import { FLOW, HEART, MASS, TAPS } from "../config/tree";
import { Curve, V3, norm } from "./curve";

export type Dominance = "right" | "co" | "left";
export type LmPattern = "bifurcation" | "trifurcation" | "absent";
export interface Variant {
  dominance: Dominance;
  lm: LmPattern; // trifurcation adds a ramus intermedius; absent = separate LAD/LCx ostia
  saNodeFrom: "RCA" | "LCx";
  conusOstium: "shared" | "separate";
  ladCourse: "normal" | "short" | "wrap";
}
export const TYPICAL: Variant = { dominance: "right", lm: "bifurcation", saNodeFrom: "RCA", conusOstium: "shared", ladCourse: "normal" };

type Wp = { l: number; p: number; h?: number } | { pt: V3 };
interface Def {
  id: string; name: string; group: "LAD" | "LCx" | "RCA"; parent: string | null; attach: number;
  path: Wp[]; endMass: number; startPt?: V3;
}
export interface Segment {
  id: string; name: string; group: "LAD" | "LCx" | "RCA"; parent: string | null; attach: number;
  endMass: number; // mass fed at the vessel's distal end
  taps: { pos: number; mass: number }[]; // small unrendered branches along the vessel (fractions of length)
  subMass: number; children: string[];
  length: number; // mm
  samples: V3[]; // patient-frame points, uniform arc length (N+1)
  heartSamples: V3[]; // heart-frame points (for surface checks)
  curve: Curve; // heart-frame curve
}
export interface Tree { variant: Variant; segments: Segment[]; byId: Record<string, Segment>; totalMass: number }

const { a: A, b: B, c: C } = HEART.radii;
const surf = (l: number, p: number, h = HEART.vesselHeight): V3 => {
  const x = A * Math.cos(p) * Math.sin(l), y = B * Math.sin(p), z = C * Math.cos(p) * Math.cos(l);
  const n = norm([x / (A * A), y / (B * B), z / (C * C)]);
  return [x + n[0] * h, y + n[1] * h, z + n[2] * h];
};
const toPt = (w: Wp): V3 => ("pt" in w ? w.pt : surf(w.l, w.p, w.h));
/** Rotate a heart-frame vector into the patient (render) frame: apex tilted left and anterior. */
export function rotateHeart(v: V3): V3 {
  const cz = Math.cos(HEART.rotateZ), sz = Math.sin(HEART.rotateZ), cx = Math.cos(HEART.rotateX), sx = Math.sin(HEART.rotateX);
  const x1 = v[0] * cz - v[1] * sz, y1 = v[0] * sz + v[1] * cz, z1 = v[2];
  return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
}
export const toPatient = (v: V3): V3 => rotateHeart(v);
/** Outward epicardial normal at a heart-frame point (ellipsoid gradient). */
export const surfaceNormal = (v: V3): V3 => norm([v[0] / (A * A), v[1] / (B * B), v[2] / (C * C)]);
const W = (l: number, p: number, h?: number): Wp => ({ l, p, h });
const PI = Math.PI;

function definitions(v: Variant): Def[] {
  const M = MASS, d: Def[] = [];
  const ramus = v.lm === "trifurcation";
  const lad = M.lad + (v.ladCourse === "short" ? -M.ladShortShift : v.ladCourse === "wrap" ? M.ladWrapShift : 0);
  const pdaShift = v.ladCourse === "short" ? M.ladShortShift : v.ladCourse === "wrap" ? -M.ladWrapShift : 0;
  const pda = M.pda + pdaShift;
  const leftOrigin = v.lm === "absent" ? null : "LM";

  // ---- left system ----
  if (v.lm !== "absent") d.push({ id: "LM", name: "Left main", group: "LAD", parent: null, attach: 0, endMass: 0, startPt: [3, 52, 10], path: [W(0.5, 0.8)] });
  const ladPath: Wp[] = [W(0.42, 0.55), W(0.32, 0.2), W(0.22, -0.2), W(0.14, -0.6)];
  if (v.ladCourse === "short") ladPath.push(W(0.1, -0.85));
  else { ladPath.push(W(0.06, -1.0), W(0.0, -1.32)); if (v.ladCourse === "wrap") ladPath.push(W(0, -1.55), W(PI, -1.5), W(PI, -1.15)); }
  d.push({ id: "LAD", name: "LAD", group: "LAD", parent: leftOrigin, attach: 1, endMass: lad, startPt: v.lm === "absent" ? [4, 52, 12] : undefined, path: v.lm === "absent" ? [W(0.5, 0.8), ...ladPath] : ladPath });
  d.push({ id: "D1", name: "Diagonal 1", group: "LAD", parent: "LAD", attach: 0.24, endMass: M.d1 - (ramus ? M.ramusFromD1 : 0), path: [W(0.85, 0.3), W(1.0, 0.05), W(1.08, -0.15)] });
  d.push({ id: "D2", name: "Diagonal 2", group: "LAD", parent: "LAD", attach: 0.52, endMass: M.d2, path: [W(0.85, -0.1), W(1.0, -0.35), W(1.08, -0.55)] });
  if (ramus) d.push({ id: "RAMUS", name: "Ramus intermedius", group: "LCx", parent: "LM", attach: 1, endMass: M.ramus, path: [W(0.7, 0.78), W(0.95, 0.4), W(1.0, -0.1), W(1.05, -0.4)] });

  const cxEnd: Wp[] = v.dominance === "right" ? [W(2.1, 0.88), W(2.45, 0.84)] : v.dominance === "co" ? [W(2.2, 0.88), W(2.6, 0.8), W(2.85, 0.7)] : [W(2.2, 0.88), W(2.6, 0.8), W(2.95, 0.65), W(3.12, 0.5)];
  const cxStart: Wp[] = [W(0.8, 0.82), W(1.2, 0.86), W(1.7, 0.9)];
  d.push({ id: "LCX", name: "Circumflex", group: "LCx", parent: leftOrigin, attach: 1, endMass: M.lcxEnd - (v.dominance === "left" ? M.avnode : 0), startPt: v.lm === "absent" ? [4, 51, 6] : undefined, path: v.lm === "absent" ? [W(0.5, 0.8), ...cxStart, ...cxEnd] : [...cxStart, ...cxEnd] });
  d.push({ id: "OM1", name: "Obtuse marginal 1", group: "LCx", parent: "LCX", attach: 0.35, endMass: M.om1 - (ramus ? M.ramusFromOM1 : 0), path: [W(1.45, 0.6), W(1.58, 0.2), W(1.65, -0.15)] });
  d.push({ id: "OM2", name: "Obtuse marginal 2", group: "LCx", parent: "LCX", attach: 0.62, endMass: M.om2, path: [W(2.0, 0.6), W(2.12, 0.2), W(2.2, -0.15)] });
  if (v.dominance !== "right") d.push({ id: "PLV_L", name: "Posterolateral (from LCx)", group: "LCx", parent: "LCX", attach: 0.92, endMass: M.plv, path: [W(2.8, 0.35), W(2.85, 0.0), W(2.9, -0.35)] });
  if (v.dominance === "left") d.push({ id: "PDA_L", name: "PDA (from LCx)", group: "LCx", parent: "LCX", attach: 1, endMass: pda, path: [W(3.1, 0.35), W(3.14, -0.1), W(3.14, -0.6), W(3.1, -0.95)] });
  if (v.saNodeFrom === "LCx") d.push({ id: "SAN", name: "SA-node artery", group: "LCx", parent: "LCX", attach: 0.2, endMass: M.sanode, path: [W(0.8, 1.1), W(0.4, 1.3)] });
  if (v.dominance === "left") d.push({ id: "AVN", name: "AV-node artery", group: "LCx", parent: "LCX", attach: 0.97, endMass: M.avnode, path: [W(3.14, 0.62), W(3.14, 0.74)] });

  // ---- right system ----
  const rcaPath: Wp[] = [W(-0.45, 0.82), W(-0.9, 0.86), W(-1.5, 0.86)];
  if (v.dominance !== "left") rcaPath.push(W(-2.1, 0.86), W(-2.65, 0.78), W(-3.05, 0.6), W(-3.14, 0.5));
  else rcaPath.push(W(-1.9, 0.86));
  d.push({ id: "RCA", name: "RCA", group: "RCA", parent: null, attach: 0, endMass: M.rcaEnd - (v.dominance !== "left" ? M.avnode : 0), startPt: [-4, 52, 12], path: rcaPath });
  d.push({ id: "AM", name: "Acute marginal", group: "RCA", parent: "RCA", attach: 0.55, endMass: M.acuteMarginal, path: [W(-1.4, 0.5), W(-1.45, 0.1), W(-1.5, -0.25)] });
  d.push(v.conusOstium === "separate"
    ? { id: "CONUS", name: "Conus (separate ostium)", group: "RCA", parent: null, attach: 0, endMass: M.conus, startPt: [-1, 50, 18], path: [W(-0.2, 0.9), W(0.0, 0.72), W(0.1, 0.6)] }
    : { id: "CONUS", name: "Conus branch", group: "RCA", parent: "RCA", attach: 0.06, endMass: M.conus, path: [W(-0.4, 0.9), W(-0.1, 0.78), W(0.05, 0.65)] });
  if (v.saNodeFrom === "RCA") d.push({ id: "SAN", name: "SA-node artery", group: "RCA", parent: "RCA", attach: 0.1, endMass: M.sanode, path: [W(-0.5, 1.1), W(-0.2, 1.3)] });
  if (v.dominance !== "left") d.push({ id: "AVN", name: "AV-node artery", group: "RCA", parent: "RCA", attach: 0.97, endMass: M.avnode, path: [W(-3.14, 0.62), W(-3.14, 0.74)] });
  if (v.dominance !== "left") d.push({ id: "PDA_R", name: "PDA (from RCA)", group: "RCA", parent: "RCA", attach: 1, endMass: pda, path: [W(-3.1, 0.35), W(-3.14, -0.1), W(-3.14, -0.6), W(-3.1, -0.95)] });
  if (v.dominance === "right") d.push({ id: "PLV_R", name: "Posterolateral (from RCA)", group: "RCA", parent: "RCA", attach: 1, endMass: M.plv, path: [W(-3.3, 0.35), W(-3.42, -0.05), W(-3.48, -0.4)] });
  return d;
}

const N_SAMPLES = 240;
export function buildTree(variant: Variant = TYPICAL): Tree {
  const defs = definitions(variant);
  const byId: Record<string, Segment> = {};
  const segments: Segment[] = [];
  for (const def of defs) {
    const parent = def.parent ? byId[def.parent] : null;
    const first: V3 = def.startPt ?? parent!.curve.at(def.attach);
    const rest = def.path.map(toPt);
    const ctrl = def.startPt && !def.parent ? [def.startPt, ...rest] : [first, ...rest];
    const curve = new Curve(ctrl);
    const heartSamples: V3[] = [], samples: V3[] = [];
    for (let i = 0; i <= N_SAMPLES; i++) { const p = curve.at(i / N_SAMPLES); heartSamples.push(p); samples.push(toPatient(p)); }
    const tp = TAPS[def.id], taps: { pos: number; mass: number }[] = [];
    let endMass = def.endMass;
    if (tp && def.endMass > 0) {
      const each = (def.endMass * tp.frac) / tp.n;
      for (let k = 0; k < tp.n; k++) taps.push({ pos: 0.2 + (0.65 * (k + 0.5)) / tp.n, mass: each });
      endMass = def.endMass * (1 - tp.frac);
    }
    const seg: Segment = { id: def.id, name: def.name, group: def.group, parent: def.parent, attach: def.attach, endMass, taps, subMass: 0, children: [], length: curve.length, samples, heartSamples, curve };
    byId[def.id] = seg; segments.push(seg);
    if (parent) parent.children.push(def.id);
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    s.subMass = s.endMass + s.taps.reduce((a, t) => a + t.mass, 0) + s.children.reduce((a, c) => a + byId[c].subMass, 0);
  }
  const totalMass = segments.filter((s) => !s.parent).reduce((a, s) => a + s.subMass, 0);
  return { variant, segments, byId, totalMass };
}

// ---- flow-derived diameters (Huo–Kassab 7/3 law) ----
const K = FLOW.lmReferenceDiameter / Math.pow(FLOW.lmReferenceMass * FLOW.totalRestingFlow, 1 / FLOW.diameterExponent);
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/** Resting flow (m3/s) carried at distance s (mm) along a segment, after the branches already taken off. */
export function restFlowAt(tree: Tree, seg: Segment, s: number): number {
  let m = seg.endMass;
  for (const cid of seg.children) {
    const c = tree.byId[cid], sb = c.attach * seg.length;
    m += c.subMass * (1 - smooth((s - (sb - FLOW.branchSmoothing)) / (2 * FLOW.branchSmoothing)));
  }
  for (const t of seg.taps) m += t.mass * (1 - smooth((s - (t.pos * seg.length - FLOW.branchSmoothing)) / (2 * FLOW.branchSmoothing)));
  return m * FLOW.totalRestingFlow;
}
/** Healthy lumen diameter (m) at distance s (mm) along a segment. */
export const diameterAt = (tree: Tree, seg: Segment, s: number) =>
  Math.max(FLOW.minDiameter, K * Math.pow(restFlowAt(tree, seg, s), 1 / FLOW.diameterExponent));
