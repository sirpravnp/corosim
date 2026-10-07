import { GEOMETRY, LESION } from "../config/anatomy";

/** Lumen diameter (m) sampled along a centerline arc length (m). */
export interface LumenProfile {
  x: number[];
  d: number[];
}

export interface LesionSpec {
  referenceDiameter: number;
  diameterStenosis: number; // 0..1
  entranceLength: number; // shoulder lengths set pressure recovery
  plateau: number;
  exitLength: number;
}

export const defaultLesion = (): LesionSpec => ({
  referenceDiameter: LESION.referenceDiameter,
  diameterStenosis: LESION.diameterStenosis,
  entranceLength: (LESION.length - LESION.plateau) / 2,
  plateau: LESION.plateau,
  exitLength: (LESION.length - LESION.plateau) / 2,
});

export const lesionLength = (s: LesionSpec) => s.entranceLength + s.plateau + s.exitLength;

/** Cosine-tapered lesion with plateau, sampled at n points (a uniform tube if ds = 0). */
export function lesionProfile(s: LesionSpec, n = 200): LumenProfile {
  const L = lesionLength(s);
  const x: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = (L * i) / (n - 1);
    let f: number;
    if (xi < s.entranceLength) f = 0.5 * (1 - Math.cos((Math.PI * xi) / s.entranceLength));
    else if (xi <= s.entranceLength + s.plateau) f = 1;
    else f = 0.5 * (1 + Math.cos((Math.PI * (xi - s.entranceLength - s.plateau)) / s.exitLength));
    x.push(xi);
    d.push(s.referenceDiameter * (1 - s.diameterStenosis * f));
  }
  return { x, d };
}

export const area = (d: number) => (Math.PI * d * d) / 4;
export const minDiameter = (p: LumenProfile) => Math.min(...p.d);
export const percentDiameterStenosis = (p: LumenProfile, ref: number) => 1 - minDiameter(p) / ref;
export const percentAreaStenosis = (p: LumenProfile, ref: number) => 1 - area(minDiameter(p)) / area(ref);

/** Trapezoid integral of g(d(x)) dx along the profile. */
export function integrate(p: LumenProfile, g: (d: number) => number): number {
  let sum = 0;
  for (let i = 1; i < p.x.length; i++) {
    sum += 0.5 * (g(p.d[i - 1]) + g(p.d[i])) * (p.x[i] - p.x[i - 1]);
  }
  return sum;
}

/** Diameter after a stent expands the lesion to `stentDiameter`, minus recoil (0..1); never narrower than before. */
export function stentedProfile(p: LumenProfile, stentDiameter: number, recoil = 0.03): LumenProfile {
  const target = stentDiameter * (1 - recoil);
  return { x: p.x, d: p.d.map((di) => Math.max(di, target)) };
}

// ---- Tree-geometry validators (pure; use as acceptance tests for generated vessel trees) ----

/** Finet's law: expected proximal diameter from distal main branch and side branch. */
export const finetParent = (dDistal: number, dSide: number) => GEOMETRY.finetRatio * (dDistal + dSide);

export function finetApplies(dDistal: number, dSide: number): boolean {
  const ratio = Math.min(dDistal, dSide) / Math.max(dDistal, dSide);
  return ratio >= GEOMETRY.finetMinDaughterRatio;
}

/** Relative error of a parent diameter against the generalized Murray law D_p^n = sum D_i^n. */
export function murrayError(dParent: number, daughters: number[], n = GEOMETRY.murrayExponent): number {
  const rhs = Math.pow(daughters.reduce((a, di) => a + Math.pow(di, n), 0), 1 / n);
  return (dParent - rhs) / rhs;
}

export const bifurcationOk = (dParent: number, dDistal: number, dSide: number) =>
  Math.abs(dParent - finetParent(dDistal, dSide)) / dParent <= GEOMETRY.bifurcationTolerance;

/** A healthy vessel must never get wider with distance. */
export const taperIsMonotonic = (diametersProxToDist: number[]) =>
  diametersProxToDist.every((di, i) => i === 0 || di <= diametersProxToDist[i - 1] + 1e-12);
