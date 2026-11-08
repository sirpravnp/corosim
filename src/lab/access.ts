import { buildTree, type Tree } from "../anatomy/tree";
import { Curve, type V3 } from "../anatomy/curve";
import type { AccessSite, AccessVariant, VGraph, VSeg } from "./types";

const L = {
  femoral: 480,
  iliac: 120,
  aortaAbd: 200,
  aortaThor: 180,
  arch: 150,
  aortaAsc: 80,
  radial: 220,
  brachial: 280,
  subclavian: 60,
} as const;

const segFromCurve = (
  id: string, name: string, parent: string | null, attach: number, ctrl: V3[], diam: number,
  tortuosity: number, calc: number,
): VSeg => {
  const c = new Curve(ctrl, 20);
  const n = c.pts.length;
  const samples = c.pts;
  const diameterMm = samples.map(() => diam);
  const length = c.length;
  return { id, name, parent, attach, length, samples, diameterMm, tortuosity, calcification: calc };
};

const archCtrl = (v: AccessVariant): V3[] => {
  const bend = v.arch === "I" ? 0.1 : v.arch === "II" ? 0.45 : 1.1;
  return [
    [0, 0, 0],
    [-25 + bend * 10, 35, 10 + bend * 5],
    [-55, 70 + bend * 55, 35 + bend * 20],
    [-25, 43, -10],
  ];
};

/** Access vessels from the puncture site to the sinuses; coronaryRoot is [LM ostium, RCA ostium] in the patient frame. */
export function buildAccess(v: AccessVariant, coronaryRoot: V3[]): VGraph {
  const lm = coronaryRoot[0], rca = coronaryRoot[1] ?? lm;
  const femStart: V3 = [85, -520, -5];
  const femEnd: V3 = [40, -380, 0];
  const iliacEnd: V3 = [15, -200, 5];
  const abdEnd: V3 = [5, -20, 10];
  const thorEnd: V3 = [0, 60, 12];
  const archEnd = lm;
  const iliacTort = 0.1 + v.iliacTortuosity * 0.5;
  const iliacCalc = v.calcifiedIliac ? 0.7 : 0.1;
  const archTort = v.arch === "I" ? 0.15 : v.arch === "II" ? 0.35 : 0.7;

  const femR = segFromCurve("FEM_R", "Right femoral", null, 0, [femStart, femEnd], 8, 0.05, 0);
  const femL = segFromCurve("FEM_L", "Left femoral", null, 0, [[-femStart[0], femStart[1], femStart[2]], [-femEnd[0], femEnd[1], femEnd[2]]], 8, 0.05, 0);
  const iliacR = segFromCurve("ILIAC_R", "Right iliac", "FEM_R", 1, [femEnd, iliacEnd], 7, iliacTort, iliacCalc);
  const iliacL = segFromCurve("ILIAC_L", "Left iliac", "FEM_L", 1, [[-femEnd[0], femEnd[1], femEnd[2]], [-iliacEnd[0], iliacEnd[1], iliacEnd[2]]], 7, iliacTort, iliacCalc);
  const abd = segFromCurve("AORTA_ABD", "Abdominal aorta", "ILIAC_R", 1, [iliacEnd, abdEnd], 18, 0.05, 0);
  const thor = segFromCurve("AORTA_THOR", "Thoracic aorta", "AORTA_ABD", 1, [abdEnd, thorEnd], 22, 0.08, 0);
  const arch = segFromCurve("ARCH", "Aortic arch", "AORTA_THOR", 1, archCtrl(v), 24, archTort, 0.05);
  const asc = segFromCurve("AORTA_ASC", "Ascending aorta", "ARCH", 1, [thorEnd, archEnd], 26, 0.05, 0);

  const radStart: V3 = [-220, -15, 8];
  const radLoop: V3 = v.radialLoop ? [-180, 10, 30] : [-200, 5, 15];
  const radEnd: V3 = [-60, 35, 5];
  const radial = segFromCurve("RADIAL_R", "Right radial", null, 0, [radStart, radLoop, radEnd], 2.8, v.radialLoop ? 0.9 : 0.2, 0);
  const brach = segFromCurve("BRACH_R", "Right brachial", "RADIAL_R", 1, [radEnd, [-40, 40, 0]], 4, 0.15, 0);
  const subcl = segFromCurve("SUBCLAV_R", "Right subclavian", "BRACH_R", 1, [[-40, 40, 0], [-20, 55, 8]], 8, 0.2, 0);
  const innom = segFromCurve("INNOM", "Innominate", "SUBCLAV_R", 1, [[-20, 55, 8], thorEnd], 12, 0.25, 0);

  const segs = [femR, femL, iliacR, iliacL, abd, thor, arch, asc, radial, brach, subcl, innom];
  const byId = Object.fromEntries(segs.map((s) => [s.id, s]));
  return {
    segs,
    byId,
    ostium: { LM: { segId: "AORTA_ASC", mm: asc.length }, RCA: { segId: "AORTA_ASC", mm: Math.max(0, asc.length - 8) } },
  };
}

/** Attach the coronary tree; coronary ids match the anatomy tree. */
export function unify(access: VGraph, tree: Tree): VGraph {
  const segs = [...access.segs];
  const byId: Record<string, VSeg> = { ...access.byId };
  for (const s of tree.segments) {
    const attach = s.parent ? s.attach : 1;
    const parent = s.parent ?? "AORTA_ASC";
    const diam = s.samples.map(() => 3.2);
    segs.push({
      id: s.id,
      name: s.name,
      parent,
      attach,
      length: s.length,
      samples: s.samples,
      diameterMm: diam,
      tortuosity: 0.05,
      calcification: 0,
    });
    byId[s.id] = segs[segs.length - 1];
  }
  const lm = tree.byId.LM, rca = tree.byId.RCA;
  return {
    segs,
    byId,
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
