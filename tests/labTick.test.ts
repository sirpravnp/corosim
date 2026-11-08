import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { draw } from "../src/lab/complications";
import { baseRiskContext } from "../src/lab/effects";

const plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none" as const, stents: [],
};
const make = () => {
  const sim = new Simulation({ seed: 7 }); sim.warmup(30);
  return { sim, e: new LabEngine(sim, { seed: 2, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [plaque] }) };
};

describe("the lab runs in real time", () => {
  it("lets time pass only once there is access, and counts it", () => {
    const { e } = make();
    expect(e.tick(1)).toEqual([]); expect(e.state().elapsedS).toBe(0); // on the table, nothing has started
    e.apply({ t: "access", site: "femoral-R" });
    const t0 = e.state().elapsedS;
    for (let i = 0; i < 20; i++) e.tick(0.05);
    expect(e.state().elapsedS).toBeCloseTo(t0 + 1, 3);
  });

  it("an open perforation fills the pericardium second by second until it is sealed", () => {
    const { e } = make();
    e.apply({ t: "access", site: "femoral-R" });
    const priv = e as unknown as { applyComplicationResult(eff: unknown, out: unknown[], label: string): void };
    const out: unknown[] = [];
    priv.applyComplicationResult(draw("perforation", baseRiskContext({ calcium: 0.5, tipLoad: 3, territorySeg: "LAD" }), () => 0, true), out, "perforation");
    expect(out.length).toBe(1);
    const e0 = e.effusionMl();
    expect(e0).toBeGreaterThan(5);
    for (let i = 0; i < 100; i++) e.tick(0.1); // ten seconds
    expect(e.effusionMl()).toBeGreaterThan(e0 + 15);
    e.apply({ t: "drug", id: "protamine", dose: 50 });
    const sealed = e.effusionMl();
    for (let i = 0; i < 50; i++) e.tick(0.1);
    expect(e.effusionMl()).toBeCloseTo(sealed, 3); // protamine seals it: no more blood
  });

  it("the perforation event says where it happened, so the picture can leak dye there", () => {
    const { e } = make();
    e.apply({ t: "access", site: "femoral-R" });
    const priv = e as unknown as { applyComplicationResult(eff: unknown, out: { kind: string; data?: { segId?: string } }[], label: string): void };
    const out: { kind: string; data?: { segId?: string } }[] = [];
    priv.applyComplicationResult(draw("perforation", baseRiskContext({ territorySeg: "LAD" }), () => 0, true), out, "perforation");
    expect(out[0].kind).toBe("perforation"); expect(typeof out[0].data?.segId).toBe("string");
  });
});

import { monitorModel } from "../src/cath/lab/panels";

describe("VF and death come from the main model", () => {
  it("sustained occlusion fires VF once, and the arrest machine (not the lab) runs it: pressure collapses, a shock converts", () => {
    const { sim, e } = make();
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 6 });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    e.apply({ t: "inflate", atm: 8, seconds: 5 });
    let arrests = 0;
    for (let i = 0; i < 700 && sim.arrestState().status !== "arrest"; i++) arrests += e.tick(0.1).filter((x) => x.kind === "arrest").length;
    expect(sim.arrestState().status).toBe("arrest"); // the simulation's own arrest machine, not a lab flag
    expect(sim.rhythmClass().rhythmClass).toBe("vf");
    for (let i = 0; i < 100; i++) arrests += e.tick(0.1).filter((x) => x.kind === "arrest").length; // ten more seconds of ticking
    expect(arrests).toBe(1); // it does not fire again every frame
    expect(sim.map).toBeLessThan(40);
    const r = sim.shock({ joules: 200 });
    expect(r.discharged).toBe(true);
    for (let i = 0; i < 100; i++) arrests += e.tick(0.1).filter((x) => x.kind === "arrest").length;
    expect(arrests).toBe(1); // and not straight after a shock either
  }, 170000);

  it("the monitor names the rhythm and marks an arrest", () => {
    const tiles = monitorModel({ hr: 0, map: 18, sbp: 19, dbp: 18, ffr: null, rhythm: "VF", arrest: true }, { access: "femoral-R", act: 300 } as never);
    expect(tiles[0]).toMatchObject({ id: "rhythm", value: "VF", tone: "bad" });
    expect(tiles.find((t) => t.id === "map")!.tone).toBe("bad");
    expect(monitorModel({ hr: 80, map: 90, sbp: 120, dbp: 70, ffr: null }, { access: null, act: 0 } as never).some((t) => t.id === "rhythm")).toBe(false);
  });
});
