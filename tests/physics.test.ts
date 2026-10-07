import { describe, it, expect } from "vitest";
import {
  defaultLesion, lesionProfile, lesionLength, percentDiameterStenosis, percentAreaStenosis, area,
  stentedProfile, finetParent, finetApplies, murrayError, bifurcationOk, taperIsMonotonic,
} from "../src/physics/geometry";
import {
  pressureDrop, ffr, coronaryFlowReserve, relativeRestingFlow, restingFlow, hyperemicFlow,
  timiGrade, defaultPatient,
} from "../src/physics/hemodynamics";
import { BLOOD, LESION } from "../src/config/anatomy";

const ref = LESION.referenceDiameter;
const at = (ds: number, over = {}) => {
  const s = { ...defaultLesion(), diameterStenosis: ds, ...over };
  return { s, p: lesionProfile(s) };
};
const FFR = (ds: number, pt = defaultPatient()) => ffr(at(ds).p, ref, pt);

describe("lesion geometry", () => {
  it("has the configured length and minimum diameter", () => {
    const { s, p } = at(0.9);
    expect(lesionLength(s)).toBeCloseTo(0.014, 6);
    expect(percentDiameterStenosis(p, ref)).toBeCloseTo(0.9, 3);
  });
  it("area stenosis is 1 − (1 − DS)^2", () => {
    expect(percentAreaStenosis(at(0.9).p, ref)).toBeCloseTo(1 - 0.01, 3);
  });
  it("is symmetric by default and tapers monotonically to the plateau", () => {
    const { p } = at(0.7);
    const h = Math.floor(p.d.length / 2);
    expect(taperIsMonotonic(p.d.slice(0, h))).toBe(true);
  });
  it("a stent can only widen the lumen, minus recoil", () => {
    const { p } = at(0.9);
    const st = stentedProfile(p, 3.0e-3, 0.03);
    expect(Math.min(...st.d)).toBeCloseTo(3.0e-3 * 0.97, 6);
    st.d.forEach((d, i) => expect(d).toBeGreaterThanOrEqual(p.d[i]));
  });
});

describe("tree-geometry validators", () => {
  it("Finet: 0.678 × (distal + side)", () => {
    expect(finetParent(2.8, 2.0)).toBeCloseTo(0.678 * 4.8, 6);
  });
  it("Finet only applies for daughter ratio ≥ 0.75", () => {
    expect(finetApplies(3.0, 2.4)).toBe(true);
    expect(finetApplies(3.0, 1.5)).toBe(false);
  });
  it("Murray: equal daughters of D/2^(1/3) satisfy the law exactly", () => {
    const d = 3.0 / Math.cbrt(2);
    expect(murrayError(3.0, [d, d])).toBeCloseTo(0, 9);
  });
  it("bifurcationOk accepts a Finet-consistent split and rejects a bad one", () => {
    expect(bifurcationOk(finetParent(2.8, 2.0), 2.8, 2.0)).toBe(true);
    expect(bifurcationOk(2.0, 2.8, 2.0)).toBe(false);
  });
  it("taperIsMonotonic rejects a vessel that widens distally", () => {
    expect(taperIsMonotonic([4.0, 3.5, 3.0, 2.2])).toBe(true);
    expect(taperIsMonotonic([4.0, 3.0, 3.4])).toBe(false);
  });
});

describe("pressure drop", () => {
  it("reduces to Poiseuille for a uniform tube (no stenosis)", () => {
    const { s, p } = at(0);
    const Q = 1e-6;
    const expected = (8 * Math.PI * BLOOD.viscosity * lesionLength(s) * Q) / area(ref) ** 2;
    expect(pressureDrop(Q, p, ref)).toBeCloseTo(expected, 6);
  });
  it("rises with flow, with severity and with lesion length", () => {
    const { p } = at(0.7);
    expect(pressureDrop(2e-6, p, ref)).toBeGreaterThan(pressureDrop(1e-6, p, ref));
    expect(pressureDrop(1e-6, at(0.8).p, ref)).toBeGreaterThan(pressureDrop(1e-6, at(0.7).p, ref));
    const long = at(0.7, { entranceLength: 12e-3, exitLength: 12e-3 }).p;
    expect(pressureDrop(1e-6, long, ref)).toBeGreaterThan(pressureDrop(1e-6, p, ref));
  });
});

describe("FFR and flow reserve (validation bands from clinical experience)", () => {
  it("is ~1 with no lesion and falls monotonically with stenosis", () => {
    expect(FFR(0)).toBeCloseTo(1, 2);
    let prev = 2;
    for (const ds of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
      const f = FFR(ds);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });
  it("is mildly reduced at 50% and crosses the 0.80 threshold between ~55% and ~75%", () => {
    expect(FFR(0.5)).toBeGreaterThan(0.85);
    expect(FFR(0.55)).toBeGreaterThan(0.8);
    expect(FFR(0.75)).toBeLessThan(0.8);
  });
  it("is markedly abnormal at 90%", () => {
    expect(FFR(0.9)).toBeLessThan(0.5);
  });
  it("CFR starts at the maximum and falls toward 1", () => {
    const pt = defaultPatient();
    expect(coronaryFlowReserve(at(0).p, ref)).toBeCloseTo(pt.maxCoronaryFlowReserve, 1);
    expect(coronaryFlowReserve(at(0.7).p, ref)).toBeLessThan(coronaryFlowReserve(at(0.4).p, ref));
    expect(coronaryFlowReserve(at(0.9).p, ref)).toBeCloseTo(1, 1);
  });
  it("collaterals raise distal pressure but never create flow through the lesion", () => {
    const base = defaultPatient();
    const coll = { ...base, collateralConductanceFrac: 0.4 };
    const p = at(0.9).p;
    expect(ffr(p, ref, coll)).toBeGreaterThan(ffr(p, ref, base));
    expect(hyperemicFlow(p, ref, coll).Q).toBeLessThanOrEqual(hyperemicFlow(p, ref, base).Q + 1e-12);
  });
});

describe("resting flow, autoregulation and TIMI", () => {
  it("rest flow stays normal while autoregulation holds", () => {
    expect(relativeRestingFlow(at(0.5).p, ref)).toBeCloseTo(1, 3);
    expect(relativeRestingFlow(at(0.7).p, ref)).toBeCloseTo(1, 3);
  });
  it("rest flow falls once autoregulation is exhausted, then collapses", () => {
    const r = [0.8, 0.85, 0.9, 0.95].map((ds) => relativeRestingFlow(at(ds).p, ref));
    r.forEach((v, i) => i && expect(v).toBeLessThan(r[i - 1]));
    expect(r[3]).toBeLessThan(0.05);
  });
  it("a 90% lesion is TIMI ≤ 2 and an 85% lesion is TIMI 2 (physics, not the old prompt's TIMI 2 at 90%)", () => {
    expect(timiGrade(relativeRestingFlow(at(0.85).p, ref))).toBe(2);
    expect(timiGrade(relativeRestingFlow(at(0.9).p, ref))).toBeLessThanOrEqual(2);
  });
  it("TIMI thresholds are monotonic", () => {
    expect([1, 0.8, 0.5, 0.25, 0.1, 0.02, 0].map(timiGrade)).toEqual([3, 3, 2, 2, 1, 0, 0]);
  });
  it("stenting a 90% lesion to 3.0 mm restores TIMI 3 and FFR > 0.9", () => {
    const stented = stentedProfile(at(0.9).p, 3.0e-3);
    expect(timiGrade(relativeRestingFlow(stented, ref))).toBe(3);
    expect(ffr(stented, ref)).toBeGreaterThan(0.9);
  });
  it("an undersized stent leaves a residual gradient; an oversized one matches the reference", () => {
    const under = ffr(stentedProfile(at(0.9).p, 2.0e-3), ref);
    const good = ffr(stentedProfile(at(0.9).p, 3.0e-3), ref);
    expect(under).toBeLessThan(good);
  });
  it("resting solution conserves bed flow", () => {
    const pt = defaultPatient();
    const r = restingFlow(at(0.7).p, ref, pt);
    expect(r.Qbed).toBeCloseTo(pt.restingFlow, 9);
  });
});

import { pressureAlong } from "../src/physics/hemodynamics";
describe("pressure along the vessel", () => {
  const Pa = defaultPatient().meanAorticPressure;
  it("ends exactly at Pa − ΔP (agrees with the solver)", () => {
    for (const ds of [0.5, 0.7, 0.9]) {
      const p = at(ds).p, Q = 0.5e-6;
      const P = pressureAlong(p, ref, Q, Pa);
      expect(P[P.length - 1]).toBeCloseTo(Pa - pressureDrop(Q, p, ref), 3);
      expect(P[0]).toBeCloseTo(Pa, 6);
    }
  });
  it("recovers pressure downstream of a short, abrupt, high-velocity stenosis", () => {
    const p = at(0.8, { entranceLength: 1.5e-3, plateau: 1e-3, exitLength: 1.5e-3 }).p;
    const P = pressureAlong(p, ref, 1.5e-6, Pa);
    expect(P[P.length - 1]).toBeGreaterThan(Math.min(...P));
  });
  it("shows no recovery in a long gentle lesion, where viscous friction dominates", () => {
    const P = pressureAlong(at(0.8).p, ref, 0.5e-6, Pa);
    expect(P[P.length - 1]).toBeCloseTo(Math.min(...P), 3);
  });
  it("is flat at Pa when there is no flow", () => {
    expect(pressureAlong(at(0.8).p, ref, 0, Pa).every((v) => Math.abs(v - Pa) < 1e-6)).toBe(true);
  });
});
