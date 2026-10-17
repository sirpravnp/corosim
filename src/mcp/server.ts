import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Simulation } from "../sim/simulation";
import { TOOLS, openAiTools, anthropicTools, ToolContext } from "./tools";
import { MODEL_CARD, PROMPTS } from "./content";
import { SCENARIO_REFERENCE } from "../sim/llm";

const VERSION = "0.1.0";
const APP_URL = process.env.COROSIM_APP_URL ?? "https://corosim.com";

/** One MCP server instance wraps one simulated patient; remote sessions each get their own. */
export function buildServer(sim = new Simulation({ seed: 1 })): Server {
  const ctx: ToolContext = { sim, appUrl: APP_URL };
  const server = new Server({ name: "corosim", version: VERSION }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: "CoroSim is a stochastic, closed-loop cardiovascular teaching simulation (coronary lesions → ischemia → rhythm → beat-by-beat pressure → baroreflex). Build a patient with corosim_set_scenario (read corosim_get_schema first), change it with corosim_adjust, observe with corosim_run, ground explanations with corosim_explain, and use corosim_compare for what-if questions. Educational only; never present results as clinical advice. Always read the 'warnings' field: it lists anything that was clamped or dropped.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" }, annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool ${req.params.name}` }] };
    try {
      const result = tool.run(ctx, (req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] };
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

// ---------------------------------------------------------------- OpenAPI (for custom GPT actions and anything REST)
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

// ---------------------------------------------------------------- HTTP: MCP (Streamable HTTP) + REST
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 1_000_000) throw new Error("body too large"); chunks.push(c as Buffer); }
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : undefined;
}

export function startHttp(port: number, host = "127.0.0.1") {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const rest = new Map<string, { sim: Simulation; last: number }>();
  const send = (res: ServerResponse, code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "mcp-session-id" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (url.pathname === "/" || url.pathname === "/health") return send(res, 200, { name: "corosim", version: VERSION, mcp: "/mcp", openapi: "/openapi.json" });
      if (url.pathname === "/openapi.json") return send(res, 200, openApi(`http://${req.headers.host}`));
      if (url.pathname === "/tools.openai.json") return send(res, 200, openAiTools());
      if (url.pathname === "/tools.anthropic.json") return send(res, 200, anthropicTools());
      if (url.pathname.startsWith("/api/") && req.method === "POST") {
        const tool = TOOLS.find((t) => t.name === url.pathname.slice(5));
        if (!tool) return send(res, 404, { error: "unknown tool" });
        const id = String(req.headers["x-session-id"] ?? "default");
        let s = rest.get(id);
        if (!s) { if (rest.size > 200) { const old = [...rest.entries()].sort((a, b) => a[1].last - b[1].last)[0]; rest.delete(old[0]); } s = { sim: new Simulation({ seed: 1 }), last: 0 }; rest.set(id, s); }
        s.last = Date.now();
        try { return send(res, 200, tool.run({ sim: s.sim, appUrl: APP_URL }, ((await readJson(req)) ?? {}) as Record<string, unknown>)); }
        catch (e) { return send(res, 400, { error: (e as Error).message }); }
      }
      if (url.pathname === "/mcp") {
        const sid = req.headers["mcp-session-id"] as string | undefined;
        const body = req.method === "POST" ? await readJson(req) : undefined;
        let transport = sid ? transports.get(sid) : undefined;
        if (!transport && req.method === "POST" && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { transports.set(id, transport!); } });
          transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId); };
          await buildServer().connect(transport);
        }
        if (!transport) return send(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "No valid session; send initialize first." }, id: null });
        return await transport.handleRequest(req, res, body);
      }
      send(res, 404, { error: "not found" });
    } catch (e) { send(res, 500, { error: (e as Error).message }); }
  });
  http.listen(port, host, () => console.error(`CoroSim MCP over HTTP: http://${host}:${port}/mcp  (REST /api/<tool>, /openapi.json)`));
  return http;
}
