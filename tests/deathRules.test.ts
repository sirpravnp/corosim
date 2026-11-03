// Fast checks of the guards that keep a lethal scenario from hanging the engine or running past empty (docs/ARREST.md, "What kills").
// The end-to-end death trials (every clock speed, bounded steps) are in tests/deathTrials.test.ts (slow).
import { describe, it, expect } from "vitest";
import { FluidCompartments } from "../src/physics/core/fluids";
import { FLUIDS } from "../src/config/fluids";
import { VolumeExchange } from "../src/physics/core/volume";
import type { Ctx, Rates } from "../src/physics/core/types";
import { Conduction, rhythmState } from "../src/physics/rhythm";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { bedSites } from "../src/physics/ecgLink";
import { ARREST_SIM } from "../src/config/arrestSim";
import { ARREST } from "../src/config/arrest";

const BV = 4900;
const finiteState = (f: FluidCompartments) => Object.values(f.read()).every((v) => typeof v !== "number" || Number.isFinite(v));

describe("a hemorrhage stops at exsanguination", () => {
  it("bleeding 200 ml/min for 10 clinical hours leaves the blood volume at the floor, every compartment finite and none negative", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.hemorrhage = 200; f.setPressures(0, 0); f.setLungPressures(0, 0); // a circulation with no pressure left, as at the end
    for (let m = 0; m < 600; m += 5) f.advance(5);
    const r = f.read();
    expect(finiteState(f)).toBe(true);
    expect(r.blood).toBeGreaterThanOrEqual(FLUIDS.hemorrhage.floor * BV - 1);
    expect(r.blood).toBeLessThan(FLUIDS.hemorrhage.taperFrom * BV + 1); // it did bleed down to the taper
    expect(Math.min(r.plasma, r.redCells, r.interstitial)).toBeGreaterThanOrEqual(0);
    expect(f.hemorrhageNow).toBeLessThan(0.2 * 200); // the bleed has all but stopped
  });
  it("the rate is the set rate until the taper begins, then falls linearly to nothing at the floor", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.hemorrhage = 100;
    expect(f.hemorrhageNow).toBe(100);
    f.bleed(BV * (1 - (FLUIDS.hemorrhage.floor + FLUIDS.hemorrhage.taperFrom) / 2)); // halfway down the taper band
    expect(f.hemorrhageNow).toBeCloseTo(50, 0);
  });
  it("a sudden loss bigger than the blood volume stops at the floor; blood given back is not limited", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.bleed(10 * BV);
    expect(f.bloodVolume).toBeCloseTo(FLUIDS.hemorrhage.floor * BV, 6);
    f.bleed(-1000);
    expect(f.bloodVolume).toBeCloseTo(FLUIDS.hemorrhage.floor * BV + 1000, 6);
    expect(finiteState(f)).toBe(true);
  });
  it("a moderate bleed is untouched by the floor (the taper only acts in the last tenth of the volume)", () => {
    const f = new FluidCompartments({ bloodMl: BV, hb: 14, weightKg: 70 });
    f.hemorrhage = 100; f.advance(10);
    expect(f.read().lost).toBeCloseTo(1000, 6);
  });
});

describe("the engine cannot be drained below empty", () => {
  // two veins at their unstressed volume (weight 0) and one with 30 ml under pressure
  const rig = (V: number[]) => {
    const flows: { from: number; q: number }[] = [];
    const out = { flow: (from: number, _to: number, q: number) => flows.push({ from, q }) } as unknown as Rates;
    const ctx = { t: 0, V: Float64Array.from(V) } as unknown as Ctx;
    const ex = new VolumeExchange("x", [0, 1, 2], [0, 1, 2], (n, v) => Math.max(0, v - 500));
    return { ex, ctx, out, flows };
  };
  it("a loss takes only from the stressed volume, at most all of it per 0.25 s", () => {
    const { ex, ctx, out, flows } = rig([500, 500, 530]);
    ex.set({ rate: -120 }); ex.flow(ctx, out);
    expect(flows.filter((f) => f.from !== 2).every((f) => f.q === 0)).toBe(true); // nothing from the empty veins
    expect(flows.reduce((s, f) => s + f.q, 0)).toBeCloseTo(30 / 0.25, 6); // capped below the 120 asked
  });
  it("with nothing stressed left, a loss takes nothing", () => {
    const { ex, ctx, out, flows } = rig([500, 500, 500]);
    ex.set({ rate: -120 }); ex.flow(ctx, out);
    expect(flows.reduce((s, f) => s + f.q, 0)).toBe(0);
  });
  it("while the cap does not bind, the loss is shared exactly as before", () => {
    const { ex, ctx, out, flows } = rig([800, 600, 500]);
    ex.set({ rate: -40 }); ex.flow(ctx, out);
    expect(flows.map((f) => f.q)).toEqual([40 * (300 / 400), 40 * (100 / 400), 0]);
  });
});

describe("the beat generator never loops on a broken rate", () => {
  const sites = bedSites(buildTree(TYPICAL));
  for (const [what, patch] of [["a NaN sinus rate", { sinusRate: NaN }], ["a zero sinus rate", { sinusRate: 0 }], ["a NaN AF rate", { rhythm: "af", afRate: NaN }], ["a NaN escape rate in complete block", { avDegree: 3, escapeRate: NaN }]] as const) {
    it(`${what}: advance() returns, with finite, increasing beat times`, () => {
      const st = { ...rhythmState(sites, {}, 0, { rhythm: "sinus", bbb: "none" }), ...patch } as ReturnType<typeof rhythmState>;
      const beats = new Conduction(3).advance(30, st);
      expect(beats.length).toBeGreaterThan(0);
      expect(beats.length).toBeLessThan(400); // 30 s at no more than 400/min plus their P waves
      expect(beats.every((b) => Number.isFinite(b.t) && Number.isFinite(b.rr))).toBe(true);
    });
  }
  it("a modulation that returns NaN (the baroreflex fed a NaN pressure) does not stall it", () => {
    const st = rhythmState(sites, {}, 0, { rhythm: "sinus", bbb: "none" });
    const beats = new Conduction(3).advance(20, st, { rate: () => NaN, jitter: () => 0 });
    expect(beats.length).toBeGreaterThan(5); expect(beats.length).toBeLessThan(300);
  });
});

describe("the thresholds hang together", () => {
  it("the pulse check's lines sit below the shock line, with hysteresis", () => {
    const P = ARREST_SIM.pulsePressure, C = ARREST_SIM.critical;
    expect(P.mapAbove).toBeGreaterThan(P.mapBelow); expect(P.sbpAbove).toBeGreaterThan(P.sbpBelow);
    expect(P.mapAbove).toBeLessThan(ARREST.shockDeath.map); // a patient in shock but with a pulse dies on the shock clock, not as PEA
    expect(C.enterMap).toBe(ARREST.shockDeath.map); // the clock slows to real time where the shock clock starts counting
    expect(C.exitMap).toBeGreaterThan(C.enterMap);
  });
});
