import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import type { Plaque } from "../src/lab/types";

const soft = (segId: string, ds: number, centerMm: number): Plaque => ({
  segId, centerMm, lengthMm: 16, ds, referenceMm: 3,
  eccentric: 0.15, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.4, thrombus: 0, remodel: "none", stents: [],
});

const access = { arch: "II" as const, iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };

const bedIschemia = (sim: Simulation, artery: string) =>
  sim.analysis.cond.terminals
    .filter((t) => t.segId === artery || t.key.startsWith(artery))
    .reduce((s, t) => s + (sim.sev[t.key] ?? t.severity) * t.mass, 0);

const engageLeft = (e: LabEngine) => {
  e.apply({ t: "access", site: "femoral-R" });
  e.apply({ t: "sheath", french: 6 });
  e.apply({ t: "drug", id: "heparin", dose: 5000 });
  e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
  for (let i = 0; i < 55; i++) e.apply({ t: "advance", mm: 80 });
};

const engageRight = (e: LabEngine) => {
  e.apply({ t: "access", site: "femoral-R" });
  e.apply({ t: "sheath", french: 6 });
  e.apply({ t: "drug", id: "heparin", dose: 5000 });
  e.apply({ t: "select", slot: "guide", id: "guide-jr4" });
  for (let i = 0; i < 55; i++) e.apply({ t: "advance", mm: 80 });
};

const crossAndStent = (e: LabEngine, goalMm: number, wire = "wire-workhorse") => {
  e.apply({ t: "select", slot: "wire", id: wire });
  const plaque = e.plaques()[0];
  for (let i = 0; i < 40; i++) {
    const tip = e.state().wire!;
    if (tip.tipSeg === plaque.segId && tip.tipMm >= goalMm - 1) break;
    e.apply({ t: "advance", mm: 5 });
  }
  e.apply({ t: "select", slot: "balloon", id: "bal-semi-2.50-12" });
  e.apply({ t: "inflate", atm: 10, seconds: 3 });
  e.apply({ t: "deflate" });
  e.apply({ t: "select", slot: "stent", id: "stent-des-3.00-24" });
  e.apply({ t: "deploy", atm: 14, seconds: 3 });
};

describe("treat any vessel", () => {
  it("wire routes to the RCA when the guide engaged the RCA", () => {
    const sim = new Simulation({ seed: 3, lesions: [{ artery: "RCA", stenosis: 0.8, position: 0.4 }] });
    sim.warmup(25);
    const e = new LabEngine(sim, { seed: 5, access, plaques: [soft("RCA", 0.8, 40)] });
    engageRight(e);
    expect(e.state().guide?.engaged).toBe("RCA");
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    const route = e.state().wire!.route;
    expect(route[route.length - 1] === "RCA" || route.includes("RCA")).toBe(true);
    expect(route.includes("LAD")).toBe(false);
  });

  it("wire routes to an OM branch via LCx", () => {
    const sim = new Simulation({ seed: 3, lesions: [{ artery: "OM1", stenosis: 0.7, position: 0.3 }] });
    sim.warmup(25);
    const e = new LabEngine(sim, { seed: 6, access, plaques: [soft("OM1", 0.7, 20)] });
    e.apply({ t: "target", segId: "OM1" });
    engageLeft(e);
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    const route = e.state().wire!.route;
    expect(route).toContain("LM");
    expect(route).toContain("LCX");
    expect(route).toContain("OM1");
  });

  it("stent in the RCA changes RCA territory ischemia only", () => {
    const sim = new Simulation({
      seed: 2,
      lesions: [
        { artery: "RCA", stenosis: 0.9, position: 0.35 },
        { artery: "LAD", stenosis: 0.6, position: 0.4 },
      ],
    });
    sim.warmup(40);
    const e = new LabEngine(sim, {
      seed: 7, access,
      plaques: [soft("RCA", 0.9, 40), soft("LAD", 0.6, 50)],
    });
    e.apply({ t: "target", segId: "RCA" });
    engageRight(e);
    const lad0 = bedIschemia(sim, "LAD");
    const rca0 = bedIschemia(sim, "RCA");
    expect(rca0).toBeGreaterThan(0.05);
    crossAndStent(e, 40);
    // Settle ischemia after the RCA lesion is treated.
    for (let i = 0; i < 40; i++) sim.step(0.5);
    const lad1 = bedIschemia(sim, "LAD");
    const rca1 = bedIschemia(sim, "RCA");
    expect(e.plaques().find((p) => p.segId === "RCA")!.ds).toBeLessThan(0.3);
    expect(rca1).toBeLessThan(rca0);
    expect(Math.abs(lad1 - lad0)).toBeLessThan(0.08);
  });

  it("a target the engaged guide cannot reach is refused with an event", () => {
    const sim = new Simulation({ seed: 3, lesions: [{ artery: "RCA", stenosis: 0.7, position: 0.3 }] });
    sim.warmup(20);
    const e = new LabEngine(sim, { seed: 8, access, plaques: [soft("RCA", 0.7, 35)] });
    engageRight(e);
    expect(e.state().guide?.engaged).toBe("RCA");
    const ev = e.apply({ t: "target", segId: "LAD" });
    expect(ev.some((x) => x.severity === "caution")).toBe(true);
    expect(e.state().targetSeg).not.toBe("LAD");
  });

  it.each([
    { artery: "LAD", guide: "guide-jl4", engage: engageLeft, centerMm: 50 },
    { artery: "RCA", guide: "guide-jr4", engage: engageRight, centerMm: 40 },
    { artery: "LCX", guide: "guide-jl4", engage: engageLeft, centerMm: 25 },
    { artery: "LM", guide: "guide-ebu35", engage: engageLeft, centerMm: 8 },
  ] as const)("crosses and stents a $artery lesion end to end", ({ artery, engage, centerMm }) => {
    const sim = new Simulation({ seed: 4, lesions: [{ artery, stenosis: 0.75, position: 0.4 }] });
    sim.warmup(25);
    const e = new LabEngine(sim, { seed: 9, access, plaques: [soft(artery, 0.75, centerMm)] });
    e.apply({ t: "target", segId: artery });
    engage(e);
    crossAndStent(e, centerMm);
    expect(e.plaques()[0].ds).toBeLessThan(0.4);
    expect(e.plaques()[0].stents.length).toBeGreaterThanOrEqual(1);
    expect(e.state().wire!.route).toContain(artery === "LM" ? "LM" : artery);
  });
});
