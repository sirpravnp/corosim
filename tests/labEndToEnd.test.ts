import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { LAB_CASES } from "../src/cath/lab/cases";
import { scoreProcedure } from "../src/lab/score";
import { wireModel, timi } from "../src/sim/cath";
import type { Action } from "../src/lab/types";

const ladPciActions: Action[] = [
  { t: "access", site: "femoral-R" },
  { t: "sheath", french: 6 },
  { t: "drug", id: "heparin", dose: 5000 },
  { t: "select", slot: "guide", id: "guide-jl4" },
  { t: "advance", mm: 2000 },
  { t: "select", slot: "wire", id: "wire-workhorse" },
  { t: "advance", mm: 60 },
  { t: "select", slot: "balloon", id: "bal-semi-2.50-12" },
  { t: "inflate", atm: 10, seconds: 5 },
  { t: "deflate" },
  { t: "select", slot: "stent", id: "stent-des-3.00-24" },
  { t: "deploy", atm: 14, seconds: 5 },
  { t: "select", slot: "balloon", id: "bal-nc-3.25-12" },
  { t: "inflate", atm: 16, seconds: 4 },
  { t: "deflate" },
];

describe("lab end-to-end", () => {
  it("full LAD PCI improves physiology and scores well", () => {
    const c = LAB_CASES[0];
    const sim = new Simulation({ seed: 8, lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.45 }] });
    sim.warmup(50);
    const before = wireModel(sim, "LAD").ffr ?? 0.6;
    expect(before).toBeLessThanOrEqual(0.75);
    const e = new LabEngine(sim, { seed: 4, access: c.access, plaques: c.plaques });
    e.replay(ladPciActions);
    const after = wireModel(sim, "LAD").distalRatio ?? wireModel(sim, "LAD").ffr ?? 1;
    expect(after).toBeGreaterThanOrEqual(0.85);
    expect(timi(sim, "LAD").grade).toBeGreaterThanOrEqual(2);
    expect(e.plaques()[0].ds).toBeLessThanOrEqual(0.15);
    expect(scoreProcedure(e, c).total).toBeGreaterThanOrEqual(50);
  });

  it("replay matches on the same seed", () => {
    const c = LAB_CASES[0];
    const simA = new Simulation({ seed: 1 });
    simA.reset(c.scenario);
    simA.warmup(30);
    const a = new LabEngine(simA, { seed: 7, access: c.access, plaques: c.plaques });
    const evA = a.replay(ladPciActions.slice(0, 6));
    const simB = new Simulation({ seed: 1 });
    simB.reset(c.scenario);
    simB.warmup(30);
    const b = new LabEngine(simB, { seed: 7, access: c.access, plaques: c.plaques });
    const evB = b.replay(ladPciActions.slice(0, 6));
    expect(b.state()).toEqual(a.state());
    expect(evB.map((x) => x.kind)).toEqual(evA.map((x) => x.kind));
  });

  it("reset mid-procedure restores the scenario overlay", () => {
    const sim = new Simulation({ seed: 3, lesions: [{ artery: "LAD", stenosis: 0.5, position: 0.5 }] });
    sim.warmup(20);
    const snap = JSON.stringify(sim.scenario().lesions);
    const e = new LabEngine(sim, { seed: 1, access: LAB_CASES[0].access, plaques: LAB_CASES[0].plaques });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 8, seconds: 2 });
    e.reset();
    expect(JSON.stringify(sim.scenario().lesions)).toBe(snap);
    expect(sim.liveOn()).toBe(false);
  });
});
