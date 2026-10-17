import { Vec3 } from "../config/ecg";
import { ECG_LINK } from "../config/tree";
import { Tree, rotateHeart, surfaceNormal } from "../anatomy/tree";

/**
 * Where each myocardial bed faces, as the unit outward normal of the epicardium over it, in the ECG frame
 * (x = patient's left, y = toward the feet, z = anterior). Transmural injury current of an ischemic bed
 * flows outward across its wall, so its ST vector points along that normal.
 */
export interface BedSite { key: string; mass: number; dir: Vec3 }

export function bedSites(tree: Tree): BedSite[] {
  const out: BedSite[] = [];
  const add = (key: string, mass: number, u: number, segId: string) => {
    // Transmural injury current crosses the wall, so it points along the outward epicardial normal of the bed.
    const p = rotateHeart(surfaceNormal(tree.byId[segId].curve.at(u)));
    const e: Vec3 = [p[0], -p[1], p[2]]; // render frame has y up; the ECG frame has y down
    const n = Math.hypot(e[0], e[1], e[2]) || 1;
    out.push({ key, mass, dir: [e[0] / n, e[1] / n, e[2] / n] });
  };
  for (const seg of tree.segments) {
    seg.taps.forEach((t, k) => add(`${seg.id}#${k}`, t.mass, t.pos, seg.id));
    if (seg.endMass > 0) add(`${seg.id}#end`, seg.endMass, 1, seg.id);
  }
  return out;
}

/** How far through the wall a bed's ischemia reaches (0 subendocardial … 1 transmural), from its supply/demand ratio. */
export function transmurality(supplyRatio: number): number {
  const { subendocardialAbove: hi, transmuralBelow: lo } = ECG_LINK;
  const x = Math.min(1, Math.max(0, (hi - supplyRatio) / (hi - lo)));
  return x * x * (3 - 2 * x); // smooth: depression gives way to elevation as flow falls
}

/**
 * ST injury vector (mV). Each ischemic bed (severity × mass) contributes along its outward wall normal in proportion
 * to how transmural it is, and to the single non-localizing subendocardial vector for the rest. Without `transmural`
 * every bed is treated as transmural (the original model, still used to pick the game's daily cases).
 */
export function injuryVector(sites: BedSite[], severity: Record<string, number>, transmural?: Record<string, number>): Vec3 {
  const v: [number, number, number] = [0, 0, 0], d = ECG_LINK.subendocardialDir;
  for (const s of sites) {
    const w = (severity[s.key] ?? 0) * s.mass;
    if (!w) continue;
    const tm = transmural ? transmural[s.key] ?? 1 : 1;
    const k = w * tm * ECG_LINK.gainMv, ks = w * (1 - tm) * ECG_LINK.subendocardialGainMv;
    v[0] += s.dir[0] * k + d[0] * ks; v[1] += s.dir[1] * k + d[1] * ks; v[2] += s.dir[2] * k + d[2] * ks;
  }
  return v;
}

/** Ischemic burden: myocardial mass weighted by severity (0..1 of the whole heart). */
export const ischemicBurden = (sites: BedSite[], severity: Record<string, number>) =>
  sites.reduce((a, s) => a + (severity[s.key] ?? 0) * s.mass, 0);

/** Whole-heart severity used for rate, ectopy and T-wave change: saturates at a large-territory infarct. */
export const globalSeverity = (burden: number) => Math.min(1, burden / ECG_LINK.burdenForFullEffect);

/** Pairs of anatomically contiguous leads, for the ST-elevation criterion. */
const CONTIGUOUS: [string, string][] = [
  ["II", "III"], ["III", "aVF"], ["II", "aVF"], // inferior
  ["I", "aVL"], ["V5", "V6"], ["I", "V6"], // lateral
  ["V1", "V2"], ["V2", "V3"], ["V3", "V4"], ["V4", "V5"], // septal and anterior
  ["V7", "V8"], ["V8", "V9"], // posterior
];
/**
 * ST-elevation infarction criterion: elevation in two contiguous leads, at least 1 mm (0.5 mm in V7–V9, whose
 * voltages are smaller). aVR is not part of it: its elevation with diffuse depression is a separate pattern.
 */
export function meetsStElevation(stMm: Record<string, number>): boolean {
  const ok = (l: string) => (stMm[l] ?? 0) >= (l.startsWith("V7") || l === "V8" || l === "V9" ? 0.5 : 1);
  return CONTIGUOUS.some(([a, b]) => ok(a) && ok(b));
}
