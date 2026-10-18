// Weighted Voronoi stippling (Secord 2002) of the heart on the homepage, colored as a thermogram.
//
// The density comes from the logo: the heart's body is its opaque stamp with the coronary grooves closed over, and
// "heat" is nearness to a groove, which is where the arteries run. Points are sampled by density and relaxed with
// Lloyd's algorithm: each point moves to the density-weighted centroid of its Voronoi cell, found by walking the
// Delaunay triangulation (d3-delaunay) over every pixel of the raster. Each dot is then colored by the heat under it:
// black → deep red → orange → yellow → near-white, so the vessels read hot against a cooler myocardium.
import { Delaunay } from "d3-delaunay";

/** Square rasters, n × n, row-major: density (0..1, 0 outside the heart) and heat (0 cold .. 1 on a vessel). */
export interface Field { n: number; rho: Float32Array; heat: Float32Array }

/** The square of the stamp around the heart, in logo pixels, and the radius inside which there is no ring (the
 *  rings start 410 px from the center). The heart is 557 × 756 px, so it fills about four fifths of the height. */
const LOGO_CROP = { x: 77, y: 69, size: 920, radius: 398 };

/** Distance (in pixels, 3-4 chamfer) from every pixel to the nearest pixel where `inside` is true. */
function distanceTo(inside: Uint8Array, n: number): Float32Array {
  const INF = 1e9, d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = inside[i] ? 0 : INF;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; let v = d[i];
    if (y > 0) { v = Math.min(v, d[i - n] + 3); if (x > 0) v = Math.min(v, d[i - n - 1] + 4); if (x < n - 1) v = Math.min(v, d[i - n + 1] + 4); }
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    d[i] = v;
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x; let v = d[i];
    if (y < n - 1) { v = Math.min(v, d[i + n] + 3); if (x > 0) v = Math.min(v, d[i + n - 1] + 4); if (x < n - 1) v = Math.min(v, d[i + n + 1] + 4); }
    if (x < n - 1) v = Math.min(v, d[i + 1] + 3);
    d[i] = v;
  }
  for (let i = 0; i < n * n; i++) d[i] /= 3;
  return d;
}
const mask = (n: number, f: (i: number) => boolean) => { const m = new Uint8Array(n * n); for (let i = 0; i < n * n; i++) m[i] = f(i) ? 1 : 0; return m; };
const dilate = (m: Uint8Array, n: number, r: number) => { const d = distanceTo(m, n); return mask(n, (i) => d[i] <= r); };
const not = (m: Uint8Array, n: number) => mask(n, (i) => !m[i]);
const erode = (m: Uint8Array, n: number, r: number) => not(dilate(not(m, n), n, r), n);

/**
 * Density and heat from the logo. `closing` is the radius (as a fraction of n) that fills the widest groove; `sigma`
 * is how far, in the same units, the heat of a vessel reaches into the muscle.
 */
export function fieldFromLogo(img: HTMLImageElement, n: number, closing = 0.03, sigma = 0.024): Field {
  const c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, LOGO_CROP.x, LOGO_CROP.y, LOGO_CROP.size, LOGO_CROP.size, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const stamp = new Uint8Array(n * n), rmax = (LOGO_CROP.radius / LOGO_CROP.size) * n;
  const cx = ((532 - LOGO_CROP.x) / LOGO_CROP.size) * n, cy = ((532 - LOGO_CROP.y) / LOGO_CROP.size) * n; // the stamp's center
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inRing = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rmax;
    stamp[y * n + x] = !inRing && px[4 * (y * n + x) + 3] > 128 ? 1 : 0;
  }
  const k = closing * n;
  const body = erode(dilate(stamp, n, k), n, k); // the stamp with its grooves closed over
  const groove = dilate(erode(mask(n, (i) => !!body[i] && !stamp[i]), n, 1.5), n, 1.5); // the grooves, less the stamp's speckle
  const dv = distanceTo(groove, n), s = sigma * n;
  const rho = new Float32Array(n * n), heat = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (!body[i]) continue;
    const h = Math.exp(-((dv[i] / s) ** 2));
    heat[i] = h;
    rho[i] = 0.22 + 0.78 * h * h; // hot regions are denser as well as brighter
  }
  return { n, rho, heat };
}

/** Thermal ramp, black-body style. The black end is the ground itself: the coldest dot is still a deep red. */
const RAMP: [number, string][] = [[0, "#3a0603"], [0.22, "#8c130b"], [0.48, "#d8401a"], [0.7, "#f49218"], [0.86, "#fbd24a"], [1, "#fff6dc"]];
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
export function thermal(t: number): string {
  t = Math.min(1, Math.max(0, t));
  let k = 0;
  while (k < RAMP.length - 2 && t > RAMP[k + 1][0]) k++;
  const [t0, c0] = RAMP[k], [t1, c1] = RAMP[k + 1], u = (t - t0) / (t1 - t0), a = hex(c0), b = hex(c1);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`;
}
export const thermalGradient = () => `linear-gradient(90deg,${RAMP.map(([t, c]) => `${c} ${t * 100}%`).join(",")})`;

/** A set of points under Lloyd relaxation on the field. Coordinates are in raster pixels, 0..n. */
export class Stipple {
  readonly points: Float64Array; // x0, y0, x1, y1, ...
  readonly count: number;
  readonly heat: Float32Array; // per point, read from the field under it
  private delaunay: Delaunay<Delaunay.Point>;
  private cx: Float64Array; private cy: Float64Array; private mass: Float64Array;
  iterations = 0;
  /** Points are drawn from a flattened density so they start as a soft cloud and sharpen as they relax. */
  constructor(readonly field: Field, count: number, random = Math.random) {
    const { n, rho } = field;
    this.count = count;
    this.points = new Float64Array(count * 2);
    this.heat = new Float32Array(count);
    this.cx = new Float64Array(count); this.cy = new Float64Array(count); this.mass = new Float64Array(count);
    for (let i = 0; i < count; ) {
      const x = random() * n, y = random() * n, r = rho[Math.floor(y) * n + Math.floor(x)];
      if (r > 0 && random() < Math.pow(r, 0.35)) { this.points[2 * i] = x; this.points[2 * i + 1] = y; i++; }
    }
    this.delaunay = new Delaunay(this.points);
    this.sample();
  }
  private sample() {
    const { n, heat } = this.field;
    for (let i = 0; i < this.count; i++) {
      const x = Math.min(n - 1, Math.max(0, Math.floor(this.points[2 * i]))), y = Math.min(n - 1, Math.max(0, Math.floor(this.points[2 * i + 1])));
      this.heat[i] = heat[y * n + x];
    }
  }
  /** One Lloyd step: every point toward the density-weighted centroid of its cell, all the way (`omega` 1) or part of
   *  the way, which draws the settling out so it can be watched. Returns the largest move, in pixels. */
  step(omega = 1): number {
    const { n, rho } = this.field, { points, cx, cy, mass, delaunay } = this;
    cx.fill(0); cy.fill(0); mass.fill(0);
    let i = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const w = rho[y * n + x];
      if (!w) continue;
      i = delaunay.find(x + 0.5, y + 0.5, i);
      cx[i] += w * (x + 0.5); cy[i] += w * (y + 0.5); mass[i] += w;
    }
    let moved = 0;
    for (let j = 0; j < this.count; j++) {
      if (!mass[j]) continue; // a cell with no density keeps its point
      const dx = (cx[j] / mass[j] - points[2 * j]) * omega, dy = (cy[j] / mass[j] - points[2 * j + 1]) * omega;
      moved = Math.max(moved, Math.hypot(dx, dy));
      points[2 * j] += dx; points[2 * j + 1] += dy;
    }
    delaunay.update();
    this.iterations++;
    this.sample();
    return moved;
  }
}

/** Draw the dots on a canvas, batched by color, with hotter dots slightly larger. `size` is the canvas size in device pixels. */
export function draw(ctx: CanvasRenderingContext2D, st: Stipple, size: number, dot: number) {
  const BINS = 32, n = st.field.n, s = size / n;
  const byBin: number[][] = Array.from({ length: BINS }, () => []);
  for (let i = 0; i < st.count; i++) byBin[Math.min(BINS - 1, Math.floor(st.heat[i] * BINS))].push(i);
  ctx.clearRect(0, 0, size, size);
  for (let b = 0; b < BINS; b++) {
    if (!byBin[b].length) continue;
    const t = (b + 0.5) / BINS, r = dot * s * (0.85 + 0.3 * t);
    ctx.fillStyle = thermal(t);
    ctx.beginPath();
    for (const i of byBin[b]) { const x = st.points[2 * i] * s, y = st.points[2 * i + 1] * s; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.283); }
    ctx.fill();
  }
}
