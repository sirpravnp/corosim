import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";

/** Seed 1, core engine, healthy adult: 60 s reflex settling then hemodynamics at about 40 s (5 s rolling mean). */
function pressureAt40(rhythm: string) {
  const sim = new Simulation({}, { engine: "core" });
  sim.reset({ seed: 1, patient: { rhythm } }, { settled: true });
  sim.warmup(60);
  sim.history = [];
  sim.run(40);
  const r = sim.rolling(5);
  return { map: r.map, pp: r.sbp - r.dbp, co: r.cardiacOutput, hr: r.hr };
}

describe("library VT and torsades pressure (core engine, seed 1, ~40 s)", () => {
  it("torsades: very low pulse pressure or MAP, clearly worse than monomorphic VT", () => {
    const td = pressureAt40("torsades");
    const mono = pressureAt40("vt-mono");
    expect(td.map < 60 || td.pp < 15, `torsades map ${td.map.toFixed(1)} pp ${td.pp.toFixed(1)}`).toBe(true);
    expect(td.map, "torsades MAP below monomorphic VT").toBeLessThan(mono.map - 5);
  });

  it("polymorphic VT: low output without an immediate crash; MAP not forced to 0 in the first 5 s", () => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ seed: 1, patient: { rhythm: "vt-poly" } }, { settled: true });
    sim.warmup(60);
    sim.history = [];
    sim.run(5);
    expect(sim.rolling(5).map).toBeGreaterThan(0);
    const poly = pressureAt40("vt-poly");
    expect(poly.co).toBeLessThan(3.5);
    expect(poly.map).toBeLessThan(75);
  });

  it("monomorphic VT on a healthy heart stays pulsatile with MAP above 70", () => {
    const mono = pressureAt40("vt-mono");
    expect(mono.map).toBeGreaterThan(70);
    expect(mono.pp).toBeGreaterThan(10);
  });
});
