import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { wireModel } from "../src/sim/cath";
import { INFARCT } from "../src/config/management";

const warm = () => {
  const sim = new Simulation({ seed: 7 });
  sim.warmup(60);
  return sim;
};

describe("lab live lesions on Simulation", () => {
  it("live lesions override and release", () => {
    const sim = warm();
    sim.setLive([{ segId: "LAD", pos: 0.5, ds: 1, occluded: true }]);
    expect(wireModel(sim, "LAD").occluded).toBe(true);
    sim.setLive(null);
    expect(wireModel(sim, "LAD").occluded).toBe(false);
  });

  it("scenario is not mutated", () => {
    const sim = warm();
    const before = JSON.stringify(sim.scenario().lesions ?? []);
    sim.setLive([{ segId: "LAD", pos: 0.5, ds: 1, occluded: true }]);
    expect(JSON.stringify(sim.scenario().lesions ?? [])).toBe(before);
    sim.setLive(null);
  });

  it("60 s balloon occlusion of the mid-LAD is visible", () => {
    const sim = warm();
    sim.setRealtime(true);
    const map0 = sim.state().meanArterialPressure;
    const ef0 = sim.state().ventricle.ejectionFraction;
    sim.setLive([{ segId: "LAD", pos: 0.5, ds: 1, occluded: true }]);
    sim.step(60);
    const ecg = sim.ecg();
    const anterior = Math.max(ecg.stMm.V2, ecg.stMm.V3, ecg.stMm.V4);
    expect(anterior).toBeGreaterThanOrEqual(0.1);
    const map1 = sim.state().meanArterialPressure;
    const ef1 = sim.state().ventricle.ejectionFraction;
    expect(map0 - map1 >= 5 || ef0 - ef1 >= 0.03).toBe(true);
  });

  it("released balloon recovers", () => {
    const sim = warm();
    sim.setRealtime(true);
    sim.setLive([{ segId: "LAD", pos: 0.5, ds: 1, occluded: true }]);
    sim.step(60);
    const peak = Math.max(sim.ecg().stMm.V2, sim.ecg().stMm.V3, sim.ecg().stMm.V4);
    sim.setLive(null);
    sim.step(60);
    const after = Math.max(sim.ecg().stMm.V2, sim.ecg().stMm.V3, sim.ecg().stMm.V4);
    expect(after).toBeLessThan(peak / 2);
  });

  it("real-time mode slows the clinical clock", () => {
    const sim = warm();
    expect(sim.minutesPerSecond).toBe(INFARCT.minutesPerSecond);
    sim.setRealtime(true);
    expect(sim.minutesPerSecond).toBeCloseTo(1 / 60, 9);
    sim.setRealtime(false);
    expect(sim.minutesPerSecond).toBe(INFARCT.minutesPerSecond);
  });
});
