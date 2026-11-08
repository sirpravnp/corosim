import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import type { Plaque } from "../src/lab/types";
import type { Action } from "../src/lab/types";

const plaque: Plaque = {
  segId: "LAD", centerMm: 50, lengthMm: 18, ds: 0.75, referenceMm: 3,
  eccentric: 0.2, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.3, thrombus: 0,
  remodel: "none", stents: [],
};

const engine = (root = 35, seed = 11) => {
  const sim = new Simulation({ seed: 7 });
  sim.warmup(30);
  return new LabEngine(sim, { seed, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: root, calcifiedIliac: false }, plaques: [plaque] });
};

const advanceGuide = (e: LabEngine, mm = 80) => {
  for (let i = 0; i < 60; i++) e.apply({ t: "advance", mm });
  return e;
};

describe("LabEngine core", () => {
  it("rejects a device before access", () => {
    const e = engine();
    const ev = e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    expect(ev.some((x) => x.severity === "bad")).toBe(true);
    expect(e.state().guide).toBeNull();
  });

  it("femoral access then guide engages the LM", () => {
    const e = engine(35);
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    advanceGuide(e);
    expect(e.state().guide?.engaged).toBe("LM");
    expect(e.state().guide!.quality).toBeGreaterThanOrEqual(0.7);
  });

  it("scores guide curve against aortic root size", () => {
    const big = engine(45);
    big.apply({ t: "access", site: "femoral-R" });
    big.apply({ t: "sheath", french: 6 });
    big.apply({ t: "select", slot: "guide", id: "guide-jl35" });
    advanceGuide(big);
    const q35 = big.state().guide!.quality;
    const jl4 = engine(45);
    jl4.apply({ t: "access", site: "femoral-R" });
    jl4.apply({ t: "sheath", french: 6 });
    jl4.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    advanceGuide(jl4);
    expect(jl4.state().guide!.quality - q35).toBeGreaterThanOrEqual(0.15);
    const jr = engine(35);
    jr.apply({ t: "access", site: "femoral-R" });
    jr.apply({ t: "sheath", french: 6 });
    jr.apply({ t: "select", slot: "guide", id: "guide-jr4" });
    advanceGuide(jr);
    expect(jr.state().guide?.engaged).not.toBe("LM");
  });

  it("heparin raises ACT and a low ACT warns on wire work", () => {
    const e = engine();
    e.apply({ t: "access", site: "femoral-R" });
    expect(e.state().act).toBe(0);
    e.apply({ t: "drug", id: "heparin", dose: 5000 });
    expect(e.state().act).toBeGreaterThanOrEqual(250);
    const low = engine();
    low.apply({ t: "access", site: "femoral-R" });
    low.apply({ t: "sheath", french: 6 });
    low.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    advanceGuide(low);
    low.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    const ev = low.apply({ t: "advance", mm: 5 });
    expect(ev.some((x) => x.severity === "caution" && /thrombus/i.test(x.text))).toBe(true);
  });

  it("replay is exact for the same seed", () => {
    const acts: Action[] = [
      { t: "access", site: "femoral-R" },
      { t: "sheath", french: 6 },
      { t: "select", slot: "guide", id: "guide-jl4" },
      { t: "advance", mm: 100 },
    ];
    const a = engine();
    const evA = a.replay(acts);
    const b = engine();
    const evB = b.replay(acts);
    expect(b.state()).toEqual(a.state());
    expect(evB.map((x) => ({ ...x, at: 0 }))).toEqual(evA.map((x) => ({ ...x, at: 0 })));
  });

  it("reset restores scenario lesions and empties the log", () => {
    const sim = new Simulation({ seed: 7, lesions: [{ artery: "LAD", stenosis: 0.5, position: 0.5 }] });
    sim.warmup(20);
    const before = JSON.stringify(sim.scenario().lesions);
    const e = new LabEngine(sim, { seed: 3, access: { arch: "II", iliacTortuosity: 0, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque] });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    advanceGuide(e);
    e.reset();
    expect(e.state().log).toEqual([]);
    expect(JSON.stringify(sim.scenario().lesions)).toBe(before);
    expect(sim.liveOn()).toBe(false);
  });
});
