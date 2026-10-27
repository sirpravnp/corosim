// Lung water (task C3): the lung compartment of core/fluids.ts alone with held pressures, then the core simulation, the panels' LiveSource and the MCP oxygen tool.
import { describe, it, expect } from "vitest";
import { FluidCompartments } from "../src/physics/core/fluids";
import { FLUIDS } from "../src/config/fluids";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { PRESET_BY_ID } from "../src/sim/presets";
import { oxygen } from "../src/mcp/hemo";
import type { PatientSpec } from "../src/sim/patient";

const L = FLUIDS.lung;
/** The model alone with the wedge and PA pressures held for `hold` minutes, then returned to rest; sampled every 5 minutes. */
function held(pcwp: number, pap: number, hold: number, after = 0) {
  const f = new FluidCompartments({ bloodMl: 4900, hb: 14, weightKg: 70 }), trace: { t: number; excess: number; spo2: number }[] = [];
  const run = (minutes: number, w: number, p: number) => {
    for (let t = 0; t < minutes; t += 0.25) {
      f.setPressures(90, 6); f.setLungPressures(w, p); f.advance(0.25);
      if (Math.abs(f.time % 5) < 1e-6 || Math.abs((f.time % 5) - 5) < 1e-6) trace.push({ t: Math.round(f.time), excess: f.read().lungWaterExcess, spo2: 98 - 100 * f.satDrop });
    }
  };
  run(hold, pcwp, pap); const atHold = f.read(); run(after, L.pcwpRest, L.papRest);
  return { f, trace, atHold, drop: 100 * atHold.lungSatDrop };
}

describe("the lung compartment alone", () => {
  it("the resting lung stays where it is for hours", () => {
    const { f } = held(L.pcwpRest, L.papRest, 240);
    expect(Math.abs(f.read().lungWaterExcess)).toBeLessThan(1); expect(f.satDrop).toBeLessThan(1e-4);
  });
  it("PCWP 30 (PA 40) for 20 clinical minutes drops the saturation by 2-6 points; PCWP 10 by under 0.5", () => {
    const hi = held(30, 40, 20), lo = held(10, 15, 20);
    expect(hi.drop).toBeGreaterThan(2); expect(hi.drop).toBeLessThan(6);
    expect(lo.drop).toBeLessThan(0.5);
    expect(hi.atHold.lungWaterExcess).toBeGreaterThan(100); expect(lo.atHold.lungWaterExcess).toBeLessThan(30);
  });
  it("lymph flow rises several-fold but the water still accumulates (the safety factor is finite)", () => {
    const { atHold } = held(30, 40, 20);
    expect(atHold.lungLymph / L.lymphRest).toBeGreaterThan(2.5); expect(atHold.lungLymph / L.lymphRest).toBeLessThan(L.lymphMax);
    expect(atHold.lungFiltration).toBeGreaterThan(atHold.lungLymph);
  });
  it("the lung water clears over tens of clinical minutes when the pressure normalises", () => {
    const { trace, atHold } = held(30, 40, 20, 100), peak = atHold.lungWaterExcess;
    const at = (t: number) => trace.find((x) => x.t === t)!;
    expect(at(40).excess).toBeLessThan(0.7 * peak); expect(at(40).excess).toBeGreaterThan(0.3 * peak); // not at once
    expect(at(60).excess).toBeLessThan(0.4 * peak);
    expect(at(120).excess).toBeLessThan(0.1 * peak);
    expect(at(120).spo2).toBeGreaterThan(97.9);
  });
  it("total water including the lung is conserved to under 1 ml (also with fluid given and a hemorrhage)", () => {
    const { f } = held(30, 40, 60, 60);
    expect(Math.abs(f.balance())).toBeLessThan(1);
    const g = new FluidCompartments({ bloodMl: 4900, hb: 14, weightKg: 70 }); g.schedule("crystalloid", 1500, 0, 10); g.hemorrhage = 20;
    for (let t = 0; t < 60; t += 0.25) { g.setLungPressures(t < 30 ? 28 : 8, 33); g.setPressures(80, 8); g.advance(0.25); }
    expect(Math.abs(g.balance())).toBeLessThan(1); expect(g.read().lungWaterExcess).toBeGreaterThan(20);
  });
});

describe("in the core simulation", () => {
  const make = (spec: PatientSpec = {}) => { const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3, ...spec }, { settled: true }); s.warmup(40); return s; };
  const min = (s: Simulation, m: number) => s.step(m / s.minutesPerSecond / s.speed);
  it("the legacy engine has no lung water and no desaturation", () => { const s = new Simulation({ seed: 1 }); expect(s.fluids()).toBeNull(); expect(s.lungSatDrop()).toBe(0); });
  it("a normal patient stays dry: no lung water change, SpO2 unchanged", () => {
    const s = make(); min(s, 30);
    const f = s.fluids()!, sat = new LiveSource(s).saturations();
    expect(Math.abs(f.lungWaterExcess)).toBeLessThan(15); expect(sat.spo2).toBeGreaterThan(0.975);
  });
  it("an anterior STEMI (wedge about 20) gains a little lung water and loses under 2 points of saturation", () => {
    const s = make({ lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] }), src = new LiveSource(s);
    const s0 = src.saturations().spo2; min(s, 20);
    const f = s.fluids()!, n = src.numbers(), s1 = src.saturations().spo2;
    expect(n.pcwp).toBeGreaterThan(17); expect(n.pcwp).toBeLessThan(24);
    expect(f.lungWaterExcess).toBeGreaterThan(40); expect(f.lungWaterExcess).toBeLessThan(200);
    expect(100 * (s0 - s1)).toBeLessThan(2); expect(Math.abs(f.conservation)).toBeLessThan(1);
  }, 120_000);
  it("hypertensive acute pulmonary edema (preset): the lungs fill and the saturation falls over tens of minutes, in the panels and in the MCP oxygen tool", () => {
    const s = make(PRESET_BY_ID["flash-pulmonary-edema"]!.spec), src = new LiveSource(s);
    const s0 = src.saturations().spo2;
    min(s, 25);
    const n = src.numbers(), f = s.fluids()!, sat = src.saturations();
    expect(n.pcwp).toBeGreaterThan(24);
    expect(f.lungWaterExcess).toBeGreaterThan(120); expect(f.lungWaterIndex).toBeGreaterThan(L.evlwMlPerKg + 2);
    expect(100 * (s0 - sat.spo2)).toBeGreaterThan(2); expect(100 * (s0 - sat.spo2)).toBeLessThan(8);
    expect(s.circ.congestion).toBeGreaterThan(0.5); expect(Math.abs(f.conservation)).toBeLessThan(1);
    const o = oxygen(s) as { satPct?: { spo2: number | null } };
    expect(o.satPct!.spo2!).toBeLessThan(100 * s0 - 1.5); // the MCP tool reads the lowered pulmonary venous saturation too
  }, 180_000);
});
