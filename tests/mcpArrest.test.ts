import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TOOLS } from "../src/mcp/tools";
import { SCENARIO_REFERENCE } from "../src/sim/llm";
import { ARREST } from "../src/config/arrest";

vi.setConfig({ testTimeout: 240_000 });

/** corosim_arrest (D3) through the tool handlers, on the core engine. Slow: listed in tests/slow.json. */
const run = (sim: Simulation, name: string, args: Record<string, unknown> = {}) => TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, args) as any;
const built = (scenario: Record<string, unknown> = {}) => {
  const sim = new Simulation({ seed: 3 });
  run(sim, "corosim_set_scenario", { engine: "core", scenario, warmupSeconds: 8 });
  return sim;
};

describe("corosim_arrest", () => {
  it("VF -> CPR -> epinephrine -> shock -> ROSC, each step narrated with the arrest block", () => {
    const sim = built();
    const start = run(sim, "corosim_adjust", { patch: { patient: { rhythm: "vf-coarse" } }, runSeconds: 20 });
    expect(start.state.arrest.status).toBe("arrest");
    const cpr = run(sim, "corosim_arrest", { action: "cpr", on: true, runSeconds: 30 });
    expect(cpr.ok).toBe(true);
    expect(cpr.arrest.status).toBe("arrest");
    expect(cpr.arrest.cpr.on).toBe(true);
    expect(cpr.arrest.cpr.output).toBeGreaterThan(0.1);
    expect(cpr.dead).toBe(false);
    expect(cpr.narrative).toMatch(/^Chest compressions started\. In cardiac arrest \(ventricular fibrillation\).*CPR under way.*defibrillate/);
    const epi = run(sim, "corosim_arrest", { action: "drug", drug: "epinephrine", runSeconds: 5 });
    expect(epi.ok).toBe(true);
    expect(epi.arrest.drugs.map((d: any) => d.drug)).toContain("epinephrine");
    expect(epi.narrative).toMatch(/epinephrine/);
    let last: any;
    for (let i = 0; i < 6; i++) {
      last = run(sim, "corosim_arrest", { action: "shock", joules: 200, runSeconds: 5 });
      expect(last.shock.discharged).toBe(true);
      if (last.shock.success) break;
      run(sim, "corosim_arrest", { action: "cpr", on: true, runSeconds: 25 });
    }
    expect(last.shock.success).toBe(true);
    expect(last.narrative).toMatch(/^A 200 J shock converted the rhythm\. /);
    const after = run(sim, "corosim_arrest", { action: "cpr", on: false, runSeconds: 30 }); // the machine declares ROSC once output holds
    expect(after.arrest.status).toBe("rosc");
    expect(after.narrative).toMatch(/^Chest compressions stopped\. Return of spontaneous circulation after a successful shock/);
    const st = run(sim, "corosim_get_state");
    expect(st.arrest.status).toBe("rosc");
    expect(st.dead).toBe(false);
    expect(st.state.rhythm.label).toBe("sinus");
    expect(st.state.meanArterialPressure).toBeGreaterThan(55);
  });

  it("get_state and show expose the arrest block and dead; the ekg_show result offers the rhythm for the patient", () => {
    const sim = built();
    expect(run(sim, "corosim_get_state").arrest.status).toBe("none");
    expect(run(sim, "corosim_show").dead).toBe(false);
    const e = run(sim, "corosim_ekg_show", { preset: "vf-coarse" });
    expect(e.applyToPatient.tool).toBe("corosim_adjust");
    expect(e.applyToPatient.args.patch.patient.rhythm).toBe("vf-coarse");
    expect(run(sim, "corosim_ekg_show", { custom: { rhythm: { kind: "af", rate: 120 } } }).applyToPatient).toBeUndefined();
  });

  it("refused actions change nothing and say why (CPR on a pulse, drug without arrest)", () => {
    const sim = built();
    const c = run(sim, "corosim_arrest", { action: "cpr", on: true, runSeconds: 5 });
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/not in cardiac arrest/);
    expect(c.narrative).toMatch(/was not done: .*not in cardiac arrest/);
    expect(c.warnings.join(" ")).toMatch(/not in cardiac arrest/);
    expect(run(sim, "corosim_arrest", { action: "drug", drug: "amiodarone", runSeconds: 0 }).ok).toBe(false);
    expect(() => run(sim, "corosim_arrest", { action: "drug", drug: "atropine" })).toThrow(/drug must/);
    expect(() => run(sim, "corosim_arrest", { action: "nope" })).toThrow(/action must/);
  });

  it("untreated VF -> death; every action is refused until restart, which starts the case again", () => {
    const sim = built({});
    run(sim, "corosim_adjust", { patch: { patient: { rhythm: "vf-coarse" } }, runSeconds: 10 });
    let r: any;
    for (let i = 0; i < 40 && !sim.dead; i++) r = run(sim, "corosim_run", { seconds: 30 });
    expect(sim.dead).toBe(true);
    expect(r.dead).toBe(true);
    expect(r.narrative).toMatch(/died/);
    expect(run(sim, "corosim_get_state").dead).toBe(true);
    expect(run(sim, "corosim_get_state").arrest.status).toBe("dead");
    expect(sim.t).toBeGreaterThan(ARREST.deathAfterNoFlowS * 0.9);
    const refused = run(sim, "corosim_arrest", { action: "shock", joules: 200 });
    expect(refused.ok).toBe(false);
    expect(refused.note).toMatch(/died/);
    const back = run(sim, "corosim_arrest", { action: "restart", runSeconds: 5 });
    expect(back.ok).toBe(true);
    expect(back.dead).toBe(false);
    expect(back.narrative).toMatch(/^The patient was restarted/);
  });

  it("the legacy engine returns ok false with a note, not an error", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { scenario: {}, warmupSeconds: 5 });
    const r = run(sim, "corosim_arrest", { action: "shock", joules: 200, runSeconds: 1 });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/core engine only/);
    expect(r.arrest).toBeNull();
    expect(r.dead).toBe(false);
    expect(r.narrative).toMatch(/not done/);
    expect("arrest" in run(sim, "corosim_get_state")).toBe(false);
  });
});

describe("the reference and tool texts cover the new features", () => {
  it("point to corosim_arrest, patient.rhythm and valve interventions", () => {
    expect(SCENARIO_REFERENCE).toMatch(/corosim_arrest/);
    expect(SCENARIO_REFERENCE).toMatch(/corosim_valve/);
    expect(SCENARIO_REFERENCE).toMatch(/corosim_adjust patient\.rhythm/);
    expect(TOOLS.find((t) => t.name === "corosim_adjust")!.description).toMatch(/vf-coarse/);
    expect(TOOLS.find((t) => t.name === "corosim_arrest")!.readOnly).toBe(false);
  });
});
