export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Catmull-Rom spline through control points, re-sampled by arc length. */
export class Curve {
  pts: V3[] = [];
  cum: number[] = [0];
  constructor(ctrl: V3[], perSpan = 24) {
    const p = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
    for (let i = 1; i < p.length - 2; i++) {
      for (let k = 0; k < perSpan; k++) {
        const t = k / perSpan, t2 = t * t, t3 = t2 * t;
        const q = [0, 1, 2].map((d) =>
          0.5 * ((2 * p[i][d]) + (-p[i - 1][d] + p[i + 1][d]) * t + (2 * p[i - 1][d] - 5 * p[i][d] + 4 * p[i + 1][d] - p[i + 2][d]) * t2 + (-p[i - 1][d] + 3 * p[i][d] - 3 * p[i + 1][d] + p[i + 2][d]) * t3));
        this.pts.push(q as V3);
      }
    }
    this.pts.push(ctrl[ctrl.length - 1]);
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + len(sub(this.pts[i], this.pts[i - 1])));
  }
  get length() { return this.cum[this.cum.length - 1]; }
  /** Point at arc-length fraction u ∈ [0,1]. */
  at(u: number): V3 {
    const target = Math.min(1, Math.max(0, u)) * this.length;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= target) lo = m; else hi = m; }
    const seg = this.cum[hi] - this.cum[lo] || 1, w = (target - this.cum[lo]) / seg;
    return add(mul(this.pts[lo], 1 - w), mul(this.pts[hi], w));
  }
  tangent(u: number): V3 {
    const e = 0.004;
    return norm(sub(this.at(Math.min(1, u + e)), this.at(Math.max(0, u - e))));
  }
}
