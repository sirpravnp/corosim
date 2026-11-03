import { ISCHEMIA, type VentricleFactors } from "../config/ischemia";
import type { BedSite } from "./ecgLink";
import { isRightVentricular } from "./circulation";

const isNodal = (key: string) => /^(SAN|AVN)#/.test(key);

/**
 * One myocardial bed as a contractile segment of a ventricle (E3). `injury` is the worse of live ischemia and scar
 * (0..1); `weight` is the bed's share of that ventricle's mass (weights of one ventricle sum to 1 after normalisation).
 */
export interface RegionalSegment {
  key: string;
  weight: number;
  injury: number;
}

/** LV and RV beds as regional segments, plus the mass-weighted ischemic fractions and the A7 stiffness factors. */
export interface RegionalVentricles {
  lv: RegionalSegment[];
  rv: RegionalSegment[];
  /** Severity-weighted ischemic (or scarred) fraction of each ventricle, same definition as `circulation()`. */
  lvIschemia: number;
  rvIschemia: number;
  /** Passive-stiffness factors for `LiveHeart.setVentricleFactors` (Ees is owned by the segment law when regional is on). */
  stiffness: Pick<VentricleFactors, "lvStiffness" | "rvStiffness">;
}

/**
 * Core-native map from coronary beds → ventricular segments (E3). Does not call `circulation()`: the ischemic fractions
 * are the mass-weighted injury of LV and RV beds (nodal beds skipped), matching what `circulation()` used to feed
 * `ischemiaFactors` / `setVentricleFactors`.
 */
export function regionalVentricles(
  sites: readonly BedSite[],
  sev: Record<string, number>,
  scar: Record<string, number> = {},
): RegionalVentricles {
  const lv: RegionalSegment[] = [], rv: RegionalSegment[] = [];
  let lvMass = 0, lvIsch = 0, rvMass = 0, rvIsch = 0;
  for (const s of sites) {
    if (isNodal(s.key)) continue;
    const injury = Math.min(1, Math.max(0, Math.max(sev[s.key] ?? 0, scar[s.key] ?? 0)));
    const seg = { key: s.key, weight: s.mass, injury };
    if (isRightVentricular(s.key)) { rv.push(seg); rvMass += s.mass; rvIsch += injury * s.mass; }
    else { lv.push(seg); lvMass += s.mass; lvIsch += injury * s.mass; }
  }
  const norm = (segs: RegionalSegment[], mass: number) => {
    if (!(mass > 0)) return segs.map((s) => ({ ...s, weight: 0 }));
    return segs.map((s) => ({ ...s, weight: s.weight / mass }));
  };
  const lvIschemia = lvMass ? lvIsch / lvMass : 0, rvIschemia = rvMass ? rvIsch / rvMass : 0;
  const K = ISCHEMIA;
  return {
    lv: norm(lv, lvMass), rv: norm(rv, rvMass), lvIschemia, rvIschemia,
    stiffness: { lvStiffness: 1 + K.lvStiffGain * lvIschemia, rvStiffness: 1 + K.rvStiffGain * rvIschemia },
  };
}

/**
 * Active-elastance scale of a ventricle from its segments: max(eesFloor, Σ w·(1 − eesLoss·injury)).
 * Matches `ischemiaFactors` when injury is uniform, and when it is regional with the same mass-weighted mean
 * (the sum is linear in injury until the floor).
 */
export function regionalActiveScale(segs: readonly RegionalSegment[], eesLoss: number, eesFloor: number): number {
  let s = 0;
  for (const seg of segs) s += seg.weight * (1 - eesLoss * seg.injury);
  return Math.max(eesFloor, s);
}

/** Dead volume (ml) from dyskinetic bulge: bulgeMl · Σ w·injury. */
export function regionalDeadVolume(segs: readonly RegionalSegment[], bulgeMl: number): number {
  let s = 0;
  for (const seg of segs) s += seg.weight * seg.injury;
  return Math.max(0, bulgeMl) * s;
}
