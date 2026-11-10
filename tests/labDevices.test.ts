import { describe, it, expect } from "vitest";
import { CATALOG, byId, balloonDiameter } from "../src/config/labDevices";
import type { Balloon, Guidewire, Stent } from "../src/lab/types";

describe("device catalog", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every catalog entry by id", () => {
    for (const d of CATALOG) expect(byId[d.id]).toBe(d);
  });

  it("grows balloon diameter with pressure and hits nominal at nominalAtm", () => {
    const balloons = CATALOG.filter((d): d is Balloon => d.kind === "balloon");
    for (const b of balloons) {
      expect(balloonDiameter(b, b.nominalAtm)).toBeCloseTo(b.nominalMm, 9);
      const lo = balloonDiameter(b, b.nominalAtm - 2);
      const hi = balloonDiameter(b, b.nominalAtm + 4);
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it("keeps stents within length and diameter bounds", () => {
    const stents = CATALOG.filter((d): d is Stent => d.kind === "stent");
    for (const s of stents) {
      expect(s.lengthMm).toBeLessThanOrEqual(38);
      expect(s.nominalMm).toBeGreaterThanOrEqual(2.25);
    }
  });

  it("orders CTO wire tip load above floppy", () => {
    const floppy = byId["wire-floppy"] as Guidewire;
    const cto = byId["wire-stiff-cto"] as Guidewire;
    expect(cto.tipLoadGf).toBeGreaterThan(floppy.tipLoadGf);
  });
});

import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { plaqueToLesions } from "../src/lab/plaque";
import { inflateBalloon, deployStentAt, planSizing } from "../src/lab/balloonStent";
import { wireModel } from "../src/sim/cath";
import type { Plaque } from "../src/lab/types";

const pciPlaque: Plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none", stents: [],
};

const pciEngine = () => {
  const sim = new Simulation({ seed: 7, lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.45 }] });
  sim.warmup(50);
  const e = new LabEngine(sim, {
    seed: 4, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [pciPlaque],
  });
  e.apply({ t: "access", site: "femoral-R" });
  e.apply({ t: "sheath", french: 6 });
  e.apply({ t: "drug", id: "heparin", dose: 5000 });
  e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
  for (let i = 0; i < 50; i++) e.apply({ t: "advance", mm: 80 });
  e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
  for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 6 });
  return e;
};

describe("balloon and stent mechanics", () => {
  it("sizes stents from reference and lesion length", () => {
    const s = planSizing(3, 18);
    expect(s.stentMm).toBeCloseTo(3.15, 1);
    expect(s.lengthMm).toBeGreaterThanOrEqual(18);
  });

  it("balloon then stent clears a soft LAD lesion on the overlay", () => {
    const e = pciEngine();
    const before = plaqueToLesions(e.plaques()[0])[0]?.ds ?? 0.75;
    expect(before).toBeGreaterThanOrEqual(0.7);
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 10, seconds: 5 });
    e.apply({ t: "deflate" });
    e.apply({ t: "select", slot: "stent", id: "stent-des-3.00-24" });
    e.apply({ t: "deploy", atm: 14, seconds: 5 });
    expect(e.plaques()[0].ds).toBeLessThanOrEqual(0.15);
  });

  it("occludes flow while inflated", () => {
    const st = { access: "femoral-R" as const, sheathFr: 6, sheath: null, act: 250, guide: { id: "g", engaged: "LM" as const, quality: 0.9, tipSeg: "LAD", tipMm: 50 }, wire: null, balloon: { id: "bal-semi-2.50-12", segId: "LAD", centerMm: 50, inflatedAtm: 0 }, stent: null, targetSeg: null, carm: { rot: 0, tilt: 0 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [] };
    const b = byId["bal-semi-2.50-12"] as import("../src/lab/types").Balloon;
    const up = inflateBalloon(st, b, 10, 2, [pciPlaque], 55, "LAD", () => 0.2);
    expect(up.occludesFlow).toBe(true);
    const down = inflateBalloon({ ...st, balloon: { ...st.balloon!, inflatedAtm: 10 } }, b, 0, 0, up.plaques, 55, "LAD", () => 0.2);
    expect(down.occludesFlow).toBe(false);
  });

  it("ruptures when over-pressure", () => {
    const st = { access: "femoral-R" as const, sheathFr: 6, sheath: null, act: 250, guide: null, wire: null, balloon: { id: "bal-semi-2.50-12", segId: "LAD", centerMm: 50, inflatedAtm: 0 }, stent: null, targetSeg: null, carm: { rot: 0, tilt: 0 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [] };
    const b = byId["bal-semi-2.50-12"] as import("../src/lab/types").Balloon;
    const r = inflateBalloon(st, b, 20, 1, [pciPlaque], 55, "LAD", () => 0.5);
    expect(r.events.some((x) => x.kind === "balloon-rupture")).toBe(true);
  });

  it("flags oversized and under-sized stents", () => {
    const st = { access: "femoral-R" as const, sheathFr: 6, sheath: null, act: 250, guide: null, wire: null, balloon: null, stent: { id: "s", segId: "LAD", centerMm: 55, deployed: false }, targetSeg: null, carm: { rot: 0, tilt: 0 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [] };
    const sim = new Simulation({ seed: 7 });
    sim.warmup(20);
    const e = new LabEngine(sim, { seed: 1, access: { arch: "II", iliacTortuosity: 0, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [{ ...pciPlaque, referenceMm: 2.5 }] });
    const big = deployStentAt(st, byId["stent-des-4.00-24"] as import("../src/lab/types").Stent, 14, 1, e.plaques() as Plaque[], e.graph(), 55, "LAD", () => 0.1);
    expect(big.events.some((x) => x.kind === "oversized")).toBe(true);
    const small = deployStentAt(st, byId["stent-des-2.25-12"] as import("../src/lab/types").Stent, 14, 1, [{ ...pciPlaque, referenceMm: 3.5 }], e.graph(), 55, "LAD", () => 0.1);
    expect(small.events.some((x) => x.kind === "malapposed")).toBe(true);
  });

  it("jails a branch when the stent covers a bifurcation", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(20);
    const e = new LabEngine(sim, { seed: 1, access: { arch: "II", iliacTortuosity: 0, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [pciPlaque] });
    const d1Attach = e.graph().byId.D1.attach * e.graph().byId.LAD.length;
    const st = { access: "femoral-R" as const, sheathFr: 6, sheath: null, act: 250, guide: null, wire: null, balloon: null, stent: { id: "s", segId: "LAD", centerMm: d1Attach, deployed: false }, targetSeg: null, carm: { rot: 0, tilt: 0 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [] };
    const r = deployStentAt(st, byId["stent-des-3.00-24"] as import("../src/lab/types").Stent, 14, 1, [pciPlaque], e.graph(), d1Attach, "LAD", () => 0.2);
    expect(r.jailed.some((j) => j.branchSeg === "D1" && j.ostialDs >= 0.3)).toBe(true);
    const distal = deployStentAt(st, byId["stent-des-3.00-12"] as import("../src/lab/types").Stent, 14, 1, [pciPlaque], e.graph(), d1Attach + 25, "LAD", () => 0.2);
    expect(distal.jailed.length).toBe(0);
  });

  it("cannot advance while the balloon is inflated", () => {
    const e = pciEngine();
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 8, seconds: 3 });
    const ev = e.apply({ t: "advance", mm: 5 });
    expect(ev.some((x) => x.severity === "bad")).toBe(true);
    const tipBefore = e.state().wire!.tipMm;
    e.apply({ t: "advance", mm: 5 });
    expect(e.state().wire!.tipMm).toBe(tipBefore);
  });
});
