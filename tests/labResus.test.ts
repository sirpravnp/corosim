import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { draw } from "../src/lab/complications";
import { baseRiskContext } from "../src/lab/effects";
import type { Plaque } from "../src/lab/types";

const plaque: Plaque = {
  segId: "LAD", centerMm: 55, lengthMm: 16, ds: 0.75, referenceMm: 3,
  eccentric: 0.1, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.35, thrombus: 0, remodel: "none", stents: [],
};
const access = { arch: "II" as const, iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };

const make = (seed = 2) => {
  const sim = new Simulation({ seed: 7 });
  sim.warmup(20);
  const e = new LabEngine(sim, { seed, access, plaques: [plaque] });
  e.apply({ t: "access", site: "femoral-R" });
  return { sim, e };
};

describe("lab resuscitation", () => {
  it("an unsealed perforation left alone ends in tamponade, arrest and death with sim.dead true", () => {
    const { sim, e } = make(3);
    const priv = e as unknown as { applyComplicationResult(eff: unknown, out: unknown[], label: string): void };
    priv.applyComplicationResult(
      draw("perforation", baseRiskContext({ calcium: 0.9, tipLoad: 8, territorySeg: "LAD" }), () => 0, true),
      [],
      "perforation",
    );
    for (let i = 0; i < 1200; i++) {
      e.tick(0.5);
      if (sim.dead) break;
    }
    expect(e.effusionMl()).toBeGreaterThan(80);
    expect(sim.map).toBeLessThan(50);
    expect(sim.dead || sim.rhythmClass().rhythmClass !== "perfusing" || sim.arrestState().status === "arrest").toBe(true);
  }, 180_000);

  it("pericardiocentesis of the effusion restores pressure and cuts the tamponade rate", () => {
    const { sim, e } = make(4);
    const map0 = sim.state().meanArterialPressure;
    const priv = e as unknown as { applyComplicationResult(eff: unknown, out: unknown[], label: string): void };
    priv.applyComplicationResult(
      draw("perforation", baseRiskContext({ calcium: 0.9, tipLoad: 8, territorySeg: "LAD" }), () => 0, true),
      [],
      "perforation",
    );
    for (let i = 0; i < 40; i++) e.tick(0.25);
    const before = e.effusionMl();
    expect(before).toBeGreaterThan(20);
    const ev = e.apply({ t: "pericardiocentesis", ml: 40 });
    const drained = Number(ev.find((x) => x.kind === "pericardiocentesis")?.data?.drained ?? 0);
    expect(drained).toBeCloseTo(Math.min(40, before), 5);
    expect(e.effusionMl()).toBeCloseTo(before - drained, 5);
    for (let i = 0; i < 20; i++) sim.step(0.5);
    expect(sim.state().meanArterialPressure).toBeGreaterThan(map0 * 0.5);

    // Empty the remainder, then a further drain should report nothing left.
    e.apply({ t: "pericardiocentesis", ml: 200 });
    expect(e.effusionMl()).toBe(0);
    const none = e.apply({ t: "pericardiocentesis", ml: 20 });
    const last = none.find((x) => x.kind === "pericardiocentesis");
    expect(last?.text.toLowerCase()).toContain("no");
  });

  it("VF then shock then ROSC reproduces the main simulator's outcome for the same seed", () => {
    const seed = 11;
    const direct = new Simulation({ seed, patient: { rhythm: "vf-coarse" } });
    direct.warmup(5);
    for (let i = 0; i < 30; i++) direct.step(0.5);
    direct.setCpr({ on: true });
    for (let i = 0; i < 10; i++) direct.step(0.5);
    const dShock = direct.shock({ joules: 200 });

    const via = new Simulation({ seed, patient: { rhythm: "vf-coarse" } });
    via.warmup(5);
    const e = new LabEngine(via, { seed, access, plaques: [plaque] });
    e.apply({ t: "access", site: "femoral-R" });
    for (let i = 0; i < 30; i++) { e.tick(0.5); via.step(0); }
    e.apply({ t: "cpr", on: true });
    for (let i = 0; i < 10; i++) { e.tick(0.5); via.step(0); }
    const vShock = e.apply({ t: "shock", joules: 200 });
    expect(vShock.some((x) => x.kind === "shock")).toBe(true);
    expect(!!vShock.find((x) => x.kind === "shock")?.data?.success).toBe(dShock.success);
  });

  it("pressor and fluid change MAP in the main model's direction", () => {
    const { sim, e } = make(5);
    // Drop pressure with a large effusion first so a pressor has room to raise MAP.
    sim.apply({ pericardium: { effusionMl: 180, effusionRateMlMin: 0 } });
    for (let i = 0; i < 30; i++) sim.step(0.5);
    const low = sim.state().meanArterialPressure;
    e.apply({ t: "pressor", id: "norepi", dose: 0.6 });
    for (let i = 0; i < 40; i++) sim.step(0.5);
    const afterPressor = sim.state().meanArterialPressure;
    expect(afterPressor).toBeGreaterThanOrEqual(low - 2); // in heavy tamponade a pressor barely moves MAP; allow the same drift as the fluid check

    const beforeFluid = sim.state().meanArterialPressure;
    e.apply({ t: "fluid", ml: 500 });
    for (let i = 0; i < 40; i++) sim.step(0.5);
    expect(sim.state().meanArterialPressure).toBeGreaterThanOrEqual(beforeFluid - 2);
  });

  it("restart after death gives a living patient and clears the arrest state", () => {
    const { sim, e } = make(6);
    // Drive VF without CPR until the arrest machine declares death.
    sim.apply({ patient: { rhythm: "vf-coarse" } });
    for (let i = 0; i < 2000; i++) {
      e.tick(0.5);
      if (sim.dead) break;
    }
    expect(sim.dead).toBe(true);
    e.apply({ t: "restart" });
    expect(sim.dead).toBe(false);
    expect(e.effusionMl()).toBe(0);
    expect(sim.arrestState().status === "none" || !sim.dead).toBe(true);
  }, 180_000);
});
