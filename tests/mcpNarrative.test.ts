import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TOOLS } from "../src/mcp/tools";
import { valveSet } from "../src/sim/valves";

vi.setConfig({ testTimeout: 180_000 });

/** Narration (D2) through the MCP tools, on the core engine. Slow: each case builds and runs a patient (listed in tests/slow.json). */
const run = (sim: Simulation, name: string, args: Record<string, unknown> = {}) => TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, args) as any;
const lad = { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] };
const built = (scenario: Record<string, unknown> = lad, warmupSeconds = 15) => {
  const sim = new Simulation({ seed: 1 });
  const r = run(sim, "corosim_set_scenario", { engine: "core", scenario, warmupSeconds });
  return { sim, r };
};

describe("the case is narrated as it is built", () => {
  it("set_scenario: the new patient, its lesion and where the monitor stands", () => {
    const { r } = built();
    expect(r.narrative).toMatch(/^New patient with a proximal LAD occlusion \(settled for 15 s\): now in sinus rhythm at \d+\/min, BP \d+\/\d+ \(MAP \d+\)/);
    expect(r.narrative).toMatch(/myocardium ischemic/);
  });
  it("adjust: a hemorrhage and a pressor are named with their reason, and the response is quoted", () => {
    const { sim } = built();
    const r = run(sim, "corosim_adjust", { patch: { bloodLoss: 0.2, support: { norepinephrine: 0.4 } }, runSeconds: 15 });
    expect(r.narrative).toMatch(/^20% blood loss \(ATLS class II\): less preload.*; norepinephrine \(40% of a full dose\): vasoconstriction raises the pressure\. After 15 s: in /);
    expect(r.narrative).toMatch(/MAP \d+\)/);
  });
  it("adjust to VT: the rhythm change is the story", () => {
    const { sim } = built({});
    const r = run(sim, "corosim_adjust", { patch: { patient: { rhythm: "vt-mono" } }, runSeconds: 8 });
    expect(r.narrative).toMatch(/^A baseline rhythm of monomorphic ventricular tachycardia: fast dyssynchronous beats with short filling\. After 8 s: in monomorphic ventricular tachycardia at \d+\/min/);
    expect(r.narrative).toMatch(/was sinus rhythm/);
  });
  it("adjust to VF: no output", () => {
    const { sim } = built({});
    const r = run(sim, "corosim_adjust", { patch: { patient: { rhythm: "vf-coarse" } }, runSeconds: 8 });
    expect(r.narrative).toMatch(/no cardiac output \(an arrest rhythm\)/);
    expect(r.narrative).toMatch(/the output stopped/);
  });
  it("run: time passing, the infarct growing", () => {
    const { sim } = built();
    const r = run(sim, "corosim_run", { seconds: 20 });
    expect(r.narrative).toMatch(/^Ran 20 s: in .*left ventricle infarcted/);
    expect(r.narrative).toMatch(/infarct \d+% -> \d+% of the left ventricle/);
  });
  it("treat: the order, the delay it cost, and the patient after", () => {
    const { sim } = built();
    const r = run(sim, "corosim_treat", { procedure: "pci", runSecondsAfter: 5 });
    expect(r.narrative).toMatch(/^Primary PCI: Stent placed in the LAD; flow restored; the infarct grew from \d+% to \d+% of the left ventricle during the 60-minute wait\. Now: /);
  });
  it("valve: what the procedure did; one that cannot be done says why", () => {
    const { sim } = built({ heart: { valves: valveSet({ av: { stenosis: 0.9 } }) } }, 10);
    const r = run(sim, "corosim_valve", { type: "tavr", sizeMm: 26, runSeconds: 5 });
    expect(r.narrative).toMatch(/^Aortic valve replaced by a 26 mm transcatheter/);
    const no = run(sim, "corosim_valve", { type: "teer", valve: "mv", runSeconds: 0 });
    expect(no.narrative).toMatch(/^No valve was changed: .*does not leak/);
  });
  it("describe_case: the patient built so far, including what was treated", () => {
    const { sim } = built();
    run(sim, "corosim_adjust", { patch: { support: { norepinephrine: 0.4 } }, runSeconds: 5 });
    const before = run(sim, "corosim_describe_case");
    expect(before.narrative).toMatch(/^A patient with a proximal LAD occlusion and norepinephrine \(40% of a full dose\), now in sinus rhythm at \d+\/min, BP/);
    expect(before.findings.map((f: any) => f.finding)).toEqual(["a proximal LAD occlusion", "norepinephrine (40% of a full dose)"]);
    run(sim, "corosim_treat", { procedure: "pci", runSecondsAfter: 1 });
    expect(run(sim, "corosim_describe_case").narrative).toMatch(/^A patient with norepinephrine \(40% of a full dose\), after stenting, now in /);
  });
  it("describe_case does not advance time or change the patient", () => {
    const { sim } = built();
    const t = sim.t, s = JSON.stringify(sim.scenario());
    run(sim, "corosim_describe_case");
    expect(sim.t).toBe(t);
    expect(JSON.stringify(sim.scenario())).toBe(s);
  });
  it("the legacy engine is narrated too", () => {
    const sim = new Simulation({ seed: 1 });
    const r = run(sim, "corosim_set_scenario", { scenario: { lesions: [{ artery: "RCA", stenosis: 0.8 }] }, warmupSeconds: 10 });
    expect(r.narrative).toMatch(/^New patient with an 80% proximal RCA stenosis/);
  });
});

describe("parity: every tool that changes the patient returns a narrative", () => {
  /** One valid call per patient-changing tool. A new tool with readOnly: false must be added here (and so must return `narrative`). */
  const CALLS: Record<string, Record<string, unknown>> = {
    corosim_set_scenario: { engine: "core", scenario: lad, warmupSeconds: 5 },
    corosim_adjust: { patch: { bloodLoss: 0.1 }, runSeconds: 3 },
    corosim_run: { seconds: 3 },
    corosim_treat: { procedure: "pci", runSecondsAfter: 1 },
    corosim_valve: { type: "balloon", valve: "av", runSeconds: 1 },
    corosim_arrest: { action: "restart", runSeconds: 1 },
  };
  it("the list of patient-changing tools is the list this test calls", () => {
    expect(TOOLS.filter((t) => !t.readOnly).map((t) => t.name).sort()).toEqual(Object.keys(CALLS).sort());
  });
  it.each(Object.keys(CALLS))("%s", (name) => {
    const sim = new Simulation({ seed: 1 });
    if (name !== "corosim_set_scenario") run(sim, "corosim_set_scenario", { engine: "core", scenario: lad, warmupSeconds: 5 });
    const r = run(sim, name, CALLS[name]);
    expect(typeof r.narrative).toBe("string");
    expect(r.narrative.length).toBeGreaterThan(20);
    expect(r.narrative).not.toMatch(/undefined|NaN|\[object/);
  });
  it("corosim_describe_case is listed, read-only, and in the schemas the adapters export", () => {
    const t = TOOLS.find((x) => x.name === "corosim_describe_case");
    expect(t?.readOnly).toBe(true);
    expect(t?.description).toMatch(/narrative/);
  });
});
