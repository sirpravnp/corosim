import { describe, it, expect } from "vitest";
import { electrolyteEffects, withElectrolytes } from "../src/physics/electrolytes";
import { Beat, sampleLeadsVec } from "../src/physics/ecg";
import { Simulation } from "../src/sim/simulation";
import { rhythmState } from "../src/physics/rhythm";
import { LYTE } from "../src/config/electrolytes";

const NORMAL = electrolyteEffects(4.2, 2.4, 0.9);
const beat = (lyte?: Beat["lyte"]): Beat => ({ t: 1, rr: 0.85, pvc: false, pr: 0.16, lyte });
/** The waveform of one beat in a lead, sampled across the whole complex. */
const trace = (lead: "II" | "V2", lyte?: Beat["lyte"]) => {
  const b = beat(lyte), pts: { dt: number; v: number }[] = [];
  for (let dt = -0.3; dt <= 0.7; dt += 0.002) pts.push({ dt, v: sampleLeadsVec(b.t + dt, [b], [0, 0, 0], 0)[lead] });
  return pts;
};
const peak = (pts: { dt: number; v: number }[], from: number, to: number, sign = 1) => pts.filter((p) => p.dt >= from && p.dt <= to).reduce((m, p) => (sign * p.v > sign * m.v ? p : m), { dt: from, v: -sign * 9 });

describe("what the levels do", () => {
  it("normal levels change nothing: no morph, no extra PR, no rate change, no block", () => {
    expect(NORMAL.morph).toBeNull(); expect(NORMAL.prAdd).toBe(0); expect(NORMAL.rateScale).toBe(1); expect(NORMAL.avFloor).toBe(0); expect(NORMAL.findings).toEqual([]);
  });
  it("hyperkalemia progresses in the order taught: peaked T, then flat P with long PR and wide QRS, then block and bradycardia, then a sine wave", () => {
    const f = (k: number) => electrolyteEffects(k, 2.4, 0.9);
    expect(f(5.8).morph!.tAmp).toBeGreaterThan(1.3); expect(f(5.8).prAdd).toBe(0); expect(f(5.8).morph!.qrsWide).toBe(1);
    expect(f(6.8).prAdd).toBeGreaterThan(0.05); expect(f(6.8).morph!.pAmp).toBeLessThan(0.7); expect(f(6.8).avFloor).toBe(1);
    expect(f(7.8).morph!.qrsWide).toBeGreaterThan(1.8); expect(f(7.8).avFloor).toBe(2); expect(f(7.8).rateScale).toBeLessThan(0.8);
    expect(f(8.5).avFloor).toBe(3); expect(f(8.5).morph!.pAmp).toBe(0); expect(f(8.5).morph!.qrsWide).toBeCloseTo(LYTE.k.qrsWideMax, 5);
    let prev = 1; for (let k = 5; k <= 8.5; k += 0.5) { const t = f(k).morph?.tAmp ?? 1; expect(t).toBeGreaterThanOrEqual(prev - 1e-9); prev = t; } // the T keeps growing with the level
  });
  it("hypokalemia flattens the T and brings out U waves and ST depression, with no conduction change", () => {
    const e = electrolyteEffects(2.5, 2.4, 0.9);
    expect(e.morph!.tAmp).toBeLessThan(0.5); expect(e.morph!.uAmp).toBeGreaterThan(0.08); expect(e.morph!.stDep).toBeGreaterThan(0); expect(e.prAdd).toBe(0); expect(e.avFloor).toBe(0); expect(e.rateScale).toBe(1);
  });
  it("calcium moves the QT: low lengthens it, high shortens it", () => {
    expect(electrolyteEffects(4.2, 1.5, 0.9).morph!.qtScale).toBeGreaterThan(1.2);
    expect(electrolyteEffects(4.2, 3.4, 0.9).morph!.qtScale).toBeLessThan(0.85);
    expect(electrolyteEffects(4.2, 2.4, 0.3).morph!.qtScale).toBeGreaterThan(1.05); // severe low magnesium: a little
  });
  it("withElectrolytes lengthens the PR, slows the rate and floors the AV block, and leaves a normal patient alone", () => {
    const r = rhythmState([], {}, 0), same = withElectrolytes(r, NORMAL);
    expect(same).toBe(r);
    const k = withElectrolytes(r, electrolyteEffects(7.8, 2.4, 0.9));
    expect(k.pr).toBeGreaterThan(r.pr + 0.1); expect(k.sinusRate).toBeLessThan(r.sinusRate * 0.8); expect(k.avDegree).toBe(2);
  });
});

describe("what is drawn", () => {
  const tPeak = (lead: "II" | "V2", lyte?: Beat["lyte"]) => peak(trace(lead, lyte), 0.15, 0.6, 1);
  it("hyperkalemia gives a taller, narrower T wave and a wider QRS", () => {
    const hk = electrolyteEffects(7, 2.4, 0.9).morph!;
    const n = trace("V2"), h = trace("V2", hk);
    expect(peak(h, 0.1, 0.6).v).toBeGreaterThan(peak(n, 0.1, 0.6).v * 1.8);
    const width = (pts: typeof n) => { const m = peak(pts, 0.1, 0.6).v; return pts.filter((p) => p.dt > 0.1 && p.dt < 0.6 && p.v > m / 2).length; };
    expect(width(h)).toBeLessThan(width(n));
    const wide = electrolyteEffects(8, 2.4, 0.9).morph!, qrsSpan = (pts: typeof n) => { const a = pts.filter((p) => p.dt > -0.06 && p.dt < 0.12 && Math.abs(p.v) > 0.08); return a.length ? a[a.length - 1].dt - a[0].dt : 0; };
    expect(qrsSpan(trace("II", wide))).toBeGreaterThan(qrsSpan(trace("II")) * 1.3);
  });
  it("hyperkalemia flattens the P wave", () => {
    const n = peak(trace("II"), -0.3, -0.05).v, h = peak(trace("II", electrolyteEffects(7.8, 2.4, 0.9).morph!), -0.3, -0.05).v;
    expect(h).toBeLessThan(n * 0.6);
  });
  it("hypokalemia flattens the T and adds a U wave after it", () => {
    const hypo = electrolyteEffects(2.5, 2.4, 0.9).morph!;
    const n = trace("V2"), h = trace("V2", hypo);
    expect(peak(h, 0.15, 0.45).v).toBeLessThan(peak(n, 0.15, 0.45).v * 0.7);
    const u = peak(h, 0.45, 0.7).v; expect(u).toBeGreaterThan(0.02);
  });
  it("a low calcium puts the T later; a high calcium puts it earlier", () => {
    const at = (ca: number) => peak(trace("V2", electrolyteEffects(4.2, ca, 0.9).morph!), 0.1, 0.7).dt;
    expect(at(1.5)).toBeGreaterThan(at(2.4) + 0.03); expect(at(3.4)).toBeLessThan(at(2.4) - 0.02);
  });
});

describe("in the simulation", () => {
  const run = (spec: object) => { const s = new Simulation({ seed: 3 }, { engine: "core" }); s.reset(spec as never, { settled: true }); s.warmup(10); s.step(60, { minutes: 2 }); return s; };
  const hr = (s: Simulation) => (s.state() as { rolling10s: { hr: number } }).rolling10s.hr;
  it("a normal patient is unchanged, and K 6.8 gives a long PR with the findings reported", () => {
    const base = run({}), e0 = base.ecg();
    expect(e0.prMs).toBe(160); expect(e0.electrolyteFindings).toEqual([]);
    const hk = run({ electrolytes: { potassium: 6.8 } }), e1 = hk.ecg();
    expect(e1.prMs).toBeGreaterThan(200); expect(e1.electrolyteFindings.join(" ")).toContain("peaked T"); expect(e1.rhythm).toMatch(/first-degree/);
  }, 120000);
  it("K 7.8 slows the heart and blocks the AV node, K 8.5 is complete heart block, and the pressure falls", () => {
    const base = run({}), mid = run({ electrolytes: { potassium: 7.8 } }), top = run({ electrolytes: { potassium: 8.5 } });
    expect(hr(mid)).toBeLessThan(hr(base) * 0.8); expect(mid.ecg().rhythm).toMatch(/Mobitz|block/i);
    expect(top.ecg().rhythm).toMatch(/complete heart block/); expect(top.map).toBeLessThan(base.map);
  }, 180000);
  it("calcium and low potassium report their findings, and a library rhythm keeps its own rate", () => {
    expect(run({ electrolytes: { calcium: 1.5 } }).ecg().electrolyteFindings.join(" ")).toContain("QT");
    expect(run({ electrolytes: { potassium: 2.5 } }).ecg().electrolyteFindings.join(" ")).toContain("U waves");
    const vt = (k: number) => { const s = run({ patient: { rhythm: "svt" }, electrolytes: { potassium: k } }); return hr(s); };
    expect(Math.abs(vt(7.8) - vt(4.2))).toBeLessThan(6);
  }, 180000);
});
