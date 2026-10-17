import { PROTOCOL_VERSION, PageToServer, ServerToPage } from "./mcp/protocol";
import type { Scenario } from "./sim/scenario";

/** Where the hosted MCP server lives: a build-time setting, else localhost in development, else the public host. */
export function mcpServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_COROSIM_MCP_URL) return env.VITE_COROSIM_MCP_URL.replace(/\/$/, "");
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8787" : "https://mcp.corosim.com";
}

const TOKEN_KEY = "corosim.token", SINCE_KEY = "corosim.since";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked: signed in for this visit only */ } },
};

export interface AccountInfo { name: string | null; email: string | null; provider: string }

/**
 * The page's sign-in with the CoroSim server. Signing in goes to the server, which sends the person to Google or
 * GitHub and back here with a one-time code in the URL fragment; that is exchanged for a page token, kept in this
 * browser. The token opens the live line and the account calls below; AI connectors sign in separately (OAuth).
 */
export class Account {
  readonly server = mcpServerUrl();
  token: string | null = store.get(TOKEN_KEY);
  user: AccountInfo | null = null;
  connected: string[] = [];
  providers: string[] = [];

  get connectorUrl() { return `${this.server}/mcp`; }

  private async api(path: string, init: RequestInit = {}) {
    const res = await fetch(this.server + path, { ...init, headers: { ...(init.headers ?? {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) this.forget();
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    return body as Record<string, unknown>;
  }
  private forget() { this.token = null; this.user = null; this.connected = []; store.set(TOKEN_KEY, null); store.set(SINCE_KEY, null); }

  /** Off to the server's sign-in; the person comes back to this page. */
  signIn(provider: string) {
    location.href = `${this.server}/auth/login?provider=${encodeURIComponent(provider)}&return=${encodeURIComponent(location.href.split("#")[0])}`;
  }

  /** On load: finish a sign-in that just came back (#corosim_login=…), then find out who is signed in. */
  async load(): Promise<void> {
    const m = location.hash.match(/corosim_login=([\w-]+)/);
    if (m) {
      history.replaceState(null, "", location.href.split("#")[0]); // the code is single-use; do not leave it in the address bar
      try { const r = await this.api("/auth/exchange", { method: "POST", body: JSON.stringify({ code: m[1] }) }); this.token = r.token as string; store.set(TOKEN_KEY, this.token); }
      catch { /* expired: the person signs in again */ }
    }
    try { this.providers = ((await this.api("/auth/providers")).providers as string[]) ?? []; } catch { this.providers = []; }
    await this.refresh();
  }

  async refresh() {
    if (!this.token) { this.user = null; return; }
    try { const r = await this.api("/auth/me"); this.user = r.user as AccountInfo; this.connected = (r.connected as string[]) ?? []; }
    catch { if (!this.token) this.user = null; }
  }
  async signOut() { try { await this.api("/auth/logout", { method: "POST" }); } finally { this.forget(); } }
  async disconnectAIs() { await this.api("/auth/disconnect", { method: "POST" }); this.connected = []; }
  async deleteAccount() { await this.api("/auth/account", { method: "DELETE" }); this.forget(); }
}

export type LiveState = "off" | "connecting" | "open" | "retrying" | "replaced" | "signedout";
export interface LiveStatus { state: LiveState; clients: number; lastTool: string | null; lastClient: string | null; saved: boolean; detail?: string }

/**
 * The page's end of the account's live line: a WebSocket to the server that runs each tool call from the person's AI
 * on the patient on screen, and keeps the server's saved copy current. Reconnects with backoff if it drops.
 */
export class LiveLink {
  private ws: WebSocket | null = null;
  private wanted = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = "";
  status: LiveStatus = { state: "off", clients: 0, lastTool: null, lastClient: null, saved: false };

  constructor(
    private account: Account,
    private run: (tool: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
    private onStatus: (s: LiveStatus) => void,
    private onRestore: (scenario: Scenario) => void,
    private version = "",
  ) {}

  open() { if (!this.account.token) return this.set({ state: "signedout" }); this.wanted = true; this.retry = 0; this.connect(); }
  close() { this.wanted = false; this.clearTimer(); this.ws?.close(1000, "closed"); this.ws = null; this.set({ state: this.account.token ? "off" : "signedout", clients: 0 }); }

  /** The patient changed here: keep the server's copy current (sent only when it differs from the last one). */
  snapshot(scenario: Scenario) {
    const sig = JSON.stringify(scenario);
    if (sig === this.lastSent || this.ws?.readyState !== WebSocket.OPEN) return;
    const at = Date.now();
    this.send({ type: "snapshot", scenario, at });
    this.lastSent = sig; store.set(SINCE_KEY, String(at));
  }

  private set(p: Partial<LiveStatus>) { this.status = { ...this.status, ...p }; this.onStatus(this.status); }
  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

  private connect() {
    this.clearTimer();
    this.ws?.close();
    this.set({ state: this.retry ? "retrying" : "connecting", detail: undefined });
    const ws = new WebSocket(`${this.account.server.replace(/^http/, "ws")}/live`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0; this.lastSent = "";
      this.send({ type: "hello", protocol: PROTOCOL_VERSION, app: "corosim", version: this.version, token: this.account.token ?? "", since: Number(store.get(SINCE_KEY)) || 0 });
    };
    ws.onmessage = async (e) => {
      let m: ServerToPage;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "welcome") this.set({ state: "open" });
      else if (m.type === "status") this.set({ clients: m.clients, lastTool: m.lastTool, lastClient: m.lastClient, saved: m.saved });
      else if (m.type === "restore") { this.lastSent = JSON.stringify(m.scenario); store.set(SINCE_KEY, String(m.at)); this.onRestore(m.scenario); }
      else if (m.type === "replaced") { this.wanted = false; this.set({ state: "replaced", clients: 0 }); }
      else if (m.type === "call") {
        try { this.send({ type: "result", id: m.id, ok: true, result: await this.run(m.tool, m.args ?? {}) }); }
        catch (err) { this.send({ type: "result", id: m.id, ok: false, error: (err as Error).message }); }
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4401) { this.wanted = false; this.set({ state: "signedout", clients: 0 }); return; } // the sign-in expired or the account is gone
      if (!this.wanted) { if (this.status.state !== "replaced") this.set({ state: "off", clients: 0 }); return; }
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.set({ state: "retrying", clients: 0, detail: `Cannot reach ${this.account.server}; retrying in ${Math.round(wait / 1000)} s.` });
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }

  private send(m: PageToServer) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
}
