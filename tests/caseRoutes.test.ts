import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { startHttp } from "../src/mcp/server";
import type { CaseSpec } from "../src/cases/spec";

let srv: ReturnType<typeof startHttp> | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });
async function boot(casePasscode?: string) {
  srv = startHttp({ port: 0, devLogin: true, requestsPerMinutePerAddress: 100_000, log: () => {}, casePasscode });
  while (!srv.http.listening) await new Promise((r) => setTimeout(r, 5));
  return `http://127.0.0.1:${(srv.http.address() as AddressInfo).port}`;
}
const spec = (over: Partial<CaseSpec> = {}): CaseSpec => ({
  id: "my-case", title: "Mine", tier: "easy", blurb: "b", card: { presents: "A patient.", pmh: "None." }, start: {},
  points: { survive: 40, stable: 20, harm: 20 }, limitS: 120,
  checkpoints: [{ id: "q", atS: 5, prompt: { text: "Q", options: [{ label: "a", points: 1 }, { label: "b", points: 0 }] } }], ...over,
});
const put = (base: string, s: CaseSpec, pass?: string) => fetch(`${base}/cases/${s.id}`, { method: "PUT", headers: { "content-type": "application/json", ...(pass ? { "x-case-passcode": pass } : {}) }, body: JSON.stringify(s) });

describe("case library", () => {
  it("is read-only when no passcode is set", async () => {
    const base = await boot();
    expect((await fetch(`${base}/cases`)).status).toBe(200);
    expect((await put(base, spec(), "x")).status).toBe(503);
  });

  it("rejects writes without the right passcode", async () => {
    const base = await boot("sesame");
    expect((await put(base, spec())).status).toBe(401);
    expect((await put(base, spec(), "nope")).status).toBe(401);
    expect((await fetch(`${base}/cases/all`)).status).toBe(401);
  });

  it("keeps drafts private and shows published cases to everyone", async () => {
    const base = await boot("sesame");
    expect((await put(base, spec(), "sesame")).status).toBe(200);
    expect((await put(base, spec({ id: "live", published: true }), "sesame")).status).toBe(200);
    const pub = (await (await fetch(`${base}/cases`)).json()) as { cases: CaseSpec[] };
    expect(pub.cases.map((c) => c.id)).toEqual(["live"]);
    const all = (await (await fetch(`${base}/cases/all`, { headers: { "x-case-passcode": "sesame" } })).json()) as { cases: CaseSpec[] };
    expect(all.cases.map((c) => c.id).sort()).toEqual(["live", "my-case"]);
  });

  it("keeps an unfinished draft but refuses to publish it, and deletes", async () => {
    const base = await boot("sesame");
    expect((await put(base, spec({ checkpoints: [] }), "sesame")).status).toBe(200);
    const r = await put(base, spec({ checkpoints: [], published: true }), "sesame");
    expect(r.status).toBe(422);
    expect(((await r.json()) as { errors: string[] }).errors.join()).toMatch(/at least one time point/);
    await put(base, spec(), "sesame");
    expect((await fetch(`${base}/cases/my-case`, { method: "DELETE", headers: { "x-case-passcode": "sesame" } })).status).toBe(200);
    expect((await fetch(`${base}/cases/my-case`, { method: "DELETE", headers: { "x-case-passcode": "sesame" } })).status).toBe(404);
  });

  it("keeps the monitor, the body temperature and the lab values through save and read", async () => {
    const base = await boot("sesame");
    const extra = { monitor: ["hr", "bp", "heart3d"], tempC: 38.6, labs: { na: 128, k: 5.8 } };
    expect((await put(base, spec(extra), "sesame")).status).toBe(200);
    const all = (await (await fetch(`${base}/cases/all`, { headers: { "x-case-passcode": "sesame" } })).json()) as { cases: CaseSpec[] };
    const got = all.cases.find((c) => c.id === "my-case")!;
    expect({ monitor: got.monitor, tempC: got.tempC, labs: got.labs }).toEqual(extra);
    expect((await put(base, spec({ ...extra, monitor: ["nope"], published: true }), "sesame")).status).toBe(422); // publishing needs a valid monitor
  });
});
