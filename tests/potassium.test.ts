import { describe, it, expect } from "vitest";
import { POTASSIUM_ECG } from "../src/config/ecg";
import { generateBeats, potassiumMorph, sampleLeadsVec } from "../src/physics/ecg";
import { Arrhythmia, potassiumFactor } from "../src/physics/arrhythmia";
import { Ectopy } from "../src/physics/ectopy";
import { Simulation } from "../src/sim/simulation";

const none: [number, number, number] = [0, 0, 0];
const calm = generateBeats(20, () => 0, 1);
const sinus = calm[5];

const peak = (k: number, lead: "II" = "II") => {
  let m = 0;
  for (let dt = 0.15; dt < 0.45; dt += 0.002) m = Math.max(m, Math.abs(sampleLeadsVec(sinus.t + dt, calm, none, 0, 0, k)[lead]));
  return m;
};

const qrsHalfWidth = (k: number) => {
  const at = (dt: number) => Math.abs(sampleLeadsVec(sinus.t + dt, calm, none, 0, 0, k).II);
  const peakR = at(0);
  const thr = peakR * 0.5;
  let lo = 0, hi = 0;
  for (let dt = -0.08; dt <= 0.08; dt += 0.001) {
    if (at(dt) >= thr) { lo = dt; break; }
  }
  for (let dt = 0.08; dt >= -0.08; dt -= 0.001) {
    if (at(dt) >= thr) { hi = dt; break; }
  }
  return hi - lo;
};

describe("serum potassium ECG morph", () => {
  it("is identity at normal K", () => {
    const m = potassiumMorph(POTASSIUM_ECG.normal);
    expect(m.pAmp).toBe(1);
    expect(m.tAmp).toBe(1);
    expect(m.tWidth).toBe(1);
    expect(m.qrsWidth).toBe(1);
    const ref = sampleLeadsVec(sinus.t + 0.27, calm, none, 0);
    const atNorm = sampleLeadsVec(sinus.t + 0.27, calm, none, 0, 0, 4.2);
    for (const l of ["I", "II", "V2", "V5"] as const) expect(atNorm[l]).toBeCloseTo(ref[l], 9);
  });

  it("at K 7.5 shows taller T and wider QRS than at 4.2", () => {
    expect(peak(7.5)).toBeGreaterThan(peak(4.2) * 1.12);
    expect(qrsHalfWidth(7.5)).toBeGreaterThan(qrsHalfWidth(4.2) * 1.35);
  });
});

describe("serum potassium arrhythmia hazard floor", () => {
  it("resting electrolyte hazard is ~0 at normal K and > 0 at K 7.5; tendency scales it", () => {
    const h = (k: number, tendency = 1) => {
      const e = new Ectopy(5), a = new Arrhythmia(5, e, tendency);
      a.potassium = k;
      e.update(0, 0);
      return a.hazards();
    };
    expect(h(4.2).electrolyte).toBeCloseTo(0, 12);
    expect(h(4.2).ischemia).toBe(0);
    expect(h(7.5).electrolyte).toBeGreaterThan(0);
    expect(h(7.5, 3).electrolyte).toBeGreaterThan(h(7.5, 1).electrolyte * 2.5);
    expect(potassiumFactor(4.2)).toBe(1);
  });
});

describe("healthy simulation at extreme K (seed 1)", () => {
  it("K 4.2 stays quiet over six clinical hours; K 7.5 shows ectopy or electrolyte hazard immediately", () => {
    const run = (k: number) => {
      const s = new Simulation({ seed: 1, arrhythmiaTendency: 1, ectopyTendency: 1, electrolytes: { potassium: k } }, { engine: "core", deferCore: true });
      s.reset({ seed: 1, arrhythmiaTendency: 1, ectopyTendency: 1, electrolytes: { potassium: k } }, { settled: true });
      s.warmup(10);
      const h0 = s.arrhythmia!.hazards().electrolyte;
      s.step(360 / s.minutesPerSecond, { minutes: 360 });
      const st = s.state().rhythm as { ectopy?: { lastMinute: { pvcs: number } } };
      return { h0, pvcs: st.ectopy?.lastMinute.pvcs ?? 0, hazard: s.arrhythmia!.hazards().electrolyte };
    };
    const norm = run(4.2);
    expect(norm.h0).toBeCloseTo(0, 12);
    expect(norm.hazard).toBeCloseTo(0, 12);
    expect(norm.pvcs).toBe(0);
    const hyper = run(7.5);
    expect(hyper.h0).toBeGreaterThan(0);
    expect(hyper.hazard).toBeGreaterThan(0);
  });
});
