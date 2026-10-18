import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, openApi } from "../src/mcp/server";
import { TOOLS, openAiTools, anthropicTools } from "../src/mcp/tools";
import { encodeScenario, decodeScenario } from "../src/sim/llm";

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: !!r.isError, data: r.isError ? text : JSON.parse(text) };
  };
  return { client, call };
}

describe("MCP server", () => {
  it("lists every tool with a JSON schema and read-only hints", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of tools) { expect(t.inputSchema.type).toBe("object"); expect(t.description!.length).toBeGreaterThan(40); }
    expect(tools.find((t) => t.name === "corosim_get_state")!.annotations!.readOnlyHint).toBe(true);
  });
  it("builds a patient from a scenario and reports what actually ran", async () => {
    const { call } = await connect();
    const r = await call("corosim_set_scenario", { scenario: { lesions: [{ artery: "circumflex", stenosis: 0.9 }, { artery: "bogus" }], bloodLoss: 9 }, warmupSeconds: 20 });
    expect(r.isError).toBe(false);
    expect(r.data.warnings.join(" ")).toMatch(/bogus/); expect(r.data.warnings.join(" ")).toMatch(/bloodLoss/);
    expect(r.data.scenario.lesions[0].artery).toBe("LCX");
    expect(r.data.state.rolling10s.hr).toBeGreaterThan(60);
    expect(r.data.explanation.mechanisms.join(" ")).toMatch(/blood volume/i);
  });
  it("adjust shows the response of a drug over time", async () => {
    const { call } = await connect();
    const before = (await call("corosim_set_scenario", { warmupSeconds: 30 })).data.state.rolling10s;
    const r = await call("corosim_adjust", { patch: { drugs: { vasopressor: 1 } }, runSeconds: 90 });
    const tc = r.data.timeCourse as { t: number; map: number; hr: number }[];
    expect(tc.length).toBeGreaterThan(8);
    const end = tc.slice(-6), avg = (f: (x: { map: number; hr: number }) => number) => end.reduce((s, x) => s + f(x), 0) / end.length;
    expect(avg((x) => x.map)).toBeGreaterThan(before.map + 4);
    expect(avg((x) => x.hr)).toBeLessThan(before.hr - 5); // reflex bradycardia
  });
  it("run returns a bounded beat table on request", async () => {
    const { call } = await connect();
    const r = await call("corosim_run", { seconds: 120, beats: "all", maxBeats: 50 });
    expect(r.data.beats.rows.length).toBeLessThanOrEqual(50); expect(r.data.beats.columns).toContain("rr_ms");
    expect(r.data.metrics.hrv).toBeUndefined(); // autonomic statistics only on request
    expect(r.data.ecg.stMm.V2).toBeDefined();
    const withHrv = await call("corosim_run", { seconds: 90, autonomic: true });
    expect(withHrv.data.metrics.hrv.sdnnMs).toBeGreaterThan(10);
  });
  it("compare leaves the current patient untouched and reports deltas", async () => {
    const { call } = await connect();
    const before = (await call("corosim_get_state")).data.scenario;
    const r = await call("corosim_compare", { seconds: 60, warmupSeconds: 30, scenarios: [{ label: "base", scenario: {} }, { label: "no reflex, bleeding", scenario: { bloodLoss: 0.2, autonomic: { baroreflexGain: 0 } } }] });
    expect(r.data[1].deltaVsFirst.strokeVolume).toBeLessThan(-8);
    expect(r.data[1].deltaVsFirst.map).toBeLessThan(0);
    expect((await call("corosim_get_state")).data.scenario).toEqual(before);
  });
  it("returns tool errors as isError rather than throwing", async () => {
    const { call } = await connect();
    const r = await call("corosim_compare", { scenarios: [{ label: "only", scenario: {} }] });
    expect(r.isError).toBe(true);
  });
  it("serves a round-trippable share link", async () => {
    const { call } = await connect();
    await call("corosim_set_scenario", { scenario: { lesions: [{ artery: "LAD", stenosis: 0.75 }], drugs: { betaBlocker: 0.5 } }, warmupSeconds: 10 });
    const r = await call("corosim_open_link");
    const enc = r.data.link.split("#s=")[1];
    expect(decodeScenario(enc).lesions![0].artery).toBe("LAD");
  });
  it("exposes resources and prompts", async () => {
    const { client } = await connect();
    const res = await client.readResource({ uri: "corosim://model-card" });
    expect(String((res.contents[0] as { text: string }).text)).toMatch(/Not simulated/);
    const p = await client.getPrompt({ name: "build_patient", arguments: { case: "62 y/o with RCA occlusion" } });
    expect(JSON.stringify(p.messages)).toMatch(/RCA occlusion/);
  });
});

describe("export formats", () => {
  it("OpenAI, Anthropic and OpenAPI definitions cover every tool", () => {
    expect(openAiTools().map((t) => t.function.name)).toEqual(TOOLS.map((t) => t.name));
    expect(anthropicTools().every((t) => t.input_schema)).toBe(true);
    expect(Object.keys(openApi("http://x").paths as object)).toHaveLength(TOOLS.length);
  });
  it("scenario codec round-trips unicode-safe", () => {
    const s = { seed: 9, lesions: [{ artery: "RCA", occluded: true }] };
    expect(decodeScenario(encodeScenario(s))).toEqual(s);
  });
});

import { VIEWER_URI, VIEWER_MIME, viewerHtml } from "../src/mcp/server";
describe("the in-chat viewer (MCP Apps)", () => {
  it.runIf(!!viewerHtml())("is served as a ui:// resource and attached only to corosim_show", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const withUi = tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === VIEWER_URI).map((t) => t.name).sort();
    expect(withUi).toEqual(["corosim_show"]); // one panel per turn: only the show tool draws it
    expect(tools.find((t) => t.name === "corosim_show")!._meta!["ui/resourceUri"]).toBe(VIEWER_URI); // legacy key for older hosts
    expect(tools.find((t) => t.name === "corosim_compare")!._meta).toBeUndefined();
    const res = await client.readResource({ uri: VIEWER_URI });
    const c = res.contents[0] as { mimeType: string; text: string };
    expect(c.mimeType).toBe(VIEWER_MIME);
    expect(c.text).toContain("<canvas id=\"ecg\"");
    expect(c.text).not.toMatch(/<script[^>]+src=/); // everything inlined: the sandbox has no network
  });
  it("every patient-showing result carries the scenario the viewer replays", async () => {
    const { call } = await connect();
    for (const [tool, args] of [["corosim_get_state", {}], ["corosim_run", { seconds: 2 }], ["corosim_adjust", { patch: { bloodLoss: 0.1 }, runSeconds: 1 }]] as const) {
      const r = await call(tool, args as Record<string, unknown>);
      expect(r.data.scenario ?? r.data.applied).toBeTruthy();
    }
  });
});

import { EKG_VIEWER_URI, ekgViewerHtml } from "../src/mcp/server";
describe("the in-chat EKG viewer", () => {
  it.runIf(!!ekgViewerHtml())("is served as its own ui:// resource and attached only to corosim_ekg_show", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const withUi = tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === EKG_VIEWER_URI).map((t) => t.name);
    expect(withUi).toEqual(["corosim_ekg_show"]);
    const res = await client.readResource({ uri: EKG_VIEWER_URI });
    const c = res.contents[0] as { mimeType: string; text: string };
    expect(c.mimeType).toBe(VIEWER_MIME);
    expect(c.text).toContain("<canvas id=\"paper\"");
    expect(c.text).not.toMatch(/<script[^>]+src=/);
  });
  it("runs EKG tools without touching the patient", async () => {
    const { call } = await connect();
    const before = (await call("corosim_get_state")).data.scenario;
    const r = await call("corosim_ekg_show", { preset: "torsades" });
    expect(r.data.ekg.preset).toBe("torsades");
    expect((await call("corosim_get_state")).data.scenario).toEqual(before);
  });
});

describe("routing rhythm requests to the EKG tool", () => {
  it("says up front, and in the patient tools, that rhythms go to corosim_ekg_show", async () => {
    const { client } = await connect();
    expect(client.getInstructions()!.slice(0, 400)).toContain("corosim_ekg_show");
    const { tools } = await client.listTools();
    for (const n of ["corosim_get_schema", "corosim_set_scenario", "corosim_show"]) expect(tools.find((t) => t.name === n)!.description).toContain("corosim_ekg_show");
    expect(tools.find((t) => t.name === "corosim_ekg_show")!.description).toMatch(/torsades/);
  });
});
