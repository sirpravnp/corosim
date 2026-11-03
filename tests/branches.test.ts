import { describe, it, expect } from "vitest";
import { buildBranches, branchLength } from "../src/anatomy/branches";
import { buildTree, TYPICAL, Variant } from "../src/anatomy/tree";
import { BRANCHES } from "../src/config/tree";
import { projectToEpicardium } from "../src/anatomy/heartSurface";
import { len, sub } from "../src/anatomy/curve";

const tree = buildTree();
const bs = buildBranches(tree);
// the default heart mesh bounds (meshHeart): nothing may leave them
const LO = [-64, -74, -72], HI = [64, 114, 48];
const variants: Variant[] = [TYPICAL, { ...TYPICAL, dominance: "left", lm: "trifurcation", ladCourse: "wrap" }, { ...TYPICAL, dominance: "co", lm: "absent", ladCourse: "short", saNodeFrom: "LCx", conusOstium: "separate" }];

describe("display branches", () => {
  it("is deterministic: a second build gives identical branches", () => {
    expect(JSON.stringify(buildBranches(buildTree()))).toBe(JSON.stringify(bs));
  });
  it("starts every first-generation branch on the parent's curve", () => {
    for (const b of bs.filter((x) => x.gen === 1)) {
      const seg = tree.byId[b.segId], q = projectToEpicardium(seg.curve.at(b.u), 0.6).pos;
      expect(len(sub(b.pts[0], q))).toBeLessThan(1e-6);
    }
  });
  it("starts twigs on their parent branch", () => {
    for (const b of bs.filter((x) => x.gen > 1)) {
      const pid = b.id.slice(0, b.id.lastIndexOf(".")), p = bs.find((x) => x.id === pid)!;
      expect(p).toBeTruthy();
      expect(p.pts.some((q) => len(sub(q, b.pts[0])) < 1e-9)).toBe(true);
    }
  });
  it("stays inside the heart bounds, with finite sane lengths", () => {
    for (const b of bs) {
      for (const p of b.pts) for (let i = 0; i < 3; i++) { expect(Number.isFinite(p[i])).toBe(true); expect(p[i]).toBeGreaterThan(LO[i]); expect(p[i]).toBeLessThan(HI[i]); }
      const l = branchLength(b);
      expect(l).toBeGreaterThan(3); expect(l).toBeLessThan(BRANCHES.maxLength + 5);
    }
  });
  it("keeps diameters finite, at least the minimum, non-increasing along a branch and below the parent's at the junction", () => {
    for (const b of bs) {
      expect(b.d.length).toBe(b.pts.length);
      b.d.forEach((d, i) => { expect(Number.isFinite(d)).toBe(true); expect(d).toBeGreaterThanOrEqual(BRANCHES.minDiameter - 1e-12); if (i) expect(d).toBeLessThanOrEqual(b.d[i - 1] + 1e-12); });
      expect(b.d[0]).toBeLessThanOrEqual(b.parentD + 1e-9);
      if (b.parentD > BRANCHES.minDiameter / BRANCHES.childRatio + 1e-9) expect(b.d[0]).toBeLessThan(b.parentD);
    }
  });
  it("makes bigger territories wider (Murray: d ~ mass^(1/3)) where the parent does not cap them", () => {
    const uncapped = bs.filter((b) => b.gen === 1 && !b.septal && b.d[0] < b.parentD * BRANCHES.childRatio - 1e-9 && b.d[0] > BRANCHES.minDiameter + 1e-9).sort((x, y) => x.mass - y.mass);
    expect(uncapped.length).toBeGreaterThan(3);
    for (let i = 1; i < uncapped.length; i++) expect(uncapped[i].d[0]).toBeGreaterThanOrEqual(uncapped[i - 1].d[0] - 1e-9);
  });
  it("gives each vessel a sane branch count", () => {
    const n = (seg: string, f: (b: (typeof bs)[number]) => boolean = () => true) => bs.filter((b) => b.segId === seg && f(b)).length;
    expect(n("LAD", (b) => b.gen === 1 && !b.septal)).toBe(tree.byId.LAD.taps.length);
    expect(n("LAD", (b) => b.septal)).toBeGreaterThanOrEqual(3); expect(n("LAD", (b) => b.septal)).toBeLessThanOrEqual(5);
    expect(n("PDA_R", (b) => b.septal)).toBeGreaterThanOrEqual(3); expect(n("PDA_R", (b) => b.septal)).toBeLessThanOrEqual(5);
    expect(n("LCX", (b) => b.septal)).toBe(0);
    expect(n("CONUS")).toBe(0);
    expect(bs.length).toBeGreaterThan(40); expect(bs.length).toBeLessThan(150);
    expect(bs.filter((b) => b.gen === 3).length).toBeGreaterThan(0);
  });
  it("holds up across anatomical variants (no NaN, still bounded, every tap drawn, reproducible)", () => {
    for (const v of variants) {
      const t = buildTree(v), list = buildBranches(t);
      expect(list.filter((b) => b.gen === 1 && !b.septal).length).toBe(t.segments.reduce((a, s) => a + s.taps.length, 0));
      for (const b of list) for (const p of b.pts) for (let i = 0; i < 3; i++) { expect(Number.isFinite(p[i])).toBe(true); expect(Math.abs(p[i])).toBeLessThan(120); }
      expect(JSON.stringify(buildBranches(buildTree(v)))).toBe(JSON.stringify(list));
    }
  });
});
