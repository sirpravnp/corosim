import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { CASES } from "../src/cath/cases";
import { timi, wireModel } from "../src/sim/cath";
import { createUnified, diagnoseModel, wireReadout, setLesions } from "../src/cath/unified/model";

/** The old diagnostic page: a core-engine Simulation on the case's scenario, warmed up 20 s. */
const oldSim = (id: string) => {
  const c = CASES.find((x) => x.id === id)!;
  const s = new Simulation({ seed: 1, ...c.scenario }, { engine: "core" });
  s.reset(c.scenario, { settled: true }); s.warmup(20);
  return { s, c };
};

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
    matchesOld(CASES.map((c) => c.id));
  });

  it("lists the lesions as findings and calls flow-limiting ones out", () => {
    const d = diagnoseModel(createUnified("lm90").sim);
    expect(d.findings.some((f) => /LM 90% stenosis/.test(f.text) && f.bad)).toBe(true);
    expect(d.flow.find((f) => f.artery === "LAD")!.grade).toBeLessThan(3);
    const n = diagnoseModel(createUnified("normal").sim);
    expect(n.findings[0].text).toMatch(/No coronary lesions/);
    expect(n.flow.every((f) => f.grade === 3)).toBe(true);
  });

  it("the pressure wire stops at an occlusion, and an occlusion leaves the other vessels and the pressure alone", () => {
    const u = createUnified("ladocc");
    expect(wireReadout(u.sim, "LAD", 1).ffr).toBeNull();
    expect(timi(u.sim, "LCX").grade).toBe(3);
    expect(u.sim.state().rolling10s.map!).toBeGreaterThan(60);
    expect(u.sim.arrestState().status).not.toBe("arrest");
  });

  it("moving a lesion along the artery moves it in the flow model", () => {
    const u = createUnified("lad75");
    const near = { ...u.lesions[0], centerMm: 15 }, far = { ...u.lesions[0], centerMm: 90 };
    setLesions(u, [near], false); const posNear = u.sim.n.lesionSpecs[0].position;
    setLesions(u, [far], false); const posFar = u.sim.n.lesionSpecs[0].position;
    expect(posFar).toBeGreaterThan(posNear + 0.4);
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
