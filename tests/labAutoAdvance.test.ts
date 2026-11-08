import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { routeArcTo } from "../src/lab/geometry";
import { routeTo } from "../src/lab/route";

describe("autoAdvance", () => {
  const mk = (arch: "I" | "II" | "III", calc = false) => {
    const sim = new Simulation({ seed: 3 });
    sim.warmup(15);
    return new LabEngine(sim, {
      seed: 11,
      access: { arch, iliacTortuosity: calc ? 0.9 : 0.1, radialLoop: false, aorticRootMm: 35, calcifiedIliac: calc },
      plaques: [],
    });
  };

  it("reaches LM ostium on easy anatomy in one action", () => {
    const e = mk("I");
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    const kinds = e.apply({ t: "autoAdvance", to: "LM" }).map((x) => x.kind);
    expect(kinds).not.toContain("bad");
    expect(e.state().guide?.engaged).toBe("LM");
    expect(e.state().log.filter((a) => a.t === "autoAdvance")).toHaveLength(1);
  });

  it("emits resistance on arch III with calcified iliac", () => {
    const e = mk("III", true);
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    const kinds = e.apply({ t: "autoAdvance", to: "ostium" }).map((x) => x.kind);
    expect(kinds).toContain("resistance");
  });

  it("guide tip arc increases monotonically when advancing", () => {
    const e = mk("II");
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    const g = e.graph();
    const route = routeTo(g, "femoral-R", "LM");
  let arc = 0;
    for (let i = 0; i < 8; i++) {
      e.apply({ t: "advance", mm: 15 });
      const st = e.state().guide!;
      const next = routeArcTo(g, route, st.tipSeg, st.tipMm);
      expect(next).toBeGreaterThanOrEqual(arc - 1e-6);
      arc = next;
    }
  });
});
