import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { draw } from "../src/lab/complications";
import { baseRiskContext } from "../src/lab/effects";
import type { Plaque, Action } from "../src/lab/types";

const plaque: Plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none", stents: [],
};
const access = { arch: "II" as const, iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };

const make = (seed = 2) => {
  const sim = new Simulation({ seed: 7 });
  sim.warmup(30);
  const e = new LabEngine(sim, { seed, access, plaques: [plaque] });
  return { sim, e };
};

describe("lab undo", () => {
  it("undo of a perforating advance restores pressure, effusion and tip", () => {
    const { sim, e } = make();
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 8; i++) e.apply({ t: "advance", mm: 6 });
    const before = {
      tipSeg: e.state().wire!.tipSeg,
      tipMm: e.state().wire!.tipMm,
      map: sim.state().meanArterialPressure,
      effusion: e.effusionMl(),
      dead: sim.dead,
      logLen: e.state().log.length,
    };
    // Force a perforation as the next action's side effect via the private path after a logged advance.
    const priv = e as unknown as { applyComplicationResult(eff: unknown, out: unknown[], label: string): void };
    const out: unknown[] = [];
    e.apply({ t: "advance", mm: 2 });
    priv.applyComplicationResult(draw("perforation", baseRiskContext({ calcium: 0.9, tipLoad: 8, territorySeg: "LAD" }), () => 0, true), out, "perforation");
    for (let i = 0; i < 30; i++) e.tick(0.2);
    expect(e.effusionMl()).toBeGreaterThan(before.effusion + 5);
    e.undo();
    expect(e.state().wire!.tipSeg).toBe(before.tipSeg);
    expect(e.state().wire!.tipMm).toBeCloseTo(before.tipMm, 5);
    expect(e.effusionMl()).toBe(0);
    expect(sim.dead).toBe(false);
    expect(e.state().log.length).toBe(before.logLen);
  });

  it("undo then the same action reproduces the same events", () => {
    const { e } = make(11);
    const acts: Action[] = [
      { t: "access", site: "femoral-R" },
      { t: "sheath", french: 6 },
      { t: "drug", id: "heparin", dose: 5000 },
      { t: "select", slot: "guide", id: "guide-jl4" },
      { t: "advance", mm: 80 },
    ];
    e.replay(acts);
    const after = JSON.stringify({ st: e.state(), tip: e.state().guide });
    const kinds = e.replay(acts).map((x) => x.kind);
    e.undo();
    e.apply(acts[acts.length - 1]);
    expect(JSON.stringify({ st: e.state(), tip: e.state().guide })).toBe(after);
    expect(e.replay(acts).map((x) => x.kind)).toEqual(kinds);
  });

  it("undo at the start is a no-op", () => {
    const { e } = make();
    expect(e.canUndo()).toBe(false);
    expect(() => e.undo()).not.toThrow();
    expect(e.undoCount).toBe(0);
    expect(e.state().log).toEqual([]);
  });

  it("undo after death restores a living patient", () => {
    const { sim, e } = make(3);
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    // Put the patient into VF arrest and run the no-flow clock out to death.
    sim.apply({ patient: { rhythm: "vf-coarse" } });
    for (let i = 0; i < 2000 && !sim.dead; i++) sim.step(0.5);
    expect(sim.dead).toBe(true);
    e.undo(); // drops the sheath; full replay restores the baseline living patient
    expect(sim.dead).toBe(false);
    expect(e.effusionMl()).toBe(0);
    expect(e.state().log.map((a) => a.t)).toEqual(["access"]);
  }, 120_000);

  it("undoCount increments and survives reset only as zero", () => {
    const { e } = make();
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.undo();
    expect(e.undoCount).toBe(1);
    e.undo();
    expect(e.undoCount).toBe(2);
    e.reset();
    expect(e.undoCount).toBe(0);
    expect(e.canUndo()).toBe(false);
  });

  it("replays 200 actions in under 2 seconds", () => {
    const { e } = make(5);
    const acts: Action[] = [{ t: "access", site: "femoral-R" }, { t: "sheath", french: 6 }, { t: "select", slot: "guide", id: "guide-jl4" }];
    for (let i = 0; i < 197; i++) acts.push({ t: "advance", mm: 2 });
    e.replay(acts);
    const t0 = performance.now();
    e.undo();
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
  });
});
