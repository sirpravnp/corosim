// Generic rotary pump (D1): fit, steady flow between fixed pressures, between compliances, suction, backflow, dt.
import { describe, it, expect } from "vitest";
import { createEngine } from "../src/physics/core/engine";
import { Compliance } from "../src/physics/core/chamber";
import { RotaryPump, fitHQ, pumpHead, inflowResistance, type HQPoint, type PumpParams } from "../src/physics/core/devices/pump";
import { GENERIC_PUMP } from "../src/config/devices";
import type { Engine } from "../src/physics/core/types";

const KNOWN = { a: 0.12, b: 0.03, c: 0.002 };
const SPEEDS = [20, 25, 30];
const table = (noise = 0): HQPoint[] => SPEEDS.flatMap((speed, i) => [0, 10, 20, 30, 40].map((flow, j) => {
  const head = pumpHead(KNOWN, speed, flow);
  return { speed, flow, head: head * (1 + noise * Math.sin(1.7 * i + 2.3 * j)) };
}));

const BIG = 1e6;
/** Two huge compliances that hold their pressures: inflow at pIn, outflow at pOut. */
const fixed = (pIn: number, pOut: number, patch: Partial<PumpParams> = {}) => {
  const pump = new RotaryPump("pump", 0, 1, patch);
  const eng = createEngine([
    { name: "in", model: new Compliance("in", BIG), group: "none", start: pIn * BIG },
    { name: "out", model: new Compliance("out", BIG), group: "none", start: pOut * BIG }], [pump]);
  return { eng, pump };
};
const run = (eng: Engine, s: number, dt = 0.0005) => { const n = Math.round(s / dt); for (let i = 0; i < n; i++) eng.step(dt); };
const tap = (eng: Engine, k: string) => eng.sample().taps.pump[k];
const Q = (eng: Engine) => eng.sample().q.pump;

describe("fitHQ", () => {
  it("recovers known coefficients within 1 %", () => {
    const f = fitHQ(table());
    for (const k of ["a", "b", "c"] as const) expect(Math.abs(f[k] - KNOWN[k]) / KNOWN[k]).toBeLessThan(0.01);
  });
  it("reproduces a noisy HQ table at 3 speeds within 5 %", () => {
    const t = table(0.02), f = fitHQ(t);
    for (const p of t) { expect(p.head).toBeGreaterThan(10); expect(Math.abs(pumpHead(f, p.speed, p.flow) - p.head) / p.head).toBeLessThan(0.05); }
  });
});

describe("between fixed pressures", () => {
  const pIn = 40, params = { ...GENERIC_PUMP };
  /** Steady Q (ml/s) of H(ω,Q) − ΔP − R_in·Q = 0 by bisection. */
  const expected = (dP: number, speed = params.speed) => {
    const R = inflowResistance(params, pIn, 1e3);
    let lo = -200, hi = 400;
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (pumpHead(params, speed, m) - dP - R * m > 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const settled = (dP: number, speed = params.speed) => { const { eng } = fixed(pIn, pIn + dP, { speed }); run(eng, 1); return Q(eng); };

  it("steady flow equals the HQ curve's flow at that pressure difference", () => {
    for (const dP of [0, 20, 50, 80]) expect(settled(dP)).toBeCloseTo(expected(dP), 3);
  });
  it("flow falls as ΔP rises and rises with speed", () => {
    const q = [10, 30, 50, 70].map((d) => settled(d));
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeLessThan(q[i - 1]);
    const s = [20, 25, 30, 35].map((w) => settled(40, w));
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });
  it("speed can be set live", () => {
    const { eng, pump } = fixed(pIn, pIn + 40); run(eng, 0.5); const q0 = Q(eng);
    pump.set({ speed: 35 }); run(eng, 0.5);
    expect(Q(eng)).toBeGreaterThan(q0 + 5); expect(tap(eng, "speed")).toBe(35);
  });
  it("taps: flow in L/min, head, ΔP, power proxy", () => {
    const { eng } = fixed(pIn, pIn + 40); run(eng, 1);
    const q = Q(eng);
    expect(tap(eng, "flow")).toBeCloseTo((q * 60) / 1000, 9);
    expect(tap(eng, "dP")).toBeCloseTo(40, 2);
    expect(tap(eng, "head")).toBeCloseTo(pumpHead(params, 30, q), 6);
    expect(tap(eng, "power")).toBeCloseTo(40 * q, 1);
    expect(tap(eng, "suction")).toBe(0);
  });
  it("regurgitates at zero speed with positive ΔP", () => {
    const { eng } = fixed(pIn, pIn + 60, { speed: 0 }); run(eng, 1);
    expect(Q(eng)).toBeLessThan(-5);
    expect(tap(eng, "suction")).toBe(0);
  });
});

describe("between two compliances", () => {
  it("conserves volume and the flow settles", () => {
    const eng = createEngine([
      { name: "in", model: new Compliance("in", 5), group: "none", start: 250 }, // 50 mmHg
      { name: "out", model: new Compliance("out", 2), group: "none", start: 40 }, // 20 mmHg
    ], [new RotaryPump("pump", 0, 1)]);
    let peak = 0;
    for (let i = 0; i < 20000; i++) {
      eng.step(0.0005); peak = Math.max(peak, Q(eng));
      if (i % 1000 === 0) { const s = eng.sample(); expect(Math.abs(s.V[0] + s.V[1] - 290)).toBeLessThan(1e-9); }
    }
    expect(peak).toBeGreaterThan(20);
    expect(Math.abs(Q(eng))).toBeLessThan(0.05); // settled: H(ω,0) balances ΔP
    expect(eng.sample().V[1]).toBeGreaterThan(40);
  });
});

describe("suction", () => {
  it("an inflow compliance draining toward collapse trips suction, flow drops, no chatter or NaN", () => {
    const eng = createEngine([
      { name: "in", model: new Compliance("in", 4), group: "none", start: 80 }, // 20 mmHg
      { name: "out", model: new Compliance("out", BIG), group: "none", start: 60 * BIG },
    ], [new RotaryPump("pump", 0, 1)]);
    const flow: number[] = [], sus: number[] = [], vin: number[] = [];
    for (let i = 0; i < 16000; i++) { eng.step(0.0005); if (i % 20 === 0) { const s = eng.sample(); flow.push(s.q.pump); sus.push(s.taps.pump.suction); vin.push(s.V[0]); } }
    const peak = Math.max(...flow), end = flow[flow.length - 1];
    expect(flow.every(Number.isFinite) && vin.every(Number.isFinite)).toBe(true);
    expect(sus[0]).toBe(0); expect(sus[sus.length - 1]).toBe(1);
    expect(end).toBeLessThan(0.3 * peak);
    expect(end).toBeGreaterThan(-1e-6); // no reversal through suction
    expect(Math.min(...vin)).toBeGreaterThan(-2);
    let flips = 0; for (let i = 1; i < sus.length; i++) if (sus[i] !== sus[i - 1]) flips++;
    expect(flips).toBe(1); // suction turns on once and stays on: no chatter
    const k = flow.indexOf(peak); for (let i = k + 1; i < flow.length; i++) expect(flow[i]).toBeLessThanOrEqual(flow[i - 1] + 1e-6);
  });
  it("resistance is bounded and rises as pressure or volume fall", () => {
    const p = GENERIC_PUMP;
    expect(inflowResistance(p, 30, 100)).toBeCloseTo(p.R0, 2);
    expect(inflowResistance(p, -50, -50)).toBeLessThanOrEqual(p.R0 + p.Rmax + 1e-12);
    expect(inflowResistance(p, 0, 100)).toBeGreaterThan(inflowResistance(p, 5, 100));
    expect(inflowResistance(p, 30, 2)).toBeGreaterThan(inflowResistance(p, 30, 10));
  });
});

describe("numerics", () => {
  it("halving dt changes settled flow by < 0.5 % and does not oscillate at the default dt", () => {
    const go = (dt: number) => { const { eng } = fixed(40, 90); const q: number[] = []; for (let i = 0; i < 1 / dt; i++) { eng.step(dt); if (i * dt > 0.5) q.push(Q(eng)); } return q; };
    const a = go(0.0005), b = go(0.00025);
    expect(Math.abs(a[a.length - 1] - b[b.length - 1]) / b[b.length - 1]).toBeLessThan(0.005);
    expect(Math.max(...a) - Math.min(...a)).toBeLessThan(1e-3 * Math.abs(a[0]));
  });
  it("a start from rest rises without overshoot", () => {
    const { eng } = fixed(40, 90); let prev = -Infinity, mono = true;
    for (let i = 0; i < 4000; i++) { eng.step(0.0005); const q = Q(eng); if (q < prev - 1e-3) mono = false; prev = q; }
    expect(mono).toBe(true);
  });
});
