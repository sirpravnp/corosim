import { describe, it, expect } from "vitest";
import { buildTree, diameterAt, restFlowAt, TYPICAL, Variant } from "../src/anatomy/tree";
import { HEART, FLOW } from "../src/config/tree";
import { solveNetwork, analyze } from "../src/physics/network";
import { finetParent, taperIsMonotonic, murrayError } from "../src/physics/geometry";

const { a: A, b: B, c: C } = HEART.radii;
const VARIANTS: [string, Variant][] = [
  ["right-dominant", TYPICAL],
  ["co-dominant", { ...TYPICAL, dominance: "co" }],
  ["left-dominant", { ...TYPICAL, dominance: "left" }],
  ["trifurcation (ramus)", { ...TYPICAL, lm: "trifurcation" }],
  ["absent left main", { ...TYPICAL, lm: "absent" }],
  ["separate conus ostium", { ...TYPICAL, conusOstium: "separate" }],
  ["SA node from LCx", { ...TYPICAL, saNodeFrom: "LCx" }],
  ["short LAD", { ...TYPICAL, ladCourse: "short" }],
  ["wrap-around LAD", { ...TYPICAL, ladCourse: "wrap" }],
];
const mm = (m: number) => m * 1e3;

describe.each(VARIANTS)("tree: %s", (_name, v) => {
  const t = buildTree(v);
  it("conserves myocardial mass (sums to 1)", () => expect(t.totalMass).toBeCloseTo(1, 6));
  it("conserves flow at every branch point and node", () => {
    for (const s of t.segments) {
      const Qin = restFlowAt(t, s, 0);
      const out = (s.endMass + s.taps.reduce((a, x) => a + x.mass, 0) + s.children.reduce((a, c) => a + t.byId[c].subMass, 0)) * FLOW.totalRestingFlow;
      expect(Qin).toBeCloseTo(out, 12);
    }
  });
  it("never widens along a vessel", () => {
    for (const s of t.segments) {
      const d = Array.from({ length: 50 }, (_, i) => diameterAt(t, s, (i / 49) * s.length));
      expect(taperIsMonotonic(d)).toBe(true);
    }
  });
  it("lays every non-ostial vessel on the epicardial surface", () => {
    for (const s of t.segments) {
      if (s.id === "LM") continue; // runs from the aortic root to the surface
      const pts = s.heartSamples.slice(Math.floor(s.heartSamples.length * (s.parent ? 0.05 : 0.25))); // root vessels start at the aortic ostium
      for (const p of pts) {
        const r = Math.hypot(p[0] / A, p[1] / B, p[2] / C);
        expect(r).toBeGreaterThan(0.93);
        expect(r).toBeLessThan(1.1);
      }
    }
  });
  it("has plausible caliber for the main arteries (mm)", () => {
    for (const id of ["LAD", "LCX", "RCA"]) {
      const d = mm(diameterAt(t, t.byId[id], 0));
      expect(d).toBeGreaterThan(1.8);
      expect(d).toBeLessThan(5);
    }
  });
});

describe("variant structure", () => {
  const ids = (v: Variant) => buildTree(v).segments.map((s) => s.id);
  it("right-dominant: PDA and PLV come from the RCA", () => {
    const t = buildTree(TYPICAL);
    expect(t.byId.PDA_R.parent).toBe("RCA"); expect(t.byId.PLV_R.parent).toBe("RCA");
    expect(ids(TYPICAL)).not.toContain("PDA_L");
  });
  it("left-dominant: PDA and PLV come from the circumflex", () => {
    const t = buildTree({ ...TYPICAL, dominance: "left" });
    expect(t.byId.PDA_L.parent).toBe("LCX"); expect(t.byId.PLV_L.parent).toBe("LCX");
    expect(t.byId.PDA_R).toBeUndefined();
  });
  it("co-dominant: PDA from the RCA, posterolateral from the circumflex", () => {
    const t = buildTree({ ...TYPICAL, dominance: "co" });
    expect(t.byId.PDA_R.parent).toBe("RCA"); expect(t.byId.PLV_L.parent).toBe("LCX");
  });
  it("dominance shifts myocardial supply between RCA and LCx systems", () => {
    const r = buildTree(TYPICAL), l = buildTree({ ...TYPICAL, dominance: "left" });
    expect(r.byId.RCA.subMass).toBeGreaterThan(l.byId.RCA.subMass + 0.15);
    expect(l.byId.LCX.subMass).toBeGreaterThan(r.byId.LCX.subMass + 0.15);
    expect(diameterAt(l, l.byId.LCX, 0)).toBeGreaterThan(diameterAt(r, r.byId.LCX, 0));
    expect(diameterAt(l, l.byId.RCA, 0)).toBeLessThan(diameterAt(r, r.byId.RCA, 0));
  });
  it("trifurcation adds a ramus intermedius to the left main; absent LM has no LM and separate roots", () => {
    const tri = buildTree({ ...TYPICAL, lm: "trifurcation" });
    expect(tri.byId.RAMUS.parent).toBe("LM");
    const ab = buildTree({ ...TYPICAL, lm: "absent" });
    expect(ab.byId.LM).toBeUndefined();
    expect(ab.byId.LAD.parent).toBeNull(); expect(ab.byId.LCX.parent).toBeNull();
  });
  it("short LAD hands myocardium to the PDA; wrap-around LAD takes it back", () => {
    const n = buildTree(TYPICAL), s = buildTree({ ...TYPICAL, ladCourse: "short" }), w = buildTree({ ...TYPICAL, ladCourse: "wrap" });
    expect(s.byId.LAD.subMass).toBeLessThan(n.byId.LAD.subMass);
    expect(w.byId.LAD.subMass).toBeGreaterThan(n.byId.LAD.subMass);
    expect(s.byId.PDA_R.subMass).toBeGreaterThan(n.byId.PDA_R.subMass);
  });
  it("separate conus ostium is its own root; SA-node artery follows its origin", () => {
    expect(buildTree({ ...TYPICAL, conusOstium: "separate" }).byId.CONUS.parent).toBeNull();
    expect(buildTree({ ...TYPICAL, saNodeFrom: "LCx" }).byId.SAN.parent).toBe("LCX");
    expect(buildTree(TYPICAL).byId.SAN.parent).toBe("RCA");
  });
});

describe("morphometric laws (flow-derived diameters)", () => {
  it("left main obeys Finet's law within 5% for the bifurcation pattern", () => {
    const t = buildTree(TYPICAL);
    const pred = finetParent(diameterAt(t, t.byId.LAD, 0), diameterAt(t, t.byId.LCX, 0));
    expect(Math.abs(pred - diameterAt(t, t.byId.LM, 0)) / pred).toBeLessThan(0.05);
  });
  it("diameter ∝ flow^(3/7): doubling flow raises diameter by 2^(3/7)", () => {
    const t = buildTree(TYPICAL), s = t.byId.LAD;
    const d0 = diameterAt(t, s, 0), q0 = restFlowAt(t, s, 0);
    expect(d0 / diameterAt(t, s, s.length)).toBeCloseTo(Math.pow(q0 / restFlowAt(t, s, s.length), 3 / 7), 2);
  });
  it("Murray (exponent 7/3) is satisfied at the LAD/D1 junction to within 10% of the parent flow law", () => {
    const t = buildTree(TYPICAL), lad = t.byId.LAD, d1 = t.byId.D1;
    const sb = d1.attach * lad.length;
    const err = murrayError(diameterAt(t, lad, sb - 4), [diameterAt(t, lad, sb + 4), diameterAt(t, d1, 0)], 7 / 3);
    expect(Math.abs(err)).toBeLessThan(0.1);
  });
  it("mid-LAD reference lumen matches the 3 mm used by the single-lesion model (±15%)", () => {
    const t = buildTree(TYPICAL);
    expect(mm(diameterAt(t, t.byId.LAD, 0.4 * t.byId.LAD.length))).toBeGreaterThan(2.55);
    expect(mm(diameterAt(t, t.byId.LAD, 0.4 * t.byId.LAD.length))).toBeLessThan(3.45);
  });
});

describe("network hemodynamics", () => {
  const t = buildTree(TYPICAL);
  it("healthy tree: every bed receives its resting flow at rest, and exertion is met", () => {
    expect(solveNetwork(t, [], 1).atRisk).toBe(0);
    expect(solveNetwork(t, [], FLOW.exertionDemand).atRisk).toBe(0);
  });
  it("pressure never rises along a healthy vessel", () => {
    const r = solveNetwork(t, [], FLOW.exertionDemand);
    for (const s of t.segments) r.seg[s.id].P.forEach((p, i, a) => i && expect(p).toBeLessThanOrEqual(a[i - 1] + 1e-6));
  });
  it("flow into the left main equals the sum of all left-system beds", () => {
    const r = solveNetwork(t, [], 1);
    const fromLM = (id: string): boolean => { let s = t.byId[id]; while (s.parent) s = t.byId[s.parent]; return s.id === "LM"; };
    const left = r.terminals.filter((x) => fromLM(x.segId)).reduce((a, x) => a + x.Q, 0);
    expect(r.seg.LM.Q[0]).toBeCloseTo(left, 12);
  });
  it("occlusion strands exactly the downstream myocardium", () => {
    const risk = (segId: string, pos: number, tr = t) => solveNetwork(tr, [{ segId, pos, ds: 1, occluded: true }], 1).atRisk;
    expect(risk("LM", 0.5)).toBeCloseTo(0.64, 2);
    expect(risk("LAD", 0.1)).toBeCloseTo(0.43, 2);
    expect(risk("LAD", 0.4)).toBeLessThan(risk("LAD", 0.1));
    // beyond 40%: LAD distal bed 0.10 + 3 downstream taps 0.11 + D2 0.06 (taps upstream stay perfused)
    expect(risk("LAD", 0.4)).toBeCloseTo(0.275, 2);
  });
  it("RCA occlusion jeopardizes far more myocardium in a right- than a left-dominant heart", () => {
    const l = buildTree({ ...TYPICAL, dominance: "left" });
    const r = solveNetwork(t, [{ segId: "RCA", pos: 0.2, ds: 1, occluded: true }], 1).atRisk;
    const lv = solveNetwork(l, [{ segId: "RCA", pos: 0.2, ds: 1, occluded: true }], 1).atRisk;
    expect(r).toBeGreaterThan(0.3);
    expect(lv).toBeLessThan(0.17);
  });
  it("a lesion starves only the beds beyond it, and leaves other territories untouched", () => {
    const a = analyze(t, [{ segId: "LAD", pos: 0.4, ds: 0.85 }], true);
    const base = analyze(t, [], true);
    const lcx = a.cond.terminals.filter((x) => x.group === "LCx"), lcx0 = base.cond.terminals.filter((x) => x.group === "LCx");
    lcx.forEach((x, i) => expect(x.ratio).toBeCloseTo(lcx0[i].ratio, 2));
    expect(a.cond.terminals.find((x) => x.key === "LAD#end")!.ratio).toBeLessThan(0.9);
    expect(a.cond.terminals.find((x) => x.key === "D1#end")!.ratio).toBeGreaterThan(0.99);
  });
  it("FFR falls with lesion severity and a proximal lesion jeopardizes more myocardium than a distal one", () => {
    const f = [0.4, 0.6, 0.7, 0.85].map((ds) => analyze(t, [{ segId: "LAD", pos: 0.4, ds }], false).ffr[0]);
    f.forEach((x, i) => i && expect(x).toBeLessThan(f[i - 1]));
    expect(f[0]).toBeGreaterThan(0.9);
    expect(f[3]).toBeLessThan(0.5);
    const prox = analyze(t, [{ segId: "LAD", pos: 0.1, ds: 0.85 }], true).cond.atRisk;
    const dist = analyze(t, [{ segId: "LAD", pos: 0.85, ds: 0.85 }], true).cond.atRisk;
    expect(prox).toBeGreaterThan(dist);
  });
  it("occlusion over a branch take-off leaves that branch perfused and every pressure finite", () => {
    const l = buildTree({ ...TYPICAL, dominance: "left" }); // short RCA: the 14 mm window spans the conus and SA-node origins
    const r = solveNetwork(l, [{ segId: "RCA", pos: 0.2, ds: 1, occluded: true }], 1);
    for (const x of r.terminals) { expect(Number.isFinite(x.Pd)).toBe(true); expect(Number.isFinite(x.ratio)).toBe(true); }
    expect(r.terminals.find((x) => x.key === "CONUS#end")!.ratio).toBeCloseTo(1, 2);
    expect(r.terminals.find((x) => x.key === "SAN#end")!.ratio).toBeCloseTo(1, 2);
    expect(r.terminals.find((x) => x.key === "AM#end")!.ratio).toBe(0);
  });
  it("never produces NaN for any variant, lesion site, severity or occlusion", () => {
    for (const [, v] of VARIANTS) {
      const tr = buildTree(v);
      for (const seg of tr.segments) for (const pos of [0.1, 0.5, 0.9]) for (const occluded of [false, true]) {
        const r = solveNetwork(tr, [{ segId: seg.id, pos, ds: occluded ? 1 : 0.8, occluded }], 1);
        for (const x of r.terminals) expect(Number.isFinite(x.ratio) && Number.isFinite(x.Pd)).toBe(true);
      }
    }
  });
  it("converges for a very tight lesion", () => {
    expect(solveNetwork(t, [{ segId: "LAD", pos: 0.4, ds: 0.92 }], Infinity).iterations).toBeLessThan(1500);
  });
});
