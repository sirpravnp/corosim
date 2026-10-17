import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttp, localExec } from "../src/mcp/server";
import { newRoomId, ServerToPage } from "../src/mcp/protocol";
import { Simulation } from "../src/sim/simulation";

/** The hosted server on a random port, with the same transport Claude and ChatGPT use. */
let srv: ReturnType<typeof startHttp>, base = "";
beforeAll(async () => {
  srv = startHttp({ port: 0, callsPerMinute: 1000, callTimeoutMs: 2000, log: () => {} });
  await new Promise((r) => srv.http.once("listening", r));
  base = `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
});
afterAll(async () => { await srv.close(); });

async function mcp(path: string) {
  const client = new Client({ name: "test-assistant", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + path)));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text), structured: r.structuredContent };
  };
  return { client, call };
}

/** A stand-in for the CoroSim page: its own patient, answering forwarded calls exactly as the app does. */
async function page(room: string, origin = "http://localhost:5173", since = 0) {
  const sim = new Simulation({ seed: 3 }), exec = localExec(sim), seen: ServerToPage[] = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/live/${room}`, { headers: { origin } });
  ws.on("message", async (raw) => {
    const m = JSON.parse(String(raw)) as ServerToPage;
    seen.push(m);
    if (m.type !== "call") return;
    try { ws.send(JSON.stringify({ type: "result", id: m.id, ok: true, result: await exec(m.tool, m.args) })); }
    catch (e) { ws.send(JSON.stringify({ type: "result", id: m.id, ok: false, error: (e as Error).message })); }
  });
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.once("error", rej); });
  ws.send(JSON.stringify({ type: "hello", protocol: 2, app: "corosim", version: "test", since }));
  return { sim, ws, seen };
}
const until = async (f: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };

describe("hosted MCP server: private patients", () => {
  it("serves health, OpenAPI and a full MCP session over Streamable HTTP", async () => {
    const h = await (await fetch(base + "/health")).json();
    expect(h.name).toBe("corosim");
    expect(Object.keys((await (await fetch(base + "/openapi.json")).json()).paths).length).toBeGreaterThan(5);
    const { client, call } = await mcp("/mcp");
    expect((await client.listTools()).tools.length).toBeGreaterThan(5);
    const r = await call("corosim_set_scenario", { scenario: { bloodLoss: 0.3 }, warmupSeconds: 30 });
    expect(r.isError).toBe(false);
    expect((r.structured as { state: { rolling10s: { hr: number } } }).state.rolling10s.hr).toBeGreaterThan(90);
    await client.close();
  });
  it("gives every session its own patient", async () => {
    const a = await mcp("/mcp"), b = await mcp("/mcp");
    await a.call("corosim_set_scenario", { scenario: { drugs: { betaBlocker: 1 } }, warmupSeconds: 5 });
    expect((await b.call("corosim_get_state")).data.scenario.drugs.betaBlocker).toBe(0);
    await a.client.close(); await b.client.close();
  });
  it("rejects unknown sessions and malformed connector URLs", async () => {
    const res = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "nope" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(404);
    expect((await fetch(base + "/mcp/short", { method: "POST" })).status).toBe(404);
  });
});

describe("hosted MCP server: live connection to a page", () => {
  it("forwards tool calls to the page's patient and tells the page who is connected", async () => {
    const room = newRoomId(), p = await page(room);
    const { client, call } = await mcp(`/mcp/${room}`);
    await until(() => p.seen.some((m) => m.type === "status" && m.clients === 1 && m.lastClient === "test-assistant"));
    const r = await call("corosim_adjust", { patch: { lesions: [{ artery: "RCA", occluded: true }] }, runSeconds: 5 });
    expect(r.isError).toBe(false);
    expect(p.sim.n.lesionSpecs[0].artery).toBe("RCA"); // it happened on the page's own patient
    expect((await call("corosim_get_state")).data.scenario.lesions[0].artery).toBe("RCA");
    await client.close(); p.ws.close();
  });
  it("with the page closed, the AI works on the saved patient; the page picks it up when it opens", async () => {
    const room = newRoomId();
    const { client, call } = await mcp(`/mcp/${room}`);
    const r = await call("corosim_adjust", { patch: { lesions: [{ artery: "LCX", stenosis: 0.9 }] }, runSeconds: 5 });
    expect(r.isError).toBe(false);
    expect(r.data.connection.page).toBe("closed");
    expect((await call("corosim_get_state")).data.scenario.lesions[0].artery).toBe("LCX"); // remembered between calls
    const p = await page(room);
    await until(() => p.seen.some((m) => m.type === "restore"));
    const restore = p.seen.find((m) => m.type === "restore") as Extract<ServerToPage, { type: "restore" }>;
    expect(restore.scenario.lesions![0].artery).toBe("LCX");
    await client.close(); p.ws.close();
  });
  it("a page that already has the newest patient is not sent it again", async () => {
    const room = newRoomId();
    const { client, call } = await mcp(`/mcp/${room}`);
    await call("corosim_adjust", { patch: { bloodLoss: 0.1 }, runSeconds: 1 });
    const p = await page(room, undefined, Date.now() + 60_000);
    await until(() => p.seen.some((m) => m.type === "status"));
    expect(p.seen.some((m) => m.type === "restore")).toBe(false);
    await client.close(); p.ws.close();
  });
  it("edits made on the page are what the AI sees after the page closes", async () => {
    const room = newRoomId(), p = await page(room);
    p.ws.send(JSON.stringify({ type: "snapshot", scenario: { bloodLoss: 0.25, seed: 4 }, at: Date.now() }));
    await new Promise((r) => setTimeout(r, 50));
    p.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const { client, call } = await mcp(`/mcp/${room}`);
    expect((await call("corosim_get_state")).data.scenario.bloodLoss).toBe(0.25);
    await client.close();
  });
  it("passes the page's own errors back to the AI", async () => {
    const room = newRoomId(), p = await page(room);
    const { client, call } = await mcp(`/mcp/${room}`);
    const r = await call("corosim_compare", { scenarios: [{ label: "only one", scenario: {} }] });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/at least two/);
    await client.close(); p.ws.close();
  });
  it("a second tab takes over the room; the first is told", async () => {
    const room = newRoomId(), first = await page(room), second = await page(room);
    await until(() => first.seen.some((m) => m.type === "replaced"));
    const { client, call } = await mcp(`/mcp/${room}`);
    await call("corosim_adjust", { patch: { bloodLoss: 0.2 }, runSeconds: 1 });
    expect(second.sim.n.bloodLoss).toBe(0.2); expect(first.sim.n.bloodLoss).toBe(0);
    await client.close(); second.ws.close();
  });
  it("only pages from allowed origins can open a room", async () => {
    await expect(page(newRoomId(), "https://evil.example")).rejects.toThrow(/403/);
  });
});

describe("hosted MCP server: connectors survive restarts", () => {
  it("the same connector, the same client, across a server restart, with no reconnect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "corosim-rooms-"));
    const a = startHttp({ port: 0, dataDir: dir, log: () => {} });
    await new Promise((r) => a.http.once("listening", r));
    const port = (a.http.address() as AddressInfo).port, room = newRoomId();
    const client = new Client({ name: "claude", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${room}`)));
    await client.callTool({ name: "corosim_adjust", arguments: { patch: { lesions: [{ artery: "RCA", occluded: true }] }, runSeconds: 1 } });
    await a.close();
    expect(readdirSync(dir).some((f) => f.startsWith(room))).toBe(true);

    const b = startHttp({ port, dataDir: dir, log: () => {} });
    await new Promise((r) => b.http.once("listening", r));
    const r = await client.callTool({ name: "corosim_get_state", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as { text: string }[])[0].text).scenario.lesions[0].artery).toBe("RCA");
    await client.close(); await b.close();
  });
  it("a connector whose client kept an old session id still works (stateless)", async () => {
    const room = newRoomId();
    const res = await fetch(`${base}/mcp/${room}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "from-before-a-deploy" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).result.tools.length).toBeGreaterThan(5);
  });
});

describe("hosted MCP server: limits", () => {
  it("rate-limits tool calls per caller", async () => {
    const s = startHttp({ port: 0, callsPerMinute: 3, log: () => {} });
    await new Promise((r) => s.http.once("listening", r));
    const client = new Client({ name: "x", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(s.http.address() as AddressInfo).port}/mcp`)));
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await client.callTool({ name: "corosim_get_state", arguments: {} }));
    expect(results.filter((r) => r.isError).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(results[4].content)).toMatch(/Too many/);
    await client.close(); await s.close();
  });
  it("expires idle sessions", async () => {
    const s = startHttp({ port: 0, sessionIdleMs: 30, log: () => {} });
    await new Promise((r) => s.http.once("listening", r));
    const url = `http://127.0.0.1:${(s.http.address() as AddressInfo).port}/mcp`;
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const old = new Client({ name: "x", version: "1" }); await old.connect(transport);
    const sid = transport.sessionId!;
    await new Promise((r) => setTimeout(r, 60));
    const fresh = new Client({ name: "y", version: "1" }); await fresh.connect(new StreamableHTTPClientTransport(new URL(url))); // triggers the sweep
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": sid }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }) });
    expect(res.status).toBe(404);
    await fresh.close(); await s.close();
  });
});
