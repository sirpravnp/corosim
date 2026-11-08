import { buildTree, type Tree } from "../anatomy/tree";
import { Curve, type V3 } from "../anatomy/curve";
import type { AccessSite, AccessVariant, VGraph, VSeg } from "./types";

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mirrorX = (p: V3): V3 => [-p[0], p[1], p[2]];
const lerp = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
const endOf = (s: VSeg): V3 => s.samples[s.samples.length - 1];
const pointAt = (s: VSeg, mm: number): V3 => {
  const u = Math.min(1, Math.max(0, mm / s.length));
  const i = Math.min(s.samples.length - 2, Math.floor(u * (s.samples.length - 1)));
  return lerp(s.samples[i], s.samples[i + 1], u * (s.samples.length - 1) - i);
};

const segFromCurve = (
  id: string, name: string, parent: string | null, attach: number,
  ctrl: V3[], diam: number, tortuosity: number, calc: number, start?: V3,
): VSeg => {
  const points = start ? [start, ...ctrl.filter((p) => dist(start, p) > 0.25)] : ctrl;
  const c = new Curve(points, 24);
  const samples = c.pts;
  return {
    id, name, parent, attach, length: c.length,
    samples, diameterMm: samples.map(() => diam), tortuosity, calcification: calc,
  };
};

const archCtrl = (v: AccessVariant, thorEnd: V3, sinus: V3): V3[] => {
  const lift = v.arch === "I" ? 0.35 : v.arch === "II" ? 0.65 : 1;
  const mid: V3 = [thorEnd[0] - 14 * lift, thorEnd[1] + 28 + 32 * lift, thorEnd[2] + 16 * lift + v.aorticRootMm * 0.06];
  const peak: V3 = [-sinus[0] * 0.3 - 24 * lift, sinus[1] - 22, sinus[2] + 5];
  return [thorEnd, mid, lerp(peak, sinus, 0.62)];
};

type FemChain = { femR: VSeg; iliacR: VSeg; abd: VSeg; thor: VSeg; arch: VSeg; asc: VSeg; femL: VSeg; iliacL: VSeg };

/** Right femoral → ascending aorta (sinus level); left side is mirrored. */
function buildFemoralChain(v: AccessVariant, sinus: V3): FemChain {
  const puncture: V3 = [82, -500, -12];
  const inguinal: V3 = [48, -395, -6];
  const iliacBif: V3 = [22, -265, 2];
  const renal: V3 = [8, -115, 10];
  const diaphragm: V3 = [2, 12, 11];
  const archBase: V3 = [1, 72, 14];

  const femR = segFromCurve("FEM_R", "Right femoral", null, 0, [puncture, inguinal], 8, 0.06, 0);
  const iliacCalc = v.calcifiedIliac ? 0.72 : 0.12;
  const iliacTort = 0.12 + v.iliacTortuosity * 0.55;
  const iliacR = segFromCurve(
    "ILIAC_R", "Right iliac", "FEM_R", 1,
    [iliacBif, lerp(iliacBif, renal, 0.35)], 7, iliacTort, iliacCalc, endOf(femR),
  );
  const abd = segFromCurve("AORTA_ABD", "Abdominal aorta", "ILIAC_R", 1, [renal, diaphragm], 18, 0.06, 0, endOf(iliacR));
  const thor = segFromCurve("AORTA_THOR", "Thoracic aorta", "AORTA_ABD", 1, [diaphragm, archBase], 22, 0.08, 0, endOf(abd));
  const archTort = v.arch === "I" ? 0.18 : v.arch === "II" ? 0.38 : 0.72;
  const arch = segFromCurve(
    "ARCH", "Aortic arch", "AORTA_THOR", 1,
    archCtrl(v, endOf(thor), sinus), 24, archTort, 0.06, endOf(thor),
  );
  const asc = segFromCurve(
    "AORTA_ASC", "Ascending aorta", "ARCH", 1,
    [endOf(arch), lerp(endOf(arch), sinus, 0.35), sinus], 26, 0.05, 0, endOf(arch),
  );

  const femL = segFromCurve(
    "FEM_L", "Left femoral", null, 0,
    [mirrorX(puncture), mirrorX(inguinal)], 8, 0.06, 0,
  );
  const iliacL = segFromCurve(
    "ILIAC_L", "Left iliac", "FEM_L", 1,
    [mirrorX(iliacBif), mirrorX(lerp(iliacBif, renal, 0.35))], 7, iliacTort, iliacCalc, endOf(femL),
  );
  return { femR, iliacR, abd, thor, arch, asc, femL, iliacL };
}

function buildRadialChain(v: AccessVariant, thor: VSeg): { radialR: VSeg; brach: VSeg; subcl: VSeg; innom: VSeg } {
  const wrist: V3 = [-635, -62, 12];
  const loop: V3 = v.radialLoop ? [-440, 36, 44] : [-485, -8, 24];
  const elbow: V3 = [-320, 62, 11];
  const shoulder: V3 = [-155, 86, 5];
  const attachMm = thor.length * 0.42;
  const innomEnd = pointAt(thor, attachMm);

  const radialR = segFromCurve(
    "RADIAL_R", "Right radial", null, 0,
    [wrist, loop, lerp(wrist, elbow, 0.55), elbow], 2.8, v.radialLoop ? 0.88 : 0.22, 0,
  );
  const brach = segFromCurve(
    "BRACH_R", "Right brachial", "RADIAL_R", 1,
    [elbow, lerp(elbow, shoulder, 0.4), shoulder], 4, 0.16, 0, endOf(radialR),
  );
  const subcl = segFromCurve(
    "SUBCLAV_R", "Right subclavian", "BRACH_R", 1,
    [shoulder, lerp(shoulder, innomEnd, 0.35), lerp(shoulder, innomEnd, 0.7)], 8, 0.22, 0, endOf(brach),
  );
  const innom = segFromCurve(
    "INNOM", "Innominate", "SUBCLAV_R", 1,
    [lerp(shoulder, innomEnd, 0.8), innomEnd], 12, 0.28, 0, endOf(subcl),
  );
  return { radialR, brach, subcl, innom };
}

/** Access vessels from the puncture site to the sinuses; coronaryRoot is [LM ostium, RCA ostium] in the patient frame. */
export function buildAccess(v: AccessVariant, coronaryRoot: V3[]): VGraph {
  const lm = coronaryRoot[0], rca = coronaryRoot[1] ?? lm;
  const sinus = lerp(lm, rca, 0.35);

  const fem = buildFemoralChain(v, sinus);
  const rad = buildRadialChain(v, fem.thor);
  const segs = [
    fem.femR, fem.femL, fem.iliacR, fem.iliacL, fem.abd, fem.thor, fem.arch, fem.asc,
    rad.radialR, rad.brach, rad.subcl, rad.innom,
  ];
  const byId = Object.fromEntries(segs.map((s) => [s.id, s]));
  const asc = fem.asc;
  const lmDist = dist(endOf(asc), lm);
  const rcaDist = dist(endOf(asc), rca);
  const ostiumLmMm = Math.max(0, asc.length - lmDist * 0.35);
  const ostiumRcaMm = Math.max(0, asc.length - rcaDist * 0.4);
  return {
    segs, byId,
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
  const c = g.byId[childId];
  if (!c.parent) return 0;
  const p = g.byId[c.parent];
  if (!p) return Infinity;
  const join = pointAt(p, c.attach * p.length);
  return dist(join, c.samples[0]);
}
