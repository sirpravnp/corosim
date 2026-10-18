// Weighted Voronoi stippling (Secord 2002) of the heart on the homepage, colored as a thermogram.
//
// The density comes from the logo: the heart's body is its opaque stamp with the coronary grooves closed over, and
// "heat" is nearness to a groove, which is where the arteries run. Points are sampled by density and relaxed with
// Lloyd's algorithm: each point moves to the density-weighted centroid of its Voronoi cell, found by walking the
// Delaunay triangulation (d3-delaunay) over every pixel of the raster. Each dot is then colored by the heat under it:
// black → deep red → orange → yellow → near-white, so the vessels read hot against a cooler myocardium.
import { Delaunay } from "d3-delaunay";

/** Square rasters, n × n, row-major: density (0..1, 0 outside the heart) and heat (0 cold .. 1 on a vessel), and the
 *  box the heart occupies, in raster pixels, for fitting it to a screen. */
export interface Field { n: number; rho: Float32Array; heat: Float32Array; box: { x0: number; y0: number; x1: number; y1: number } }
/** How the raster lands on a canvas: device pixels per raster pixel, and the raster origin in device pixels. */
export interface Placement { s: number; ox: number; oy: number }


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
 * Density and heat from the logo (public/logo-transparent.png: the heart alone on a transparent ground, square, its
 * coronary grooves cut through it). `closing` is the radius (as a fraction of n) that fills the widest groove; `sigma`
 * is how far, in the same units, the heat of a vessel reaches into the muscle.
 */
export function fieldFromLogo(img: HTMLImageElement, n: number, closing = 0.03, sigma = 0.024): Field {
  const c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const stamp = mask(n, (i) => px[4 * i + 3] > 128);
  const k = closing * n;
  const body = erode(dilate(stamp, n, k), n, k); // the stamp with its grooves closed over
  const groove = dilate(erode(mask(n, (i) => !!body[i] && !stamp[i]), n, 1.5), n, 1.5); // the grooves, less the stamp's speckle
  const dv = distanceTo(groove, n), s = sigma * n;
  const rho = new Float32Array(n * n), heat = new Float32Array(n * n), box = { x0: n, y0: n, x1: 0, y1: 0 };
  for (let i = 0; i < n * n; i++) {
    if (!body[i]) continue;
    const h = Math.exp(-((dv[i] / s) ** 2));
    heat[i] = h;
    rho[i] = 0.22 + 0.78 * h * h; // hot regions are denser as well as brighter
    const x = i % n, y = (i - x) / n;
    box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x + 1); box.y1 = Math.max(box.y1, y + 1);
  }
  return { n, rho, heat, box };
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
  readonly warm: Float32Array; // per point, extra heat from being touched; fades with every step
  private delaunay: Delaunay<Delaunay.Point>;
  private cx: Float64Array; private cy: Float64Array; private mass: Float64Array;
  private home: Float64Array | null = null; // where each point last settled, for one pushed clear of the heart
  iterations = 0;
  /** Points are drawn from a flattened density so they start as a soft cloud and sharpen as they relax. */
  constructor(readonly field: Field, count: number, random = Math.random) {
    const { n, rho } = field;
    this.count = count;
    this.points = new Float64Array(count * 2);
    this.heat = new Float32Array(count); this.warm = new Float32Array(count);
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
      let tx: number, ty: number;
      if (mass[j]) { tx = cx[j] / mass[j]; ty = cy[j] / mass[j]; }
      else if (this.home) { tx = this.home[2 * j]; ty = this.home[2 * j + 1]; } // stirred clear of the heart: come home
      else continue; // a cell with no density keeps its point
      const dx = (tx - points[2 * j]) * omega, dy = (ty - points[2 * j + 1]) * omega;
      moved = Math.max(moved, Math.hypot(dx, dy));
      points[2 * j] += dx; points[2 * j + 1] += dy;
      this.warm[j] *= 0.88;
    }
    delaunay.update();
    this.iterations++;
    this.sample();
    return moved;
  }
  /** Remember the settled positions, so a point stirred out of the heart knows where to return. */
  settle() { this.home = Float64Array.from(this.points); }
  /** A touch at (x, y): points within `radius` are pushed outward, up to `push` pixels, and warmed by up to `warmth`. */
  stir(x: number, y: number, radius: number, push: number, warmth: number) {
    const { points, count } = this;
    for (let j = 0; j < count; j++) {
      const dx = points[2 * j] - x, dy = points[2 * j + 1] - y, d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      const k = (1 - d / radius) ** 2, u = d > 1e-6 ? 1 / d : 0;
      points[2 * j] += dx * u * push * k; points[2 * j + 1] += dy * u * push * k;
      this.warm[j] = Math.max(this.warm[j], warmth * k);
    }
  }
}

/** Draw the dots on a canvas of `w` × `h` device pixels, batched by color, hotter dots slightly larger; `dot` is the
 *  dot radius in raster pixels. */
export function draw(ctx: CanvasRenderingContext2D, st: Stipple, w: number, h: number, at: Placement, dot: number) {
  const BINS = 32, { s, ox, oy } = at;
  const byBin: number[][] = Array.from({ length: BINS }, () => []);
  for (let i = 0; i < st.count; i++) byBin[Math.min(BINS - 1, Math.floor(Math.min(1, st.heat[i] + st.warm[i]) * BINS))].push(i);
  ctx.clearRect(0, 0, w, h);
  for (let b = 0; b < BINS; b++) {
    if (!byBin[b].length) continue;
    const t = (b + 0.5) / BINS, r = dot * s * (0.85 + 0.3 * t);
    ctx.fillStyle = thermal(t);
    ctx.beginPath();
    for (const i of byBin[b]) { const x = ox + st.points[2 * i] * s, y = oy + st.points[2 * i + 1] * s; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.283); }
    ctx.fill();
  }
}
