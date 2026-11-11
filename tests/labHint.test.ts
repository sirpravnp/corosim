import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { OLD_PRESETS, sliderToPlaque } from "../src/lab/lesions";
import { nextHint, type Hint } from "../src/lab/hint";
import { branchChoice } from "../src/lab/wire";
import { byId } from "../src/config/labDevices";
import { LAB } from "../src/config/lab";
import type { Action, Guidewire, Plaque } from "../src/lab/types";

const access = { arch: "II" as const, iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };

const soft = (segId: string, ds: number, centerMm: number): Plaque => ({
  segId, centerMm, lengthMm: 16, ds, referenceMm: 3,
  eccentric: 0.15, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.4, thrombus: 0, remodel: "none", stents: [],
});

/** Map a pure hint onto the action the planner meant (devices named in `why`). */
const toAction = (h: Hint): Action | null => {
  const idMatch = h.why.match(/\(([a-zA-Z0-9.-]+)\)/);
  const id = idMatch?.[1];
  switch (h.kind) {
    case "none": return null;
    case "wait": return null;
    case "advance": return { t: "advance", mm: h.mm ?? 5 };
    case "withdraw": return { t: "advance", mm: -(h.mm ?? 5) };
    case "torque": return { t: "torque", deg: h.deg ?? 0 };
    case "shape": return { t: "shape", tipBendDeg: h.bendDeg ?? 60 };
    case "engage": return { t: "autoAdvance", to: h.target?.segId === "RCA" ? "RCA" : "LM" };
    case "inject": return { t: "inject", where: h.target?.segId === "RCA" ? "RCA" : "LCA", ml: h.mm ?? 6 };
    case "inflate": return { t: "inflate", atm: h.atm ?? 10, seconds: 3 };
    case "deflate": return { t: "deflate" };
    case "deploy": return { t: "deploy", atm: h.atm ?? 14, seconds: 3 };
    case "select": {
      if (!id) throw new Error(`select hint missing device id in why: ${h.why}`);
      if (id.startsWith("femoral") || id.startsWith("radial")) return { t: "access", site: id as Action extends { t: "access"; site: infer S } ? S : never };
      if (id.startsWith("sheath-")) return { t: "sheath", french: Number(id.slice(7)) as 5 | 6 | 7 };
      if (id === "heparin") return { t: "drug", id: "heparin", dose: 5000 };
      if (id.startsWith("target-")) return { t: "target", segId: id.slice(7) };
      const slot = id.startsWith("guide") ? "guide" : id.startsWith("wire") ? "wire" : id.startsWith("bal") ? "balloon" : "stent";
      return { t: "select", slot, id };
    }
    default: return null;
  }
};

describe("lab nextHint", () => {
  it("with no access, the hint is to gain access", () => {
    const sim = new Simulation({ seed: 1 });
    sim.warmup(10);
    const e = new LabEngine(sim, { seed: 2, access, plaques: [soft("LAD", 0.7, 50)] });
    const h = nextHint(e, { segId: "LAD", centerMm: 50 });
    expect(h.kind).toBe("select");
    expect(h.why.toLowerCase()).toMatch(/access/);
  });

  it("with the wire in the wrong branch, the hint is to withdraw to the bifurcation then rotate by the angle that selects the right branch", () => {
    const sim = new Simulation({ seed: 3, lesions: [{ artery: "OM1", stenosis: 0.7, position: 0.3 }] });
    sim.warmup(20);
    const e = new LabEngine(sim, { seed: 4, access, plaques: [soft("OM1", 0.7, 18)] });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "drug", id: "heparin", dose: 5000 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    e.apply({ t: "autoAdvance", to: "LM" });
    // Wire into the LAD first, then retarget OM1 so the tip sits in the wrong branch.
    e.apply({ t: "target", segId: "LAD" });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    for (let i = 0; i < 16; i++) e.apply({ t: "advance", mm: 4 });
    expect(e.state().wire!.tipSeg === "LAD" || e.state().wire!.route.includes("LAD")).toBe(true);
    e.apply({ t: "target", segId: "OM1" });

    const goal = { segId: "OM1", centerMm: 18 };
    const kinds: Hint["kind"][] = [];
    for (let i = 0; i < 40; i++) {
      const h = nextHint(e, goal);
      kinds.push(h.kind);
      const a = toAction(h);
      if (!a) break;
      e.apply(a);
      const tip = e.state().wire;
      if (tip && tip.tipSeg === goal.segId) break;
    }
    expect(kinds.some((k) => k === "withdraw")).toBe(true);
    expect(kinds.some((k) => k === "torque" || k === "shape")).toBe(true);
    expect(e.state().wire!.tipSeg).toBe("OM1");
  });

  it("following hints from a fresh patient crosses and stents each old preset lesion without a complication", () => {
    for (const preset of OLD_PRESETS) {
      if (preset.lesions.length === 0) continue; // normal coronaries: nothing to stent
      const lesion = sliderToPlaque(preset.lesions[0]!);
      const goal = { segId: lesion.segId, centerMm: lesion.centerMm };
      let passed = false;
      let lastBad: string[] = [];
      // Engine seed only affects complication rolls; try a few so a random perforation does not flake the suite.
      for (const seed of [15, 18, 22, 27, 33, 41, 48, 55, 62, 71, 88, 101]) {
        const sim = new Simulation({
          seed: 11,
          lesions: plaquesToSim(lesion),
          exertion: preset.exertion,
        });
        sim.warmup(12);
        const e = new LabEngine(sim, { seed, access, plaques: [{ ...lesion, stents: [] }] });
        const bad: string[] = [];
        let stented = false;
        for (let i = 0; i < 80; i++) {
          const h = nextHint(e, goal);
          const a = toAction(h);
          if (!a) break;
          for (const x of e.apply(a)) if (x.severity === "bad") bad.push(x.kind);
          if (bad.length) break;
          const p = e.plaques()[0];
          if (p && p.stents.length > 0 && p.ds < 0.4) { stented = true; break; }
        }
        lastBad = bad;
        if (!bad.length && stented && e.undoCount === 0) {
          passed = true;
          break;
        }
      }
      expect(passed, `${preset.id} bad=${lastBad.join(",")}`).toBe(true);
    }
  });

  it("hint never advances into a total occlusion without a crossing strategy", () => {
    const sim = new Simulation({ seed: 5, lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] });
    sim.warmup(15);
    const plaque = soft("LAD", 0.99, 25);
    plaque.cto = { ageMonths: 3, capHardness: 0.8, microchannels: false };
    const e = new LabEngine(sim, { seed: 6, access, plaques: [plaque] });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "drug", id: "heparin", dose: 5000 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    e.apply({ t: "autoAdvance", to: "LM" });
    e.apply({ t: "select", slot: "wire", id: "wire-floppy" });
    // Park just proximal to the occlusion.
    const tipSeg = e.state().wire!.tipSeg;
    for (let i = 0; i < 20; i++) {
      const tip = e.state().wire!;
      if (tip.tipSeg === "LAD" && tip.tipMm >= plaque.centerMm - plaque.lengthMm / 2 - 1) break;
      e.apply({ t: "advance", mm: 3 });
    }
    const h = nextHint(e, { segId: "LAD", centerMm: plaque.centerMm });
    expect(h.kind).not.toBe("advance");
    expect(h.kind === "select" || h.kind === "withdraw").toBe(true);
    expect(h.why.toLowerCase()).toMatch(/stiff|cto|occlusion|perforat|subintimal|crossing/);
    void tipSeg;
  });

  it("hint rotation matches what the wire model needs", () => {
    const sim = new Simulation({ seed: 7 });
    sim.warmup(10);
    const e = new LabEngine(sim, { seed: 8, access, plaques: [soft("OM1", 0.6, 15)] });
    e.apply({ t: "target", segId: "OM1" });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "drug", id: "heparin", dose: 5000 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    e.apply({ t: "autoAdvance", to: "LM" });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    // Walk until the tip is on LCX (parent of OM1) near the OM1 takeoff, without entering OM1.
    for (let i = 0; i < 30; i++) {
      const tip = e.state().wire!;
      if (tip.tipSeg === "LCX") break;
      // Prefer staying on the main path: no bend yet.
      e.apply({ t: "advance", mm: 3 });
    }
    // If we already entered OM1, withdraw to LCX.
    for (let i = 0; i < 10 && e.state().wire!.tipSeg === "OM1"; i++) e.apply({ t: "advance", mm: -3 });
    expect(e.state().wire!.tipSeg).toBe("LCX");

    const goal = { segId: "OM1", centerMm: 15 };
    let torque: Hint | null = null;
    for (let i = 0; i < 15; i++) {
      const h = nextHint(e, goal);
      if (h.kind === "shape") { e.apply(toAction(h)!); continue; }
      if (h.kind === "torque") { torque = h; break; }
      if (h.kind === "withdraw") { e.apply(toAction(h)!); continue; }
      break;
    }
    expect(torque).not.toBeNull();
    expect(typeof torque!.deg).toBe("number");

    const w = byId[e.state().wire!.id] as Guidewire;
    const g = e.graph();
    const parent = g.byId["LCX"]!;
    const child = g.byId["OM1"]!;
    const u = child.attach;
    const i = Math.min(parent.samples.length - 2, Math.max(0, Math.floor(u * (parent.samples.length - 1))));
    const v3 = (a: [number, number, number], b: [number, number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      return [dx / l, dy / l, dz / l] as const;
    };
    const pt = v3(parent.samples[i], parent.samples[i + 1]);
    const ct = v3(child.samples[0], child.samples[Math.min(2, child.samples.length - 1)]);
    const dot = Math.min(1, Math.max(-1, pt[0] * ct[0] + pt[1] * ct[1] + pt[2] * ct[2]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const bend = Math.max(e.state().wire!.bendDeg, LAB.branchBendChoiceDeg);
    const afterRot = e.state().wire!.rotDeg + (torque!.deg ?? 0);
    const choice = branchChoice(w, bend, afterRot, [{ id: "OM1", angleDeg, diameterMm: Math.min(...child.diameterMm) }], () => 0.5);
    expect(choice).toBe("OM1");
  });
});

function plaquesToSim(p: Plaque) {
  if (p.ds >= 0.99) return [{ artery: p.segId, occluded: true as const, position: 0.2 }];
  return [{ artery: p.segId, stenosis: p.ds, position: 0.5 }];
}
