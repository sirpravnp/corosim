import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, openApi } from "../src/mcp/server";
import { TOOLS, openAiTools, anthropicTools } from "../src/mcp/tools";
import { encodeScenario, decodeScenario, describeForLlm } from "../src/sim/llm";
import { Simulation } from "../src/sim/simulation";

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
    expect(r.data.metrics.hrv.sdnnMs).toBeGreaterThan(10);
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
  it("serves a round-trippable share link and a paste block", async () => {
    const { call } = await connect();
    await call("corosim_set_scenario", { scenario: { lesions: [{ artery: "LAD", stenosis: 0.75 }], drugs: { betaBlocker: 0.5 } }, warmupSeconds: 10 });
    const r = await call("corosim_open_link");
    const enc = r.data.link.split("#s=")[1];
    expect(decodeScenario(enc).lesions![0].artery).toBe("LAD");
    expect(r.data.pasteBlock).toMatch(/Scenario \(editable JSON\)/);
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
  it("paste block contains the scenario and grounded mechanisms", () => {
    const sim = new Simulation({ bloodLoss: 0.3 }); sim.warmup(60);
    const t = describeForLlm(sim);
    expect(t).toMatch(/"bloodLoss": 0.3/); expect(t).toMatch(/Blood volume is 30% below normal/);
  });
});
