import { HEART } from "../config/tree";
import { V3 } from "./curve";

/**
 * Procedural external cardiac anatomy as a signed distance field (mm, heart frame: x = patient's left,
 * y = toward the base along the long axis, z = anterior; positive outside).
 *
 * The ventricular mass keeps the reference ellipsoid that the coronary paths were laid out on, so the
 * arteries still fit, and adds what an ellipsoid lacks: a tapered apex, a right-ventricular bulge, the
 * interventricular and atrioventricular grooves (where the arteries run, in fat), and the base cut off
 * at the valve plane. Above the base sit the atria with their appendages and the aorta, from which the
 * coronary arteries arise. Pulmonary vessels and venae cavae are left out because they hide the
 * coronaries without bearing on them. Display only; no physics depends on it.
 */

export enum Part { LV, RV, RA, LA, Aorta }
export const PART_NAMES = ["Left ventricle", "Right ventricle", "Right atrium", "Left atrium", "Aorta"];

const { a: A, b: B, c: C } = HEART.radii;

// ---- primitives -------------------------------------------------------------------------------
function ellipsoid(p: V3, c: V3, r: V3): number {
  const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z), k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}
function capsule(p: V3, a: V3, b: V3, r: number): number {
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2)));
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - r;
}
/** Lobe along a polyline whose radius tapers from r0 at the base to r1 at the tip (atrial appendage). */
function taperedLobe(p: V3, pts: V3[], r0: number, r1: number): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ra = r0 + ((r1 - r0) * (i - 1)) / (pts.length - 1), rb = r0 + ((r1 - r0) * i) / (pts.length - 1);
    const a = pts[i - 1], b = pts[i], pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2)));
    d = Math.min(d, Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - (ra + (rb - ra) * h));
  }
  return d;
}
const polyline = (p: V3, pts: V3[], r: number) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, capsule(p, pts[i - 1], pts[i], r)); return d; };
/** Polynomial smooth minimum: blends two surfaces with a fillet of size ~k. */
export const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

// ---- anatomy ----------------------------------------------------------------------------------
// Interventricular plane, chosen to pass under the LAD (anterior) and the PDA (posterior).
const SEPT_N: V3 = [0.979, 0, -0.204], SEPT_D = 6.5;
export const septalDistance = (p: V3) => SEPT_N[0] * p[0] + SEPT_N[2] * p[2] - SEPT_D; // > 0: LV side, < 0: RV side
export const latitude = (p: V3) => Math.asin(Math.max(-1, Math.min(1, p[1] / B)));
export const AV_GROOVE_LAT = 0.82;
const BASE_Y = 54;

/** Ventricles, including the grooves the coronary arteries lie in. */
export function ventricles(p: V3): number {
  const t = p[1] < 0 ? Math.min(1, -p[1] / B) : 0;
  const k = 1 - 0.3 * Math.pow(t, 1.6); // conical apex
  let d = ellipsoid([p[0] / k, p[1], p[2] / k], [0, 0, 0], [A, B, C]) * k;
  const s = septalDistance(p);
  d -= 2.6 * smooth01(-s / 14) * (1 - t) * smooth01((AV_GROOVE_LAT - latitude(p)) / 0.18); // RV bulge, fading out before the AV groove
  d += 2.8 * Math.exp(-((s / 5.5) ** 2)) * smooth01((54 - p[1]) / 10); // interventricular grooves (anterior and posterior)
  d += 3.4 * Math.exp(-(((latitude(p) - AV_GROOVE_LAT) / 0.1) ** 2)); // atrioventricular groove (coronary sulcus): broad, fat-filled
  d = smin(d, capsule(p, [-5, 30, 22], [5, 52, 25], 12.5), 7); // right ventricular outflow tract (conus)
  return smax(d, p[1] - BASE_Y, 5); // base at the valve plane
}

const AORTA: V3[] = [[0, 44, 2], [0, 56, 2], [1, 70, 1], [5, 86, -8], [17, 94, -26], [27, 87, -40], [30, 76, -45]]; // root, ascending, arch, start of descending
export function parts(p: V3): number[] {
  // Atria: broad, low bodies blended into the base; appendages as tapering ear-shaped lobes.
  const ra = smin(ellipsoid(p, [-27, 54, -6], [16, 17, 18]), taperedLobe(p, [[-26, 58, 6], [-20, 61, 15], [-12, 60, 21]], 7, 3.5), 7);
  const la = smin(ellipsoid(p, [5, 56, -21], [25, 12, 15]), taperedLobe(p, [[17, 57, -6], [27, 59, 3], [33, 56, 11]], 6, 3), 7);
  return [
    ventricles(p), Infinity, ra, la,
    smin(polyline(p, AORTA, 12), ellipsoid(p, [0, 50, 2], [15, 9, 15]), 4), // aortic root with its sinuses
  ];
}

/** Whole heart: smooth union of every part. Small fillets keep the grooves and chamber outlines visible. */
export function heartSdf(p: V3): number {
  const d = parts(p);
  const atria = smin(d[Part.RA], d[Part.LA], 6);
  return smin(smin(d[Part.LV], atria, 3.5), d[Part.Aorta], 3);
}

/** Which structure a surface point belongs to (nearest part; ventricles split by the septal plane). */
export function partAt(p: V3): Part {
  const d = parts(p);
  let best = 0;
  for (let i = 2; i < d.length; i++) if (d[i] < d[best]) best = i;
  if (best === Part.LV && septalDistance(p) < 0) return Part.RV;
  return best as Part;
}

export function gradient(f: (p: V3) => number, p: V3, e = 0.25): V3 {
  const gx = f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]);
  const gy = f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]);
  const gz = f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e]);
  const n = Math.hypot(gx, gy, gz) || 1;
  return [gx / n, gy / n, gz / n];
}
function smooth01(t: number) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

/**
 * Place a coronary centerline point on the ventricular epicardium: Newton-project onto the ventricle
 * surface, then lift by `h`. Ostial segments near the aortic root are left where the tree put them,
 * blending smoothly so each artery leaves the aorta and drops into its groove.
 */
export function projectToEpicardium(p: V3, h: number): { pos: V3; n: V3 } {
  let q: V3 = [p[0], p[1], p[2]];
  for (let i = 0; i < 7; i++) { const d = ventricles(q), g = gradient(ventricles, q); q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d]; if (Math.abs(d) < 0.02) break; }
  const n = gradient(ventricles, q);
  const onWall: V3 = [q[0] + n[0] * h, q[1] + n[1] * h, q[2] + n[2] * h];
  const w = 1 - smooth01((p[1] - 47) / 6); // 1 on the ventricles, 0 at the aortic root
  return { pos: [p[0] + (onWall[0] - p[0]) * w, p[1] + (onWall[1] - p[1]) * w, p[2] + (onWall[2] - p[2]) * w], n };
}

// ---- meshing ----------------------------------------------------------------------------------
export interface SurfaceMesh { positions: Float32Array; normals: Float32Array; indices: Uint32Array; parts: Uint8Array }

/**
 * Naive surface nets: one vertex per grid cell that straddles the surface (at the mean of its edge
 * crossings, then projected onto the surface), one quad per sign-changing grid edge. Watertight.
 */
export function meshHeart(step = 1.4, bounds: [V3, V3] = [[-64, -74, -72], [64, 114, 48]]): SurfaceMesh {
  const [lo, hi] = bounds;
  const nx = Math.ceil((hi[0] - lo[0]) / step) + 1, ny = Math.ceil((hi[1] - lo[1]) / step) + 1, nz = Math.ceil((hi[2] - lo[2]) / step) + 1;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Coarse pass every 3rd node; exact evaluation only in a narrow band around the surface.
  const val = new Float32Array(nx * ny * nz);
  const C3 = 3, cx = Math.ceil((nx - 1) / C3) + 1, cy = Math.ceil((ny - 1) / C3) + 1, cz = Math.ceil((nz - 1) / C3) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    coarse[i + cx * (j + cy * k)] = heartSdf([lo[0] + i * C3 * step, lo[1] + j * C3 * step, lo[2] + k * C3 * step]);
  const band = 1.6 * C3 * step;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const fi = i / C3, fj = j / C3, fk = k / C3;
    const i0 = Math.min(cx - 2, Math.floor(fi)), j0 = Math.min(cy - 2, Math.floor(fj)), k0 = Math.min(cz - 2, Math.floor(fk));
    const u = fi - i0, v = fj - j0, w = fk - k0, g = (a: number, b: number, c: number) => coarse[(i0 + a) + cx * ((j0 + b) + cy * (k0 + c))];
    const approx = (1 - w) * ((1 - v) * ((1 - u) * g(0, 0, 0) + u * g(1, 0, 0)) + v * ((1 - u) * g(0, 1, 0) + u * g(1, 1, 0)))
      + w * ((1 - v) * ((1 - u) * g(0, 0, 1) + u * g(1, 0, 1)) + v * ((1 - u) * g(0, 1, 1) + u * g(1, 1, 1)));
    val[at(i, j, k)] = Math.abs(approx) > band ? approx : heartSdf([lo[0] + i * step, lo[1] + j * step, lo[2] + k * step]);
  }

  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cell = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corners: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, b, c]) => val[at(i + a, j + b, k + c)]);
    const inside = v.filter((x) => x < 0).length;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      if ((v[e0] < 0) === (v[e1] < 0)) continue;
      const t = v[e0] / (v[e0] - v[e1]), c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; n++;
    }
    cellVert[cell(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * step, lo[1] + (j + sy / n) * step, lo[2] + (k + sz / n) * step);
  }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[at(i, j, k)], inside0 = v0 < 0;
    if (inside0 !== (val[at(i + 1, j, k)] < 0)) // x edge: cells around it in y,z
      quad(cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)], !inside0);
    if (inside0 !== (val[at(i, j + 1, k)] < 0)) // y edge: cells around it in z,x
      quad(cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i - 1, j, k)], cellVert[cell(i, j, k)], cellVert[cell(i, j, k - 1)], !inside0);
    if (inside0 !== (val[at(i, j, k + 1)] < 0)) // z edge: cells around it in x,y
      quad(cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)], !inside0);
  }

  // Snap vertices onto the true surface and take analytic normals.
  const nv = pos.length / 3, positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), partArr = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    let q: V3 = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
    const d = heartSdf(q), g = gradient(heartSdf, q); // one Newton step; the gradient doubles as the normal
    q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
    positions.set(q, 3 * v); normals.set(g, 3 * v); partArr[v] = partAt(q);
  }
  // Make triangles wind outward (the sign convention above is checked against the volume).
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    vol += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  return { positions, normals, indices: Uint32Array.from(idx), parts: partArr };
}

/** Enclosed volume (ml) of a closed, outward-wound mesh. */
export function meshVolumeMl(m: SurfaceMesh): number {
  let vol = 0; const p = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return vol / 1000;
}
