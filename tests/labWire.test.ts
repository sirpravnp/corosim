import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { branchChoice, crossingResistance, advanceWire } from "../src/lab/wire";
import { byId } from "../src/config/labDevices";
import { wireModel } from "../src/sim/cath";
import type { Guidewire, Plaque } from "../src/lab/types";
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

const mkPlaque = (over: Partial<Plaque> & Pick<Plaque, "ds" | "calcium">): Plaque => ({
  segId: "LAD", centerMm: 55, lengthMm: 16, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, lipid: 0.3, thrombus: 0, remodel: "none", stents: [],
  ...over,
});

const readyForWire = (e: LabEngine, wire = "wire-floppy", root = 35) => {
  e.apply({ t: "access", site: "femoral-R" });
  e.apply({ t: "sheath", french: 6 });
  e.apply({ t: "drug", id: "heparin", dose: 5000 });
  e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
  for (let i = 0; i < 50; i++) e.apply({ t: "advance", mm: 80 });
  e.apply({ t: "select", slot: "wire", id: wire });
  return e;
};

describe("wire mechanics", () => {
  it("crosses a soft 70 % lesion with a floppy wire", () => {
    const e = engine(35, 21);
    readyForWire(e);
    const ev: string[] = [];
    for (let i = 0; i < 30; i++) {
      e.apply({ t: "advance", mm: 8 }).forEach((x) => ev.push(x.kind));
    }
    expect(ev).not.toContain("prolapse");
    expect(e.state().wire!.tipSeg).toBe("LAD");
    expect(e.state().wire!.tipMm).toBeGreaterThan(48);
  });

  it("prolapses on a 95 % calcified lesion with the same floppy wire", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(30);
    const hard = mkPlaque({ ds: 0.95, calcium: 0.9 });
    const e = new LabEngine(sim, {
      seed: 21, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [hard],
    });
    readyForWire(e);
    for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
    const kinds = e.apply({ t: "advance", mm: 5 }).map((x) => x.kind);
    expect(kinds).toContain("prolapse");
  });

  it("crosses a 95 % lesion with a stiff CTO wire", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(30);
    const hard = mkPlaque({ ds: 0.95, calcium: 0.85 });
    const e = new LabEngine(sim, {
      seed: 33, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [hard],
    });
    readyForWire(e, "wire-stiff-cto");
    for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
    e.apply({ t: "advance", mm: 12 });
    expect(e.state().wire!.tipMm).toBeGreaterThan(54);
  });

  it("guide support lets a floppy wire cross when a JL guide prolapses", () => {
    const hard = mkPlaque({ ds: 0.92, calcium: 0.8 });
    const prolapse = () => {
      const sim = new Simulation({ seed: 7 });
      sim.warmup(30);
      const e = new LabEngine(sim, {
        seed: 5, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [hard],
      });
      readyForWire(e, "wire-floppy");
      for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
      return e.apply({ t: "advance", mm: 5 }).some((x) => x.kind === "prolapse");
    };
    const crossEbu = () => {
      const sim = new Simulation({ seed: 7 });
      sim.warmup(30);
      const e = new LabEngine(sim, {
        seed: 5, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [hard],
      });
      e.apply({ t: "access", site: "femoral-R" });
      e.apply({ t: "sheath", french: 6 });
      e.apply({ t: "drug", id: "heparin", dose: 5000 });
      e.apply({ t: "select", slot: "guide", id: "guide-ebu35" });
      for (let i = 0; i < 50; i++) e.apply({ t: "advance", mm: 80 });
      e.apply({ t: "select", slot: "wire", id: "wire-floppy" });
      for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
      e.apply({ t: "advance", mm: 8 });
      return e.state().wire!.tipMm;
    };
    expect(prolapse()).toBe(true);
    expect(crossEbu()).toBeGreaterThan(52);
  });

  it("branch selection at D1", () => {
    const branches = [{ id: "D1", angleDeg: 18, diameterMm: 2.2 }, { id: "LAD-dist", angleDeg: 0, diameterMm: 3.1 }];
    const w = byId["wire-workhorse"] as Guidewire;
    let d1 = 0;
    for (let s = 0; s < 200; s++) {
      if (branchChoice(w, 0, 0, branches, () => (s * 0.17) % 1) === "D1") d1++;
    }
    expect(d1).toBeLessThanOrEqual(25);
    let d1bent = 0;
    for (let s = 0; s < 200; s++) {
      if (branchChoice(w, 45, 18, [{ id: "D1", angleDeg: 18, diameterMm: 2.2 }], () => (s * 0.13) % 1) === "D1") d1bent++;
    }
    expect(d1bent).toBeGreaterThanOrEqual(170);
    let mismatch = 0;
    for (let s = 0; s < 200; s++) {
      if (branchChoice(w, 45, 80, [{ id: "D1", angleDeg: 18, diameterMm: 2.2 }], () => (s * 0.11) % 1) === "D1") mismatch++;
    }
    expect(mismatch).toBeLessThanOrEqual(50);
  });

  it("CTO wire events and microchannel crossing", () => {
    const cto = mkPlaque({ ds: 0.99, calcium: 0.6, thrombus: 0.3, cto: { ageMonths: 6, capHardness: 0.85, microchannels: false } });
    let subOrPerf = 0;
    for (let seed = 0; seed < 50; seed++) {
      const sim = new Simulation({ seed: 7 });
      sim.warmup(20);
      const e = new LabEngine(sim, {
        seed, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [cto],
      });
      readyForWire(e, "wire-stiff-cto");
      for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
      const ev = e.apply({ t: "advance", mm: 20 });
      if (ev.some((x) => x.kind === "subintimal" || x.kind === "perforation")) subOrPerf++;
      expect(e.state().wire!.tipMm).toBeGreaterThan(0);
    }
    expect(subOrPerf).toBeGreaterThanOrEqual(10);
    const softCto = mkPlaque({ ds: 0.99, calcium: 0.3, cto: { ageMonths: 3, capHardness: 0.4, microchannels: true } });
    let crossed = 0;
    for (let seed = 0; seed < 50; seed++) {
      const sim = new Simulation({ seed: 7 });
      sim.warmup(20);
      const e = new LabEngine(sim, {
        seed, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [softCto],
      });
      readyForWire(e, "wire-floppy");
      for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
      e.apply({ t: "advance", mm: 15 });
      if (e.state().wire!.tipMm >= 50) crossed++;
    }
    expect(crossed).toBeGreaterThanOrEqual(30);
    expect(crossingResistance(byId["wire-stiff-cto"] as Guidewire, softCto, 12)).toBeLessThan(
      crossingResistance(byId["wire-floppy"] as Guidewire, cto, 1),
    );
  });

  it("pressure wire reading matches wireModel", () => {
    const sim = new Simulation({ seed: 7, lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.45 }] });
    sim.warmup(40);
    const e = new LabEngine(sim, {
      seed: 9, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false },
      plaques: [mkPlaque({ ds: 0.75, calcium: 0.1 })],
    });
    readyForWire(e, "wire-pressure");
    for (let i = 0; i < 12; i++) e.apply({ t: "advance", mm: 6 });
    const wm = wireModel(sim, "LAD").at({ mm: e.state().wire!.tipMm });
    expect(e.wirePdPa()!).toBeCloseTo(wm.hyperRatio, 9);
  });
});
