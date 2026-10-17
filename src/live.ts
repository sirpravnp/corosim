import { PROTOCOL_VERSION, ROOM_RE, newRoomId, PageToServer, ServerToPage } from "./mcp/protocol";
import type { Scenario } from "./sim/scenario";

/** Where the hosted MCP server lives: a build-time setting, else localhost in development, else the public host. */
export function mcpServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_COROSIM_MCP_URL) return env.VITE_COROSIM_MCP_URL.replace(/\/$/, "");
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8787" : "https://mcp.corosim.com";
}

export type LiveState = "off" | "connecting" | "open" | "retrying" | "replaced";
export interface LiveStatus { state: LiveState; clients: number; lastTool: string | null; lastClient: string | null; saved: boolean; detail?: string }

const ROOM_KEY = "corosim.room", ON_KEY = "corosim.live", SINCE_KEY = "corosim.since";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked: the URL lasts this visit */ } },
};

/**
 * The page's end of a live AI connection. It holds a WebSocket to the MCP server's room for this browser, runs each
 * forwarded tool call through `run`, and reconnects with backoff if the line drops. The room id persists in this
 * browser, so the connector URL a user adds to Claude or ChatGPT keeps working across visits; it can also be set to a
 * URL from another device, so one connector serves all of them.
 *
 * The server keeps the room's patient. The page sends it a snapshot whenever the patient changes, and when it
 * connects it is handed the saved one (`restore`) if an AI changed it while the page was closed.
 */
export class LiveLink {
  readonly server = mcpServerUrl();
  room: string;
  private ws: WebSocket | null = null;
  private wanted = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  status: LiveStatus = { state: "off", clients: 0, lastTool: null, lastClient: null, saved: false };
  private lastSent = "";

  constructor(
    private run: (tool: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
    private onStatus: (s: LiveStatus) => void,
    private onRestore: (scenario: Scenario) => void,
    private version = "",
  ) {
    const saved = store.get(ROOM_KEY);
    this.room = saved && ROOM_RE.test(saved) ? saved : newRoomId();
    store.set(ROOM_KEY, this.room);
  }

  get connectorUrl() { return `${this.server}/mcp/${this.room}`; }
  /** Was a connection open last time this browser was here? Then reopen it on load. */
  get remembered() { return store.get(ON_KEY) === "1"; }

  open() { this.wanted = true; store.set(ON_KEY, "1"); this.retry = 0; this.connect(); }
  close() { this.wanted = false; store.set(ON_KEY, null); this.clearTimer(); this.ws?.close(1000, "closed by user"); this.ws = null; this.set({ state: "off", clients: 0 }); }
  /** Retire the old URL: anyone holding it loses access. */
  rotate() { this.switchTo(newRoomId()); }

  /** Use a connector URL (or bare room id) from another device, so the same connector reaches this browser too. */
  useUrl(text: string): boolean {
    const id = text.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
    if (!ROOM_RE.test(id)) return false;
    this.switchTo(id);
    return true;
  }

  private switchTo(id: string) {
    const was = this.wanted;
    this.close();
    this.room = id; store.set(ROOM_KEY, id); store.set(SINCE_KEY, null); this.lastSent = "";
    if (was) this.open(); else this.set({});
  }

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
    const ws = new WebSocket(`${this.server.replace(/^http/, "ws")}/live/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0; this.lastSent = "";
      this.send({ type: "hello", protocol: PROTOCOL_VERSION, app: "corosim", version: this.version, since: Number(store.get(SINCE_KEY)) || 0 });
      this.set({ state: "open" });
    };
    ws.onmessage = async (e) => {
      let m: ServerToPage;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "status") this.set({ clients: m.clients, lastTool: m.lastTool, lastClient: m.lastClient, saved: m.saved });
      else if (m.type === "restore") { this.lastSent = JSON.stringify(m.scenario); store.set(SINCE_KEY, String(m.at)); this.onRestore(m.scenario); }
      else if (m.type === "replaced") { this.wanted = false; this.set({ state: "replaced", clients: 0 }); }
      else if (m.type === "call") {
        try { this.send({ type: "result", id: m.id, ok: true, result: await this.run(m.tool, m.args ?? {}) }); }
        catch (err) { this.send({ type: "result", id: m.id, ok: false, error: (err as Error).message }); }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) { if (this.status.state !== "replaced") this.set({ state: "off", clients: 0 }); return; }
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.set({ state: "retrying", clients: 0, detail: `Cannot reach ${this.server}; retrying in ${Math.round(wait / 1000)} s.` });
      this.timer = setTimeout(() => this.connect(), wait);
    };
  }

  private send(m: PageToServer) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
}
