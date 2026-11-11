import { V3 } from "./curve";

/**
 * The CT-derived heart: the average healthy adult four-chamber heart of a statistical shape model built from 20 cardiac CT scans
 * (Rodero C, Strocchi M, Marciniak M, et al., "Linking statistical shape models and simulated function in the healthy adult human
 * heart", PLoS Comput Biol 17(4): e1008851, 2021; data on Zenodo, doi:10.5281/zenodo.4593739, CC BY 4.0). `npm run build:heart`
 * voxelizes it at 1 mm into src/cath/data/heart.bin.gz (labels plus universal ventricular coordinates) and heart.json (valves, vessel
 * stubs, ostia). It is the average shape, not any one person's scan.
 *
 * This module is DOM-free and shared: it turns the label volume into signed distance fields (so surfaces sampled between voxels are
 * smooth, not 1 mm staircases), answers "what is here" at any point, and places the heart in CoroSim's heart frame. The echo images it
 * today; the simulator's own 3D heart may move onto it later.
 *
 * Frames. The CT frame is the shape model's own, in mm: z runs from the LV apex (about -91) to the centre of the LV base (0), x points
 * from the septum to the LV free wall, y anterior. It is left-handed, so placing it in CoroSim's right-handed heart frame needs a
 * reflection; `place` picks the rigid map (with or without one) that best fits the landmarks it is given.
 */

/** Labels of the volume (scripts/cath/fill2.py). */
export const CT = {
  LV: 1, RV: 2, RA: 3, LA: 4, AORTA: 7, PA: 17,
  MV_PLANE: 20, AV_PLANE: 21, TV_PLANE: 22, PV_PLANE: 23, IAS: 24,
  RV_WALL: 25, LA_WALL: 26, RA_WALL: 27, AO_WALL: 28, PERICARDIUM: 29, PA_WALL: 32,
  /** LV myocardium: 40 + segment in the volume's ring order (anterolateral, anterior, anteroseptal, inferoseptal, inferior, inferolateral). */
  LV_SEG0: 40,
} as const;
/** The volume's ring order to AHA order (basal/mid: anterior, anteroseptal, inferoseptal, inferior, inferolateral, anterolateral). */
const RING_TO_AHA = [5, 0, 1, 2, 3, 4];
/** AHA segment (0..16) of an LV-wall label 40..56. */
export function ahaSegment(label: number): number {
  const s = label - CT.LV_SEG0;
  if (s < 0 || s > 16) return -1;
  if (s < 12) return Math.floor(s / 6) * 6 + RING_TO_AHA[s % 6];
  return s; // apical four (anterior, septal, inferior, lateral) and the cap are already in AHA order
}

export interface CtMeta {
  shape: [number, number, number];
  origin_mm: V3;
  valves: Record<"MV" | "TV" | "AV" | "PV", { c: V3; n: V3; R: number }>;
  tubes: Record<"ao" | "pa", { vc: V3; u: V3; end: V3; r: number; rwall: number }>;
  ostia: Record<string, { c: V3; n: V3; r: number }>;
  centroids: Record<"LV" | "RV" | "RA" | "LA", V3>;
  lv_apex_cm: V3;
}

export interface CtHeart {
  meta: CtMeta;
  nx: number; ny: number; nz: number; origin: V3;
  labels: Uint8Array;
  /** Universal ventricular coordinates of LV-wall voxels, 0..254 (255 elsewhere): transmural, circumferential, apex to base. */
  transmural: Uint8Array; circumferential: Uint8Array; longitudinal: Uint8Array;
  /** Signed distance (mm) to the blood pools (all chambers, the aortic and pulmonary lumens); negative in blood. */
  blood: Float32Array;
  /** Signed distance (mm) to the heart's outer surface (myocardium, walls and blood); negative inside. */
  body: Float32Array;
  /** CT frame (mm) <-> CoroSim heart frame: q = R (c - cc) + hc, c = R^T (q - hc) + cc. */
  R: number[]; cc: V3; hc: V3;
}

const BLOOD_LABELS = new Set<number>([CT.LV, CT.RV, CT.RA, CT.LA, CT.AORTA, CT.PA, CT.MV_PLANE, CT.AV_PLANE, CT.TV_PLANE, CT.PV_PLANE]);

/** Squared Euclidean distance transform along one line (Felzenszwalb and Huttenlocher), in place. */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Distance (voxels) from every voxel to the nearest voxel where `inside` is set. */
function distanceTo(inside: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const INF = 1e12, n = nx * ny * nz, g = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = inside[i] ? 0 : INF;
  const m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const idx = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { for (let k = 0; k < nz; k++) f[k] = g[idx(i, j, k)]; edt1(f, nz, d, v, z); for (let k = 0; k < nz; k++) g[idx(i, j, k)] = d[k]; }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { for (let j = 0; j < ny; j++) f[j] = g[idx(i, j, k)]; edt1(f, ny, d, v, z); for (let j = 0; j < ny; j++) g[idx(i, j, k)] = d[j]; }
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) { for (let i = 0; i < nx; i++) f[i] = g[idx(i, j, k)]; edt1(f, nx, d, v, z); for (let i = 0; i < nx; i++) g[idx(i, j, k)] = d[i]; }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/** Signed distance to a voxel set (negative inside), lightly smoothed so trilinear samples give smooth, not stepped, surfaces. */
function signedField(inside: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const outside = new Uint8Array(inside.length);
  for (let i = 0; i < inside.length; i++) outside[i] = inside[i] ? 0 : 1;
  const dOut = distanceTo(inside, nx, ny, nz), dIn = distanceTo(outside, nx, ny, nz);
  const s = new Float32Array(inside.length);
  for (let i = 0; i < s.length; i++) s[i] = inside[i] ? 0.5 - dIn[i] : dOut[i] - 0.5;
  // one pass of a [1 2 1]/4 filter on each axis
  const tmp = new Float32Array(s.length), str = [ny * nz, nz, 1], dims = [nx, ny, nz];
  for (let a = 0; a < 3; a++) {
    const st = str[a], dm = dims[a];
    for (let i = 0; i < s.length; i++) {
      const c = Math.floor(i / st) % dm;
      const lo = c > 0 ? s[i - st] : s[i], hi = c < dm - 1 ? s[i + st] : s[i];
      tmp[i] = 0.25 * lo + 0.5 * s[i] + 0.25 * hi;
    }
    s.set(tmp);
  }
  return s;
}

/** Build the heart from the decompressed volume (four channels of nx*ny*nz bytes) and its metadata. Takes about a second. */
export function ctHeartFromBytes(bin: Uint8Array, metaIn: unknown): CtHeart {
  const meta = metaIn as CtMeta;
  const [nx, ny, nz] = meta.shape, n = nx * ny * nz;
  if (bin.length < 4 * n) throw new Error(`CT heart: expected ${4 * n} bytes, got ${bin.length}`);
  const labels = bin.subarray(0, n), transmural = bin.subarray(n, 2 * n), circumferential = bin.subarray(2 * n, 3 * n), longitudinal = bin.subarray(3 * n, 4 * n);
  const bloodSet = new Uint8Array(n), bodySet = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const l = labels[i]; bloodSet[i] = BLOOD_LABELS.has(l) ? 1 : 0; bodySet[i] = l !== 0 && l !== CT.PERICARDIUM ? 1 : 0; }
  return {
    meta, nx, ny, nz, origin: meta.origin_mm, labels, transmural, circumferential, longitudinal,
    blood: signedField(bloodSet, nx, ny, nz), body: signedField(bodySet, nx, ny, nz),
    R: [1, 0, 0, 0, 1, 0, 0, 0, 1], cc: [0, 0, 0], hc: [0, 0, 0],
  };
}

/** Trilinear sample of a field at a CT-frame point (mm); `outside` beyond the volume. */
export function sampleField(h: CtHeart, f: Float32Array, c: V3, outside = 50): number {
  const x = c[0] - h.origin[0], y = c[1] - h.origin[1], z = c[2] - h.origin[2];
  if (x < 0 || y < 0 || z < 0 || x >= h.nx - 1 || y >= h.ny - 1 || z >= h.nz - 1) return outside;
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const sy = h.nz, sx = h.ny * h.nz, o = i * sx + j * sy + k;
  const c00 = f[o] + (f[o + sx] - f[o]) * fx, c10 = f[o + sy] + (f[o + sx + sy] - f[o + sy]) * fx;
  const c01 = f[o + 1] + (f[o + sx + 1] - f[o + 1]) * fx, c11 = f[o + sy + 1] + (f[o + sx + sy + 1] - f[o + sy + 1]) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

/** Label of the voxel containing a CT-frame point (0 outside the volume). */
export function labelAt(h: CtHeart, c: V3): number {
  const i = Math.round(c[0] - h.origin[0]), j = Math.round(c[1] - h.origin[1]), k = Math.round(c[2] - h.origin[2]);
  if (i < 0 || j < 0 || k < 0 || i >= h.nx || j >= h.ny || k >= h.nz) return 0;
  return h.labels[(i * h.ny + j) * h.nz + k];
}

/** The label of the nearest voxel in `set` within `reach` voxels (a small search), or 0. */
export function nearestLabel(h: CtHeart, c: V3, set: (l: number) => boolean, reach = 3): number {
  const i0 = Math.round(c[0] - h.origin[0]), j0 = Math.round(c[1] - h.origin[1]), k0 = Math.round(c[2] - h.origin[2]);
  let best = 0, bd = Infinity;
  for (let di = -reach; di <= reach; di++) for (let dj = -reach; dj <= reach; dj++) for (let dk = -reach; dk <= reach; dk++) {
    const d = di * di + dj * dj + dk * dk; if (d >= bd) continue;
    const i = i0 + di, j = j0 + dj, k = k0 + dk;
    if (i < 0 || j < 0 || k < 0 || i >= h.nx || j >= h.ny || k >= h.nz) continue;
    const l = h.labels[(i * h.ny + j) * h.nz + k];
    if (set(l)) { best = l; bd = d; }
  }
  return best;
}

// ---- placement ----------------------------------------------------------------------------------
const cm = (v: V3): V3 => [v[0] * 10, v[1] * 10, v[2] * 10];
/** Landmarks in the CT frame, mm: LV apex, the valve centres. */
export function ctLandmarks(h: CtHeart): { apex: V3; mv: V3; av: V3; tv: V3; pv: V3 } {
  const v = h.meta.valves;
  return { apex: cm(h.meta.lv_apex_cm), mv: cm(v.MV.c), av: cm(v.AV.c), tv: cm(v.TV.c), pv: cm(v.PV.c) };
}

/** 3x3 helpers, row-major. */
const mulMV = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulTV = (m: number[], v: V3): V3 => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Polar decomposition of a 3x3 matrix by Newton iteration: the closest orthogonal matrix (a rotation, or a reflection if det < 0). */
function orthogonalPart(a: number[]): number[] {
  let q = a.slice();
  for (let it = 0; it < 60; it++) {
    // q <- (q + q^-T) / 2
    const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = q;
    const det = a0 * (a4 * a8 - a5 * a7) - a1 * (a3 * a8 - a5 * a6) + a2 * (a3 * a7 - a4 * a6);
    if (Math.abs(det) < 1e-12) break;
    const invT = [(a4 * a8 - a5 * a7) / det, -(a3 * a8 - a5 * a6) / det, (a3 * a7 - a4 * a6) / det,
      -(a1 * a8 - a2 * a7) / det, (a0 * a8 - a2 * a6) / det, -(a0 * a7 - a1 * a6) / det,
      (a1 * a5 - a2 * a4) / det, -(a0 * a5 - a2 * a3) / det, (a0 * a4 - a1 * a3) / det];
    q = q.map((x, i) => 0.5 * (x + invT[i]));
  }
  return q;
}

/**
 * Place the CT heart rigidly (no scaling) so its landmarks best match `target` (the same named points in CoroSim's heart frame).
 * Both handednesses are tried; the one with the smaller residual wins (the CT frame is left-handed, so it is expected to be the one
 * with a reflection). Returns the RMS residual, mm.
 */
export function place(h: CtHeart, target: Record<string, V3>): number {
  const src = ctLandmarks(h) as Record<string, V3>, keys = Object.keys(target).filter((k) => src[k]);
  const mean = (pts: V3[]): V3 => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0] as V3);
  const A = keys.map((k) => src[k]), B = keys.map((k) => target[k]), ca = mean(A), cb = mean(B);
  // cross-covariance H = sum (b - cb)(a - ca)^T; the best orthogonal R maximizes tr(R^T H)
  const H = new Array(9).fill(0);
  for (let n = 0; n < A.length; n++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[3 * i + j] += (B[n][i] - cb[i]) * (A[n][j] - ca[j]);
  const R = orthogonalPart(H);
  const res = Math.sqrt(A.reduce((s, a, n) => { const q = mulMV(R, [a[0] - ca[0], a[1] - ca[1], a[2] - ca[2]]); return s + (q[0] + cb[0] - B[n][0]) ** 2 + (q[1] + cb[1] - B[n][1]) ** 2 + (q[2] + cb[2] - B[n][2]) ** 2; }, 0) / A.length);
  h.R = R; h.cc = ca; h.hc = cb;
  return res;
}

/** CT frame (mm) to CoroSim's heart frame, and back. Directions: `toHeartDir` / `toCtDir`. */
export const ctToHeart = (h: CtHeart, c: V3): V3 => { const q = mulMV(h.R, [c[0] - h.cc[0], c[1] - h.cc[1], c[2] - h.cc[2]]); return [q[0] + h.hc[0], q[1] + h.hc[1], q[2] + h.hc[2]]; };
export const heartToCt = (h: CtHeart, q: V3, out: V3 = [0, 0, 0]): V3 => {
  const x = q[0] - h.hc[0], y = q[1] - h.hc[1], z = q[2] - h.hc[2], R = h.R;
  out[0] = R[0] * x + R[3] * y + R[6] * z + h.cc[0]; out[1] = R[1] * x + R[4] * y + R[7] * z + h.cc[1]; out[2] = R[2] * x + R[5] * y + R[8] * z + h.cc[2];
  return out;
};
export const ctDirToHeart = (h: CtHeart, d: V3): V3 => mulMV(h.R, d);
export const heartDirToCt = (h: CtHeart, d: V3): V3 => mulTV(h.R, d);
