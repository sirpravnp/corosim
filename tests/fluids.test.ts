// Fluid compartments (task C2): the model alone with a venous-pressure stand-in, then the core simulation with the engine's own pressures.
import { describe, it, expect } from "vitest";
import { FluidCompartments, oncotic, starling } from "../src/physics/core/fluids";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";

const BV = 4900;
/** The model with a crude circulation: capillary pressure rises 0.0085 mmHg per ml of blood above the resting volume (the slope the core engine shows). */
function bench() {
  const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
  const run = (minutes: number) => {
    for (let t = 0; t < minutes; t += 0.25) {
      const pc = 17 + 0.0085 * (f.bloodVolume - BV);
      f.setPressures(90, (pc - 0.13 * 90) / 0.87);
      f.advance(0.25);
    }
  };
  return { f, run };
}

describe("Starling pieces", () => {
  it("oncotic pressure of 7 g/dl protein is 25.6 mmHg (Landis and Pappenheimer)", () => { expect(oncotic(7)).toBeCloseTo(25.6, 0); });
  it("filtration is Kf times the net force", () => { expect(starling(2, 0.9, 20, 0, 25, 5)).toBeCloseTo(2 * (20 - 0.9 * 20), 9); });
});

describe("the resting patient", () => {
  it("stays where it is for hours (no drift, no settling)", () => {
    const { f, run } = bench(); run(240);
    const r = f.read();
    expect(Math.abs(r.blood - BV)).toBeLessThan(2); expect(Math.abs(r.interstitialExcess)).toBeLessThan(2);
    expect(r.hb).toBeCloseTo(14, 1);
    expect(Math.abs(r.netTranscapillary)).toBeLessThan(0.1);
  });
});

describe("fluids given", () => {
  const retained = (kind: "crystalloid" | "albumin" | "colloid", ml: number, at: number[]) => {
    const { f, run } = bench(); f.schedule(kind, ml, 0, 5);
    let t = 0; return at.map((m) => { run(m - t); t = m; return (f.read().blood - BV) / ml; });
  };
  it("1 L of crystalloid: 20-30 % intravascular at 30 minutes", () => {
    const [r30, r60] = retained("crystalloid", 1000, [30, 60]);
    expect(r30).toBeGreaterThan(0.2); expect(r30).toBeLessThan(0.3);
    expect(r60).toBeGreaterThan(0.2); expect(r60).toBeLessThan(0.3);
  });
  it("500 ml of 5 % albumin: more than 80 % intravascular at 30 minutes", () => {
    const [r30, r60] = retained("albumin", 500, [30, 60]);
    expect(r30).toBeGreaterThan(0.8); expect(r60).toBeGreaterThan(0.8);
  });
  it("synthetic colloid stays in too", () => { expect(retained("colloid", 500, [30])[0]).toBeGreaterThan(0.8); });
  it("crystalloid dilutes Hb and the plasma proteins, and the water goes to the interstitium", () => {
    const { f, run } = bench(); f.schedule("crystalloid", 1000, 0, 5); run(10);
    expect(f.read().hb).toBeLessThan(13); expect(f.read().oncoticPlasma).toBeLessThan(21);
    run(50); expect(f.read().interstitialExcess).toBeGreaterThan(550);
  });
  it("blood restores Hb: two units after a bleed", () => {
    const { f, run } = bench(); f.bleed(1000); run(60);
    const low = f.read().hb;
    f.schedule("blood", 700, 60, 30); run(120);
    expect(f.read().hb).toBeGreaterThan(low + 0.9);
  });
  it("2 units of blood (600 ml) raise Hb of the normal adult by about 1 g/dl", () => {
    const { f, run } = bench(); f.schedule("blood", 600, 0, 20); run(60);
    expect(f.read().hb - 14).toBeGreaterThan(0.6); expect(f.read().hb - 14).toBeLessThan(1.5);
  });
});

describe("hemorrhage", () => {
  it("lowers the blood volume at the set rate minus the transcapillary refill, and Hb falls as the interstitium refills", () => {
    const { f, run } = bench(); f.hemorrhage = 20; run(30);
    const r = f.read(), lost = 20 * 30;
    expect(r.lost).toBeCloseTo(lost, 3);
    expect(BV - r.blood).toBeLessThan(lost); expect(BV - r.blood).toBeGreaterThan(0.6 * lost);
    expect(-r.interstitialExcess).toBeGreaterThan(20); // the refill
    expect(r.hb).toBeLessThan(14);
    expect(r.netTranscapillary).toBeLessThan(0); // the interstitium gives to the plasma
  });
  it("a sudden loss is refilled from the interstitium over the next minutes", () => {
    const { f, run } = bench(); f.bleed(735); run(5);
    const early = f.read().netTranscapillary; run(60);
    expect(early).toBeLessThan(-5); expect(f.read().blood).toBeGreaterThan(BV - 735 + 100);
  });
});

describe("conservation of water", () => {
  it("intravascular + interstitial = rest + given - lost - urine + maintenance, to under 1 ml, through every kind of event", () => {
    const { f, run } = bench();
    f.schedule("crystalloid", 1500, 0, 10); f.schedule("albumin", 500, 20, 15); f.schedule("blood", 600, 40, 30); f.schedule("colloid", 500, 60, 10);
    f.hemorrhage = 25; f.leak = 0.5; run(90); f.hemorrhage = 0; f.bleed(300); f.diuretic = 3; run(240);
    expect(Math.abs(f.balance())).toBeLessThan(1);
    const r = f.read(); expect(r.given).toBeCloseTo(3100, 3); expect(r.urine).toBeGreaterThan(100);
  });
});

describe("capillary leak and diuresis", () => {
  it("leak lets more of the crystalloid out and the albumin escape", () => {
    const run = (leak: number) => { const { f, run: r } = bench(); f.leak = leak; f.schedule("crystalloid", 1000, 0, 5); r(30); return f.read().blood - BV; };
    expect(run(0.8)).toBeLessThan(run(0) - 40);
  });
  it("a diuretic and a full circulation make more urine; shock stops it", () => {
    const urine = (setup: (f: FluidCompartments) => void) => { const { f, run } = bench(); setup(f); run(60); return f.read().urine; };
    const base = urine(() => {});
    expect(urine((f) => { f.diuretic = 4; })).toBeGreaterThan(2.5 * base);
    expect(urine((f) => f.give("crystalloid", 1500))).toBeGreaterThan(1.5 * base);
    const { f } = bench(); f.setPressures(35, 3); f.advance(60); expect(f.read().urine).toBe(0);
  });
});

describe("in the core simulation", () => {
  const make = (spec: PatientSpec = {}) => { const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3, ...spec }, { settled: true }); s.warmup(40); return s; };
  const min = (s: Simulation, m: number) => s.step(m / s.minutesPerSecond / s.speed);
  it("is null on the legacy engine", () => { expect(new Simulation({ seed: 1 }).fluids()).toBeNull(); });
  it("1 L of crystalloid from the spec: 20-30 % intravascular at 30 clinical minutes, 500 ml of albumin more than 80 %, water conserved", () => {
    const c = make({ fluids: { given: [{ kind: "crystalloid", ml: 1000, atMin: 0, overMin: 5 }] } }), a = make({ fluids: { given: [{ kind: "albumin", ml: 500, atMin: 0, overMin: 5 }] } });
    min(c, 30); min(a, 30);
    const fc = c.fluids()!, fa = a.fluids()!;
    expect((fc.blood - BV) / 1000).toBeGreaterThan(0.2); expect((fc.blood - BV) / 1000).toBeLessThan(0.3);
    expect((fa.blood - BV) / 500).toBeGreaterThan(0.8);
    expect(Math.abs(fc.conservation)).toBeLessThan(1); expect(Math.abs(fa.conservation)).toBeLessThan(1);
    // the engine holds the compartments' blood (rate-limited, so within a few ml of the target after the bolus)
    const total = (x: Simulation) => x.live!.engine.sample().V.reduce((p, q) => p + q, 0);
    expect(Math.abs(total(c) - (total(make()) + fc.blood - BV))).toBeLessThan(15);
    expect(fc.hb).toBeLessThan(13.5);
  });
  it("hemorrhage at a set rate: the loss minus the refill, Hb falling", () => {
    const s = make({ fluids: { hemorrhageMlMin: 20 } }); min(s, 20);
    const f = s.fluids()!;
    expect(f.lost).toBeCloseTo(400, 0); expect(BV - f.blood).toBeLessThan(400); expect(BV - f.blood).toBeGreaterThan(250);
    expect(f.hb).toBeLessThan(14); expect(f.netTranscapillary).toBeLessThan(0);
    s.apply({ fluids: { hemorrhageMlMin: 0 } }); min(s, 5); const lost = s.fluids()!.lost; min(s, 10); expect(s.fluids()!.lost).toBe(lost);
  });
  it("capillary leak from the spec reaches the model", () => { expect(make({ fluids: { capillaryLeak: 0.6 } }).fluids()!.leak).toBe(0.6); });
  it("the dials still work: blood loss and IV fluid go through the compartments", () => {
    const s = make({ bloodLoss: 0.15, support: { fluids: 1 } });
    expect(s.fluids()!.lost).toBeCloseTo(735, 0); expect(s.fluids()!.given).toBeCloseTo(1000, 0);
  });
});
