import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { applyToSim, contrastEffect, guideTrace, wireReading } from "../src/lab/coupling";
import { wireModel, timi } from "../src/sim/cath";
import type { Plaque } from "../src/lab/types";

const plaque: Plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none", stents: [],
};

describe("lab coupling", () => {
  it("raises FFR after PCI on the live overlay", () => {
    const sim = new Simulation({ seed: 7, lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.45 }] });
    sim.warmup(50);
    applyToSim(sim, [plaque], { occlusions: [], bedResistance: {} });
    const before = wireModel(sim, "LAD").ffr!;
    expect(before).toBeLessThanOrEqual(0.75);
    const e = new LabEngine(sim, {
      seed: 4, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque],
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 6 });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 10, seconds: 4 });
    e.apply({ t: "deflate" });
    e.apply({ t: "select", slot: "stent", id: "stent-des-3.00-24" });
    e.apply({ t: "deploy", atm: 14, seconds: 4 });
    expect(e.plaques()[0].ds).toBeLessThanOrEqual(0.15);
    const wm = wireModel(sim, "LAD");
    const after = wm.ffr ?? wm.distalRatio ?? 1;
    expect(after).toBeGreaterThanOrEqual(0.9);
  });

  it("dampens the guide trace with poor engagement and critical ostial stenosis", () => {
    const pa = [120, 80, 100, 70, 110, 75];
    const good = guideTrace(pa, { quality: 1, engaged: "LM", ostialDs: 0.2 });
    const poor = guideTrace(pa, { quality: 0.4, engaged: "LM", ostialDs: 0.2 });
    const crit = guideTrace(pa, { quality: 0.8, engaged: "LM", ostialDs: 0.9 });
    const amp = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(amp(poor)).toBeLessThanOrEqual(amp(good) * 0.85);
    expect(Math.min(...crit)).toBeLessThan(Math.min(...good) * 0.8);
  });

  it("flags contrast nephropathy risk from volume and eGFR", () => {
    expect(contrastEffect(180, 40).nephropathyRisk).toBeGreaterThan(0.5);
    expect(contrastEffect(60, 90).nephropathyRisk).toBeLessThan(0.1);
  });

  it("wire reading matches wireModel", () => {
    const sim = new Simulation({ seed: 7, lesions: [{ artery: "LAD", stenosis: 0.6, position: 0.5 }] });
    sim.warmup(40);
    applyToSim(sim, [plaque], { occlusions: [], bedResistance: {} });
    const r = wireReading(sim, "LAD", 40);
    const w = wireModel(sim, "LAD").at({ mm: 40 });
    expect(r.ratioHyper).toBeCloseTo(w.hyperRatio, 9);
  });

  it("reset releases the live overlay", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(30);
    const e = new LabEngine(sim, {
      seed: 1, access: { arch: "II", iliacTortuosity: 0, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque],
    });
    e.apply({ t: "access", site: "femoral-R" });
    expect(sim.liveOn()).toBe(true);
    e.reset();
    expect(sim.liveOn()).toBe(false);
  });
});
