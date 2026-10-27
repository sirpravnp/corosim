import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Simulation } from "../src/sim/simulation";
import { buildServer } from "../src/mcp/server";
import { TOOLS } from "../src/mcp/tools";
import { hemoStats } from "../src/mcp/hemo";
import { decodePatient } from "../src/sim/llm";

/** Direct tool runs on a Simulation (latency measured), plus one test through the real MCP transport. */
const run = (sim: Simulation, name: string, args: Record<string, unknown> = {}) => {
  const t = performance.now();
  const out = TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, args) as any;
  return { out, ms: Math.round(performance.now() - t) };
};
const patient = (spec: Record<string, unknown>, warmupSeconds = 30) => {
  const sim = new Simulation({ seed: 1 });
  run(sim, "corosim_set_scenario", { scenario: spec, warmupSeconds });
  return sim;
};
const ASD = { heart: { asd: { diameterMm: 22 } } };
const STEMI = { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], seed: 3 };
const lat: string[] = [];

// built once: the first reading builds the core twin of a legacy-engine patient, which takes a moment
const stemi = patient(STEMI), asd = patient(ASD);

describe("corosim_heart_cath", () => {
  it("anterior STEMI: wedge is raised, no shunt, adult grading", () => {
    const { out, ms } = run(stemi, "corosim_heart_cath"); lat.push(`heart_cath STEMI cold ${ms} ms`);
    expect(out.format).toBe("corosim.heart_cath/1");
    expect(out.source).toMatch(/Core engine/);
    expect(out.right.pressuresMmHg.pcwp).toBeGreaterThanOrEqual(15);
    expect(out.right.pressuresMmHg.pa.mean).toBeGreaterThan(out.right.pressuresMmHg.ra.mean);
    expect(out.right.oximetry.stepUp).toBeNull();
    expect(out.right.derived.qpQs).toBeLessThan(1.3);
    for (const k of ["fickLmin", "thermodilutionLmin"]) expect(out.right.output[k]).toBeGreaterThan(1.5);
    expect(out.right.derived.cpoW).toBeGreaterThan(0.2);
    expect(out.left.lvMmHg.lvedp).toBeGreaterThan(15);
    expect(out.left.normalAreasCm2).toEqual({ aortic: 3.8, mitral: 5, for: "adult" });
    expect(out.left.grade.aortic).toBe("none");
  });
  it("atrial septal defect: atrial step-up, Qp:Qs above 1.3, adult grading", () => {
    const { out, ms } = run(asd, "corosim_heart_cath"); lat.push(`heart_cath ASD cold ${ms} ms`);
    console.log("ASD cath", JSON.stringify({ stepUp: out.right.oximetry.stepUp, qpQs: out.right.derived.qpQs, qp: out.right.output.qpLmin, qs: out.right.output.qsLmin }));
    expect(out.right.oximetry.stepUp.level).toBe("atrial");
    expect(out.right.oximetry.stepUp.deltaPctPoints).toBeGreaterThanOrEqual(7);
    expect(out.right.derived.qpQs).toBeGreaterThan(1.3);
    expect(out.right.output.qpLmin).toBeGreaterThan(out.right.output.qsLmin);
    expect(out.left.normalAreasCm2).toEqual({ aortic: 3.8, mitral: 5, for: "adult" });
  });
  it("side selects one half", () => {
    expect(Object.keys(run(asd, "corosim_heart_cath", { side: "right" }).out)).not.toContain("left");
    expect(Object.keys(run(asd, "corosim_heart_cath", { side: "left" }).out)).not.toContain("right");
  });
});

describe("corosim_jvp", () => {
  it("STEMI: a waveform with an a wave and a height", () => {
    const { out, ms } = run(stemi, "corosim_jvp"); lat.push(`jvp STEMI warm ${ms} ms`);
    expect(out.format).toBe("corosim.jvp/1");
    expect(out.wavesPresent).toEqual(expect.arrayContaining(["a", "v", "y"]));
    expect(out.aWaveAbsent).toBe(false);
    expect(out.heightCm).toBeGreaterThan(-6); expect(out.heightCm).toBeLessThan(20);
    expect(typeof out.words).toBe("string");
  });
  it("atrial septal defect: the waveform's classes are words and the mean RA is positive", () => {
    const { out } = run(asd, "corosim_jvp");
    expect(Array.isArray(out.classes)).toBe(true);
    expect(out.meanRaMmHg).toBeGreaterThan(0);
    expect(out.words.length).toBeGreaterThan(0);
  });
  it("atrial fibrillation has no a wave", () => {
    const af = patient({ patient: { rhythm: "af" }, seed: 2 }, 30);
    const { out } = run(af, "corosim_jvp");
    expect(out.aWaveAbsent).toBe(true); expect(out.classes).toContain("aAbsent");
  });
});

describe("corosim_oxygen", () => {
  it("STEMI: saturations, extraction and cues", () => {
    const { out, ms } = run(stemi, "corosim_oxygen"); lat.push(`oxygen STEMI warm ${ms} ms`);
    expect(out.format).toBe("corosim.oxygen/1");
    expect(out.satPct.spo2).toBeGreaterThan(95);
    expect(out.satPct.mixedVenousPA).toBeLessThan(out.satPct.spo2);
    expect(out.do2MlMin).toBeGreaterThan(300); expect(out.vo2MlMin).toBeGreaterThan(100);
    expect(out.extractionRatio).toBeGreaterThan(0.25); // low output -> high extraction
  });
  it("STEMI with hemorrhage (shock): low mixed venous saturation and the extraction cue", () => {
    const { out } = run(patient({ ...STEMI, bloodLoss: 0.3 }), "corosim_oxygen");
    expect(out.extractionRatio).toBeGreaterThan(0.35);
    expect(out.cues.join(" ")).toMatch(/extraction/i);
    expect(out.cues.join(" ")).toMatch(/mixed venous/i);
  });
  it("atrial septal defect: Qp:Qs above 1.3 and a step-up from the cava to the right atrium", () => {
    const { out } = run(asd, "corosim_oxygen");
    expect(out.qpQs).toBeGreaterThan(1.3);
    expect(out.nodeSatPct.RA).toBeGreaterThan(out.nodeSatPct.SVC + 5);
  });
});

describe("corosim_loop_metrics", () => {
  it("STEMI: stroke work, PVA, MVO2, Ea/Ees, CPO from the last beat", () => {
    const { out, ms } = run(stemi, "corosim_loop_metrics"); lat.push(`loop_metrics STEMI warm ${ms} ms`);
    expect(out.format).toBe("corosim.loop_metrics/1");
    expect(out.strokeWork.mmHgMl).toBeGreaterThan(500);
    expect(out.pva.mmHgMl).toBeGreaterThan(out.strokeWork.mmHgMl);
    expect(out.efficiency).toBeGreaterThan(0); expect(out.efficiency).toBeLessThan(1);
    expect(out.mvo2.mlPer100gPerMin).toBeGreaterThan(2); expect(out.mvo2.mlPer100gPerMin).toBeLessThan(40);
    expect(out.elastanceMmHgPerMl.coupling).toBeGreaterThan(1); // failing ventricle: Ea exceeds Ees
    expect(out.cpoW).toBeGreaterThan(0.2);
    expect(out.volumesMl.edv).toBeGreaterThan(out.volumesMl.esv);
  });
  it("atrial septal defect: still finite", () => {
    const { out } = run(asd, "corosim_loop_metrics");
    expect(out.volumesMl.edv).toBeGreaterThan(out.volumesMl.esv);
    expect(out.strokeWork.mmHgMl).toBeGreaterThan(0);
  });
});

describe("caching and the PatientSpec", () => {
  it("rebuilds the core twin only when the patient changes", () => {
    const a = hemoStats(stemi).resolves;
    run(stemi, "corosim_heart_cath"); run(stemi, "corosim_oxygen"); run(stemi, "corosim_jvp");
    expect(hemoStats(stemi).resolves).toBe(a);
  });
  it("corosim_adjust with a heart field round-trips: the cath, the link and the next adjust", () => {
    const sim = patient({ seed: 4 }, 30);
    const before = run(sim, "corosim_heart_cath", { side: "left" }).out;
    expect(before.left.grade.aortic).toBe("none");
    const r1 = run(sim, "corosim_adjust", { patch: { heart: { valves: { av: { open: 0.2 } } } }, runSeconds: 5 });
    expect(r1.out.applied.heart.valves.av.open).toBe(0.2);
    const t0 = performance.now(); // the cache must notice the change
    const after = run(sim, "corosim_heart_cath", { side: "left" }).out; lat.push(`heart_cath after a heart patch (re-solve) ${Math.round(performance.now() - t0)} ms`);
    expect(after.left.aorticGradientMmHg.mean).toBeGreaterThan(before.left.aorticGradientMmHg.mean + 10);
    expect(["moderate", "severe"]).toContain(after.left.grade.aortic);
    // a second patch on another field keeps the first (deep merge), and the share link carries both
    run(sim, "corosim_adjust", { patch: { heart: { vsd: { diameterMm: 4 } }, bloodLoss: 0.05 }, runSeconds: 1 });
    const link = (run(sim, "corosim_open_link").out.link as string).split("#s=")[1];
    const spec = decodePatient(link) as any;
    expect(spec.heart.valves.av.open).toBe(0.2); expect(spec.heart.vsd.diameterMm).toBe(4); expect(spec.bloodLoss).toBe(0.05);
  });
  it("share link carries the heart; compare takes the full schema; there is no kind field any more", () => {
    const spec = decodePatient((run(asd, "corosim_open_link").out.link as string).split("#s=")[1]) as any;
    expect(spec.heart.asd.diameterMm).toBe(22); expect(spec).not.toHaveProperty("kind");
    const { out } = run(asd, "corosim_compare", { scenarios: [{ label: "a", scenario: {} }, { label: "b", scenario: { heart: { asd: { diameterMm: 22 } } } }], seconds: 30, warmupSeconds: 10 });
    expect(out).toHaveLength(2);
    const adjSchema = TOOLS.find((t) => t.name === "corosim_adjust")!.inputSchema as any;
    expect(Object.keys(adjSchema.properties.patch.properties)).toEqual(expect.arrayContaining(["heart", "devices"]));
    expect(Object.keys(adjSchema.properties.patch.properties)).not.toContain("kind");
    const cmpSchema = TOOLS.find((t) => t.name === "corosim_compare")!.inputSchema as any;
    expect(Object.keys(cmpSchema.properties.scenarios.items.properties.scenario.properties)).toContain("heart");
  });
});

describe("engine choice and devices", () => {
  it("the default engine stays legacy; engine: core adds the device consoles to the bedside report", () => {
    const sim = new Simulation({ seed: 1 });
    expect(sim.engine).toBe("legacy");
    const legacy = run(sim, "corosim_set_scenario", { scenario: STEMI, warmupSeconds: 10 }).out;
    expect(legacy.devices).toBeUndefined();
    const core = run(sim, "corosim_set_scenario", { engine: "core", scenario: { ...STEMI, devices: { iabp: { ratio: 1 } } }, warmupSeconds: 10 }).out;
    expect(sim.engine).toBe("core");
    expect(core.devices).toBeDefined(); expect(core.devices.iabp).toBeDefined();
    expect(core.devices.iabp.on).toBe(true);
    expect(() => run(sim, "corosim_set_scenario", { engine: "quantum" })).toThrow(/engine/);
    // the cath tools read a core-engine patient directly, not a twin
    const before = hemoStats(sim).resolves;
    const c = run(sim, "corosim_heart_cath", { side: "right" }).out;
    expect(c.right.pressuresMmHg.pcwp).toBeGreaterThan(5);
    expect(hemoStats(sim).resolves).toBe(before + 1); // one live source made for the simulation
    run(sim, "corosim_oxygen"); expect(hemoStats(sim).resolves).toBe(before + 1);
  }, 120000);
});

describe("through the MCP transport", () => {
  it("lists the four new tools as read-only and calls them", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer().connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    for (const n of ["corosim_heart_cath", "corosim_jvp", "corosim_oxygen", "corosim_loop_metrics"]) {
      const t = tools.find((x) => x.name === n)!;
      expect(t.annotations!.readOnlyHint).toBe(true); expect(t.description!.length).toBeGreaterThan(80);
    }
    await client.callTool({ name: "corosim_set_scenario", arguments: { scenario: ASD, warmupSeconds: 10 } });
    const t0 = performance.now();
    const r = await client.callTool({ name: "corosim_heart_cath", arguments: { side: "right" } });
    lat.push(`heart_cath over MCP, ASD cold ${Math.round(performance.now() - t0)} ms`);
    const data = JSON.parse((r.content as { text: string }[])[0].text);
    expect(data.right.derived.qpQs).toBeGreaterThan(1.3);
  }, 60000);
  it("prints the latencies", () => { console.log("LATENCY\n" + lat.join("\n")); });
});
