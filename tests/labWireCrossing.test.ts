import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { nextHint } from "../src/lab/hint";
import type { Plaque } from "../src/lab/types";

const access = { arch: "II" as const, iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };
const soft = (segId: string, ds: number, centerMm: number, extra: Partial<Plaque> = {}): Plaque => ({
  segId, centerMm, lengthMm: 16, ds, referenceMm: 3,
  eccentric: 0.15, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.4, thrombus: 0, remodel: "none", stents: [], ...extra,
});
const sim = new Simulation({ seed: 1 });
/** A guide engaged in the target's coronary and a wire loaded, on a fresh engine. */
const wired = (plaques: Plaque[], seed = 7, wire = "wire-workhorse") => {
  const e = new LabEngine(sim, { seed, access, plaques });
  const root = /^(RCA|PDA_R|PLV_R)/.test(plaques[0]?.segId ?? "LAD") ? "RCA" : "LM";
  e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "sheath", french: 6 }); e.apply({ t: "drug", id: "heparin", dose: 6000 });
  if (plaques[0]) e.apply({ t: "target", segId: plaques[0].segId });
  e.apply({ t: "select", slot: "guide", id: root === "RCA" ? "guide-jr4" : "guide-jl4" });
  e.apply({ t: "autoAdvance", to: root });
  e.apply({ t: "select", slot: "wire", id: wire });
  return e;
};
const pastLesion = (e: LabEngine, p: Plaque) => { const w = e.state().wire!; return w.tipSeg === p.segId && w.tipMm > p.centerMm + p.lengthMm / 2; };

describe("wire crossing", () => {
  it("a workhorse wire crosses a 75 percent lesion with small steady presses, without prolapse", () => {
    const p = soft("LAD", 0.75, 60), e = wired([p]);
    let prolapses = 0;
    for (let i = 0; i < 80 && !pastLesion(e, p); i++) prolapses += e.apply({ t: "advance", mm: 3 }).filter((x) => x.kind === "prolapse").length;
    expect(pastLesion(e, p)).toBe(true);
    expect(prolapses).toBe(0);
  });

  it("the wire stops at the lesion edge rather than jumping across it on a long press", () => {
    const p = soft("LAD", 0.99, 60, { calcium: 0.9, cto: { ageMonths: 6, capHardness: 1, microchannels: false } }), e = wired([p]);
    for (let i = 0; i < 40 && e.state().wire!.tipSeg !== "LAD"; i++) e.apply({ t: "advance", mm: 4 });
    e.apply({ t: "advance", mm: 80 });
    const w = e.state().wire!;
    expect(w.tipSeg).toBe("LAD");
    expect(w.tipMm).toBeLessThanOrEqual(p.centerMm - p.lengthMm / 2 + 0.5);
  });

  it("steady pressure crosses a fresh occlusion with a workhorse wire within a few presses at the cap", () => {
    const p = soft("LAD", 1, 60, { thrombus: 0.6 }), e = wired([p]);
    let presses = 0;
    for (let i = 0; i < 80 && !pastLesion(e, p); i++) { e.apply({ t: "advance", mm: 3 }); presses++; }
    expect(pastLesion(e, p)).toBe(true);
    expect(presses).toBeLessThan(60);
  });

  it("a hard shove of a soft wire into a hard cap can prolapse it, and the tip lands back on a real vessel", () => {
    let seen = 0;
    for (let seed = 1; seed <= 12 && !seen; seed++) {
      const p = soft("LAD", 0.99, 60, { calcium: 0.9, cto: { ageMonths: 6, capHardness: 1, microchannels: false } }), e = wired([p], seed);
      for (let i = 0; i < 40 && !(e.state().wire!.tipSeg === "LAD" && e.state().wire!.tipMm >= 51); i++) e.apply({ t: "advance", mm: 3 });
      const ev = e.apply({ t: "advance", mm: 12 });
      if (ev.some((x) => x.kind === "prolapse")) {
        seen++;
        const w = e.state().wire!, seg = e.graph().byId[w.tipSeg];
        expect(seg).toBeTruthy();
        expect(w.tipMm).toBeGreaterThanOrEqual(0);
        expect(w.tipMm).toBeLessThanOrEqual(seg.length);
      }
    }
    expect(seen).toBe(1); // some seed in twelve buckles the wire
  });
});

describe("wire perforation", () => {
  it("open vessel carries no perforation risk: a wire run down a normal LAD never perforates", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const e = wired([], seed);
      e.apply({ t: "target", segId: "LAD" });
      for (let i = 0; i < 30; i++) expect(e.apply({ t: "advance", mm: 3 }).some((x) => x.kind === "perforation")).toBe(false);
    }
  });

  it("crossing a soft 75 percent lesion with a workhorse wire perforates rarely", () => {
    let perforated = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const p = soft("LAD", 0.75, 60), e = wired([p], seed);
      for (let i = 0; i < 80 && !pastLesion(e, p); i++) if (e.apply({ t: "advance", mm: 3 }).some((x) => x.kind === "perforation")) perforated++;
    }
    expect(perforated / N).toBeLessThan(0.08);
  });
});

describe("engine bookkeeping", () => {
  it("turning the C-arm is not logged, so undo takes back the last real step", () => {
    const e = wired([soft("LAD", 0.75, 60)]);
    const n = e.state().log.length;
    e.apply({ t: "carm", rot: -30, tilt: 20 });
    expect(e.state().log.length).toBe(n);
    expect(e.state().carm).toEqual({ rot: -30, tilt: 20 });
    e.undo();
    expect(e.state().wire).toBeNull();
  });

  it("resuscitation works before access", () => {
    const e = new LabEngine(sim, { seed: 3, access, plaques: [] });
    expect(e.apply({ t: "fluid", ml: 250 }).some((x) => x.kind === "no-access")).toBe(false);
    expect(e.apply({ t: "restart" }).some((x) => x.kind === "no-access")).toBe(false);
  });

  it("the hint retargets to a second lesion and exchanges the guide for the other coronary", () => {
    const lad = soft("LAD", 0.75, 60), rca = soft("RCA", 0.8, 40);
    const e = wired([lad, rca]);
    expect(e.state().guide!.engaged).toBe("LM");
    const goal = { segId: "RCA", centerMm: 40 };
    const seen: string[] = [];
    for (let i = 0; i < 200 && !e.state().stent?.deployed; i++) {
      const h = nextHint(e, goal);
      if (!h.action) break;
      seen.push(h.action.t === "select" ? `select:${h.action.id}` : h.action.t);
      e.apply(h.action);
    }
    expect(seen).toContain("select:guide-jr4");
    expect(seen).toContain("target");
    expect(e.state().targetSeg).toBe("RCA");
    expect(e.state().stent?.deployed).toBe(true);
    expect(e.state().stent?.segId).toBe("RCA");
  });
});
