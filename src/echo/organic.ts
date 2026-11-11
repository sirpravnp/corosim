import { V3 } from "../anatomy/curve";

/**
 * Irregularity for the echo anatomy. The heart is built from exact primitives (ellipsoid atria, a cylindrical left ventricle, straight
 * vessel segments, a flat septal plane and valve plane), and its walls are exact offsets of those surfaces, so an unaltered cut through it
 * is all perfect circles, parallel lines and sharp corners. Real hearts are none of these. This file supplies the difference:
 *
 * - `organicWarp`: a smooth displacement field (two octaves, about 30 mm and 11 mm wavelengths, a few millimeters) applied to every point
 *   before it is classified, so ellipses become lumpy ovals, straight walls bow and the valve plane is no longer flat. It is fixed to
 *   the tissue (it is evaluated at the end-diastolic position), so it moves with the heart rather than shimmering.
 * - `roughness`: fine, positive-leaning noise (about 4 mm) for trabeculation, where the endocardium meets the blood.
 * - `patchiness`: smooth noise for echogenicity, which varies with fiber direction and tissue make-up.
 *
 * The same idea as the cath lab's tortuosity field, which gives the modeled coronary centerlines the wander of real arteries.
 * The fields are value noise on a periodic random lattice (precomputed once, trilinear lookup), so they are cheap and deterministic.
 */
const N = 32, MASK = N - 1;
function lattice(seed: number): Float32Array {
  const t = new Float32Array(N * N * N);
  let a = seed >>> 0;
  for (let i = 0; i < t.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    t[i] = (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return t;
}
const LX = lattice(11), LY = lattice(23), LZ = lattice(37), LR = lattice(51), LP = lattice(67);

/** Smooth value noise in -1..1 at lattice coordinates (x, y, z). */
function noise(t: Float32Array, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  let fx = x - x0, fy = y - y0, fz = z - z0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const i0 = x0 & MASK, i1 = (x0 + 1) & MASK, j0 = (y0 & MASK) * N, j1 = ((y0 + 1) & MASK) * N, k0 = (z0 & MASK) * N * N, k1 = ((z0 + 1) & MASK) * N * N;
  const c00 = t[i0 + j0 + k0] + (t[i1 + j0 + k0] - t[i0 + j0 + k0]) * fx;
  const c10 = t[i0 + j1 + k0] + (t[i1 + j1 + k0] - t[i0 + j1 + k0]) * fx;
  const c01 = t[i0 + j0 + k1] + (t[i1 + j0 + k1] - t[i0 + j0 + k1]) * fx;
  const c11 = t[i0 + j1 + k1] + (t[i1 + j1 + k1] - t[i0 + j1 + k1]) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

/** Wavelengths (mm) and amplitudes (mm) of the displacement field's two octaves. */
export const ORGANIC = { coarse: 30, coarseMm: 2.6, fine: 11, fineMm: 0.9, trabecula: 4.2 };

/**
 * Displace a heart-frame point (mm) by the smooth field, scaled by `amount` (0 = none, 1 = full). Writes into `out` (may alias `p`).
 */
export function organicWarp(p: V3, amount: number, out: V3): V3 {
  if (amount <= 0) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
  const a = 1 / ORGANIC.coarse, b = 1 / ORGANIC.fine;
  const x = p[0], y = p[1], z = p[2];
  const ca = ORGANIC.coarseMm * amount, fa = ORGANIC.fineMm * amount;
  // the fine octave reads the lattice at an offset, so the two octaves do not line up
  const dx = ca * noise(LX, x * a, y * a, z * a) + fa * noise(LX, x * b + 7.3, y * b + 1.1, z * b + 3.7);
  const dy = ca * noise(LY, x * a, y * a, z * a) + fa * noise(LY, x * b + 2.9, y * b + 5.3, z * b + 0.6);
  const dz = ca * noise(LZ, x * a, y * a, z * a) + fa * noise(LZ, x * b + 4.1, y * b + 8.2, z * b + 6.4);
  out[0] = x + dx; out[1] = y + dy; out[2] = z + dz;
  return out;
}

/** Trabeculation: fine noise in 0..1, leaning toward 0 with occasional ridges (muscle bundles protruding into the cavity). */
export function roughness(p: V3): number {
  const k = 1 / ORGANIC.trabecula, v = 0.5 + 0.5 * noise(LR, p[0] * k, p[1] * k * 0.6, p[2] * k); // stretched along the long axis: trabeculae run apex to base
  return v * v;
}

/** Echogenicity patchiness: smooth noise in -1..1 on a 7 mm scale. */
export function patchiness(p: V3): number {
  const k = 1 / 7;
  return noise(LP, p[0] * k, p[1] * k, p[2] * k);
}
