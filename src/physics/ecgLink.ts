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

/** ST injury vector (mV): sum over beds of severity × mass × direction, scaled by a single gain. */
export function injuryVector(sites: BedSite[], severity: Record<string, number>): Vec3 {
  const v: [number, number, number] = [0, 0, 0];
  for (const s of sites) {
    const k = (severity[s.key] ?? 0) * s.mass * ECG_LINK.gainMv;
    v[0] += s.dir[0] * k; v[1] += s.dir[1] * k; v[2] += s.dir[2] * k;
  }
  return v;
}

/** Ischemic burden: myocardial mass weighted by severity (0..1 of the whole heart). */
export const ischemicBurden = (sites: BedSite[], severity: Record<string, number>) =>
  sites.reduce((a, s) => a + (severity[s.key] ?? 0) * s.mass, 0);

/** Whole-heart severity used for rate, ectopy and T-wave change: saturates at a large-territory infarct. */
export const globalSeverity = (burden: number) => Math.min(1, burden / ECG_LINK.burdenForFullEffect);
