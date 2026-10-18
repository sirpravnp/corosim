import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Simulation } from "../sim/simulation";
import { Scenario } from "../sim/scenario";
import { TOOLS, openAiTools, anthropicTools } from "./tools";
import { MODEL_CARD, PROMPTS } from "./content";
import { SCENARIO_REFERENCE } from "../sim/llm";
import { PROTOCOL_VERSION, PageToServer, ServerToPage } from "./protocol";
import { Store } from "./db";
import { Accounts, ProviderKeys, page } from "./accounts";

export const VERSION = "0.5.0";

// ---------------------------------------------------------------- the in-chat viewer (an MCP App)
export const VIEWER_URI = "ui://corosim/viewer.html";
export const VIEWER_MIME = "text/html;profile=mcp-app";
let viewerCache: string | null | undefined;
/** The single-file viewer: next to the bundled server, or the build output in a checkout. Null if not built. */
export function viewerHtml(): string | null {
  if (viewerCache !== undefined) return viewerCache;
  const here = (() => { try { return dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); } })();
  const file = [process.env.COROSIM_VIEWER_HTML, join(here, "viewer.html"), join(process.cwd(), "dist-viewer", "index.html")].find((f) => f && existsSync(f));
  viewerCache = file ? readFileSync(file, "utf8") : null;
  return viewerCache;
}
const APP_URL = process.env.COROSIM_APP_URL ?? "https://corosim.com";

/** Runs a tool somewhere: on a local patient (stdio), on the user's open page, or on their saved patient. */
export type Exec = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export function localExec(sim = new Simulation({ seed: 1 }), appUrl = APP_URL): Exec {
  return async (name, args) => {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    return tool.run({ sim, appUrl }, args);
  };
}

/** How to be useful with this server: the same for every connection. */
const STYLE = " To show the patient (the 3D heart, live ECG and monitor appear right in the chat), call corosim_show; set_scenario, adjust, run, treat and get_state display it too. Do not hand the user a link unless they ask for one. How to be useful: lead with the clinical picture (vitals, rhythm, 12-lead ST findings, the main problem), then the mechanism, then what to do next. corosim_get_state includes the guideline assessment; act on it with corosim_adjust (support) and corosim_treat (PCI, fibrinolysis, CABG) and show what changed, before → after. When teaching, ask the learner before revealing answers (the 'rounds' prompt does this). Pick sensible values for anything a case leaves unstated and say so in one line. Mention a model limit only when it changes the answer, in one sentence. Do not report internal model parameters (autonomic tone, reflex gains, HRV) unless the user asks about autonomic physiology.";
const INSTRUCTIONS = {
  local: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation (coronary lesions → ischemia → rhythm → beat-by-beat pressure → autonomic reflexes). This connection has its own local patient. Build one with corosim_set_scenario (read corosim_get_schema first), change it with corosim_adjust, observe with corosim_run, ground explanations with corosim_explain, and use corosim_compare for what-if questions. Educational only; never present results as clinical advice. Always read the 'warnings' field: it lists anything that was clamped or dropped." + STYLE,
  // account: the signed-in user's own patient. On their screen when their page is open, saved otherwise.
  account: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation. This connection works on the signed-in user's own patient: when their CoroSim page is open every tool acts on the patient they are watching and changes appear on their screen at once; when it is closed, tools act on their saved patient and results carry a 'connection' note saying so. Start with corosim_get_state to see what they are looking at before changing anything; prefer corosim_adjust over corosim_set_scenario unless asked for a new patient, since set_scenario replaces what is on their screen. Educational only; never present results as clinical advice. Always read the 'warnings' field." + STYLE,
};

export function buildServer(exec: Exec = localExec(), mode: keyof typeof INSTRUCTIONS = "local"): Server {
  const server = new Server({ name: "corosim", version: VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS[mode] });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as { type: "object" },
      annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
      // MCP Apps: hosts that support it render the viewer with this tool's result; others ignore the key.
      ...(t.viewer && viewerHtml() ? { _meta: { ui: { resourceUri: VIEWER_URI }, "ui/resourceUri": VIEWER_URI } } : {}),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await exec(req.params.name, args);
      const structured = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : { result };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: structured };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: "corosim://model-card", name: "Model card", description: "What is simulated, what is not, calibration and how to read the numbers.", mimeType: "text/markdown" },
      { uri: "corosim://scenario-reference", name: "Scenario reference", description: "Compact scenario JSON format.", mimeType: "text/plain" },
      ...(viewerHtml() ? [{ uri: VIEWER_URI, name: "CoroSim viewer", description: "The patient in 3D with a live 12-lead ECG and monitor, shown in the chat.", mimeType: VIEWER_MIME }] : []),
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (uri === "corosim://model-card") return { contents: [{ uri, mimeType: "text/markdown", text: MODEL_CARD }] };
    if (uri === "corosim://scenario-reference") return { contents: [{ uri, mimeType: "text/plain", text: SCENARIO_REFERENCE }] };
    if (uri === VIEWER_URI) { const html = viewerHtml(); if (html) return { contents: [{ uri, mimeType: VIEWER_MIME, text: html }] }; }
    throw new Error(`Unknown resource ${uri}`);
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, description: p.description, arguments: [...p.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => ({ name: m[1], required: true })) })),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = PROMPTS[req.params.name];
    if (!p) throw new Error(`Unknown prompt ${req.params.name}`);
    const text = p.text.replace(/\{\{(\w+)\}\}/g, (_, k) => req.params.arguments?.[k] ?? `<${k}>`);
    return { description: p.description, messages: [{ role: "user", content: { type: "text", text } }] };
  });
  return server;
}

// ---------------------------------------------------------------- OpenAPI (custom GPT actions, scripts)
export function openApi(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const t of TOOLS) {
    paths[`/api/${t.name}`] = {
      post: {
        operationId: t.name, summary: t.title, description: t.description, security: [{ oauth: [] }],
        requestBody: { required: false, content: { "application/json": { schema: t.inputSchema } } },
        responses: { "200": { description: "JSON result", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "Sign in required" } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "CoroSim", version: VERSION, description: "Stochastic closed-loop cardiovascular teaching simulation, on the signed-in user's own patient. Educational only; not for clinical decisions." },
    servers: [{ url: serverUrl }], paths,
    components: { securitySchemes: { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${serverUrl}/oauth/authorize`, tokenUrl: `${serverUrl}/oauth/token`, scopes: { corosim: "Use your CoroSim patient" } } } } } },
  };
}

// ---------------------------------------------------------------- rooms: each account's patient, live on a page or saved here
interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
interface Live { ws: WebSocket; pending: Map<string, Pending>; alive: boolean }
export interface PatientStore { get(id: string): { scenario: Scenario; at: number } | undefined; put(id: string, scenario: Scenario, at?: number): void; readonly persistent: boolean }

const CLOSED_NOTE = "The user's CoroSim page is closed, so this ran on their saved patient. The change is kept, and they will see it the next time they open CoroSim.";
const ACTIVE_MS = 10 * 60_000;

/**
 * One room per account. The patient lives on the user's page while one is open (calls are forwarded there) and is
 * saved in the store, so their AI keeps working when no page is open (calls run on a server copy) and across
 * restarts. A page that connects is handed the saved patient if an AI changed it meanwhile.
 */
export class Rooms {
  private live = new Map<string, Live>();
  private twins = new Map<string, Simulation>();
  private activity = new Map<string, { lastTool: string | null; lastClient: string | null; lastCallAt: number }>();
  constructor(readonly store: PatientStore, private callTimeoutMs = 20_000, private maxRooms = 2000, private maxTwins = 200) {}
  get size() { return this.live.size; }
  has(id: string) { return this.live.has(id); }

  /** A signed-in page has said hello: it becomes the live copy of this account's patient. */
  attach(id: string, ws: WebSocket, since = 0) {
    const old = this.live.get(id);
    if (old) { this.send(old.ws, { type: "replaced" }); this.detach(id, old.ws, "the page was opened in another tab"); old.ws.close(4000, "replaced"); }
    if (this.live.size >= this.maxRooms) { ws.close(1013, "server busy"); return; }
    const room: Live = { ws, pending: new Map(), alive: true };
    this.live.set(id, room);
    this.twins.delete(id);
    ws.on("pong", () => { room.alive = true; });
    ws.on("message", (raw) => {
      let m: PageToServer;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === "snapshot") {
        if (m.scenario && typeof m.scenario === "object") this.store.put(id, m.scenario, Number(m.at) || Date.now());
      } else if (m.type === "result") {
        const p = room.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer); room.pending.delete(m.id);
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      }
    });
    ws.on("close", () => this.detach(id, ws, "the CoroSim page was closed or disconnected"));
    this.send(ws, { type: "welcome", protocol: PROTOCOL_VERSION });
    const saved = this.store.get(id);
    if (saved && saved.at > since) this.send(ws, { type: "restore", scenario: saved.scenario, at: saved.at });
    this.status(id);
  }

  private detach(id: string, ws: WebSocket, why: string) {
    const r = this.live.get(id);
    if (!r || r.ws !== ws) return;
    for (const p of r.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`No answer: ${why}.`)); }
    this.live.delete(id);
  }

  noteClient(id: string, name?: string) {
    const a = this.activity.get(id) ?? { lastTool: null, lastClient: null, lastCallAt: Date.now() };
    if (name) a.lastClient = name;
    a.lastCallAt = Date.now();
    this.activity.set(id, a);
    this.status(id);
  }

  async call(id: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const a = this.activity.get(id) ?? { lastTool: null, lastClient: null, lastCallAt: 0 };
    a.lastTool = tool; a.lastCallAt = Date.now(); this.activity.set(id, a);
    const r = this.live.get(id);
    if (r && r.ws.readyState === WebSocket.OPEN) {
      const callId = randomUUID();
      const out = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { r.pending.delete(callId); reject(new Error("The CoroSim page did not answer in time (the tab may be in the background or busy). Try again.")); }, this.callTimeoutMs);
        r.pending.set(callId, { resolve, reject, timer });
      });
      this.send(r.ws, { type: "call", id: callId, tool, args });
      this.status(id);
      return out;
    }
    const sim = this.twin(id);
    const result = await localExec(sim)(tool, args);
    if (!TOOLS.find((t) => t.name === tool)?.readOnly) this.store.put(id, sim.scenario());
    return result && typeof result === "object" && !Array.isArray(result) ? { ...(result as object), connection: { page: "closed", note: CLOSED_NOTE } } : result;
  }

  /** Forget everything held in memory for an account (it was deleted). */
  forget(id: string) {
    const r = this.live.get(id);
    if (r) { this.detach(id, r.ws, "the account was deleted"); r.ws.close(4401, "account deleted"); }
    this.twins.delete(id); this.activity.delete(id);
  }

  private twin(id: string): Simulation {
    let sim = this.twins.get(id);
    if (sim) { this.twins.delete(id); this.twins.set(id, sim); return sim; }
    sim = new Simulation();
    sim.reset(this.store.get(id)?.scenario ?? { seed: 1 }, { settled: true });
    sim.warmup(20);
    this.twins.set(id, sim);
    while (this.twins.size > this.maxTwins) this.twins.delete(this.twins.keys().next().value!);
    return sim;
  }

  private status(id: string) {
    const r = this.live.get(id), a = this.activity.get(id);
    if (!r) return;
    const active = !!a && Date.now() - a.lastCallAt < ACTIVE_MS;
    this.send(r.ws, { type: "status", clients: active ? 1 : 0, lastTool: a?.lastTool ?? null, lastClient: a?.lastClient ?? null, saved: this.store.persistent });
  }

  private send(ws: WebSocket, m: ServerToPage) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

  heartbeat() {
    for (const [id, r] of this.live) {
      if (!r.alive) { r.ws.terminate(); this.detach(id, r.ws, "the CoroSim page stopped responding"); continue; }
      r.alive = false; r.ws.ping(); this.status(id);
    }
  }
}

// ---------------------------------------------------------------- HTTP
export interface HttpOptions {
  port: number; host?: string;
  publicUrl?: string; // this server's public base (OAuth issuer); default http://<host>:<port>
  allowedOrigins?: (string | RegExp)[]; // site origins: pages that may open a live line, and where sign-in may return
  dbFile?: string; // accounts and patients; without it everything is lost on restart
  github?: ProviderKeys; google?: ProviderKeys; devLogin?: boolean;
  callsPerMinute?: number; callsPerDay?: number; callTimeoutMs?: number;
  requestsPerMinutePerAddress?: number; // all HTTP requests from one address (a classroom shares one)
  trustProxy?: boolean; // behind Fly's proxy: take the client address from its header, not the socket
  log?: (m: string) => void; fetch?: typeof fetch;
}

/** Token bucket per key: bounds how fast one account or one address can call. */
class Limiter {
  private b = new Map<string, { tokens: number; at: number }>();
  constructor(private perMinute: number) {}
  take(key: string): boolean {
    const now = Date.now(), cap = this.perMinute, e = this.b.get(key) ?? { tokens: cap, at: now };
    e.tokens = Math.min(cap, e.tokens + ((now - e.at) / 60_000) * cap); e.at = now;
    if (this.b.size > 10_000) this.b.clear();
    if (e.tokens < 1) { this.b.set(key, e); return false; }
    e.tokens -= 1; this.b.set(key, e); return true;
  }
}

export const DEFAULT_ORIGINS: (string | RegExp)[] = ["https://corosim.com", "https://www.corosim.com", /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export function startHttp(o: HttpOptions) {
  const log = o.log ?? ((m: string) => console.error(m));
  const origins = o.allowedOrigins?.length ? o.allowedOrigins : DEFAULT_ORIGINS;
  const originOk = (origin?: string) => !!origin && origins.some((x) => (typeof x === "string" ? x === origin : x.test(origin)));
  const store = new Store(o.dbFile);
  if (!store.persistent) log("no database file: accounts and patients last only until the server stops");
  const patients: PatientStore = { get: (id) => store.patient(id), put: (id, sc, at) => store.savePatient(id, sc, at), persistent: store.persistent };
  const rooms = new Rooms(patients, o.callTimeoutMs);
  const perMinute = new Limiter(o.callsPerMinute ?? 60), perIp = new Limiter(o.requestsPerMinutePerAddress ?? 600), perDay = o.callsPerDay ?? 2000;
  let accounts: Accounts | undefined;

  const ANY = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id, www-authenticate" };
  const send = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = ANY) => {
    if (res.headersSent) return;
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  // Forwarding headers are only believed behind a proxy that sets them; otherwise anyone could forge one.
  const ip = (req: IncomingMessage) => String((o.trustProxy ? req.headers["fly-client-ip"] ?? req.headers["x-forwarded-for"] : undefined) ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw Object.assign(new Error("Request body too large"), { code: 413 }); chunks.push(c as Buffer); }
    const s = Buffer.concat(chunks).toString("utf8");
    try { return s ? JSON.parse(s) : undefined; } catch { throw Object.assign(new Error("Invalid JSON"), { code: 400 }); }
  }
  /** Every tool call is counted against the account: a per-minute rate and a daily allowance. */
  const metered = (userId: string): Exec => (tool, args) => {
    if (!perMinute.take(userId)) return Promise.reject(new Error("Too many calls in a minute; slow down."));
    if (!store.spend(userId, perDay)) return Promise.reject(new Error(`Daily limit of ${perDay} calls reached for this account; it resets at midnight UTC.`));
    return rooms.call(userId, tool, args);
  };

  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "OPTIONS" && !url.pathname.startsWith("/auth/")) return send(res, 204, "");
      // A person who opens the server or the connector address in a browser gets a page saying what it is for;
      // AI clients (JSON, or an event stream) never ask for HTML and are unaffected.
      const browser = String(req.headers.accept ?? "").includes("text/html") && !String(req.headers.accept).includes("text/event-stream");
      if (req.method === "GET" && browser && (url.pathname === "/" || url.pathname === "/mcp" || url.pathname === "/mcp/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(page("Connect your AI", `
          <p>This is CoroSim's connector address for AI assistants. It is not a page to browse: paste it into your AI app.</p>
          <p><code style="font-size:13px">${accounts!.resource}</code></p>
          <ul class="muted" style="padding-left:18px">
            <li><b>Claude</b>: Settings → Connectors → Add custom connector, paste the address, then Connect and sign in.</li>
            <li><b>ChatGPT</b>: Settings → Apps &amp; Connectors → Advanced → Developer mode, then Create, paste it, and sign in.</li>
            <li><b>Claude Code</b>: <code>claude mcp add --transport http corosim ${accounts!.resource}</code></li>
          </ul>
          <a class="btn primary" href="https://corosim.com">Open CoroSim</a>`));
      }
      if ((url.pathname === "/" && req.method !== "POST") || url.pathname === "/health") {
        return send(res, 200, { name: "corosim", version: VERSION, mcp: accounts!.resource, signIn: accounts!.providers, pagesOpen: rooms.size, persistent: store.persistent });
      }
      if (!perIp.take(ip(req))) return send(res, 429, { error: "Too many requests; slow down." });
      if (await accounts!.handle(req, res, url)) return;
      if (url.pathname === "/openapi.json") return send(res, 200, openApi(accounts!.issuer));
      if (url.pathname === "/tools.openai.json") return send(res, 200, openAiTools());
      if (url.pathname === "/tools.anthropic.json") return send(res, 200, anthropicTools());

      if (url.pathname.startsWith("/api/") && req.method === "POST") {
        const tool = TOOLS.find((t) => t.name === url.pathname.slice(5));
        if (!tool) return send(res, 404, { error: "unknown tool" });
        const who = accounts!.bearer(req);
        if (!who) return accounts!.challenge(res, ANY, "/mcp");
        try { return send(res, 200, await metered(who.user.id)(tool.name, ((await readJson(req)) ?? {}) as Record<string, unknown>)); }
        catch (e) { return send(res, (e as { code?: number }).code ?? 400, { error: (e as Error).message }); }
      }

      // MCP: one URL for everyone (at /mcp, and at the bare domain since people paste that); the token says whose
      // patient. Stateless, so nothing to lose across restarts.
      if (url.pathname === "/mcp" || url.pathname === "/mcp/" || (url.pathname === "/" && req.method === "POST")) {
        if (req.method !== "POST") { res.writeHead(405, { ...ANY, allow: "POST" }); return res.end(); }
        const who = accounts!.bearer(req);
        if (!who) return accounts!.challenge(res, ANY, url.pathname);
        const body = await readJson(req);
        if (isInitializeRequest(body)) rooms.noteClient(who.user.id, (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo?.name);
        const server = buildServer(metered(who.user.id), "account");
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        return await transport.handleRequest(req, res, body);
      }
      if (url.pathname.startsWith("/mcp/")) {
        return send(res, 410, { error: `CoroSim connectors now use ${accounts!.resource} with sign-in. Remove this connector and add that URL instead.` });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      log(`error: ${(e as Error).stack ?? e}`);
      send(res, (e as { code?: number }).code ?? 500, { error: (e as Error).message });
    }
  });

  // Signed-in pages hold their account's live line at /live: the first message must carry the page token.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
  http.on("upgrade", (req, socket, head) => {
    if (!/^\/live\/?(\?|$)/.test(req.url ?? "") || !originOk(req.headers.origin)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const timer = setTimeout(() => ws.close(4401, "sign in first"), 5000);
      ws.once("message", (raw) => {
        clearTimeout(timer);
        let m: PageToServer;
        try { m = JSON.parse(String(raw)); } catch { ws.close(4400, "bad hello"); return; }
        const user = m.type === "hello" ? store.sessionUser(m.token, "page") : undefined;
        if (!user || m.type !== "hello") { ws.close(4401, "sign in first"); return; }
        rooms.attach(user.id, ws, m.since ?? 0);
      });
    });
  });

  // The OAuth issuer is this server's public URL; without one configured it is localhost on the port actually bound.
  const makeAccounts = (base: string) => new Accounts(store, { publicUrl: base, siteOrigins: origins, github: o.github, google: o.google, devLogin: o.devLogin, fetch: o.fetch });
  if (o.publicUrl) accounts = makeAccounts(o.publicUrl);
  http.listen(o.port, o.host ?? "127.0.0.1", () => {
    const addr = http.address(), port = typeof addr === "object" && addr ? addr.port : o.port;
    const a = (accounts ??= makeAccounts(`http://localhost:${port}`));
    log(`CoroSim MCP ${VERSION} on ${o.host ?? "127.0.0.1"}:${port}: ${a.resource} (sign-in: ${a.providers.join(", ") || "none configured"})`);
  });
  // Deleting an account also drops its live line and server copy.
  const del = store.deleteUser.bind(store);
  store.deleteUser = (id: string) => { rooms.forget(id); del(id); };

  const beat = setInterval(() => rooms.heartbeat(), 25_000);
  const sweep = setInterval(() => store.sweep(), 3600_000);
  let closed = false;
  const close = () => new Promise<void>((resolve) => {
    if (closed) return resolve();
    closed = true;
    clearInterval(beat); clearInterval(sweep);
    for (const c of wss.clients) c.terminate();
    wss.close(); http.closeAllConnections?.();
    http.close(() => { store.close(); resolve(); });
  });
  return { http, rooms, store, accounts: () => accounts!, close };
}
