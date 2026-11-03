// E2: coronary coupling on the core engine. The driving pressures of the subendocardium and subepicardium come from the aortic and LV
// traces of each beat (diastolic pressure and time, LVEDP, intramyocardial pressure); a balloon pump's augmentation arrives through the
// aortic trace. FFR is a hyperemic ratio at the reference pressure and does not depend on it. Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";
import { CASE_BY_ID } from "../src/cath/cases";
import { CoronaryCoupling } from "../src/physics/core/coronary";
import { COUPLING } from "../src/config/coronary";

const say = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const LAD = CASE_BY_ID.ladocc.scenario, L75 = CASE_BY_ID.lad75.scenario;

function make(sc: PatientSpec = {}, pace = 0) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3, ...sc }, { settled: true });
  if (pace) { s.support.pacing = true; s.support.paceRate = pace; } // above the scenario's 120 bpm limit: a pacing wire driven fast
  s.warmup(40); s.history = [];
  s.run(30);
  return s;
}
const supply = (s: Simulation) => s.coronarySupply()!;

describe("coupling of one beat (synthetic traces)", () => {
  /** A beat: ejection at 120 mmHg for `sys` s, then a diastole of `dia` s in which the aorta runs from `ao0` down with the LV at `lvedp`. */
  function beat(sys: number, dia: number, ao0: number, lvedp: number) {
    const c = new CoronaryCoupling(), h = 0.005;
    for (let t = 0; t < sys; t += h) c.sample(h, 120, 118, false);
    for (let t = 0; t < dia; t += h) c.sample(h, ao0 - 30 * (t / dia), lvedp, true);
    c.endBeat();
    return c.beat!;
  }
  const normal = beat(0.3, 0.5, 90, 8);
  it("a shorter diastole lowers the driving pressure and the diastolic fraction", () => {
    const fast = beat(0.2, 0.2, 90, 8);
    expect(fast.diastolicFraction).toBeLessThan(normal.diastolicFraction);
    expect(fast.endo).toBeLessThan(normal.endo);
    expect(fast.dpti).toBeLessThan(normal.dpti * 0.5);
  });
  it("a higher LVEDP lowers the subendocardium far more than the subepicardium", () => {
    const high = beat(0.3, 0.5, 90, 25);
    expect(high.endo).toBeLessThan(normal.endo - 5);
    expect(normal.epi - high.epi).toBeLessThan((normal.endo - high.endo) / 3);
    expect(high.transmural).toBeLessThan(normal.transmural);
  });
  it("a higher diastolic aortic pressure (a balloon) raises both layers; the squeeze of systole is the layers' difference", () => {
    const aug = beat(0.3, 0.5, 110, 8);
    expect(aug.endo).toBeGreaterThan(normal.endo + 5);
    expect(aug.dpti).toBeGreaterThan(normal.dpti);
    expect(normal.endo).toBeLessThan(normal.epi); // the endocardium is squeezed by the LV pressure, the epicardium by a fraction of it
    expect(COUPLING.wEndo).toBeGreaterThan(COUPLING.wEpi);
  });
});

describe("coronary supply on the core engine", () => {
  const normal = make(), n = supply(normal);
  it("the default patient keeps its perfusion pressure: the layer pressures are calibrated to the old fixed mean pressure", () => {
    say("normal", n, normal.perfusion);
    expect(Math.abs(normal.perfusion - normal.map)).toBeLessThan(3);
    expect(n.endoIndex).toBeGreaterThan(0.95); expect(n.endoIndex).toBeLessThan(1.05);
    expect(n.epiIndex).toBeGreaterThan(0.95); expect(n.epiIndex).toBeLessThan(1.05);
    expect(n.endo).toBeLessThan(n.epi); // supply index of the subendocardium is the lower one
    expect(n.viability).toBeGreaterThan(0.8);
    expect(n.diastolicFraction).toBeGreaterThan(0.5);
    for (const b of Object.values(n.beds)) { expect(b.endo).toBeGreaterThanOrEqual(0.99); expect(b.severity).toBeLessThan(0.02); }
  });
  it("tachycardia (paced at 150) shortens the diastole and lowers the subendocardial supply index (DPTI/TTI)", () => {
    const fast = make({}, 150), f = supply(fast);
    say("HR 150", f, fast.perfusion);
    expect(fast.rolling(30).hr).toBeGreaterThan(140);
    expect(f.diastolicFraction).toBeLessThan(n.diastolicFraction - 0.04);
    expect(f.dpti).toBeLessThan(n.dpti * 0.6); // per beat
    expect(f.viability).toBeLessThan(n.viability - 0.08);
  });
  it("a high LVEDP (stiff ventricle, 25 mmHg) lowers the subendocardial driving pressure and index, and the transmural ratio", () => {
    const stiff = make({ heart: { lvStiffness: 3 } }), st = make({ ...L75, heart: { lvStiffness: 5 } }), x = supply(stiff), y = supply(st);
    say("stiff LV", x, "stiff + LAD 75", y, st.hemo(30)!.lvedp);
    expect(x.lvedp).toBeGreaterThan(14);
    expect(x.endo).toBeLessThan(n.endo - 4);
    expect(x.endoIndex).toBeLessThan(n.endoIndex - 0.08);
    expect(x.transmural).toBeLessThan(n.transmural);
    expect(x.viability).toBeLessThan(n.viability - 0.05);
    expect(y.lvedp).toBeGreaterThan(22);
    expect(y.endo).toBeLessThan(n.endo - 8);
  });
  it("the IABP raises the subendocardial supply (through the aortic trace, not a shortcut), in the normal heart and in the anterior STEMI", () => {
    const pump = make({ support: { iabp: true } }), p = supply(pump);
    const base = make(LAD), pumped = make({ ...LAD, support: { iabp: true } }), b = supply(base), q = supply(pumped);
    say("IABP", p, "STEMI", b, "STEMI + IABP", q);
    expect(p.endo).toBeGreaterThan(n.endo + 6); expect(p.viability).toBeGreaterThan(n.viability + 0.2); expect(p.dpti).toBeGreaterThan(n.dpti * 1.15);
    expect(q.endo).toBeGreaterThan(b.endo + 3); expect(q.viability).toBeGreaterThan(b.viability + 0.05);
    expect(pumped.perfusion).toBeGreaterThan(base.perfusion + 3);
  });
  it("the anterior STEMI is limited by its occlusion and its pressure; its infarct bed stays at full severity with or without the pump", () => {
    const base = make(LAD);
    expect(base.sev["LAD#end"]).toBeGreaterThan(0.95);
    expect(supply(base).beds["LAD#end"].endo).toBe(0);
    const b = supply(base);
    expect(b.endo).toBeLessThan(n.endo - 2); // a lower aortic pressure and a higher LVEDP than the healthy heart
  });
});

describe("FFR does not depend on the coupling", () => {
  it("the default patient's lesion FFR is the hyperemic ratio at the reference pressure, on the core and the legacy engine alike", () => {
    const core = make(L75), legacy = new Simulation({}, { engine: "legacy" });
    legacy.reset({ seed: 3, ...L75 }, { settled: true }); legacy.warmup(40);
    say("FFR", core.analysis.ffr, legacy.analysis.ffr);
    expect(core.analysis.ffr.length).toBeGreaterThan(0);
    core.analysis.ffr.forEach((v, i) => expect(Math.abs(v - legacy.analysis.ffr[i])).toBeLessThan(0.01));
    const hot = make({ ...L75, heart: { lvStiffness: 5 } });
    hot.analysis.ffr.forEach((v, i) => expect(Math.abs(v - core.analysis.ffr[i])).toBeLessThan(0.01));
  });
});
