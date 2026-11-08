import { describe, it, expect } from "vitest";
import { LAB_CASES } from "../src/cath/lab/cases";
import { scoreProcedure } from "../src/lab/score";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";

describe("lab score", () => {
  const run = (acts: Parameters<LabEngine["apply"]>[0][]) => {
    const c = LAB_CASES[0];
    const sim = new Simulation({ seed: 5 });
    sim.reset(c.scenario);
    sim.warmup(30);
    const e = new LabEngine(sim, { seed: 2, access: c.access, plaques: c.plaques });
    for (const a of acts) e.apply(a);
    return scoreProcedure(e, c);
  };

  it("scores a basic PCI run", () => {
    const s = run([
      { t: "access", site: "femoral-R" },
      { t: "sheath", french: 6 },
      { t: "drug", id: "heparin", dose: 5000 },
      { t: "select", slot: "guide", id: "guide-jl4" },
    ]);
    expect(s.total).toBeGreaterThanOrEqual(20);
    expect(s.debrief.every((l) => !/[\u{1F300}-\u{1FAFF}]/u.test(l))).toBe(true);
  });

  it("penalizes skipping heparin", () => {
    const withHep = run([{ t: "access", site: "femoral-R" }, { t: "drug", id: "heparin", dose: 5000 }]);
    const noHep = run([{ t: "access", site: "femoral-R" }]);
    expect(withHep.total - noHep.total).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic for the same log", () => {
    const acts = [{ t: "access", site: "femoral-R" }, { t: "sheath", french: 6 }] as const;
    const a = run([...acts]);
    const b = run([...acts]);
    expect(b.total).toBe(a.total);
  });
});
