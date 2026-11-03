import { describe, it, expect } from "vitest";
import { normalizeScenario } from "../src/sim/scenario";
import { relaxationTau } from "../src/physics/core/recorder";
import { Simulation } from "../src/sim/simulation";
import { assessHeart, murmurOf } from "../src/sim/valves";
import { FluidCompartments } from "../src/physics/core/fluids";
import { INFARCT } from "../src/config/management";

describe("NaN stenosis in normalizeScenario", () => {
  it("warns and drops a lesion whose stenosis is not finite", () => {
    const n = normalizeScenario({ lesions: [{ artery: "LAD", stenosis: NaN }] });
    expect(n.warnings.some((w) => /stenosis is not a number/i.test(w))).toBe(true);
    expect(n.scenario.lesions).toHaveLength(0);
  });
});

describe("relaxationTau guards", () => {
  it("returns NaN on a flat trace after the peak (no trustworthy falling limb)", () => {
    const n = 200, t = Array.from({ length: n }, (_, i) => i * 0.001);
    const pv = t.map((x) => (x < 0.05 ? 80 + 400 * x : 100));
    const pa = t.map(() => 8);
    expect(relaxationTau(t, pv, pa)).toBeNaN();
  });
  it("returns NaN when the fit would imply absurdly slow relaxation", () => {
    const n = 400, t = Array.from({ length: n }, (_, i) => i * 0.001);
    const pv = t.map((x) => (x < 0.05 ? 120 - 800 * x * x : 118 - 0.002 * (x - 0.05)));
    const pa = t.map(() => 6);
    expect(relaxationTau(t, pv, pa)).toBeNaN();
  });
});

describe("apply({ seed }) reseeds random streams", () => {
  const jitter = (s: Simulation) => {
    const out: number[] = [];
    s.autonomic.step(0.5);
    for (let i = 0; i < 20; i++) out.push(s.autonomic.jitter());
    return out.join(",");
  };
  it("changes autonomic jitter after a finite seed apply", () => {
    const s = new Simulation({ seed: 1 }, { engine: "core" });
    s.warmup(5);
    const before = jitter(s);
    s.apply({ seed: 99 });
    expect(jitter(s)).not.toBe(before);
  });
  it("ignores a non-finite seed without changing the stored seed", () => {
    const s = new Simulation({ seed: 1 }, { engine: "core" });
    s.warmup(5);
    s.apply({ seed: NaN });
    expect(s.warnings.some((w) => /seed is not a number/i.test(w))).toBe(true);
    expect(s.n.seed).toBe(1);
  });
});

describe("passive leg raise in fluid compartments", () => {
  const BV = 4900;
  it("does nothing when leg raise is off", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.advance(15);
    const r0 = f.read().blood;
    f.setLegRaise(false);
    f.advance(15);
    expect(f.read().blood - r0).toBeLessThan(5);
  });
  it("raises intravascular volume during leg raise", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.setLegRaise(true);
    f.advance(10);
    expect(f.read().blood).toBeGreaterThan(BV + 80);
  });
});

describe("leg raise in the core simulation with hemorrhage", () => {
  const blood = (s: Simulation) => s.fluids()!.blood;
  it("30% hemorrhage with leg raise differs from the same bleed without it", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, bloodLoss: 0.3 }, { settled: true });
    s.warmup(20);
    for (let i = 0; i < 60; i++) s.step(0.25, { minutes: 0.25 * s.speed * INFARCT.minutesPerSecond });
    const before = blood(s);
    s.apply({ fluids: { legRaise: true } });
    for (let i = 0; i < 40; i++) s.step(0.25, { minutes: 0.25 * s.speed * INFARCT.minutesPerSecond });
    expect(blood(s)).toBeGreaterThan(before + 40);
  });
  it("healthy adult with legRaise false matches the same patient without the flag", () => {
    const mk = (fluids?: { legRaise?: boolean }) => {
      const s = new Simulation({}, { engine: "core" });
      s.reset({ seed: 3, ...(fluids ? { fluids } : {}) }, { settled: true });
      s.warmup(20);
      for (let i = 0; i < 40; i++) s.step(0.25, { minutes: 0.25 * s.speed * INFARCT.minutesPerSecond });
      return s.fluids()!.blood;
    };
    expect(Math.abs(mk() - mk({ legRaise: false }))).toBeLessThan(5);
  });
});

describe("Impella RP level 0", () => {
  it("does not run retrograde when the pump is present at level 0", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, devices: { impellaRp: { level: 0 } } }, { settled: true });
    s.warmup(25);
    for (let i = 0; i < 80; i++) s.step(0.02);
    const flow = s.live!.engine.sample().taps.impellaRp?.flow ?? 0;
    expect(Math.abs(flow)).toBeLessThan(0.1);
  });
});

describe("shunt murmurs in murmurOf", () => {
  it("reports flow murmurs for ASD, VSD and PDA without changing valve grades", () => {
    const asd = assessHeart({ asd: { diameterMm: 15 } });
    expect(asd.murmur).toMatch(/Atrial septal shunt/i);
    expect(asd.valves.every((v) => v.stenosis === "none" && v.regurgitation === "none")).toBe(true);
    const vsd = assessHeart({ vsd: { diameterMm: 8 }, pvri: 2 });
    expect(vsd.murmur).toMatch(/Ventricular septal shunt/i);
    const pda = assessHeart({ pda: { diameterMm: 4 }, pvri: 1.5 });
    expect(pda.murmur).toMatch(/Patent ductus shunt/i);
  });
  it("keeps valve murmur grading unchanged", () => {
    const both = assessHeart({ valves: { av: { open: 0.3 } }, asd: { diameterMm: 15 } });
    expect(both.murmur).toMatch(/Aortic: crescendo-decrescendo/i);
    expect(both.murmur).toMatch(/Atrial septal shunt/i);
    expect(murmurOf(both.valves)).toMatch(/Aortic:/);
    expect(murmurOf(both.valves)).not.toMatch(/Atrial septal/);
  });
});

describe("empty circulation death", () => {
  it("declares death after sustained empty stressed volume with no output", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, fluids: { hemorrhageMlMin: 100 } }, { settled: true });
    s.warmup(15);
    let steps = 0;
    while (!s.dead && steps < 8000) {
      s.step(0.25, { minutes: 0.25 * s.speed * INFARCT.minutesPerSecond });
      steps++;
    }
    expect(s.dead).toBe(true);
    expect(s.deathCause).toBe("noFlow");
  });
  it("healthy adult is still alive at six clinical hours", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3 }, { settled: true });
    s.warmup(15);
    const target = 360;
    let done = 0;
    while (done < target && !s.dead) {
      const chunk = Math.min(5, target - done);
      s.step(chunk / (s.speed * INFARCT.minutesPerSecond), { minutes: chunk });
      done += chunk;
    }
    expect(s.dead).toBe(false);
  });
});
