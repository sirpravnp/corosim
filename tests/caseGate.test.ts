import { describe, it, expect } from "vitest";
import { learnerMayApply, isTreatment, editBetween, TREATMENT_KEYS } from "../src/cases/gate";
import type { PatientSpec } from "../src/sim/patient";

const refused = (e: PatientSpec) => { const v = learnerMayApply(e); expect(v.ok).toBe(false); return v.ok ? "" : v.why; };

describe("the learner-edit gate", () => {
  it("rhythm change is refused with a sentence", () => {
    const why = refused({ patient: { rhythm: "vt-mono" } });
    expect(why).toMatch(/rhythm/i); expect(why).toMatch(/\.$/);
    expect(isTreatment({ patient: { rhythm: "af" } })).toBe(false);
  });
  it("bundle branch block is refused", () => { expect(refused({ patient: { bbb: "lbbb" } })).toMatch(/bundle branch/i); });
  it("a coronary lesion or occlusion is refused", () => {
    refused({ lesions: [{ artery: "LAD", stenosis: 0.8 }] });
    refused({ lesions: [{ artery: "RCA", occluded: true }] });
    refused({ anatomy: { dominance: "left" } });
  });
  it("a valve lesion is refused", () => {
    expect(refused({ heart: { valves: { av: { stenosisAreaCm2: 0.7 } } } as never })).toMatch(/valve/i);
    refused({ heart: { lvEes: 0.5 } as never });
  });
  it("pericardial effusion is refused", () => {
    expect(refused({ pericardium: { effusionMl: 400 } })).toMatch(/effusion/i);
    refused({ pericardium: { stiffness: 3 } });
  });
  it("blood volume baseline and autonomic gains are refused", () => {
    refused({ bloodLoss: 0.2 });
    refused({ autonomic: { baroreflexGain: 0 } });
    refused({ fluids: { hemorrhageMlMin: 100 } });
    refused({ electrolytes: { potassium: 2.5 } });
    refused({ seed: 5 });
  });
  it("a drug dose, a fluid bolus, oxygen, ventilation, pacing, a shock, CPR and a device are allowed", () => {
    for (const e of [
      { drugs: { betaBlocker: 0.5, atropine: 1, vasopressor: 0.4 } },
      { support: { norepinephrine: 0.5, dobutamine: 0.3, fluids: 1, pacing: true, paceRate: 80 } },
      { fluids: { given: [{ kind: "blood" as const, ml: 500 }] } },
      { ventilation: { mode: "positive" as const, peep: 8 } },
      { devices: { ecmo: { flowLpm: 4, fio2: 1 }, iabp: { ratio: 1 as const }, impella: { level: 6 } } },
      { pericardium: { drainMl: 100 } },
    ] as PatientSpec[]) expect(learnerMayApply(e)).toEqual({ ok: true });
    // Shocks, CPR and drugs by name are calls on the simulation (shock, startCpr, giveDrug), not patient edits: they never reach the gate.
  });
  it("an empty edit is allowed", () => {
    expect(learnerMayApply({})).toEqual({ ok: true });
    expect(learnerMayApply({ heart: {}, pericardium: {} } as PatientSpec)).toEqual({ ok: true });
  });
  it("a mixed edit (a drug plus a lesion) is refused as a whole", () => {
    refused({ drugs: { atropine: 1 }, lesions: [{ artery: "LAD", occluded: true }] });
  });
  it("an unknown field is refused (fail closed)", () => {
    expect(learnerMayApply({ somethingNew: 1 } as unknown as PatientSpec).ok).toBe(false);
    expect(learnerMayApply({ support: { teleport: 1 } } as unknown as PatientSpec).ok).toBe(false);
  });
  it("every allowlisted key has a reason, and editBetween marks removals", () => {
    for (const [k, v] of Object.entries(TREATMENT_KEYS)) { expect(k).toMatch(/\./); expect(v.length).toBeGreaterThan(5); }
    expect(learnerMayApply(editBetween({ lesions: [{ artery: "LAD" }] }, {})).ok).toBe(false);
    expect(learnerMayApply(editBetween({ fluids: { given: [{ kind: "blood", ml: 1 }] } }, {})).ok).toBe(true);
    expect(editBetween({ seed: 1 }, { seed: 1 })).toEqual({});
  });
});

import { TOOLS } from "../src/mcp/tools";
import { Simulation } from "../src/sim/simulation";

describe("the connector tools while a case is running", () => {
  const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
  it("corosim_adjust and corosim_set_scenario refuse disease and take treatment", () => {
    const sim = new Simulation(), ctx = { sim, appUrl: "x", inCase: true };
    expect(() => tool("corosim_adjust").run(ctx, { patch: { patient: { rhythm: "vt-mono" } }, runSeconds: 0 })).toThrow(/rhythm/i);
    expect(() => tool("corosim_set_scenario").run(ctx, { scenario: { lesions: [{ artery: "LAD", occluded: true }] }, warmupSeconds: 0 })).toThrow(/lesion/i);
    expect(() => tool("corosim_adjust").run(ctx, { patch: { support: { fluids: 0.5 } }, runSeconds: 0 })).not.toThrow();
    expect(() => tool("corosim_adjust").run({ sim, appUrl: "x" }, { patch: { patient: { rhythm: "af" } }, runSeconds: 0 })).not.toThrow(); // no case: unchanged
  });
});
