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
/** The morphed heart (heartSdfMorph) labels more structures; the first five values are the same as `Part`. */
export enum MorphPart { LV, RV, RA, LA, Aorta, PA, SVC, IVC, PV, Duct, BT, DAO }
export const MORPH_PART_NAMES = [...PART_NAMES, "Pulmonary artery", "Superior vena cava", "Inferior vena cava", "Pulmonary veins", "Ductus arteriosus", "BT shunt", "Descending aorta"];

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
export function ventricles(p: V3, rvBulge = 1): number {
  const t = p[1] < 0 ? Math.min(1, -p[1] / B) : 0;
  const k = 1 - 0.3 * Math.pow(t, 1.6); // conical apex
  let d = ellipsoid([p[0] / k, p[1], p[2] / k], [0, 0, 0], [A, B, C]) * k;
  const s = septalDistance(p);
  d -= Math.max(0, 2.6 * rvBulge + 6 * (rvBulge - 1)) * smooth01(-s / 14) * (1 - t) * smooth01((AV_GROOVE_LAT - latitude(p)) / 0.18); // RV bulge, fading out before the AV groove
  d += 2.8 * Math.exp(-((s / 5.5) ** 2)) * smooth01((54 - p[1]) / 10); // interventricular grooves (anterior and posterior)
  d += 3.4 * Math.exp(-(((latitude(p) - AV_GROOVE_LAT) / 0.1) ** 2)); // atrioventricular groove (coronary sulcus): broad, fat-filled
  d = smin(d, capsule(p, [-5, 30, 22], [5, 52, 25], Math.max(4, 12.5 * rvBulge)), 7); // right ventricular outflow tract (conus)
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

// ---- morphed heart (the structural page) ---------------------------------------------------------
/**
 * The same heart reshaped for a lesion, with the great vessels the coronary views leave out (pulmonary artery, venae cavae,
 * pulmonary veins, ductus, BT shunt). Every field is optional; the default heart (`heartSdf`) is untouched by any of it.
 * Sizes are linear scales (volume^(1/3)); the ventricles scale about the base plane so they stay attached to the atria.
 * Schematic: lesions are drawn as illustrative shapes, not measured anatomy.
 */
export interface HeartMorph {
  ventricleScale?: number; rvBulge?: number; raScale?: number; laScale?: number; aortaScale?: number;
  greatVessels?: boolean; paScale?: number; pvScale?: number; cavaScale?: number;
  ductRadius?: number; btRadius?: number; // mm; 0 or missing = absent
}
/** Inverse of `rotateHeart` (src/anatomy/tree.ts): from the patient frame (x left, y up, z anterior) back to the heart's own frame. */
export function unrotateHeart(v: V3): V3 {
  const cz = Math.cos(HEART.rotateZ), sz = Math.sin(HEART.rotateZ), cx = Math.cos(HEART.rotateX), sx = Math.sin(HEART.rotateX);
  const x1 = v[0], y1 = v[1] * cx + v[2] * sx, z1 = -v[1] * sx + v[2] * cx;
  return [x1 * cz + y1 * sz, -x1 * sz + y1 * cz, z1];
}
const fromPatient = (pts: V3[]): V3[] => pts.map(unrotateHeart);
// The great vessels are laid out as they sit in the patient (x left, y up, z anterior, mm from the heart's centre) and converted:
// the heart's own frame is tilted, so paths written in it come out leaning. The arch is raised above the pulmonary bifurcation.
const PA_TRUNK: V3[] = fromPatient([[-23, 53, -6], [-19, 55, -16], [-15, 57, -28], [-14, 56, -34]]);
const LPA: V3[] = fromPatient([[-14, 56, -34], [0, 58, -50], [14, 56, -66]]);
const RPA: V3[] = fromPatient([[-14, 56, -34], [-22, 53, -60], [-46, 52, -70], [-64, 52, -66]]); // behind the ascending aorta, over the left atrium
const SVC_PATH: V3[] = fromPatient([[-55, 34, -26], [-56, 60, -26], [-56, 84, -26]]);
const IVC_PATH: V3[] = fromPatient([[-55, 10, -26], [-55, -12, -28], [-55, -34, -30]]);
const PV_RIGHT: V3[][] = [[[-25, 30, -46], [-38, 36, -58], [-58, 40, -66]], [[-25, 30, -46], [-36, 26, -58], [-58, 24, -68]]];
const PV_LEFT: V3[][] = ([[[-25, 30, -46], [-12, 36, -58], [8, 40, -68]], [[-25, 30, -46], [-12, 26, -60], [8, 24, -70]]] as V3[][]).map(fromPatient);
const DUCT_PATH: V3[] = fromPatient([[4, 58, -56], [-6, 58, -70], [-16, 56, -80]]); // left pulmonary artery back to the isthmus
const BT_PATH: V3[] = fromPatient([[-38, 70, -54], [-44, 62, -64], [-46, 52, -70]]); // from the top of the arch to the right pulmonary artery (ends on its centreline)
/** The aorta of this heart: the root and first ascending aorta as in `AORTA`, then a taller arch than the coronary views draw. */
const MORPH_AORTA: V3[] = [AORTA[0], AORTA[1], AORTA[2], ...fromPatient([[-38, 62, -42], [-34, 76, -52], [-26, 74, -72], [-18, 60, -82], [-14, 41, -83]])];
const FLOOR = 1.2; // mm: the thinnest vessel drawn (the page's smallest tube is 2.25 mm, so this only guards a bad input)

const scale = (x: number | undefined, lo = 0.05, def = 1) => (x !== undefined && Number.isFinite(x) ? Math.max(lo, x) : def);

export function partsMorph(p: V3, m: HeartMorph): number[] {
  const kv = scale(m.ventricleScale), ra = scale(m.raScale), la = scale(m.laScale), ao = scale(m.aortaScale), rb = scale(m.rvBulge, 0.05);
  const q: V3 = [p[0] / kv, 54 + (p[1] - 54) / kv, p[2] / kv];
  // a small or large right ventricle: the right-hand side of the septal plane is squeezed toward it or stretched away from it
  const sd = septalDistance(q), k = Math.min(1.5, Math.max(0.35, rb)), shift = sd < 0 && Math.abs(k - 1) > 1e-6 ? -sd * (1 - 1 / k) : 0;
  const qr: V3 = [q[0] + SEPT_N[0] * shift, q[1], q[2] + SEPT_N[2] * shift];
  const lv = ventricles(qr, rb) * kv;
  const rAtrium = smin(ellipsoid(p, [-27, 54, -6], [16 * ra, 17 * ra, 18 * ra]), taperedLobe(p, [[-26, 58, 6], [-20, 61, 15], [-12, 60, 21]], 7 * ra, 3.5 * ra), 7);
  const lAtrium = smin(ellipsoid(p, [5, 56, -21], [25 * la, 12 * la, 15 * la]), taperedLobe(p, [[17, 57, -6], [27, 59, 3], [33, 56, 11]], 6 * la, 3 * la), 7);
  // the root, ascending aorta and arch are the aorta; from the top of the arch down is the descending aorta, so the two can carry different blood
  const aorta = smin(polyline(p, MORPH_AORTA.slice(0, 6), 12 * ao), ellipsoid(p, [0, 50, 2], [15 * ao, 9 * ao, 15 * ao]), 4);
  const out = new Array(12).fill(Infinity);
  out[MorphPart.LV] = lv; out[MorphPart.RA] = rAtrium; out[MorphPart.LA] = lAtrium; out[MorphPart.Aorta] = aorta;
  out[MorphPart.DAO] = polyline(p, MORPH_AORTA.slice(5), 12 * ao);
  if (m.greatVessels) {
    const pa = m.paScale === undefined || !Number.isFinite(m.paScale) ? 1 : Math.max(0, m.paScale), pv = m.pvScale === undefined || !Number.isFinite(m.pvScale) ? 1 : Math.max(0, m.pvScale), cv = scale(m.cavaScale);
    const trunk: V3[] = [[PA_TRUNK[0][0] * kv, 54 + (PA_TRUNK[0][1] - 54) * kv, PA_TRUNK[0][2] * kv], ...PA_TRUNK.slice(1)]; // starts on the (scaled) outflow tract
    if (pa > 0) out[MorphPart.PA] = Math.min(polyline(p, trunk, Math.max(FLOOR, 10 * pa)), polyline(p, LPA, Math.max(FLOOR, 6.5 * pa)), polyline(p, RPA, Math.max(FLOOR, 6.5 * pa)));
    out[MorphPart.SVC] = polyline(p, SVC_PATH, 7.5 * cv); out[MorphPart.IVC] = polyline(p, IVC_PATH, 8.5 * cv);
    if (pv > 0) {
      // a big right atrium would swallow the right pulmonary veins, so they leave the left atrium further back and to the right
      // (in the patient frame) the free ends move back and to the right; the end on the left atrium stays on it
      const shiftHeart = unrotateHeart([-6 * (ra - 1), 0, -12 * (ra - 1)]);
      const moved = PV_RIGHT.map((path) => fromPatient(path).map((v, i): V3 => (i === 0 ? v : [v[0] + shiftHeart[0], v[1] + shiftHeart[1], v[2] + shiftHeart[2]])));
      out[MorphPart.PV] = Math.min(...[...moved, ...PV_LEFT].map((path) => polyline(p, path, Math.max(FLOOR, 4.5 * pv))));
    }
    if ((m.ductRadius ?? 0) > 0) out[MorphPart.Duct] = polyline(p, DUCT_PATH, Math.max(FLOOR, m.ductRadius!));
    if ((m.btRadius ?? 0) > 0) out[MorphPart.BT] = polyline(p, BT_PATH, Math.max(FLOOR, m.btRadius!));
  }
  return out;
}
export function heartSdfMorph(p: V3, m: HeartMorph): number {
  const d = partsMorph(p, m);
  let f = smin(smin(d[MorphPart.LV], smin(d[MorphPart.RA], d[MorphPart.LA], 6), 3.5), smin(d[MorphPart.Aorta], d[MorphPart.DAO], 2), 3);
  for (let i = MorphPart.PA; i <= MorphPart.BT; i++) if (d[i] < Infinity) f = smin(f, d[i], 2.5);
  return f;
}
export function partAtMorph(p: V3, m: HeartMorph): MorphPart {
  const d = partsMorph(p, m);
  let best = 0;
  for (let i = 2; i < d.length; i++) if (d[i] < d[best]) best = i;
  const kv = scale(m.ventricleScale);
  if (best === MorphPart.LV && septalDistance([p[0] / kv, 54 + (p[1] - 54) / kv, p[2] / kv]) < 0) return MorphPart.RV;
  return best as MorphPart;
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
export function meshHeart(step = 1.4, bounds: [V3, V3] = [[-64, -74, -72], [64, 114, 48]], morph?: HeartMorph): SurfaceMesh {
  const sdf = morph ? (q: V3) => heartSdfMorph(q, morph) : heartSdf, which = morph ? (q: V3) => partAtMorph(q, morph) : partAt;
  let [lo, hi] = bounds;
  if (morph) { // a larger heart needs a larger box: the ventricles scale about the base plane, y = 54
    const k = Math.max(1, scale(morph.ventricleScale));
    lo = [lo[0] * k, 54 - (54 - lo[1]) * k - 4, lo[2] * k]; hi = [hi[0] * k, hi[1], hi[2] * k];
    // the great vessels reach further than the coronary views' box: a branch pulmonary artery, an enlarged aortic arch, the pulmonary veins
    if (morph.greatVessels) { lo = [Math.min(lo[0], -80 * k), lo[1], Math.min(lo[2], -84)]; hi = [Math.max(hi[0], 80 * k), Math.max(hi[1], 132), hi[2]]; }
  }
  const nx = Math.ceil((hi[0] - lo[0]) / step) + 1, ny = Math.ceil((hi[1] - lo[1]) / step) + 1, nz = Math.ceil((hi[2] - lo[2]) / step) + 1;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Coarse pass every 3rd node; exact evaluation only in a narrow band around the surface.
  const val = new Float32Array(nx * ny * nz);
  const C3 = 3, cx = Math.ceil((nx - 1) / C3) + 1, cy = Math.ceil((ny - 1) / C3) + 1, cz = Math.ceil((nz - 1) / C3) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    coarse[i + cx * (j + cy * k)] = sdf([lo[0] + i * C3 * step, lo[1] + j * C3 * step, lo[2] + k * C3 * step]);
  const band = 1.6 * C3 * step;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const fi = i / C3, fj = j / C3, fk = k / C3;
    const i0 = Math.min(cx - 2, Math.floor(fi)), j0 = Math.min(cy - 2, Math.floor(fj)), k0 = Math.min(cz - 2, Math.floor(fk));
    const u = fi - i0, v = fj - j0, w = fk - k0, g = (a: number, b: number, c: number) => coarse[(i0 + a) + cx * ((j0 + b) + cy * (k0 + c))];
    const approx = (1 - w) * ((1 - v) * ((1 - u) * g(0, 0, 0) + u * g(1, 0, 0)) + v * ((1 - u) * g(0, 1, 0) + u * g(1, 1, 0)))
      + w * ((1 - v) * ((1 - u) * g(0, 0, 1) + u * g(1, 0, 1)) + v * ((1 - u) * g(0, 1, 1) + u * g(1, 1, 1)));
    val[at(i, j, k)] = Math.abs(approx) > band ? approx : sdf([lo[0] + i * step, lo[1] + j * step, lo[2] + k * step]);
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
    const d = sdf(q), g = gradient(sdf, q); // one Newton step; the gradient doubles as the normal
    q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
    positions.set(q, 3 * v); normals.set(g, 3 * v); partArr[v] = which(q);
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
  const mesh: SurfaceMesh = { positions, normals, indices: Uint32Array.from(idx), parts: partArr };
  return morph ? dropSmallPieces(mesh, 60) : mesh;
}

/**
 * Removes closed shells of fewer than `minVertices` vertices: where two smooth-blended vessels meet at some sizes the field leaves a
 * pinhole bubble a few millimetres across, which would otherwise float beside the heart.
 */
export function dropSmallPieces(m: SurfaceMesh, minVertices: number): SurfaceMesh {
  const n = m.positions.length / 3, par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < m.indices.length; t += 3) { const a = find(m.indices[t]); par[find(m.indices[t + 1])] = a; par[find(m.indices[t + 2])] = find(a); }
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) { const r = find(i); size.set(r, (size.get(r) ?? 0) + 1); }
  if ([...size.values()].every((s) => s >= minVertices)) return m;
  const keep = (i: number) => (size.get(find(i)) ?? 0) >= minVertices, map = new Int32Array(n).fill(-1);
  let k = 0; for (let i = 0; i < n; i++) if (keep(i)) map[i] = k++;
  const positions = new Float32Array(k * 3), normals = new Float32Array(k * 3), parts = new Uint8Array(k), idx: number[] = [];
  for (let i = 0; i < n; i++) if (map[i] >= 0) { positions.set(m.positions.subarray(3 * i, 3 * i + 3), 3 * map[i]); normals.set(m.normals.subarray(3 * i, 3 * i + 3), 3 * map[i]); parts[map[i]] = m.parts[i]; }
  for (let t = 0; t < m.indices.length; t += 3) if (map[m.indices[t]] >= 0) idx.push(map[m.indices[t]], map[m.indices[t + 1]], map[m.indices[t + 2]]);
  return { positions, normals, indices: Uint32Array.from(idx), parts };
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
