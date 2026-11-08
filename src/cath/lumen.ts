import type { Plaque } from "../lab/types";

/** Pure geometry for drawing a vessel as a lumen with two edges, from its screen-space centerline. */

export type P2 = [number, number];

/** Unit normals along a polyline, from the neighbors on each side so a bend gets a smooth normal and abutting quads share an edge exactly. */
export function normals(pts: readonly P2[]): P2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
}

/**
 * The two wall lines of a vessel. `width` is the lumen diameter in pixels at each point; `asym` (-1..1) pushes the lumen toward one wall
 * (an eccentric plaque takes the lumen off-center), keeping the width. Width has a floor so a thin vessel still reads as a line.
 */
export function wallLines(pts: readonly P2[], width: readonly number[], asym?: readonly number[], floor = 1.3): { left: P2[]; right: P2[] } {
  const n = normals(pts), left: P2[] = [], right: P2[] = [];
  pts.forEach((p, i) => {
    const w = Math.max(floor, width[i]), s = asym?.[i] ?? 0;
    left.push([p[0] + n[i][0] * (w / 2) * (1 + s), p[1] + n[i][1] * (w / 2) * (1 + s)]);
    right.push([p[0] - n[i][0] * (w / 2) * (1 - s), p[1] - n[i][1] * (w / 2) * (1 - s)]);
  });
  return { left, right };
}

/** Split sample levels (0..levels) into runs of equal level, as [first, last] sample indexes that share an edge at the cut. */
export function levelRuns(level: readonly number[]): { a: number; b: number; level: number }[] {
  const out: { a: number; b: number; level: number }[] = [];
  let a = 0;
  for (let i = 1; i <= level.length; i++) {
    if (i === level.length || level[i] !== level[a]) { if (level[a] > 0) out.push({ a, b: Math.min(level.length - 1, i), level: level[a] }); a = i; }
  }
  return out;
}

/**
 * How much a plaque shifts the lumen at `mm` along its vessel. `ew` is the plaque's weight there (0 outside it, 1 at its center);
 * `asym` is the signed fraction of one wall the thick side takes up, as seen in a view where the thick wall is at `viewAngleDeg` round the vessel.
 */
export function plaqueShift(p: Plaque, mm: number, viewAngleDeg = 0): { ew: number; asym: number } {
  const half = Math.max(1, p.lengthMm * 0.5), z = (mm - p.centerMm) / (half * 0.9);
  const ew = Math.exp(-z * z);
  const asym = ew * p.eccentric * Math.cos(((p.eccentricAngleDeg - viewAngleDeg) * Math.PI) / 180) * 0.5;
  return { ew, asym };
}

/** Screen-space mid-points of the lumen's calcium: a short run along each wall where the plaque has calcium. Returned as [from, to, wall] triples in samples. */
export function calciumSpan(p: Plaque, segLengthMm: number, samples: number): { from: number; to: number } | null {
  if (p.calcium < 0.25) return null;
  const from = Math.max(0, Math.floor(((p.centerMm - p.lengthMm * 0.55) / segLengthMm) * samples));
  const to = Math.min(samples, Math.ceil(((p.centerMm + p.lengthMm * 0.55) / segLengthMm) * samples));
  return to > from ? { from, to } : null;
}

/** Chaikin corner cutting: rounds a polyline sampled every few millimeters into a smooth curve, keeping both ends. */
export function smoothPath(pts: readonly P2[], iterations = 2): P2[] {
  let out = pts.slice();
  for (let n = 0; n < iterations && out.length > 2; n++) {
    const next: P2[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(out[out.length - 1]); out = next;
  }
  return out;
}

/** Cumulative arc length of a polyline, in the same units as its points. */
export function arcLengths(pts: readonly P2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/**
 * Half-width profile (mm) of a balloon along its length. Inflated, it fills its nominal radius except where a lesion holds it in: there it
 * waists, and the waist fills out as the pressure rises (gone at about the nominal pressure plus 4 atm). Deflated it is a thin wrap.
 */
export function balloonProfile(
  n: number, lengthMm: number, nominalRadiusMm: number, atm: number, nominalAtm: number,
  lesion?: { offsetMm: number; lengthMm: number; lumenRadiusMm: number },
): number[] {
  if (atm <= 0) return Array.from({ length: n }, () => 0.5);
  const out: number[] = [];
  const relief = smoothNum((atm - 2) / Math.max(2, nominalAtm + 2));
  for (let i = 0; i < n; i++) {
    const s = (i / Math.max(1, n - 1) - 0.5) * lengthMm, ends = Math.min(1, Math.min(i, n - 1 - i) / Math.max(1, n * 0.08)); // the tapered shoulders
    let r = nominalRadiusMm * (0.55 + 0.45 * Math.sqrt(ends));
    if (lesion) {
      const g = Math.exp(-(((s - lesion.offsetMm) / Math.max(1, lesion.lengthMm * 0.4)) ** 2));
      const waist = lesion.lumenRadiusMm + (nominalRadiusMm - lesion.lumenRadiusMm) * relief;
      r = Math.min(r, nominalRadiusMm - g * (nominalRadiusMm - waist));
    }
    out.push(r);
  }
  return out;
}
const smoothNum = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
