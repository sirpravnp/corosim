import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Simulation } from "../sim/simulation";
import { TOOLS, openAiTools, anthropicTools } from "./tools";
import { MODEL_CARD, PROMPTS } from "./content";
import { SCENARIO_REFERENCE } from "../sim/llm";
import { PROTOCOL_VERSION, ROOM_RE, PageToServer, ServerToPage } from "./protocol";
import { RoomStore } from "./roomStore";

export const VERSION = "0.2.0";
const APP_URL = process.env.COROSIM_APP_URL ?? "https://corosim.com";

/** Runs a tool somewhere: on a private headless patient, or on a live page. */
export type Exec = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export function localExec(sim = new Simulation({ seed: 1 }), appUrl = APP_URL): Exec {
  return async (name, args) => {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    return tool.run({ sim, appUrl }, args);
  };
}

const INSTRUCTIONS = {
  // live: a connector URL. The patient is the user's; it is on their screen when their page is open, saved otherwise.
  private: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation (coronary lesions → ischemia → rhythm → beat-by-beat pressure → autonomic reflexes). This connection has its own private patient. Build one with corosim_set_scenario (read corosim_get_schema first), change it with corosim_adjust, observe with corosim_run, ground explanations with corosim_explain, and use corosim_compare for what-if questions. Educational only; never present results as clinical advice. Always read the 'warnings' field: it lists anything that was clamped or dropped.",
  live: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation. This connection is the user's own patient: when their CoroSim page is open every tool acts on the patient they are watching and changes appear on their screen at once; when it is closed, tools act on their saved patient and results carry a 'connection' note saying so. Start with corosim_get_state to see what they are looking at before changing anything; prefer corosim_adjust over corosim_set_scenario unless asked for a new patient, since set_scenario replaces what is on their screen. Educational only; never present results as clinical advice. Always read the 'warnings' field.",
};

/** One MCP server instance per session. */
export function buildServer(exec: Exec = localExec(), mode: keyof typeof INSTRUCTIONS = "private", onCall?: (tool: string) => void): Server {
  const server = new Server({ name: "corosim", version: VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS[mode] });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as { type: "object" }, annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    onCall?.(req.params.name);
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
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (uri === "corosim://model-card") return { contents: [{ uri, mimeType: "text/markdown", text: MODEL_CARD }] };
    if (uri === "corosim://scenario-reference") return { contents: [{ uri, mimeType: "text/plain", text: SCENARIO_REFERENCE }] };
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

// ---------------------------------------------------------------- OpenAPI (custom GPT actions, anything REST)
export function openApi(serverUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const t of TOOLS) {
    paths[`/api/${t.name}`] = {
      post: {
        operationId: t.name, summary: t.title, description: t.description,
        requestBody: { required: false, content: { "application/json": { schema: t.inputSchema } } },
        responses: { "200": { description: "JSON result", content: { "application/json": { schema: { type: "object" } } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "CoroSim", version: VERSION, description: "Stochastic closed-loop cardiovascular teaching simulation. Send an `x-session-id` header to keep a patient between calls. Educational only; not for clinical decisions." },
    servers: [{ url: serverUrl }], paths,
  };
}

// ---------------------------------------------------------------- rooms: a connector URL's patient, live on a page or saved here
interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
interface Live { ws: WebSocket; pending: Map<string, Pending>; alive: boolean }

const CLOSED_NOTE = "The user's CoroSim page is closed, so this ran on their saved patient. The change is kept, and they will see it the next time they open CoroSim.";
const ACTIVE_MS = 10 * 60_000;

/**
 * Each room is a connector URL. Its patient lives on the user's page while one is open (calls are forwarded there)
 * and is saved here, so the URL keeps working when no page is open (calls run on a server copy) and across
 * restarts (the store is on disk). A page that connects gets the saved patient if an AI changed it meanwhile.
 */
export class Rooms {
  private live = new Map<string, Live>();
  private twins = new Map<string, Simulation>(); // server copies for rooms with no page open
  private activity = new Map<string, { lastTool: string | null; lastClient: string | null; lastCallAt: number }>();
  constructor(readonly store: RoomStore, private callTimeoutMs = 20_000, private maxRooms = 2000, private maxTwins = 200) {}
  get size() { return this.live.size; }
  has(id: string) { return this.live.has(id); }

  attach(id: string, ws: WebSocket) {
    const old = this.live.get(id);
    if (old) { this.send(old.ws, { type: "replaced" }); this.detach(id, old.ws, "the page was opened in another tab"); old.ws.close(4000, "replaced"); }
    if (this.live.size >= this.maxRooms) { ws.close(1013, "server busy"); return; }
    const room: Live = { ws, pending: new Map(), alive: true };
    this.live.set(id, room);
    this.twins.delete(id); // the page is the live copy now
    ws.on("pong", () => { room.alive = true; });
    ws.on("message", (raw) => {
      let m: PageToServer;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === "hello") {
        const saved = this.store.get(id);
        if (saved && saved.at > (m.since ?? 0)) this.send(ws, { type: "restore", scenario: saved.scenario, at: saved.at });
        this.status(id);
      } else if (m.type === "snapshot") {
        if (m.scenario && typeof m.scenario === "object") this.store.put(id, m.scenario, { at: Number(m.at) || Date.now() });
      } else if (m.type === "result") {
        const p = room.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer); room.pending.delete(m.id);
        m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      }
    });
    ws.on("close", () => this.detach(id, ws, "the CoroSim page was closed or disconnected"));
    this.send(ws, { type: "welcome", protocol: PROTOCOL_VERSION });
  }

  private detach(id: string, ws: WebSocket, why: string) {
    const r = this.live.get(id);
    if (!r || r.ws !== ws) return;
    for (const p of r.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`No answer: ${why}.`)); }
    this.live.delete(id);
  }

  /** An AI introduced itself on this room (its MCP initialize). */
  noteClient(id: string, name?: string) {
    const a = this.activity.get(id) ?? { lastTool: null, lastClient: null, lastCallAt: Date.now() };
    if (name) a.lastClient = name;
    a.lastCallAt = Date.now();
    this.activity.set(id, a);
    this.store.touch(id, name);
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
    // No page open: run on the saved patient, and save what changed.
    const sim = this.twin(id);
    const result = await localExec(sim)(tool, args);
    const tool_ = TOOLS.find((t) => t.name === tool);
    if (tool_ && !tool_.readOnly) this.store.put(id, sim.scenario());
    else this.store.touch(id);
    return result && typeof result === "object" && !Array.isArray(result) ? { ...(result as object), connection: { page: "closed", note: CLOSED_NOTE } } : result;
  }

  private twin(id: string): Simulation {
    let sim = this.twins.get(id);
    if (sim) { this.twins.delete(id); this.twins.set(id, sim); return sim; }
    const saved = this.store.get(id);
    sim = new Simulation();
    sim.reset(saved?.scenario ?? { seed: 1 }, { settled: true });
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

  /** Drop pages that stopped answering pings; refresh "AI connected" as activity ages out. */
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
  allowedOrigins?: string[]; // pages allowed to open live rooms; default corosim.com and localhost
  sessionIdleMs?: number; maxSessions?: number; callsPerMinute?: number; callTimeoutMs?: number;
  dataDir?: string; // where connector patients are saved; without it they last until the process ends
  log?: (m: string) => void;
}

/** Token bucket per client address: bounds how much CPU one caller can spend. */
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

const DEFAULT_ORIGINS = ["https://corosim.com", "https://www.corosim.com", /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

export function startHttp(o: HttpOptions): { http: HttpServer; rooms: Rooms; close: () => Promise<void> } {
  const log = o.log ?? ((m: string) => console.error(m));
  const idleMs = o.sessionIdleMs ?? 30 * 60_000, maxSessions = o.maxSessions ?? 1000;
  const origins: (string | RegExp)[] = o.allowedOrigins?.length ? o.allowedOrigins : DEFAULT_ORIGINS;
  const originOk = (origin?: string) => !!origin && origins.some((x) => (typeof x === "string" ? x === origin : x.test(origin)));
  const rooms = new Rooms(new RoomStore(o.dataDir, 90, 5000, log), o.callTimeoutMs);
  const limiter = new Limiter(o.callsPerMinute ?? 120);
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; room: string | null; last: number }>();
  const rest = new Map<string, { exec: Exec; last: number }>();

  const send = (res: ServerResponse, code: number, body: unknown) => {
    if (res.headersSent) return;
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-expose-headers": "mcp-session-id" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const ip = (req: IncomingMessage) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw Object.assign(new Error("Request body too large"), { code: 413 }); chunks.push(c as Buffer); }
    const s = Buffer.concat(chunks).toString("utf8");
    try { return s ? JSON.parse(s) : undefined; } catch { throw Object.assign(new Error("Invalid JSON"), { code: 400 }); }
  }
  const evictIdle = () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.last > idleMs) { void s.transport.close(); sessions.delete(id); }
    for (const [id, s] of rest) if (now - s.last > idleMs) rest.delete(id);
  };

  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const base = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (url.pathname === "/" || url.pathname === "/health") {
        return send(res, 200, { name: "corosim", version: VERSION, mcp: `${base}/mcp`, live: `${base}/mcp/<room>`, openapi: `${base}/openapi.json`, sessions: sessions.size, pagesOpen: rooms.size, persistent: rooms.store.persistent });
      }
      if (url.pathname === "/openapi.json") return send(res, 200, openApi(base));
      if (url.pathname === "/tools.openai.json") return send(res, 200, openAiTools());
      if (url.pathname === "/tools.anthropic.json") return send(res, 200, anthropicTools());

      if (url.pathname.startsWith("/api/") && req.method === "POST") {
        const tool = TOOLS.find((t) => t.name === url.pathname.slice(5));
        if (!tool) return send(res, 404, { error: "unknown tool" });
        if (!limiter.take(ip(req))) return send(res, 429, { error: "Too many calls; slow down." });
        const id = String(req.headers["x-session-id"] ?? "default").slice(0, 128);
        let s = rest.get(id);
        if (!s) { evictIdle(); if (rest.size >= maxSessions) return send(res, 503, { error: "Server busy." }); s = { exec: localExec(), last: 0 }; rest.set(id, s); }
        s.last = Date.now();
        try { return send(res, 200, await s.exec(tool.name, ((await readJson(req)) ?? {}) as Record<string, unknown>)); }
        catch (e) { return send(res, (e as { code?: number }).code ?? 400, { error: (e as Error).message }); }
      }

      // MCP: /mcp/<room> is a connector URL with a saved patient. It is stateless: no session to lose, so it keeps
      // working across restarts, deploys and idle time. /mcp is a private patient per session (stateful).
      const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
      if (m && m[1] !== undefined) {
        const room = m[1];
        if (!ROOM_RE.test(room)) return send(res, 404, { error: "Unknown connector URL." });
        if (req.method !== "POST") { res.writeHead(405, { allow: "POST", "access-control-allow-origin": "*" }); return res.end(); }
        const body = await readJson(req);
        if (isInitializeRequest(body)) rooms.noteClient(room, (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo?.name);
        const exec: Exec = (tool, args) => (limiter.take(ip(req)) ? rooms.call(room, tool, args) : Promise.reject(new Error("Too many calls in a minute; slow down.")));
        const server = buildServer(exec, "live");
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        return await transport.handleRequest(req, res, body);
      }
      if (m) {
        const sid = req.headers["mcp-session-id"] as string | undefined;
        const body = req.method === "POST" ? await readJson(req) : undefined;
        const entry = sid ? sessions.get(sid) : undefined;
        if (!entry && req.method === "POST" && isInitializeRequest(body)) {
          evictIdle();
          if (sessions.size >= maxSessions) return send(res, 503, { jsonrpc: "2.0", error: { code: -32000, message: "Server busy; try again shortly." }, id: null });
          const exec = localExec();
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { sessions.set(id, { transport, room: null, last: Date.now() }); },
          });
          transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
          const limited: Exec = (tool, args) => (limiter.take(ip(req)) ? exec(tool, args) : Promise.reject(new Error("Too many calls in a minute; slow down.")));
          await buildServer(limited, "private").connect(transport);
          return await transport.handleRequest(req, res, body);
        }
        if (!entry) return send(res, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found or expired; reconnect." }, id: null });
        entry.last = Date.now();
        return await entry.transport.handleRequest(req, res, body);
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      log(`error: ${(e as Error).stack ?? e}`);
      send(res, (e as { code?: number }).code ?? 500, { error: (e as Error).message });
    }
  });

  // Pages open their live room over a WebSocket at /live/<room>.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
  http.on("upgrade", (req, socket, head) => {
    const m = (req.url ?? "").match(/^\/live\/([^/?#]+)/);
    if (!m || !ROOM_RE.test(m[1]) || !originOk(req.headers.origin)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => rooms.attach(m[1], ws));
  });
  const beat = setInterval(() => { rooms.heartbeat(); evictIdle(); }, 25_000);
  const purge = setInterval(() => rooms.store.purge(), 6 * 3600_000);
  http.on("close", () => { clearInterval(beat); clearInterval(purge); rooms.store.flush(); });

  http.listen(o.port, o.host ?? "127.0.0.1", () => log(`CoroSim MCP ${VERSION}: http://${o.host ?? "127.0.0.1"}:${o.port}/mcp (private patient), /mcp/<room> (live page), /live/<room> (pages), /openapi.json`));
  const close = () => new Promise<void>((resolve) => {
    clearInterval(beat); clearInterval(purge); rooms.store.flush();
    for (const s of sessions.values()) void s.transport.close();
    for (const c of wss.clients) c.terminate();
    wss.close(); http.close(() => resolve()); http.closeAllConnections?.();
  });
  return { http, rooms, close };
}
