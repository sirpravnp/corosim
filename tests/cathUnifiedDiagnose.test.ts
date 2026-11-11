import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { CASES } from "../src/cath/cases";
import { timi, wireModel } from "../src/sim/cath";
import { createUnified, diagnoseModel, wireReadout } from "../src/cath/unified/model";

/** The old diagnostic page: a core-engine Simulation on the case's scenario, warmed up 20 s. */
const oldSim = (id: string) => {
  const c = CASES.find((x) => x.id === id)!;
  const s = new Simulation({ seed: 1, ...c.scenario }, { engine: "core" });
  s.reset(c.scenario, { settled: true }); s.warmup(20);
  return { s, c };
};

/**
 * Known engine bug (review finding C1, src/lab/plaque.ts): plaqueToLesions sends a total occlusion to the solver as ds 1 without
 * `occluded: true`, and the left system's flow goes to NaN (the patient starts in PEA). These presets are checked in it.fails below,
 * which turns red once the engine is fixed: then fold them back into the main test.
 */
const OCCLUSION_PRESETS = ["ladocc", "rcaocc", "lcxocc"];

const matchesOld = (ids: string[]) => {
  for (const c of CASES.filter((x) => ids.includes(x.id))) {
      const u = createUnified(c.id), { s: old } = oldSim(c.id);
      // a case whose description gives a TIMI range ("TIMI 1 to 2") is matched to that range, the rest exactly
      const range = c.blurb.match(/TIMI (\d) to (\d)/);
      for (const artery of ["LAD", "LCX", "RCA"]) {
        const got = timi(u.sim, artery).grade, want = timi(old, artery).grade;
        if (range && want < 3) {
          expect(got, `${c.id} ${artery} TIMI`).toBeGreaterThanOrEqual(+range[1]);
          expect(got, `${c.id} ${artery} TIMI`).toBeLessThanOrEqual(+range[2]);
        } else expect(got, `${c.id} ${artery} TIMI`).toBe(want);
      }
      const nf = wireModel(u.sim, c.artery).ffr, of = wireModel(old, c.artery).ffr;
      if (of === null) expect(nf, `${c.id} FFR`).toBeNull();
      else expect(Math.abs((nf ?? 0) - of), `${c.id} FFR ${nf} vs ${of}`).toBeLessThanOrEqual(0.03);
    }
};

describe("unified cath page: Diagnose", () => {
  it("Diagnose reproduces each old preset's TIMI flow and pullback gradient within the old page's tolerances", () => {
    matchesOld(CASES.map((c) => c.id).filter((id) => !OCCLUSION_PRESETS.includes(id)));
  });

  it.fails("the occlusion presets match the old page too (blocked by engine finding C1)", () => {
    matchesOld(OCCLUSION_PRESETS);
  });

  it("lists the lesions as findings and calls flow-limiting ones out", () => {
    const d = diagnoseModel(createUnified("lm90").sim);
    expect(d.findings.some((f) => /LM 90% stenosis/.test(f.text) && f.bad)).toBe(true);
    expect(d.flow.find((f) => f.artery === "LAD")!.grade).toBeLessThan(3);
    const n = diagnoseModel(createUnified("normal").sim);
    expect(n.findings[0].text).toMatch(/No coronary lesions/);
    expect(n.flow.every((f) => f.grade === 3)).toBe(true);
  });

  it.fails("the pressure wire stops at an occlusion (blocked by engine finding C1)", () => {
    expect(wireReadout(createUnified("ladocc").sim, "LAD", 1).ffr).toBeNull();
  });

  it("the pressure wire reads a drop across a stenosis", () => {
    const st = wireReadout(createUnified("lm90").sim, "LM", 1);
    expect(st.ffr).not.toBeNull();
    expect(st.ffr!).toBeLessThan(0.8);
    expect(st.gradient!).toBeGreaterThan(10);
    const prox = wireReadout(createUnified("lm90").sim, "LM", 0);
    expect(prox.at.hyperRatio).toBeGreaterThan(st.at.hyperRatio);
  });
});
