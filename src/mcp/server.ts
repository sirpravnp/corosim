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
  private: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation (coronary lesions → ischemia → rhythm → beat-by-beat pressure → autonomic reflexes). This connection has its own private patient. Build one with corosim_set_scenario (read corosim_get_schema first), change it with corosim_adjust, observe with corosim_run, ground explanations with corosim_explain, and use corosim_compare for what-if questions. Educational only; never present results as clinical advice. Always read the 'warnings' field: it lists anything that was clamped or dropped.",
  live: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation. This connection is linked to a CoroSim page the user has open: every tool acts on the patient they are watching, and changes appear on their screen at once. Start with corosim_get_state to see what they are looking at before changing anything; prefer corosim_adjust over corosim_set_scenario unless asked for a new patient, since set_scenario replaces what is on their screen. Educational only; never present results as clinical advice. Always read the 'warnings' field.",
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

// ---------------------------------------------------------------- live rooms: pages that lend their patient to an AI
interface Room { ws: WebSocket; pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>; clients: Set<string>; lastTool: string | null; lastClient: string | null; alive: boolean }

export class Rooms {
  private rooms = new Map<string, Room>();
  constructor(private callTimeoutMs = 20_000, private maxRooms = 2000) {}
  get size() { return this.rooms.size; }
  has(id: string) { return this.rooms.has(id); }

  attach(id: string, ws: WebSocket) {
    const old = this.rooms.get(id);
    if (old) { this.send(old.ws, { type: "replaced" }); this.detach(id, old.ws, "the page was opened in another tab"); old.ws.close(4000, "replaced"); }
    if (this.rooms.size >= this.maxRooms) { ws.close(1013, "server busy"); return; }
    const room: Room = { ws, pending: new Map(), clients: new Set(old?.clients ?? []), lastTool: null, lastClient: null, alive: true };
    this.rooms.set(id, room);
    ws.on("pong", () => { room.alive = true; });
    ws.on("message", (raw) => {
      let m: PageToServer;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type !== "result") return;
      const p = room.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer); room.pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    });
    ws.on("close", () => this.detach(id, ws, "the CoroSim page was closed or disconnected"));
    this.send(ws, { type: "welcome", protocol: PROTOCOL_VERSION });
    this.status(id);
  }

  private detach(id: string, ws: WebSocket, why: string) {
    const r = this.rooms.get(id);
    if (!r || r.ws !== ws) return;
    for (const p of r.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`No answer: ${why}.`)); }
    this.rooms.delete(id);
  }

  /** An MCP session joined or left this room: the page shows who is connected. */
  client(id: string, session: string, joined: boolean, name?: string) {
    const r = this.rooms.get(id);
    if (!r) return;
    if (joined) { r.clients.add(session); if (name) r.lastClient = name; } else r.clients.delete(session);
    this.status(id);
  }

  call(id: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const r = this.rooms.get(id);
    if (!r || r.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The CoroSim page for this connector is not open. Ask the user to open CoroSim and click 'Open a connection' under 'Connect your AI'."));
    }
    const callId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { r.pending.delete(callId); reject(new Error("The CoroSim page did not answer in time (the tab may be in the background or busy).")); }, this.callTimeoutMs);
      r.pending.set(callId, { resolve, reject, timer });
      r.lastTool = tool;
      this.send(r.ws, { type: "call", id: callId, tool, args });
      this.status(id);
    });
  }

  private status(id: string) {
    const r = this.rooms.get(id);
    if (r) this.send(r.ws, { type: "status", clients: r.clients.size, lastTool: r.lastTool, lastClient: r.lastClient });
  }

  private send(ws: WebSocket, m: ServerToPage) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

  /** Drop pages that stopped answering pings. */
  heartbeat() {
    for (const [id, r] of this.rooms) {
      if (!r.alive) { r.ws.terminate(); this.detach(id, r.ws, "the CoroSim page stopped responding"); continue; }
      r.alive = false; r.ws.ping();
    }
  }
}

// ---------------------------------------------------------------- HTTP
export interface HttpOptions {
  port: number; host?: string;
  allowedOrigins?: string[]; // pages allowed to open live rooms; default corosim.com and localhost
  sessionIdleMs?: number; maxSessions?: number; callsPerMinute?: number; callTimeoutMs?: number;
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
  const rooms = new Rooms(o.callTimeoutMs);
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
        return send(res, 200, { name: "corosim", version: VERSION, mcp: `${base}/mcp`, live: `${base}/mcp/<room>`, openapi: `${base}/openapi.json`, sessions: sessions.size, liveRooms: rooms.size });
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

      // MCP: /mcp is a private patient per session; /mcp/<room> is the user's live page.
      const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
      if (m) {
        const room = m[1] ?? null;
        if (room !== null && !ROOM_RE.test(room)) return send(res, 404, { error: "Unknown connector URL." });
        const sid = req.headers["mcp-session-id"] as string | undefined;
        const body = req.method === "POST" ? await readJson(req) : undefined;
        let entry = sid ? sessions.get(sid) : undefined;
        if (entry && entry.room !== room) return send(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "Session belongs to a different connector URL." }, id: null });
        if (!entry && req.method === "POST" && isInitializeRequest(body)) {
          evictIdle();
          if (sessions.size >= maxSessions) return send(res, 503, { jsonrpc: "2.0", error: { code: -32000, message: "Server busy; try again shortly." }, id: null });
          const clientName = (body as { params?: { clientInfo?: { name?: string } } }).params?.clientInfo?.name;
          const exec: Exec = room ? (tool, args) => rooms.call(room, tool, args) : localExec();
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { sessions.set(id, { transport, room, last: Date.now() }); if (room) rooms.client(room, id, true, clientName); },
          });
          transport.onclose = () => { const id = transport.sessionId; if (!id) return; sessions.delete(id); if (room) rooms.client(room, id, false); };
          const limited: Exec = (tool, args) => (limiter.take(ip(req)) ? exec(tool, args) : Promise.reject(new Error("Too many calls in a minute; slow down.")));
          await buildServer(limited, room ? "live" : "private").connect(transport);
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
  http.on("close", () => clearInterval(beat));

  http.listen(o.port, o.host ?? "127.0.0.1", () => log(`CoroSim MCP ${VERSION}: http://${o.host ?? "127.0.0.1"}:${o.port}/mcp (private patient), /mcp/<room> (live page), /live/<room> (pages), /openapi.json`));
  const close = () => new Promise<void>((resolve) => {
    clearInterval(beat);
    for (const s of sessions.values()) void s.transport.close();
    for (const c of wss.clients) c.terminate();
    wss.close(); http.close(() => resolve()); http.closeAllConnections?.();
  });
  return { http, rooms, close };
}
