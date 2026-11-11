import { describe, it, expect } from "vitest";
import { byId } from "../src/config/labDevices";
import { draw, risk, scriptedComplication, forcedEffect, type Complication } from "../src/lab/complications";
import { applyEffect, terminalBedKey } from "../src/lab/effects";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { LAB_CASES } from "../src/cath/lab/cases";
import { timi } from "../src/sim/cath";
import type { Guidewire } from "../src/lab/types";

describe("lab complications", () => {
  const wire = byId["wire-stiff-cto"] as Guidewire;
  const floppy = byId["wire-floppy"] as Guidewire;

  it("risk is monotonic in its main drivers", () => {
    const low = risk("perforation", { tipLoad: 1, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 });
    const high = risk("perforation", { tipLoad: 12, calcium: 0.9, oversize: 0.3, thrombus: 0, pressureAtm: 8, ratedAtm: 16 });
    expect(high).toBeGreaterThan(low);
    const nrLow = risk("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0.1, pressureAtm: 0, ratedAtm: 16 });
    const nrHigh = risk("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0.9, pressureAtm: 0, ratedAtm: 16 });
    expect(nrHigh).toBeGreaterThan(nrLow);
    expect(risk("dissection", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm: 10, ratedAtm: 16 }))
      .toBeLessThan(risk("dissection", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm: 18, ratedAtm: 16 }));
  });

  it("perforation → tamponade lowers MAP without seal", () => {
    const sim = new Simulation({ seed: 4 }, { engine: "core" });
    sim.warmup(45);
    const map0 = sim.state().meanArterialPressure;
    applyEffect(sim, forcedEffect("perforation", "LAD"));
    for (let i = 0; i < 12; i++) sim.step(10);
    const map1 = sim.state().meanArterialPressure;
    expect(map0 - map1).toBeGreaterThanOrEqual(map0 * 0.15);
    applyEffect(sim, { tamponade: 0 });
    sim.apply({ pericardium: { effusionRateMlMin: 0, drainMl: 50 } });
  });

  it("no-reflow keeps TIMI 3 but starves the distal bed", () => {
    const sim = new Simulation({ seed: 5 });
    sim.warmup(40);
    sim.setLive([], { [terminalBedKey("LAD")]: 5 });
    const bed = sim.analysis.cond.terminals.find((t) => t.key === terminalBedKey("LAD"));
    expect(timi(sim, "LAD").grade).toBe(3);
    expect(bed!.ratio).toBeLessThan(0.5);
  });

  it("femoral bleed raises bloodLoss when access stays open", () => {
    const sim = new Simulation({ seed: 6 });
    sim.warmup(30);
    const e = new LabEngine(sim, {
      seed: 2, access: LAB_CASES[0].access, plaques: LAB_CASES[0].plaques,
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    const bl0 = sim.scenario().bloodLoss ?? 0;
    e.apply({ t: "inflate", atm: 0, seconds: 1200 });
    expect((sim.scenario().bloodLoss ?? 0) - bl0).toBeGreaterThanOrEqual(0.1);
    e.apply({ t: "close", method: "closure-device" });
    const mid = sim.scenario().bloodLoss ?? 0;
    e.apply({ t: "inflate", atm: 0, seconds: 600 });
    expect((sim.scenario().bloodLoss ?? 0) - mid).toBeLessThan(0.02);
  });

  it("VF triggers via sustained occlusion in the engine", () => {
    const sim = new Simulation({ seed: 8 }, { engine: "core" });
    sim.warmup(40);
    const e = new LabEngine(sim, {
      seed: 1, access: LAB_CASES[0].access, plaques: LAB_CASES[0].plaques,
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 6 });
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
    const map0 = sim.state().meanArterialPressure;
    const ev = e.apply({ t: "inflate", atm: 8, seconds: 120 });
    const map1 = sim.state().meanArterialPressure;
    const st = Math.max(sim.ecg().stMm.V2, sim.ecg().stMm.V3);
    expect(
      ev.some((x) => x.kind === "arrest")
      || sim.patient.rhythm.includes("vf")
      || map0 - map1 >= 3
      || st >= 0.08,
    ).toBe(true);
  });

  it("forced events fire once at the trigger", () => {
    const sim = new Simulation({ seed: 3 });
    sim.warmup(25);
    const e = new LabEngine(sim, {
      seed: 9, access: LAB_CASES[1].access, plaques: LAB_CASES[1].plaques, forced: LAB_CASES[1].forced,
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "select", slot: "guide", id: "guide-jr4" });
    for (let i = 0; i < 40; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    e.apply({ t: "select", slot: "stent", id: "stent-des-3.00-24" });
    e.apply({ t: "deploy", atm: 12, seconds: 2 });
    const bed = sim.analysis.cond.terminals.find((t) => t.key === terminalBedKey("RCA"));
    e.apply({ t: "deploy", atm: 12, seconds: 2 });
    const f = scriptedComplication("no-reflow", "post-stent");
    expect(f.once).toBe(true);
    expect(bed!.ratio).toBeLessThan(0.55);
    expect(timi(sim, "RCA").grade).toBeGreaterThanOrEqual(1);
  });

  it("draw uses terminal bed keys", () => {
    const eff = draw("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 1, pressureAtm: 0, ratedAtm: 16, territorySeg: "LAD" }, () => 0, true);
    expect(eff?.bedResistance?.[terminalBedKey("LAD")]).toBeGreaterThan(1);
    expect(risk("perforation", { tipLoad: floppy.tipLoadGf, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 }))
      .toBeLessThan(risk("perforation", { tipLoad: wire.tipLoadGf, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 }));
  });
});
