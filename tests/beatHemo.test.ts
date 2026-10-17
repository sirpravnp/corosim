import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { bedSites } from "../src/physics/ecgLink";
import { rhythmState } from "../src/physics/rhythm";
import { circulation } from "../src/physics/circulation";
import { BeatStream } from "../src/physics/beatStream";
import { BeatHemodynamics } from "../src/physics/beatHemo";
import { Beat } from "../src/physics/ecg";

const sites = bedSites(buildTree(TYPICAL));
const rs = rhythmState(sites, {}, 0);
const circ = circulation(sites, {}, rs);
const beat = (t: number, extra: Partial<Beat> = {}): Beat => ({ t, rr: 60 / circ.hr, pvc: false, ...extra });

describe("beat stream", () => {
  it("hands each ventricular beat out exactly once, in order, never a blocked P", () => {
    const s = new BeatStream(3);
    s.extend(0, rs); s.extend(1, rs); s.extend(2, rs);
    const a = s.drain(2), b = s.drain(2);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(0);
    expect(a.every((x) => !x.pOnly)).toBe(true);
    for (let i = 1; i < a.length; i++) expect(a[i].t).toBeGreaterThan(a[i - 1].t);
  });
  it("is repeatable for the same seed", () => {
    const run = () => { const s = new BeatStream(5); s.extend(0, rs); s.extend(1, rs); return s.drain(5).map((b) => b.t); };
    expect(run()).toEqual(run());
  });
});

describe("beat-to-beat hemodynamics", () => {
  const steady = (n = 12) => {
    const h = new BeatHemodynamics(); const T = 60 / circ.hr;
    for (let i = 0; i < n; i++) h.onBeat(beat(i * T), circ);
    return h.last!;
  };
  it("regular beats settle to the steady stroke volume and a physiologic pressure", () => {
    const b = steady();
    expect(b.strokeVolume).toBeCloseTo(circ.strokeVolume, 0);
    expect(b.systolic).toBeGreaterThan(b.diastolic);
    expect((b.systolic + 2 * b.diastolic) / 3).toBeGreaterThan(circ.map * 0.85);
    expect((b.systolic + 2 * b.diastolic) / 3).toBeLessThan(circ.map * 1.15);
  });
  it("a PVC gives a small stroke, then the pause gives a bigger, potentiated one", () => {
    const h = new BeatHemodynamics(); const T = 60 / circ.hr;
    for (let i = 0; i < 8; i++) h.onBeat(beat(i * T), circ);
    const base = h.last!;
    const pvc = h.onBeat(beat(7 * T + 0.6 * T, { pvc: true }), circ);
    const after = h.onBeat(beat(7 * T + 0.6 * T + 1.4 * T * 1.0), circ);
    expect(pvc.strokeVolume).toBeLessThan(base.strokeVolume * 0.7);
    expect(after.strokeVolume).toBeGreaterThan(base.strokeVolume);
    expect(after.diastolic).toBeLessThan(base.diastolic); // long pause lets pressure fall further
  });
  it("loses the atrial kick without a P wave", () => {
    const h = new BeatHemodynamics(); const T = 60 / circ.hr;
    for (let i = 0; i < 8; i++) h.onBeat(beat(i * T), circ);
    const base = h.last!;
    const esc = h.onBeat(beat(8 * T, { noP: true }), circ);
    expect(esc.atrialKick).toBe(false);
    expect(esc.strokeVolume).toBeLessThan(base.strokeVolume);
  });
  it("a long interval fills the ventricle more than a short one", () => {
    const mk = (gap: number) => { const h = new BeatHemodynamics(); h.onBeat(beat(0), circ); return h.onBeat(beat(gap), circ).strokeVolume; };
    expect(mk(1.2)).toBeGreaterThan(mk(0.5));
  });
});
