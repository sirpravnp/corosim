/**
 * Image statistics of a sector echo picture, used to calibrate the simulated echo against real open-licensed loops: the same function
 * measures a reference frame (scripts/echo/reference-stats.ts writes src/echo/reference.json) and a simulated one (tests/echoRealism.test.ts).
 * Pure: gray pixels in, numbers out.
 *
 * - Gray percentiles inside the sector, past the near field.
 * - Anechoic fraction: pixels darker than `DARK` (blood pools, fluid, shadow).
 * - Speckle grain: the half-width (mm) of the autocorrelation of the speckle, along the beam (axial) and across it (lateral), measured in
 *   textured tissue. Real speckle is a few tenths of a millimeter long axially and wider laterally, and widens with depth.
 * - Brightness of tissue against depth, by centimeter.
 */
export interface SectorGeometry {
  w: number; h: number;
  /** Sector apex in pixels. */
  apex: [number, number];
  /** Pixels per millimeter. */
  pxPerMm: number;
  /** 1 inside the sector. */
  mask: Uint8Array;
}

export interface ImageStats {
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  darkFraction: number;
  /** Speckle autocorrelation half-width at half maximum, mm, in textured tissue: near (under 8 cm) and far (8 cm and deeper). */
  grain: { axial: number; lateral: number; axialFar: number; lateralFar: number };
  /** Mean gray of tissue pixels by depth, one entry per centimeter (NaN where there is none). */
  depthProfile: number[];
  /** Mean of tissue pixels over mean of all sector pixels: how much tissue stands out. */
  tissueContrast: number;
}

export const DARK = 22;
/** Tissue: local mean above this. */
const TISSUE = 55;
const NEAR_MM = 10;

function boxMean(g: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += g[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

const bilinear = (a: Float32Array, w: number, h: number, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + w] * (1 - fx) + a[i + w + 1] * fx) * fy;
};

/** Accumulate frames into one measurement: every frame's pixels count. */
export function imageStats(frames: Uint8Array[], geo: SectorGeometry): ImageStats {
  const { w, h, apex, pxPerMm, mask } = geo;
  const hist = new Float64Array(256);
  let dark = 0, total = 0, tissueSum = 0, tissueN = 0, allSum = 0;
  const prof = new Float64Array(30), profN = new Float64Array(30);
  const lags = 40, step = 0.1; // mm
  const acc = { ax: new Float64Array(lags + 1), lat: new Float64Array(lags + 1), axF: new Float64Array(lags + 1), latF: new Float64Array(lags + 1) };
  let accN = 0, accNF = 0;
  for (const raw of frames) {
    const g = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) g[i] = raw[i];
    const r = Math.max(2, Math.round(2.5 * pxPerMm));
    const m = boxMean(g, w, h, r);
    const dev = new Float32Array(g.length); for (let i = 0; i < g.length; i++) dev[i] = g[i] - m[i];
    const v2 = boxMean(dev.map((d) => d * d), w, h, r);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const dx = x - apex[0], dy = y - apex[1], depth = Math.hypot(dx, dy) / pxPerMm;
      if (depth < NEAR_MM) continue;
      // stay off the sector's edge, where masking would bias the local mean
      let edge = false;
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) { edge = true; break; } }
      if (edge) continue;
      const val = raw[i];
      hist[val]++; total++; allSum += val;
      if (val < DARK) dark++;
      if (m[i] > TISSUE) {
        tissueSum += val; tissueN++;
        const cm = Math.floor(depth / 10); if (cm < 30) { prof[cm] += val; profN[cm]++; }
        // autocorrelation on a sparse subset of tissue pixels (every 7th), along and across the local beam direction
        if (k++ % 7 !== 0 || v2[i] < 16) continue;
        const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, sd = Math.sqrt(v2[i]);
        const far = depth >= 80;
        const ax = far ? acc.axF : acc.ax, lat = far ? acc.latF : acc.lat;
        let ok = true;
        const rowA: number[] = [], rowL: number[] = [];
        for (let j = 0; j <= lags; j++) {
          const d = j * step * pxPerMm;
          const a = bilinear(dev, w, h, x + ux * d, y + uy * d), b = bilinear(dev, w, h, x - uy * d, y + ux * d);
          if (Number.isNaN(a) || Number.isNaN(b)) { ok = false; break; }
          rowA.push((dev[i] * a) / (sd * sd)); rowL.push((dev[i] * b) / (sd * sd));
        }
        if (!ok) continue;
        for (let j = 0; j <= lags; j++) { ax[j] += rowA[j]; lat[j] += rowL[j]; }
        if (far) accNF++; else accN++;
      }
    }
  }
  const pct = (q: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= q * total) return v; } return 255; };
  const hwhm = (a: Float64Array, n: number) => {
    if (n === 0 || a[0] <= 0) return NaN;
    for (let j = 1; j < a.length; j++) if (a[j] / a[0] <= 0.5) { const f = (a[j - 1] / a[0] - 0.5) / (a[j - 1] / a[0] - a[j] / a[0]); return (j - 1 + f) * step; }
    return (a.length - 1) * step;
  };
  return {
    percentiles: { p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95) },
    darkFraction: total ? dark / total : 0,
    grain: { axial: hwhm(acc.ax, accN), lateral: hwhm(acc.lat, accN), axialFar: hwhm(acc.axF, accNF), lateralFar: hwhm(acc.latF, accNF) },
    depthProfile: Array.from(prof, (s, i) => (profN[i] > 50 ? s / profN[i] : NaN)).slice(0, 18),
    tissueContrast: tissueN && total ? tissueSum / tissueN / (allSum / total) : 0,
  };
}

/** A sector mask for an image whose apex, edge angles (degrees from straight down, left and right) and radius are known. */
export function wedgeMask(w: number, h: number, apex: [number, number], half: [number, number], radius: number): Uint8Array {
  const tl = Math.tan((half[0] * Math.PI) / 180), tr = Math.tan((half[1] * Math.PI) / 180), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - apex[0], dy = y - apex[1];
    m[y * w + x] = dy > 0 && -dx <= dy * tl && dx <= dy * tr && Math.hypot(dx, dy) <= radius ? 1 : 0;
  }
  return m;
}

/**
 * How well defined the borders are: the median 10-90 % rise distance (mm) across blood-to-tissue borders, measured on the image
 * smoothed over about a millimetre (so speckle does not count as an edge), along the local gradient; and how bright the brightest
 * echoes are against ordinary tissue (99th percentile of the sector over the median of tissue pixels). Real borders are soft and the
 * specular lines are bright but not white everywhere; an over-crisp simulation shows short rise distances and a high ratio.
 */
export interface EdgeStats { edgeWidth: number; edges: number; specularRatio: number }

export function edgeStats(frames: Uint8Array[], geo: SectorGeometry): EdgeStats {
  const { w, h, apex, pxPerMm, mask } = geo;
  const widths: number[] = [], tissue: number[] = [], all: number[] = [];
  const r = Math.max(1, Math.round(0.8 * pxPerMm)), step = 0.25, reach = 4;
  for (const raw of frames) {
    const g = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) g[i] = raw[i];
    const m = boxMean(g, w, h, r);
    for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
      const i = y * w + x;
      if (!mask[i] || Math.hypot(x - apex[0], y - apex[1]) / pxPerMm < NEAR_MM) continue;
      all.push(raw[i]); if (m[i] > TISSUE) tissue.push(raw[i]);
      const gx = (m[i + 1] - m[i - 1]) / 2, gy = (m[i + w] - m[i - w]) / 2, gm = Math.hypot(gx, gy);
      if (gm < 6 || m[i] < 25 || m[i] > 90) continue;
      const ux = gx / gm, uy = gy / gm, prof: number[] = [];
      let ok = true;
      for (let d = -reach; d <= reach + 1e-9; d += step) {
        const v = bilinear(m, w, h, x + ux * d * pxPerMm, y + uy * d * pxPerMm);
        if (Number.isNaN(v)) { ok = false; break; }
        prof.push(v);
      }
      if (!ok) continue;
      const lo = prof[0], hi = prof[prof.length - 1];
      if (lo > 22 || hi < 60) continue; // a blood-to-tissue border only
      const a = lo + 0.1 * (hi - lo), b = lo + 0.9 * (hi - lo);
      let ia = -1, ib = -1;
      for (let k = 0; k < prof.length; k++) { if (ia < 0 && prof[k] >= a) ia = k; if (ib < 0 && prof[k] >= b) ib = k; }
      if (ia >= 0 && ib > ia) widths.push((ib - ia) * step);
    }
  }
  const med = (v: number[]) => { if (!v.length) return NaN; const s = v.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const p99 = (v: number[]) => { if (!v.length) return NaN; const s = v.slice().sort((p, q) => p - q); return s[Math.floor(0.99 * (s.length - 1))]; };
  return { edgeWidth: med(widths), edges: widths.length, specularRatio: p99(all) / Math.max(1, med(tissue)) };
}
