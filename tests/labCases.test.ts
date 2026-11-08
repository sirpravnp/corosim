import { describe, it, expect } from "vitest";
import { LAB_CASES } from "../src/cath/lab/cases";
import { CATALOG, byId } from "../src/config/labDevices";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { buildTree } from "../src/anatomy/tree";

describe("lab cases", () => {
  it("every case loads into Simulation and LabEngine", () => {
    for (const c of LAB_CASES) {
      const sim = new Simulation({ seed: 3 });
      sim.reset(c.scenario);
      sim.warmup(20);
      const e = new LabEngine(sim, { seed: 1, access: c.access, plaques: c.plaques });
      expect(e.plaques().length).toBe(c.plaques.length);
    }
  });

  it("recommended devices exist in the catalog", () => {
    for (const c of LAB_CASES) {
      for (const id of [c.recommended.guide, c.recommended.wire, c.recommended.balloon, c.recommended.stent].filter(Boolean) as string[]) {
        expect(byId[id]).toBeDefined();
        expect(CATALOG.some((d) => d.id === id)).toBe(true);
      }
    }
  });

  it("plaque segIds exist in the tree", () => {
    const tree = buildTree();
    for (const c of LAB_CASES) {
      for (const p of c.plaques) expect(tree.byId[p.segId]).toBeDefined();
    }
  });

  it("forced events are well-formed", () => {
    for (const c of LAB_CASES) {
      for (const f of c.forced ?? []) {
        expect(f.once).toBe(true);
        expect(f.trigger.length).toBeGreaterThan(0);
      }
    }
  });
});
