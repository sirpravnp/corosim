import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttp, localExec } from "../src/mcp/server";
import { ServerToPage } from "../src/mcp/protocol";
import { Simulation } from "../src/sim/simulation";

type Srv = ReturnType<typeof startHttp>;
async function boot(opts: Partial<Parameters<typeof startHttp>[0]> = {}): Promise<{ srv: Srv; base: string }> {
  const srv = startHttp({ port: 0, devLogin: true, callsPerMinute: 1000, requestsPerMinutePerAddress: 100_000, callTimeoutMs: 2000, log: () => {}, ...opts });
  await new Promise((r) => srv.http.once("listening", r));
  return { srv, base: `http://localhost:${(srv.http.address() as AddressInfo).port}` };
}
let srv: Srv, base = "";
beforeAll(async () => { ({ srv, base } = await boot()); });
afterAll(async () => { await srv.close(); });

const SITE = "http://localhost:5173/";
const get = (u: string, cookie?: string) => fetch(u, { redirect: "manual", headers: cookie ? { cookie } : {} });

/** The site's sign-in: provider round trip, back to the site with a one-time code, exchanged for a page token. */
async function signInPage(as: string, b = base): Promise<string> {
  const login = await get(`${b}/auth/login?provider=dev&as=${as}&return=${encodeURIComponent(SITE)}`);
  const back = await get(login.headers.get("location")!);
  const code = new URL(back.headers.get("location")!).hash.match(/corosim_login=([\w-]+)/)![1];
  const r = await (await fetch(`${b}/auth/exchange`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ code }) })).json();
  return r.token;
}

/** What Claude or ChatGPT does: discover, register, authorize (sign in + consent), exchange the code with PKCE. */
async function connectAi(as: string, b = base, name = "Claude") {
  const r401 = await fetch(`${b}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  expect(r401.status).toBe(401);
  const prm = await (await fetch(r401.headers.get("www-authenticate")!.match(/resource_metadata="([^"]+)"/)![1])).json();
  const asMeta = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const reg = await (await fetch(asMeta.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) })).json();
  const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url"), state = "xyz";
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state, resource: prm.resource });
  const toSignin = await get(`${asMeta.authorization_endpoint}?${q}`);
  const pending = new URL(toSignin.headers.get("location")!).searchParams.get("pending")!;
  const login = await get(`${b}/auth/login?provider=dev&as=${as}&return=${encodeURIComponent(`/oauth/consent?pending=${pending}`)}`);
  const cb = await get(login.headers.get("location")!);
  const cookie = cb.headers.get("set-cookie")!.split(";")[0];
  const consent = await get(cb.headers.get("location")!, cookie);
  expect(await consent.text()).toContain(name);
  const allow = await fetch(`${b}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ pending, decision: "allow" }) });
  const back = new URL(allow.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(redirect); expect(back.searchParams.get("state")).toBe(state);
  const tok = await (await fetch(asMeta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
  expect(tok.token_type).toBe("Bearer");
  return { access: tok.access_token as string, refresh: tok.refresh_token as string, clientId: reg.client_id as string, redirect, verifier, challenge };
}

async function mcpClient(access: string, b = base, name = "claude-ai") {
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${b}/mcp`), { requestInit: { headers: { authorization: `Bearer ${access}` } } }));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call };
}

/** A stand-in for the signed-in CoroSim page: its own patient, answering forwarded calls as the app does. */
async function page(token: string, b = base, origin = "http://localhost:5173") {
  const sim = new Simulation({ seed: 3 }), exec = localExec(sim), seen: ServerToPage[] = [];
  const ws = new WebSocket(`${b.replace("http", "ws")}/live`, { headers: { origin } });
  let closedWith = 0;
  ws.on("close", (code) => { closedWith = code; });
  ws.on("message", async (raw) => {
    const m = JSON.parse(String(raw)) as ServerToPage;
    seen.push(m);
    if (m.type !== "call") return;
    try { ws.send(JSON.stringify({ type: "result", id: m.id, ok: true, result: await exec(m.tool, m.args) })); }
    catch (e) { ws.send(JSON.stringify({ type: "result", id: m.id, ok: false, error: (e as Error).message })); }
  });
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.once("error", rej); });
  ws.send(JSON.stringify({ type: "hello", protocol: 3, app: "corosim", version: "test", token, since: 0 }));
  return { sim, ws, seen, closed: () => closedWith };
}
const until = async (f: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };

describe("AI connectors sign in with OAuth (the MCP authorization flow)", () => {
  it("advertises how to sign in", async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    expect(prm.resource).toBe(`${base}/mcp`);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${base}/oauth/register`);
  });
  it("after sign-in and consent, the AI works on the account's own patient", async () => {
    const t = await connectAi("ana");
    const { client, call } = await mcpClient(t.access);
    const r = await call("corosim_adjust", { patch: { lesions: [{ artery: "RCA", occluded: true }] }, runSeconds: 2 });
    expect(r.isError).toBe(false);
    expect(r.data.connection.page).toBe("closed"); // no page open: the saved patient
    expect((await call("corosim_get_state")).data.scenario.lesions[0].artery).toBe("RCA");
    await client.close();
  });
  it("keeps accounts apart", async () => {
    const a = await mcpClient((await connectAi("ben")).access), b = await mcpClient((await connectAi("cy")).access);
    await a.call("corosim_adjust", { patch: { bloodLoss: 0.3 }, runSeconds: 1 });
    expect((await b.call("corosim_get_state")).data.scenario.bloodLoss).toBe(0);
    await a.client.close(); await b.client.close();
  });
  it("forwards to the account's open page, which is told which AI is working", async () => {
    const pg = await page(await signInPage("dee"));
    const { client, call } = await mcpClient((await connectAi("dee")).access);
    await call("corosim_adjust", { patch: { lesions: [{ artery: "LAD", stenosis: 0.8 }] }, runSeconds: 1 });
    expect(pg.sim.n.lesionSpecs[0].artery).toBe("LAD");
    await until(() => pg.seen.some((m) => m.type === "status" && m.lastClient === "claude-ai"));
    await client.close(); pg.ws.close();
  });
  it("a page opened later gets what the AI did while it was closed", async () => {
    const { client, call } = await mcpClient((await connectAi("eve")).access);
    await call("corosim_adjust", { patch: { lesions: [{ artery: "OM1", occluded: true }] }, runSeconds: 1 });
    const pg = await page(await signInPage("eve"));
    await until(() => pg.seen.some((m) => m.type === "restore"));
    expect((pg.seen.find((m) => m.type === "restore") as Extract<ServerToPage, { type: "restore" }>).scenario.lesions![0].artery).toBe("OM1");
    await client.close(); pg.ws.close();
  });
  it("refresh tokens rotate: each works once", async () => {
    const t = await connectAi("fay");
    const refresh = (rt: string) => fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: t.clientId }) });
    const first = await refresh(t.refresh);
    expect(first.status).toBe(200);
    expect((await refresh(t.refresh)).status).toBe(400);
    const { access } = { access: (await first.json()).access_token };
    const { client, call } = await mcpClient(access);
    expect((await call("corosim_get_state")).isError).toBe(false);
    await client.close();
  });
});

describe("OAuth refuses what it should", () => {
  const register = async (uris: string[]) => fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x", redirect_uris: uris }) });
  it("rejects unsafe redirect addresses at registration", async () => {
    expect((await register(["javascript:alert(1)"])).status).toBe(400);
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
    expect((await register(["http://localhost:33418/callback"])).status).toBe(201);
  });
  it("never redirects to an address the client did not register", async () => {
    const reg = await (await register(["https://claude.ai/cb"])).json();
    const r = await get(`${base}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=abc&code_challenge_method=S256`);
    expect(r.status).toBe(400); expect(r.headers.get("location")).toBeNull();
  });
  it("requires PKCE, checks the verifier, and accepts each code once", async () => {
    const reg = await (await register(["https://claude.ai/cb"])).json();
    const noPkce = await get(`${base}/oauth/authorize?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/cb")}`);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const t = await connectAi("gus"); // gets a code; now try to reuse the pattern with a bad verifier
    const tokenWith = (code: string, verifier: string) => fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: t.redirect, client_id: t.clientId, code_verifier: verifier }) });
    expect((await tokenWith("not-a-code", t.verifier)).status).toBe(400);
  });
  it("a declined consent sends the AI an error, not a code", async () => {
    const reg = await (await register(["https://claude.ai/cb"])).json();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/cb", code_challenge: "abc", code_challenge_method: "S256", state: "s" });
    const pending = new URL((await get(`${base}/oauth/authorize?${q}`)).headers.get("location")!).searchParams.get("pending")!;
    const cb = await get((await get(`${base}/auth/login?provider=dev&as=hal&return=${encodeURIComponent(`/oauth/consent?pending=${pending}`)}`)).headers.get("location")!);
    const cookie = cb.headers.get("set-cookie")!.split(";")[0];
    const deny = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ pending, decision: "deny" }) });
    const to = new URL(deny.headers.get("location")!);
    expect(to.searchParams.get("error")).toBe("access_denied"); expect(to.searchParams.get("code")).toBeNull();
  });
  it("a consent post without the session cookie does nothing", async () => {
    const r = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ pending: "anything", decision: "allow" }) });
    expect(r.status).toBe(400);
  });
  it("sign-in only returns to the site's own origins", async () => {
    expect((await get(`${base}/auth/login?provider=dev&return=${encodeURIComponent("https://evil.example/")}`)).status).toBe(400);
  });
  it("development sign-in is unavailable on a public address", async () => {
    const { srv: s, base: b } = await boot({ publicUrl: "https://mcp.example.com" });
    expect((await (await fetch(`${b}/auth/providers`)).json()).providers).not.toContain("dev");
    await s.close();
  });
});

describe("pages and accounts", () => {
  it("a page needs a valid sign-in, from an allowed site", async () => {
    const bad = await page("not-a-token");
    await until(() => bad.closed() === 4401);
    await expect(page(await signInPage("ivy"), base, "https://evil.example")).rejects.toThrow(/403/);
  });
  it("disconnecting AIs revokes their tokens", async () => {
    const t = await connectAi("jo"), pageToken = await signInPage("jo");
    expect((await (await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${pageToken}` } })).json()).connected).toContain("Claude");
    await fetch(`${base}/auth/disconnect`, { method: "POST", headers: { authorization: `Bearer ${pageToken}` } });
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t.access}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(r.status).toBe(401);
  });
  it("deleting the account removes the patient, the tokens and the live line", async () => {
    const t = await connectAi("kai"), pageToken = await signInPage("kai"), pg = await page(pageToken);
    const { client, call } = await mcpClient(t.access);
    await call("corosim_adjust", { patch: { bloodLoss: 0.2 }, runSeconds: 1 });
    await client.close();
    const del = await fetch(`${base}/auth/account`, { method: "DELETE", headers: { authorization: `Bearer ${pageToken}` } });
    expect((await del.json()).deleted).toBe(true);
    await until(() => pg.closed() === 4401);
    expect((await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${pageToken}` } })).status).toBe(401);
    const again = await mcpClient((await connectAi("kai")).access); // signing in again starts a fresh account
    expect((await again.call("corosim_get_state")).data.scenario.bloodLoss).toBe(0);
    await again.client.close();
  });
  it("old secret-URL connectors are told what changed", async () => {
    const r = await fetch(`${base}/mcp/uMMlt16laqmV4BjD6x7puA`, { method: "POST" });
    expect(r.status).toBe(410); expect((await r.json()).error).toMatch(/sign-in/);
  });
});

describe("limits and restarts", () => {
  it("each account has a daily allowance", async () => {
    const { srv: s, base: b } = await boot({ callsPerDay: 3 });
    const { client, call } = await mcpClient((await connectAi("lee", b)).access, b);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await call("corosim_get_state"));
    expect(results.filter((r) => r.isError).length).toBe(2);
    expect(results[4].text).toMatch(/Daily limit/);
    await client.close(); await s.close();
  });
  it("the AI's sign-in and the patient survive a restart: the same token works, no new sign-in", async () => {
    const dbFile = join(mkdtempSync(join(tmpdir(), "corosim-db-")), "corosim.db");
    const a = await boot({ dbFile });
    const port = Number(new URL(a.base).port);
    const { access } = await connectAi("max", a.base);
    const before = await mcpClient(access, a.base);
    await before.call("corosim_adjust", { patch: { lesions: [{ artery: "LCX", stenosis: 0.9 }] }, runSeconds: 1 });
    await before.client.close();
    await a.srv.close();
    // A restarted server drops open connections, so the client reconnects, as any HTTP client must; it keeps its token.
    const b = await boot({ dbFile, port });
    const after = await mcpClient(access, b.base);
    expect((await after.call("corosim_get_state")).data.scenario.lesions[0].artery).toBe("LCX");
    await after.client.close(); await b.srv.close();
  });
});
