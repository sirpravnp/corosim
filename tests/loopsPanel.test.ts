import { describe, expect, it } from "vitest";
import {
  endDiastolicPoint, endSystolicPoint, fitAllowed, fitEDPVR, fitESPVR, loopArea, loopStats, rescaleAxis, type Pt,
} from "../src/panels/loopMath";
import { loopsPanel } from "../src/panels/loops";
import { createStubSource } from "../src/sim/stubSource";

/** Rectangle loop: fill at pd from esv to edv, isovolumic rise, eject at ps, isovolumic fall. */
function rect(esv: number, edv: number, pd: number, ps: number) {
  const pts = [[esv, pd], [(esv + edv) / 2, pd], [edv, pd], [edv, (pd + ps) / 2], [edv, ps], [(esv + edv) / 2, ps], [esv, ps], [esv, (pd + ps) / 2]];
  return { v: Float32Array.from(pts.map(q => q[0])), p: Float32Array.from(pts.map(q => q[1])) };
}

describe("loop math", () => {
  const l = rect(50, 130, 8, 120);
  it("gets SV, EF, EDP and the area of a rectangle loop", () => {
    const s = loopStats(l.p, l.v);
    expect(s.sv).toBe(80);
    expect(s.ef).toBeCloseTo(80 / 130, 6);
    expect(s.edp).toBe(8);
    expect(loopArea(l.p, l.v)).toBeCloseTo(80 * 112, 3);
  });
  it("finds the corners", () => {
    expect(endSystolicPoint(l.p, l.v)).toEqual({ v: 50, p: 120 });
    expect(endDiastolicPoint(l.p, l.v)).toEqual({ v: 130, p: 8 });
  });
  it("prefers the source's EDV/ESV and tolerates empty loops", () => {
    expect(loopStats(l.p, l.v, 140, 60).ef).toBeCloseTo(80 / 140, 6);
    const e = loopStats([], []);
    expect(e.ef).toBeNaN();
    expect(e.es).toBeNull();
  });
  it("ignores NaN samples", () => {
    expect(loopStats([8, NaN, 120], [130, 90, 50]).sv).toBe(80);
  });
});

describe("ESPVR / EDPVR fits", () => {
  const es = (vs: number[]): Pt[] => vs.map(v => ({ v, p: 2 * (v - 10) })); // E = 2 mmHg/ml, V0 = 10
  it("fits a line when spread, and recovers slope and V0", () => {
    const f = fitESPVR(es([40, 50, 60, 70]))!;
    expect(f.slope).toBeCloseTo(2, 6);
    expect(f.v0).toBeCloseTo(10, 6);
  });
  it("refuses with too few points or too little spread", () => {
    expect(fitESPVR(es([40, 60]))).toBeNull();
    expect(fitESPVR(es([50, 51, 52, 53]))).toBeNull();
    expect(fitAllowed(es([50, 51, 52, 53]))).toBe(false);
    expect(fitEDPVR([{ v: 120, p: 8 }, { v: 121, p: 8.2 }, { v: 122, p: 8.5 }])).toBeNull();
  });
  it("refuses a falling or noisy relation", () => {
    expect(fitESPVR([{ v: 40, p: 120 }, { v: 55, p: 100 }, { v: 70, p: 80 }])).toBeNull();
    expect(fitESPVR([{ v: 40, p: 100 }, { v: 55, p: 20 }, { v: 70, p: 110 }, { v: 80, p: 30 }])).toBeNull();
  });
  it("fits an exponential through end-diastolic points", () => {
    const pts = [100, 115, 130, 145].map(v => ({ v, p: 0.5 * Math.exp(0.03 * v) }));
    const f = fitEDPVR(pts)!;
    expect(f.b).toBeCloseTo(0.03, 6);
    expect(f.a).toBeCloseTo(0.5, 5);
  });
});

describe("axis hysteresis", () => {
  it("grows at once and holds through small changes", () => {
    let a = rescaleAxis(null, 50, 130, 10);
    expect(a.lo).toBeLessThanOrEqual(50);
    expect(a.hi).toBeGreaterThanOrEqual(130);
    expect(rescaleAxis(a, 52, 128, 10)).toBe(a);
    a = rescaleAxis(a, 50, 160, 10);
    expect(a.hi).toBeGreaterThanOrEqual(160);
  });
  it("shrinks only when the data fill well under the span", () => {
    const a = rescaleAxis(null, 0, 200, 10);
    expect(rescaleAxis(a, 0, 150, 10)).toBe(a);
    expect(rescaleAxis(a, 0, 90, 10).hi).toBeLessThan(a.hi);
  });
  it("ignores non-finite needs", () => {
    const a = { lo: 0, hi: 100 };
    expect(rescaleAxis(a, NaN, 5, 10)).toBe(a);
  });
});

describe("loops panel with the stub source", () => {
  it("is on by default and has a stable id", () => {
    expect(loopsPanel.id).toBe("loops");
    expect(loopsPanel.defaultOn).toBe(true);
  });
  it("stub beat gives the stub's SV, EF and a positive EDP", () => {
    const b = createStubSource().beats(1)[0];
    const s = loopStats(b.loops.LV.p, b.loops.LV.v, b.edv.LV, b.esv.LV);
    expect(s.edv).toBe(130);
    expect(s.sv).toBe(75);
    expect(s.ef).toBeCloseTo(75 / 130, 6);
    expect(s.edp).toBeGreaterThan(0);
  });
});
