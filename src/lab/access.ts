import { buildTree, type Tree } from "../anatomy/tree";
import { Curve, type V3 } from "../anatomy/curve";
import { loadPeripheral } from "./peripheral";
import type { AccessSite, AccessVariant, VGraph, VSeg } from "./types";

/**
 * The access vessels, from a puncture site to the aortic sinuses, in the patient frame (mm): +x is the patient's left, +y is
 * cranial, +z is anterior, the same frame as the coronary tree. The routable chain (what the wire and guide travel) keeps its
 * ids and its parent links. Side branches (renals, internal iliacs, profunda, carotids, left subclavian) go in `VGraph.branches`:
 * they are drawn and they fill with dye, but no device route or branch choice sees them.
 */

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
const endOf = (s: VSeg): V3 => s.samples[s.samples.length - 1];
const pointAt = (s: VSeg, mm: number): V3 => {
  const u = Math.min(1, Math.max(0, mm / s.length));
  const i = Math.min(s.samples.length - 2, Math.floor(u * (s.samples.length - 1)));
  return lerp(s.samples[i], s.samples[i + 1], u * (s.samples.length - 1) - i);
};
const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** Landmarks of the body, as the patient lies in the frame. The coronary tree sits near the origin with the sinuses about y = 44. */
export const BODY = {
  midlineX: -10, // spine and sternum; the heart sits to the patient's left of it
  puncture: [-82, -505, 16] as V3, // right common femoral, over the femoral head
  inguinal: [-76, -398, -4] as V3,
  bifurcation: [-8, -255, -40] as V3, // aortic bifurcation, L4
  renalLevel: -178, // y of the renal arteries
  hiatus: [-4, -112, -50] as V3, // the aorta passes the diaphragm, T12
};

/** Reflect a point across the midline, so the left limb mirrors the right. */
const mirror = (p: V3): V3 => [2 * BODY.midlineX - p[0], p[1], p[2]];

const N_MIN = 12, N_MAX = 160, MM_PER_SAMPLE = 4;

/** A centerline through control points, resampled at equal arc length, with a diameter that tapers from d0 to d1 (a smooth ramp). */
export const segFromCurve = (
  id: string, name: string, parent: string | null, attach: number,
  ctrl: V3[], diam: number | [number, number], tortuosity: number, calc: number, start?: V3,
): VSeg => {
  const points = start ? [start, ...ctrl.filter((p) => dist(start, p) > 0.25)] : ctrl;
  const c = new Curve(points, 24);
  const n = Math.min(N_MAX, Math.max(N_MIN, Math.round(c.length / MM_PER_SAMPLE)));
  const samples: V3[] = [];
  for (let i = 0; i <= n; i++) samples.push(c.at(i / n));
  const [d0, d1] = typeof diam === "number" ? [diam, diam] : diam;
  return {
    id, name, parent, attach, length: c.length,
    samples, diameterMm: samples.map((_, i) => d0 + (d1 - d0) * smooth(i / n)), tortuosity, calcification: calc,
  };
};

/** Arch height above the sinuses by type: I is flat, III is tall and tight. */
export const archHeightMm = (arch: AccessVariant["arch"]) => (arch === "I" ? 46 : arch === "II" ? 62 : 82);

/** Where the ascending aorta ends and the arch begins, and the point of the innominate origin (the same point). */
const archStart = (v: AccessVariant, sinus: V3): V3 => [sinus[0] - 3, sinus[1] + archHeightMm(v.arch) - 12, sinus[2] - 5];

type FemChain = { femR: VSeg; iliacR: VSeg; abd: VSeg; thor: VSeg; arch: VSeg; asc: VSeg; femL: VSeg; iliacL: VSeg };

/** A wiggle across the iliac course: tortuosity pushes the control points sideways, alternately, so the vessel gets S bends. */
const iliacCtrl = (side: 1 | -1, tort: number): V3[] => {
  const amp = tort * 16;
  const { inguinal, bifurcation } = BODY;
  const pts: V3[] = [];
  const steps = [0.22, 0.45, 0.7];
  steps.forEach((u, k) => {
    const base = lerp(inguinal, bifurcation, u);
    // the external iliac bows laterally and anteriorly (the brim of the pelvis); the wiggle rides on top
    const bow = Math.sin(u * Math.PI);
    const s = k % 2 ? 1 : -1;
    pts.push([base[0] - 14 * bow + s * amp * 0.5, base[1], base[2] + 10 * bow + s * amp]);
  });
  return side === 1 ? pts : pts.map(mirror);
};

/** Prefer baked peripheral samples when present; fall back to procedural controls. */
const periSamples = (id: string): V3[] | null => {
  try {
    const s = loadPeripheral().find((x) => x.id === id);
    return s && s.samples.length >= 2 ? s.samples.map((p) => [...p] as V3) : null;
  } catch {
    return null;
  }
};

const wiggle = (pts: V3[], amp: number, side: 1 | -1): V3[] =>
  pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const s = i % 2 ? 1 : -1;
    return [p[0] + s * amp * 0.5 * side, p[1], p[2] + s * amp] as V3;
  });

/** Right femoral to the ascending aorta (sinus level); the left side is mirrored. Uses baked peripheral centerlines when available. */
function buildFemoralChain(v: AccessVariant, sinus: V3): FemChain {
  const { puncture, inguinal, bifurcation, hiatus, midlineX } = BODY;
  const iliacCalc = v.calcifiedIliac ? 0.72 : 0.12;
  const iliacTort = 0.12 + v.iliacTortuosity * 0.55;
  const H = archHeightMm(v.arch), yS = sinus[1];
  const amp = v.iliacTortuosity * 16;

  const cfaR = periSamples("CFA_R");
  const eiaR = periSamples("EIA_R");
  const ciaR = periSamples("CIA_R");

  // Bake stores CFA inguinal→puncture; the access route climbs puncture→inguinal.
  const femR = cfaR
    ? segFromCurve("FEM_R", "Right femoral", null, 0, cfaR.slice().reverse(), [8.2, 9.4], 0.06, 0)
    : segFromCurve("FEM_R", "Right femoral", null, 0, [puncture, lerp(puncture, inguinal, 0.5), inguinal], [8.2, 9.4], 0.06, 0);
  const cfaL = periSamples("CFA_L");
  const femL = cfaL
    ? segFromCurve("FEM_L", "Left femoral", null, 0, cfaL.slice().reverse(), [8.2, 9.4], 0.06, 0)
    : segFromCurve("FEM_L", "Left femoral", null, 0, [mirror(puncture), lerp(mirror(puncture), mirror(inguinal), 0.5), mirror(inguinal)], [8.2, 9.4], 0.06, 0);

  // Iliac: prefer baked EIA/CIA direction (puncture side → bifurcation), with tortuosity wiggle.
  const iliacCtrlR = eiaR && ciaR
    ? wiggle([eiaR[eiaR.length - 1]!, ...iliacCtrl(1, iliacTort), bifurcation], amp, 1)
    : [...iliacCtrl(1, iliacTort), bifurcation];
  const eiaL = periSamples("EIA_L");
  const iliacCtrlL = eiaL
    ? wiggle([eiaL[eiaL.length - 1]!, ...iliacCtrl(-1, iliacTort), bifurcation], amp, -1)
    : [...iliacCtrl(-1, iliacTort), bifurcation];
  void ciaR;

  const iliacR = segFromCurve("ILIAC_R", "Right iliac", "FEM_R", 1, iliacCtrlR, [8, 11], iliacTort, iliacCalc, endOf(femR));
  const iliacL = segFromCurve("ILIAC_L", "Left iliac", "FEM_L", 1, iliacCtrlL, [8, 11], iliacTort, iliacCalc, endOf(femL));

  // Abdominal and thoracic aorta stay on the procedural landmarks so route length stays clinical.
  const abd = segFromCurve("AORTA_ABD", "Abdominal aorta", "ILIAC_R", 1,
    [[midlineX + 1, -205, -44], [midlineX + 4, -150, -50], hiatus], [16, 21], 0.06, 0, endOf(iliacR));

  const thorEnd: V3 = [midlineX + 21, yS + H - 34, -52];
  const thor = segFromCurve("AORTA_THOR", "Thoracic aorta", "AORTA_ABD", 1,
    [[midlineX + 12, -50, -52], [midlineX + 17, 0, -54], [midlineX + 21, 40, -54], thorEnd], [23, 26], 0.08, 0, endOf(abd));

  const A = archStart(v, sinus);
  const lift = v.arch === "I" ? 0 : v.arch === "II" ? 0.5 : 1;
  const archPts: V3[] = [
    [midlineX + 20, yS + H - 14, -50],
    [midlineX + 13, yS + H + 1 - lift, -45],
    [midlineX - 2, yS + H + 4, -34],
    [(midlineX + A[0]) / 2 - 3, yS + H + 1, -22],
    [A[0] - 1, yS + H - 6, A[2] - 3],
  ];
  const archTort = v.arch === "I" ? 0.18 : v.arch === "II" ? 0.38 : 0.72;
  const arch = segFromCurve("ARCH", "Aortic arch", "AORTA_THOR", 1, [...archPts, A], [26, 29], archTort, 0.06, endOf(thor));

  const asc = segFromCurve("AORTA_ASC", "Ascending aorta", "ARCH", 1,
    [lerp(A, sinus, 0.4), lerp(A, sinus, 0.75), sinus], [31, Math.max(32, v.aorticRootMm)], 0.05, 0, endOf(arch));
  return { femR, iliacR, abd, thor, arch, asc, femL, iliacL };
}

/** Right radial to the innominate. The innominate joins the ascending aorta at the start of the arch, so a radial guide goes straight down into the root. */
function buildRadialChain(v: AccessVariant, arch: VSeg, sinus: V3): { radialR: VSeg; brach: VSeg; subcl: VSeg; innom: VSeg } {
  const yJ = sinus[1] + archHeightMm(v.arch) + 20; // sternoclavicular joint level
  const wrist: V3 = [-635, -62, 12];
  const loop: V3 = v.radialLoop ? [-440, 36, 44] : [-485, -8, 24];
  const elbow: V3 = [-320, 62, 11];
  const shoulder: V3 = [-155, yJ - 36, 5];
  const joint: V3 = [-48, yJ, 6];
  const mouth = endOf(arch);

  // Arm route keeps procedural lengths (clinical wrist→root); baked arm segments stay in branches for runoff/arm views.
  const radialR = segFromCurve("RADIAL_R", "Right radial", null, 0,
    [wrist, loop, lerp(wrist, elbow, 0.55), elbow], [2.4, 3], v.radialLoop ? 0.88 : 0.22, 0);
  const brach = segFromCurve("BRACH_R", "Right brachial", "RADIAL_R", 1,
    [elbow, lerp(elbow, shoulder, 0.4), shoulder], [4.4, 5.6], 0.16, 0, endOf(radialR));
  const subcl = segFromCurve("SUBCLAV_R", "Right subclavian", "BRACH_R", 1,
    [shoulder, [-118, yJ - 14, 8], [-80, yJ + 4, 8], joint], [7.6, 9.4], 0.22, 0, endOf(brach));
  const innom = segFromCurve("INNOM", "Innominate", "SUBCLAV_R", 1,
    [lerp(joint, mouth, 0.35), lerp(joint, mouth, 0.7), mouth], [12.5, 13.5], 0.28, 0, endOf(subcl));
  return { radialR, brach, subcl, innom };
}

/** Side branches that no device route uses. Parents are routable segments; `attach` is the fraction along the parent. */
function buildBranches(v: AccessVariant, c: FemChain, rad: ReturnType<typeof buildRadialChain>, sinus: V3): VSeg[] {
  const out: VSeg[] = [];
  const at = (s: VSeg, u: number): V3 => pointAt(s, u * s.length);
  const branch = (id: string, name: string, parent: VSeg, u: number, ctrl: V3[], d: [number, number]) =>
    out.push(segFromCurve(id, name, parent.id, u, ctrl, d, 0.1, 0, at(parent, u)));
  const off = (p: V3, dx: number, dy: number, dz: number): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];

  for (const side of [1, -1] as const) {
    const R = side === 1, tag = R ? "R" : "L", name = R ? "Right" : "Left";
    const m = (p: V3): V3 => (R ? p : mirror(p));
    const fem = R ? c.femR : c.femL, iliac = R ? c.iliacR : c.iliacL;
    // common femoral bifurcation just below the puncture: the deep femoral goes down and back, the superficial femoral straight down
    const pf = at(fem, 0.05);
    branch(`PROFUNDA_${tag}`, `${name} deep femoral`, fem, 0.05, [off(pf, R ? 8 : -8, -36, -10), off(pf, R ? 14 : -14, -78, -22), off(pf, R ? 16 : -16, -118, -30)], [6.2, 2.8]);
    branch(`SFA_${tag}`, `${name} superficial femoral`, fem, 0.0, [off(at(fem, 0), R ? -2 : 2, -60, -2), off(at(fem, 0), R ? -2 : 2, -130, -6), off(at(fem, 0), R ? -1 : 1, -200, -10)], [6.4, 5]);
    // internal iliac leaves the common iliac at the pelvic brim and dives posteriorly and medially
    const pi = at(iliac, 0.62);
    branch(`IIA_${tag}`, `${name} internal iliac`, iliac, 0.62, [off(pi, R ? 8 : -8, -16, -14), off(pi, R ? 16 : -16, -42, -34), off(pi, R ? 18 : -18, -66, -58)], [6.8, 2.6]);
    // renal arteries come off the abdominal aorta at L1-2 and run laterally and slightly down
    const u = (BODY.renalLevel - c.abd.samples[0][1]) / (endOf(c.abd)[1] - c.abd.samples[0][1]);
    const pr = at(c.abd, u);
    branch(`RENAL_${tag}`, `${name} renal`, c.abd, u, [off(pr, R ? -14 : 14, -4, -4), m(off([BODY.midlineX, pr[1], pr[2]], -32, -10, -8)), m(off([BODY.midlineX, pr[1], pr[2]], -58, -20, -4))], [6.2, 5.2]);
  }

  // great vessels. The innominate's start is the sternoclavicular joint, where the right common carotid leaves; the left ones leave the arch.
  const joint = rad.innom.samples[0], archSeg = c.arch;
  out.push(segFromCurve("CCA_R", "Right common carotid", "INNOM", 0, [off(joint, 6, 36, -2), off(joint, 10, 78, -6), off(joint, 12, 118, -8)], [7.2, 6], 0.1, 0, joint));
  const pl = at(archSeg, 0.86), ps = at(archSeg, 0.74);
  out.push(segFromCurve("CCA_L", "Left common carotid", "ARCH", 0.86, [off(pl, 12, 30, 8), off(pl, 34, 84, 2), off(pl, 40, 138, -4)], [7.2, 6], 0.1, 0, pl));
  out.push(segFromCurve("SUBCLAV_L", "Left subclavian", "ARCH", 0.74, [off(ps, 26, 28, 14), off(ps, 80, 42, 14), off(ps, 150, 36, 8), off(ps, 205, 18, 2)], [9, 7], 0.15, 0, ps));
  void v; void sinus;
  return out;
}

/** Access vessels from the puncture site to the sinuses; coronaryRoot is [LM ostium, RCA ostium] in the patient frame. */
export function buildAccess(v: AccessVariant, coronaryRoot: V3[]): VGraph {
  const lm = coronaryRoot[0], rca = coronaryRoot[1] ?? lm;
  const sinus = lerp(lm, rca, 0.35);

  const fem = buildFemoralChain(v, sinus);
  const rad = buildRadialChain(v, fem.arch, sinus);
  const segs = [
    fem.femR, fem.femL, fem.iliacR, fem.iliacL, fem.abd, fem.thor, fem.arch, fem.asc,
    rad.radialR, rad.brach, rad.subcl, rad.innom,
  ];
  const byId = Object.fromEntries(segs.map((s) => [s.id, s]));
  // Run-off and arm vessels from the bake, kept apart from the side branches: drawn in the peripheral views, never routed.
  // Vessels the procedural graph already has (SFA, profunda, internal iliac, carotids) are not duplicated.
  const branches = buildBranches(v, fem, rad, sinus) ?? [];
  const have = new Set([...segs, ...branches].map((s) => s.id));
  const runoff = loadPeripheral().filter((s) => /^(POP|ATA|PTA|PERONEAL|DP|ULNAR|VERT)_/.test(s.id) && !have.has(s.id));
  const asc = fem.asc;
  const lmDist = dist(endOf(asc), lm);
  const rcaDist = dist(endOf(asc), rca);
  const ostiumLmMm = Math.max(0, asc.length - lmDist * 0.35);
  const ostiumRcaMm = Math.max(0, asc.length - rcaDist * 0.4);
  return {
    segs, byId,
    branches, runoff,
    ostium: {
      LM: { segId: "AORTA_ASC", mm: ostiumLmMm },
      RCA: { segId: "AORTA_ASC", mm: ostiumRcaMm },
    },
  };
}

export const routeLengthTo = (g: VGraph, site: AccessSite, target: string, routeIds: string[]): number =>
  routeIds.reduce((s, id) => s + g.byId[id].length, 0);

/** Attach the coronary tree; coronary ids match the anatomy tree. */
export function unify(access: VGraph, tree: Tree): VGraph {
  const segs = [...access.segs];
  const byId: Record<string, VSeg> = { ...access.byId };
  for (const s of tree.segments) {
    const attach = s.parent ? s.attach : 1;
    const parent = s.parent ?? "AORTA_ASC";
    const diam = s.samples.map(() => 3.2);
    segs.push({
      id: s.id, name: s.name, parent, attach,
      length: s.length, samples: s.samples, diameterMm: diam,
      tortuosity: 0.05, calcification: 0,
    });
    byId[s.id] = segs[segs.length - 1];
  }
  return {
    segs, byId,
    branches: access.branches, runoff: access.runoff,
    ostium: {
      LM: { segId: "LM", mm: 0 },
      RCA: { segId: "RCA", mm: 0 },
    },
  };
}

export function defaultUnifiedGraph(): VGraph {
  const tree = buildTree();
  const roots: V3[] = [tree.byId.LM.samples[0], tree.byId.RCA.samples[0]];
  return unify(buildAccess({ arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 32, calcifiedIliac: false }, roots), tree);
}

/** Continuity check helper (tests): parent distal point to child proximal. */
export function parentChildGap(g: VGraph, childId: string): number {
  const c = g.byId[childId] ?? g.branches?.find((b) => b.id === childId);
  if (!c || !c.parent) return 0;
  const p = g.byId[c.parent];
  if (!p) return Infinity;
  const join = pointAt(p, c.attach * p.length);
  return dist(join, c.samples[0]);
}
