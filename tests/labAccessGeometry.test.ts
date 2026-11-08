import { describe, it, expect } from "vitest";
import { buildTree } from "../src/anatomy/tree";
import { BODY, archHeightMm, buildAccess, parentChildGap, unify } from "../src/lab/access";
import { routeTo } from "../src/lab/route";
import type { AccessVariant } from "../src/lab/types";

const tree = buildTree();
const roots = [tree.byId.LM.samples[0], tree.byId.RCA.samples[0]];
const base: AccessVariant = { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 34, calcifiedIliac: false };
const access = (v: Partial<AccessVariant> = {}) => buildAccess({ ...base, ...v }, roots);
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("access geometry", () => {
  it("each routed vessel ends where the next begins", () => {
    const g = access();
    for (const [site, target] of [["femoral-R", "AORTA_ASC"], ["femoral-L", "AORTA_ASC"], ["radial-R", "AORTA_ASC"]] as const) {
      const r = routeTo(g, site, target);
      for (let i = 1; i < r.length; i++) {
        const a = g.byId[r[i - 1]], b = g.byId[r[i]];
        expect(dist(a.samples[a.samples.length - 1], b.samples[0]), `${site} ${a.id}->${b.id}`).toBeLessThan(1);
      }
    }
  });

  it("samples are equally spaced along the vessel", () => {
    for (const s of access().segs) {
      const gaps = s.samples.slice(1).map((p, i) => dist(p, s.samples[i]));
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(Math.max(...gaps) / mean, s.id).toBeLessThan(1.15);
      expect(Math.min(...gaps) / mean, s.id).toBeGreaterThan(0.85);
    }
  });

  it("the right femoral artery is on the patient's right of the midline, the left one mirrors it", () => {
    const g = access();
    expect(g.byId.FEM_R.samples[0][0]).toBeLessThan(BODY.midlineX);
    expect(g.byId.FEM_L.samples[0][0]).toBeGreaterThan(BODY.midlineX);
    expect(g.byId.FEM_R.samples[0][0] - BODY.midlineX).toBeCloseTo(BODY.midlineX - g.byId.FEM_L.samples[0][0], 6);
    // the two iliacs meet at one aortic bifurcation
    const eR = g.byId.ILIAC_R.samples.at(-1)!, eL = g.byId.ILIAC_L.samples.at(-1)!;
    expect(dist(eR, eL)).toBeLessThan(0.5);
  });

  it("the aorta widens toward the heart and the iliacs narrow toward the groin", () => {
    const g = access();
    const d = (id: string, i: number) => g.byId[id].diameterMm[i < 0 ? g.byId[id].diameterMm.length + i : i];
    expect(d("AORTA_ABD", -1)).toBeGreaterThan(d("AORTA_ABD", 0));
    expect(d("AORTA_ASC", -1)).toBeGreaterThanOrEqual(34);
    expect(d("ILIAC_R", 0)).toBeLessThan(d("ILIAC_R", -1));
    expect(d("RADIAL_R", 0)).toBeLessThan(d("RADIAL_R", -1));
    for (const s of g.segs) for (const x of s.diameterMm) expect(x, s.id).toBeGreaterThan(1.5);
  });

  it("side branches leave their parent at the stated point and carry real calibers", () => {
    const g = access();
    const ids = (g.branches ?? []).map((b) => b.id);
    for (const want of ["RENAL_R", "RENAL_L", "IIA_R", "IIA_L", "PROFUNDA_R", "PROFUNDA_L", "CCA_R", "CCA_L", "SUBCLAV_L"]) expect(ids).toContain(want);
    for (const b of g.branches ?? []) {
      expect(parentChildGap(g, b.id), b.id).toBeLessThan(1);
      expect(g.byId[b.id], `${b.id} must stay off the routable graph`).toBeUndefined();
      expect(Math.min(...b.diameterMm)).toBeGreaterThan(2);
      expect(Math.max(...b.diameterMm)).toBeLessThan(15);
    }
  });

  it("unify keeps the branches and adds only coronary vessels to the routable graph", () => {
    const g = unify(access(), tree);
    expect(g.branches?.length).toBeGreaterThan(8);
    expect(g.segs.length).toBe(12 + tree.segments.length);
  });

  it("the arch is higher and tighter by type, with the root and the innominate joined at one point", () => {
    expect(archHeightMm("I")).toBeLessThan(archHeightMm("II"));
    expect(archHeightMm("II")).toBeLessThan(archHeightMm("III"));
    const top = (a: AccessVariant["arch"]) => Math.max(...access({ arch: a }).byId.ARCH.samples.map((p) => p[1]));
    expect(top("I")).toBeLessThan(top("II"));
    expect(top("II")).toBeLessThan(top("III"));
    const g = access();
    expect(dist(g.byId.INNOM.samples.at(-1)!, g.byId.AORTA_ASC.samples[0])).toBeLessThan(1);
  });

  it("iliac tortuosity bends the iliac more", () => {
    const len = (t: number) => access({ iliacTortuosity: t }).byId.ILIAC_R.length;
    expect(len(1)).toBeGreaterThan(len(0));
  });
});
