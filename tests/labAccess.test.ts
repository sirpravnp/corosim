import { describe, it, expect } from "vitest";
import { buildTree } from "../src/anatomy/tree";
import { buildAccess, parentChildGap, unify } from "../src/lab/access";
import { curvatureAlong, routeTo, transmission } from "../src/lab/route";
import type { AccessSite, AccessVariant } from "../src/lab/types";

const tree = buildTree();
const roots = [tree.byId.LM.samples[0], tree.byId.RCA.samples[0]];
const graph = (v: Partial<AccessVariant> = {}) =>
  unify(
    buildAccess({ arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 32, calcifiedIliac: false, ...v }, roots),
    tree,
  );

const sites: AccessSite[] = ["femoral-R", "femoral-L", "radial-R", "radial-L"];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("access graph", () => {
  it("every segment is connected with valid samples", () => {
    const g = graph();
    for (const s of g.segs) {
      expect(s.samples.length).toBeGreaterThan(1);
      expect(s.diameterMm.length).toBe(s.samples.length);
      expect(s.attach).toBeGreaterThanOrEqual(0);
      expect(s.attach).toBeLessThanOrEqual(1);
      if (s.parent) expect(g.byId[s.parent]).toBeDefined();
      for (const p of s.samples) for (const c of p) expect(Number.isFinite(c)).toBe(true);
    }
  });

  it("routes reach LM and RCA from every access site", () => {
    const g = graph();
    for (const site of sites) {
      for (const target of ["LM", "RCA"] as const) {
        const r = routeTo(g, site, target);
        expect(r[r.length - 1]).toBe(target);
        for (let i = 1; i < r.length; i++) {
          const seg = g.byId[r[i]], prev = g.byId[r[i - 1]];
          const linked = seg.parent === prev.id || prev.parent === seg.id || neighborsLinked(g, prev.id, seg.id);
          expect(linked, `${site} ${r[i - 1]}->${r[i]}`).toBe(true);
        }
      }
    }
  });

  it("ends the ascending aorta at the coronary ostia", () => {
    const g = graph();
    const asc = g.byId.AORTA_ASC;
    const lm = g.byId.LM, rca = g.byId.RCA;
    expect(dist(asc.samples[asc.samples.length - 1], lm.samples[0])).toBeLessThan(15);
    expect(dist(asc.samples[asc.samples.length - 1], rca.samples[0])).toBeLessThan(25);
  });

  it("arch III is more tortuous and transmits less support than arch I", () => {
    const g1 = graph({ arch: "I" });
    const g3 = graph({ arch: "III" });
    expect(g3.byId.ARCH.tortuosity).toBeGreaterThan(g1.byId.ARCH.tortuosity);
    const r = routeTo(g1, "femoral-R", "LM");
    const t1 = transmission(g1, r, g1.byId.LM.length, 0.6);
    const t3 = transmission(g3, r, g3.byId.LM.length, 0.6);
    expect(t3).toBeLessThan(t1);
  });

  it("higher guide support improves transmission", () => {
    const g = graph();
    const r = routeTo(g, "femoral-R", "LAD");
    const low = transmission(g, r, 40, 0.3);
    const high = transmission(g, r, 40, 0.9);
    expect(high).toBeGreaterThan(low);
  });

  it("a radial loop hurts radial but not femoral routes", () => {
    const plain = graph({ radialLoop: false });
    const loop = graph({ radialLoop: true });
    const rr = routeTo(plain, "radial-R", "LM");
    const fr = routeTo(plain, "femoral-R", "LM");
    const tRadPlain = transmission(plain, rr, 30, 0.6);
    const tRadLoop = transmission(loop, routeTo(loop, "radial-R", "LM"), 30, 0.6);
    expect(tRadLoop).toBeLessThan(tRadPlain);
    expect(transmission(loop, routeTo(loop, "femoral-R", "LM"), 30, 0.6)).toBeCloseTo(transmission(plain, fr, 30, 0.6), 6);
  });

  it("parent ends meet child starts within 0.5 mm", () => {
    const access = buildAccess({ arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 32, calcifiedIliac: false }, roots);
    for (const s of access.segs) {
      if (!s.parent) continue;
      expect(parentChildGap(access, s.id), s.id).toBeLessThan(0.5);
    }
  });

  it("femoral and radial paths have plausible lengths to the root", () => {
    const access = buildAccess({ arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 32, calcifiedIliac: false }, roots);
    const femRoute = routeTo(access, "femoral-R", "AORTA_ASC");
    const radRoute = routeTo(access, "radial-R", "AORTA_ASC");
    expect(radRoute[0]).toBe("RADIAL_R");
    const fem = routeLength(access, femRoute);
    const rad = routeLength(access, radRoute);
    expect(fem).toBeGreaterThanOrEqual(650);
    expect(fem).toBeLessThanOrEqual(800);
    expect(rad).toBeGreaterThanOrEqual(650); // wrist to root through the innominate; the old floor counted a detour down the thoracic aorta
    expect(rad).toBeLessThanOrEqual(1150);
  });

  it("transmission never increases with tip distance", () => {
    const g = graph();
    const r = routeTo(g, "femoral-R", "LAD");
    const t40 = transmission(g, r, 40, 0.7);
    const t120 = transmission(g, r, 120, 0.7);
    expect(t120).toBeLessThanOrEqual(t40);
  });

  it("route from femoral-L passes the left iliac and aortic bifurcation", () => {
    const g = graph();
    const r = routeTo(g, "femoral-L", "LM");
    expect(r).toContain("FEM_L");
    expect(r).toContain("ILIAC_L");
    expect(r).toContain("AORTA_ABD");
    expect(r).toContain("ARCH");
  });

  it("radial route passes subclavian and the arch", () => {
    const g = graph();
    const r = routeTo(g, "radial-R", "LM");
    expect(r[0]).toBe("RADIAL_R");
    expect(r).toContain("SUBCLAV_R");
    expect(r.some((id) => id === "ARCH" || id === "INNOM" || id === "AORTA_ASC")).toBe(true);
  });

  it("iliac tortuosity increases route curvature", () => {
    const straight = graph({ iliacTortuosity: 0.05 });
    const tort = graph({ iliacTortuosity: 0.9 });
    const r0 = routeTo(straight, "femoral-R", "AORTA_ASC");
    const r1 = routeTo(tort, "femoral-R", "AORTA_ASC");
    const c0 = curvatureAlong(straight, r0, 0, routeLength(straight, r0));
    const c1 = curvatureAlong(tort, r1, 0, routeLength(tort, r1));
    expect(c1).toBeGreaterThan(c0);
  });
});

function routeLength(g: ReturnType<typeof graph>, route: string[]) {
  return route.reduce((s, id) => s + g.byId[id].length, 0);
}

function neighborsLinked(g: ReturnType<typeof graph>, a: string, b: string) {
  const extra = new Set<string>();
  if (a === "ILIAC_L" || a === "ILIAC_R") extra.add("AORTA_ABD");
  if (a === "INNOM") { extra.add("AORTA_THOR"); extra.add("AORTA_ASC"); }
  return extra.has(b) || extra.has(a);
}
