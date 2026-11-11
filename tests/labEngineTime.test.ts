import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";

const plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none" as const, stents: [],
};

describe("lab engine timing", () => {
  it("60 s mid-LAD inflation moves ST and pressure then recovers", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(60);
    const map0 = sim.state().meanArterialPressure;
    const ef0 = sim.state().ventricle.ejectionFraction;
    const e = new LabEngine(sim, {
      seed: 2, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque],
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 6 });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 8, seconds: 60 });
    const anterior = Math.max(sim.ecg().stMm.V2, sim.ecg().stMm.V3, sim.ecg().stMm.V4);
    expect(anterior).toBeGreaterThanOrEqual(0.08);
    expect(map0 - sim.state().meanArterialPressure >= 4 || ef0 - sim.state().ventricle.ejectionFraction >= 0.02).toBe(true);
    e.apply({ t: "deflate" });
    sim.step(60);
    const after = Math.max(sim.ecg().stMm.V2, sim.ecg().stMm.V3, sim.ecg().stMm.V4);
    expect(after).toBeLessThan(anterior / 2);
  });

  it("ACT decays with elapsed inflate time not wire travel", () => {
    const sim = new Simulation({ seed: 5 });
    sim.warmup(30);
    const e = new LabEngine(sim, {
      seed: 1, access: { arch: "II", iliacTortuosity: 0, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque],
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "drug", id: "heparin", dose: 5000 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    const act0 = e.state().act;
    e.apply({ t: "inflate", atm: 0, seconds: 120 });
    expect(act0 - e.state().act).toBeGreaterThan(5);
  });
});
