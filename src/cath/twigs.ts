import type { V3 } from "../anatomy/curve";

/**
 * The fine branches a real angiogram shows beyond the modeled tree: septals, small diagonals and marginals, distal fan-out. They are
 * cosmetic (seeded and deterministic, never used by physics), start on a real vessel and fill with dye just after the point they leave it.
 */
export interface Twig { segId: string; at: number; pts: V3[]; dMm: number; lengthMm: number }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function makeTwigs(seg: { id: string; samples: V3[]; diameterMm: number[]; length: number }, perTenMm = 1.7): Twig[] {
  const NS = seg.samples.length - 1, r = rng(hash(seg.id)), out: Twig[] = [];
  const mean = seg.diameterMm.reduce((a, b) => a + b, 0) / seg.diameterMm.length;
  if (mean < 1 || seg.length < 25) return out;
  const n = Math.min(10, Math.max(1, Math.round((seg.length / 10) * perTenMm)));
  for (let k = 0; k < n; k++) {
    const u = 0.15 + 0.85 * ((k + r() * 0.7) / n), at = Math.min(NS - 1, Math.max(1, Math.round(u * NS)));
    const p = seg.samples[at], q = seg.samples[Math.min(NS, at + 1)], T = norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    let side = norm(cross(T, [r() - 0.5, r() - 0.5, r() - 0.5]));
    if (k % 2) side = [-side[0], -side[1], -side[2]];
    let dir = norm([T[0] * 0.95 + side[0] * 0.3, T[1] * 0.95 + side[1] * 0.3, T[2] * 0.95 + side[2] * 0.3]);
    const L = (5 + r() * 10) * (1.15 - 0.5 * u), steps = 8, pts: V3[] = [p];
    for (let s = 1; s <= steps; s++) {
      const bend = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
      dir = norm([dir[0] + bend[0] * 0.22, dir[1] + bend[1] * 0.22, dir[2] + bend[2] * 0.22]);
      const last = pts[pts.length - 1]; pts.push([last[0] + (dir[0] * L) / steps, last[1] + (dir[1] * L) / steps, last[2] + (dir[2] * L) / steps]);
    }
    out.push({ segId: seg.id, at, pts, dMm: Math.max(0.4, Math.min(0.9, mean * (0.2 + 0.1 * r()))), lengthMm: L });
  }
  return out;
}
