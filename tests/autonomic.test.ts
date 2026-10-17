import { describe, it, expect } from "vitest";
import { Autonomic, OU, gaussian } from "../src/physics/autonomic";
import { mulberry32 } from "../src/physics/ecg";

describe("noise sources", () => {
  it("gaussian() is standard normal", () => {
    const r = mulberry32(1), xs = Array.from({ length: 20000 }, () => gaussian(r));
    const m = xs.reduce((a, b) => a + b) / xs.length, v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(v).toBeGreaterThan(0.95); expect(v).toBeLessThan(1.05);
  });
  it("OU keeps its stationary variance whatever the step size", () => {
    for (const dt of [0.01, 0.1, 1]) {
      const o = new OU(mulberry32(3), 0.5, 5);
      let s = 0, n = 0;
      for (let i = 0; i < 40000 / dt / 10; i++) { const x = o.step(dt); s += x * x; n++; }
      expect(Math.sqrt(s / n)).toBeGreaterThan(0.4); expect(Math.sqrt(s / n)).toBeLessThan(0.6);
    }
  });
});

describe("baroreflex", () => {
  const settle = (a: Autonomic, sys: number, dia: number, seconds: number) => {
    for (let i = 0; i < seconds / 0.02; i++) { if (i % 40 === 0) a.sense(sys, dia); a.step(0.02); }
  };
  const quiet = () => { const a = new Autonomic(1); a.controls.noiseScale = 0; a.controls.respDepth = 0; return a; };
  it("is neutral at the set point", () => {
    const a = quiet(); settle(a, 122, 72, 20);
    const fx = a.effects();
    expect(fx.hrScale).toBeCloseTo(1, 2); expect(fx.resistance).toBeCloseTo(1, 2);
  });
  it("a pressure fall raises heart rate, contractility and resistance; a rise does the opposite", () => {
    const lo = quiet(); settle(lo, 90, 55, 20);
    const hi = quiet(); settle(hi, 160, 100, 20);
    const l = lo.effects(), h = hi.effects();
    expect(l.hrScale).toBeGreaterThan(1.05); expect(l.contractility).toBeGreaterThan(1); expect(l.resistance).toBeGreaterThan(1);
    expect(h.hrScale).toBeLessThan(0.95); expect(h.resistance).toBeLessThan(1);
    expect(l.sympathetic).toBeGreaterThan(h.sympathetic); expect(h.vagal).toBeGreaterThan(l.vagal);
  });
  it("the vagal arm acts within a second, the sympathetic arm takes several", () => {
    const a = quiet(); settle(a, 120, 70, 10);
    a.sense(90, 55);
    for (let i = 0; i < 60; i++) a.step(0.02); // 1.2 s
    const early = a.effects();
    for (let i = 0; i < 400; i++) a.step(0.02); // 9 s more
    const late = a.effects();
    expect(1 - early.vagal / late.vagal).toBeLessThan(0.6 + 0.4); // vagal already well along
    const v0 = 0.4; // resting vagal tone
    expect((v0 - early.vagal) / (v0 - late.vagal)).toBeGreaterThan(0.5);
    expect((early.sympathetic - 0.3) / (late.sympathetic - 0.3)).toBeLessThan(0.5);
  });
  it("gain 0 removes the feedback", () => {
    const a = quiet(); a.controls.baroreflexGain = 0; settle(a, 90, 55, 20);
    expect(a.effects().hrScale).toBeCloseTo(1, 2);
  });
  it("atropine removes the vagal effect and beta blockade the sympathetic one", () => {
    const base = quiet(); settle(base, 120, 70, 5);
    const atro = quiet(); atro.controls.vagalBlock = 1; settle(atro, 120, 70, 5);
    const beta = quiet(); beta.controls.betaBlock = 1; settle(beta, 120, 70, 5);
    expect(atro.effects().hrScale).toBeGreaterThan(1.2);
    expect(beta.effects().hrScale).toBeLessThan(0.9);
  });
  it("respiration modulates the sinus rate at the breathing frequency (RSA) and not when vagal tone is blocked", () => {
    const rsa = (block: number) => {
      const a = new Autonomic(2); a.controls.noiseScale = 0; a.controls.vagalBlock = block;
      settle(a, 120, 70, 5);
      const xs = Array.from({ length: 80 }, (_, i) => a.hrScaleAt(a.t + i * 0.05));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(rsa(0)).toBeGreaterThan(0.08);
    expect(rsa(1)).toBeLessThan(0.01);
  });
  it("is repeatable for a seed and different across seeds", () => {
    const run = (seed: number) => { const a = new Autonomic(seed); settle(a, 120, 70, 30); return a.effects().sympathetic; };
    expect(run(5)).toBe(run(5)); expect(run(5)).not.toBe(run(6));
  });
});
