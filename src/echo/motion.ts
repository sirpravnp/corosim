import { V3 } from "../anatomy/curve";
import { septalDistance } from "../anatomy/heartSurface";
import { LV, LV_LENGTH, LvPoint, lvEpiRadius, lvFrame, lvPoint } from "./anatomy";

/**
 * How the heart moves through one beat, as a warp from where a point is now to where it sits in the end-diastolic reference heart.
 * The tissue classifier only knows the reference heart; every frame asks it about `warp(p)` instead of `p`. The warp's output is also
 * the point's material coordinate, so the speckle drawn there stays on the same piece of muscle as it moves, as real speckle does.
 *
 * What moves, and how:
 * - The base descends toward an apex that stays put (longitudinal shortening), and the atria and roots above it follow the base down.
 * - Each LV segment pulls its endocardium in by a share `k` of the global shortening `s` (`k` = 1 normal, 0.5 hypokinetic, 0 akinetic,
 *   negative dyskinetic). Myocardium keeps its volume, so a wall that shortens thickens: the map between the endocardium and the
 *   epicardium conserves area per unit length, corrected for the base's descent.
 * - The right ventricle's free wall moves toward the septum by its own share of the right ventricle's volume change.
 * `s` is solved per frame so that the cavity's volume, integrated over this geometry, falls by the same fraction as the engine's LV
 * volume. The echo's EF is then the patient's EF, whatever the wall-motion pattern.
 *
 * All lengths here are in LV units: the reference LV of anatomy.ts scaled by `lvScale` about `LV_SCALE_CENTER` (see tissue.ts).
 */

/** The 17-segment model (AHA), in order: six basal, six mid, four apical, then the apical cap. */
export const SEGMENTS = [
  "Basal anterior", "Basal anteroseptal", "Basal inferoseptal", "Basal inferior", "Basal inferolateral", "Basal anterolateral",
  "Mid anterior", "Mid anteroseptal", "Mid inferoseptal", "Mid inferior", "Mid inferolateral", "Mid anterolateral",
  "Apical anterior", "Apical septal", "Apical inferior", "Apical lateral", "Apex",
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Coronary territories in the usual (right-dominant) distribution: which segments each artery supplies. */
export const TERRITORY: Record<"LAD" | "LCX" | "RCA", number[]> = {
  LAD: [0, 1, 6, 7, 12, 13, 16],
  LCX: [4, 5, 10, 11, 15],
  RCA: [2, 3, 8, 9, 14],
};

/**
 * Angles in the LV short axis, degrees, measured from the lateral direction (E1) toward anterior (E2): lateral 0, anterior 90, septal 180,
 * inferior -90. Basal and mid rings have six segments centered on these; the apical ring has four.
 */
const RING6 = [90, 150, -150, -90, -30, 30];
const RING4 = [90, 180, -90, 0];
/** Where each ring sits along the LV, as a fraction of its length from the apex. */
const LEVEL = { apex: 0.04, apical: 0.24, mid: 0.52, basal: 0.8 };

const wrap = (a: number) => ((a + 540) % 360) - 180;

/** Contraction share at one angle of a ring: linear between neighboring segment centers. */
function ringValue(centers: number[], values: number[], ang: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < centers.length; i++) { const d = Math.abs(wrap(ang - centers[i])); if (d < bestD) { bestD = d; best = i; } }
  const c = centers[best], side = wrap(ang - c) >= 0 ? 1 : -1;
  let other = -1, otherD = Infinity;
  for (let i = 0; i < centers.length; i++) {
    if (i === best) continue;
    const d = wrap(centers[i] - c) * side;
    if (d > 0 && d < otherD) { otherD = d; other = i; }
  }
  const w = Math.min(1, Math.abs(wrap(ang - c)) / otherD);
  return values[best] * (1 - w) + values[other] * w;
}

/** A 17-entry contraction share, as a smooth function of position: (fraction along the LV from the apex, angle in degrees). */
export function contraction(k: ArrayLike<number>, tau: number, ang: number): number {
  const basal = ringValue(RING6, [k[0], k[1], k[2], k[3], k[4], k[5]], ang);
  const mid = ringValue(RING6, [k[6], k[7], k[8], k[9], k[10], k[11]], ang);
  const apical = ringValue(RING4, [k[12], k[13], k[14], k[15]], ang);
  if (tau >= LEVEL.basal) return basal;
  if (tau >= LEVEL.mid) { const w = (tau - LEVEL.mid) / (LEVEL.basal - LEVEL.mid); return mid * (1 - w) + basal * w; }
  if (tau >= LEVEL.apical) { const w = (tau - LEVEL.apical) / (LEVEL.mid - LEVEL.apical); return apical * (1 - w) + mid * w; }
  if (tau >= LEVEL.apex) { const w = (tau - LEVEL.apex) / (LEVEL.apical - LEVEL.apex); return k[16] * (1 - w) + apical * w; }
  return k[16];
}

/** Which of the 17 segments a point of the LV belongs to. */
export function segmentAt(tau: number, ang: number): number {
  const nearest = (centers: number[]) => { let b = 0, bd = Infinity; centers.forEach((c, i) => { const d = Math.abs(wrap(ang - c)); if (d < bd) { bd = d; b = i; } }); return b; };
  if (tau < 0.1) return 16;
  if (tau < 0.38) return 12 + nearest(RING4);
  if (tau < 0.66) return 6 + nearest(RING6);
  return nearest(RING6);
}

const NT = 28, NA = 36;
/** A per-patient grid of contraction shares over the LV (rows: fraction of length; columns: angle), and the reference cavity radius per row. */
export interface ContractionMap { k: Float32Array; rc: Float32Array; kBase: number }

/** Precompute the grid once per patient: it does not change through the beat. `wallLv` is the diastolic wall in LV units. */
export function contractionMap(k: ArrayLike<number>, wallLv: number): ContractionMap {
  const grid = new Float32Array(NT * NA), rc = new Float32Array(NT);
  for (let i = 0; i < NT; i++) {
    const tau = (i + 0.5) / NT;
    rc[i] = Math.max(0, lvEpiRadius(tau * LV_LENGTH) - wallLv);
    for (let j = 0; j < NA; j++) grid[i * NA + j] = contraction(k, tau, -180 + (360 * (j + 0.5)) / NA);
  }
  // the base's descent comes from the longitudinal fibers of the whole ring: mean share of the basal and mid segments
  let kBase = 0; for (let i = 0; i < 12; i++) kBase += k[i]; kBase /= 12;
  return { k: grid, rc, kBase };
}

/** Longitudinal shortening (fraction of LV length) that goes with radial shortening `s`: about 15 % when `s` is a normal 0.33. */
export const longShortening = (s: number, m: ContractionMap) => 0.45 * s * Math.max(0, m.kBase);

/** Cavity volume at shortening `s`, as a fraction of its end-diastolic volume, on this geometry. */
export function volumeRatio(s: number, m: ContractionMap): number {
  let num = 0, den = 0;
  for (let i = 0; i < NT; i++) {
    const r2 = m.rc[i] * m.rc[i];
    for (let j = 0; j < NA; j++) { const g = Math.max(0, 1 - m.k[i * NA + j] * s); num += r2 * g * g; den += r2; }
  }
  return den > 0 ? (num / den) * (1 - longShortening(s, m)) : 1;
}

/** The shortening `s` whose cavity volume is `ratio` of end-diastole (bisection; the volume falls as `s` grows). */
export function solveShortening(ratio: number, m: ContractionMap): number {
  let lo = -0.8, hi = 0.97;
  if (volumeRatio(hi, m) > ratio) return hi;
  if (volumeRatio(lo, m) < ratio) return lo;
  for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (volumeRatio(mid, m) > ratio) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** The moving part of one frame. */
export interface FrameMotion {
  /** LV radial shortening of a normal segment, and the base's descent as a fraction of LV length. */
  s: number; long: number;
  /** Right ventricular free wall: the fraction of its distance from the septum it has moved in by. */
  rv: number;
}

export const STILL: FrameMotion = { s: 0, long: 0, rv: 0 };

const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lp: LvPoint = { t: 0, x: 0, y: 0 };
const SEPT = [septalDistance([1, 0, 0]) - septalDistance([0, 0, 0]), 0, septalDistance([0, 0, 1]) - septalDistance([0, 0, 0])];

/** How far above the base the atria still follow its descent, LV units. */
const ATRIAL_FOLLOW = 45;
/** How far outside the epicardium the LV's motion still drags its surroundings, LV units. */
const DRAG = 22;

/**
 * Where point `q` (LV units, heart frame) sat at end-diastole. `out` receives the reference point; `q` is not changed.
 * Identity when the frame does not move.
 */
/** The LV's static shape for the warp: the contraction grid and the diastolic wall, lateral and septal, in LV units. */
export interface WarpShape { map: ContractionMap; wall: number; septum: number }

export function warp(q: V3, f: FrameMotion, shape: WarpShape, out: V3): V3 {
  const m = shape.map;
  out[0] = q[0]; out[1] = q[1]; out[2] = q[2];
  if (f.s === 0 && f.long === 0 && f.rv === 0) return out;
  lvFrame(q, lp);
  const L = LV_LENGTH, Lnow = L * (1 - f.long);
  // longitudinal: stretch the ventricles back to their diastolic length; carry the atria back up with the base
  let t = lp.t;
  if (t <= Lnow) t = t / (1 - f.long);
  else t = t + L * f.long * (1 - smooth((t - Lnow) / ATRIAL_FOLLOW));
  // radial: only along the ventricles, fading out across the valve plane
  const tau = t / L, along = 1 - smooth((tau - 0.9) / 0.15);
  let x = lp.x, y = lp.y;
  const r = Math.hypot(x, y);
  if (along > 0 && r > 1e-6 && tau > -0.15) {
    const ti = Math.min(NT - 1, Math.max(0, Math.floor(Math.max(0, tau) * NT)));
    const ang = (Math.atan2(y, x) * 180) / Math.PI;
    const aj = Math.min(NA - 1, Math.max(0, Math.floor(((ang + 180) / 360) * NA)));
    const k = m.k[ti * NA + aj], rcEd = m.rc[ti], g = Math.max(0.03, 1 - k * f.s), rc = rcEd * g;
    const reEd = rcEd + wallAt(ang, tau, shape.wall, shape.septum), cons = 1 - f.long;
    const reNow = Math.sqrt(rc * rc + (reEd * reEd - rcEd * rcEd) / cons);
    let rRef: number;
    if (r <= rc) rRef = r / g;
    else if (r <= reNow) rRef = Math.sqrt(rcEd * rcEd + (r * r - rc * rc) * cons);
    else rRef = r + (reEd - reNow) * (1 - smooth((r - reNow) / DRAG));
    const kk = 1 + (rRef / r - 1) * along;
    x *= kk; y *= kk;
  }
  lvPoint(t, x, y, out);
  // right ventricle: the free wall moves toward the septum (the septal plane is fixed), fading out beyond the free wall and above the base
  if (f.rv !== 0) {
    const sd = septalDistance(out);
    if (sd < 0) {
      const reach = 1 - smooth((-sd - 34) / 20), base = 1 - smooth((tau - 0.92) / 0.12);
      const shift = -sd * (1 / (1 - f.rv) - 1) * reach * base;
      out[0] -= SEPT[0] * shift; out[2] -= SEPT[2] * shift;
    }
  }
  return out;
}

/** The LV's reference wall thickness, mm, at a short-axis angle: the septal side can be thicker (asymmetric hypertrophy). */
export function wallAt(ang: number, tau: number, wall: number, septum: number): number {
  if (septum === wall) return wall;
  const w = Math.max(0, Math.cos(((wrap(ang - 180) * Math.PI) / 180) * 1.3)) * (1 - smooth((tau - 0.85) / 0.12)) * smooth((tau - 0.1) / 0.25);
  return wall + (septum - wall) * w;
}

export { LV };
