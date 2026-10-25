/**
 * Pure math behind the PV loops panel (src/panels/loops.ts): stroke volume, EF, the end-systolic and end-diastolic
 * points of one loop, the ESPVR and EDPVR estimates across several loops, and the axis hysteresis. DOM-free.
 * Units: ml, mmHg. Everything here is read off the loops given; nothing is assumed about the patient.
 */
export interface Pt { v: number; p: number }

/** A spread of end-systolic (or end-diastolic) volumes below this, ml, is too narrow to fit a line through. [assumed] */
export const MIN_FIT_SPREAD_ML = 8;
/** Fewest loops a fit needs. [assumed] */
export const MIN_FIT_POINTS = 3;
/** Fraction of the variance a fit must explain to be drawn. [assumed] */
export const MIN_FIT_R2 = 0.5;

/** Paired finite samples of a loop (a NaN in either drops the pair). */
export function cleanLoop(p: ArrayLike<number>, v: ArrayLike<number>): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < Math.min(p.length, v.length); i++) if (Number.isFinite(p[i]) && Number.isFinite(v[i])) out.push({ p: p[i], v: v[i] });
  return out;
}

/** Area enclosed by the loop, mmHg·ml (shoelace; the loop is closed). Counter-clockwise in (v, p) is positive: a ventricle's work. */
export function loopArea(p: ArrayLike<number>, v: ArrayLike<number>): number {
  const pts = cleanLoop(p, v);
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i].v * q.p - q.v * pts[i].p; }
  return a / 2;
}

/**
 * End-diastolic point: the largest volume of the loop; where several samples share it (the vertical isovolumic edge),
 * the one with the lowest pressure, which is the instant before contraction raises it.
 */
export function endDiastolicPoint(p: ArrayLike<number>, v: ArrayLike<number>): Pt | null {
  const pts = cleanLoop(p, v);
  if (!pts.length) return null;
  const vmax = Math.max(...pts.map(q => q.v)), vmin = Math.min(...pts.map(q => q.v));
  const tol = 1e-3 * (vmax - vmin) + 1e-9;
  let best: Pt | null = null;
  for (const q of pts) if (q.v >= vmax - tol && (!best || q.p < best.p)) best = q;
  return best;
}

/** End-systolic point: the sample with the highest P/V ratio (the upper-left corner of the loop). Volumes must be positive. */
export function endSystolicPoint(p: ArrayLike<number>, v: ArrayLike<number>): Pt | null {
  let best: Pt | null = null, bestR = -Infinity;
  for (const q of cleanLoop(p, v)) {
    if (q.v <= 0) continue;
    const r = q.p / q.v;
    if (r > bestR) { bestR = r; best = q; }
  }
  return best;
}

export interface LoopStats {
  edv: number; esv: number; sv: number; ef: number; // ml, ml, ml, fraction 0..1
  edp: number; // mmHg, pressure at the end-diastolic point
  es: Pt | null; ed: Pt | null;
}

/** SV, EF, EDP of one loop. `edv`/`esv` (the source's own numbers) win over the loop's extremes when given. NaN when there is no loop. */
export function loopStats(p: ArrayLike<number>, v: ArrayLike<number>, edv?: number, esv?: number): LoopStats {
  const pts = cleanLoop(p, v);
  const ed = endDiastolicPoint(p, v), es = endSystolicPoint(p, v);
  const e = edv !== undefined && Number.isFinite(edv) ? edv : pts.length ? Math.max(...pts.map(q => q.v)) : NaN;
  const s = esv !== undefined && Number.isFinite(esv) ? esv : pts.length ? Math.min(...pts.map(q => q.v)) : NaN;
  const sv = e - s;
  return { edv: e, esv: s, sv, ef: e > 0 ? sv / e : NaN, edp: ed ? ed.p : NaN, es, ed };
}

function spread(xs: number[]): number { return xs.length ? Math.max(...xs) - Math.min(...xs) : 0; }

function linreg(xs: number[], ys: number[]): { slope: number; icpt: number; r2: number } | null {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  return { slope, icpt: my - slope * mx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
}

/** Whether a set of end points is numerous and spread enough in volume to fit a line or curve through. */
export function fitAllowed(pts: readonly Pt[]): boolean {
  const ok = pts.filter(q => Number.isFinite(q.v) && Number.isFinite(q.p));
  return ok.length >= MIN_FIT_POINTS && spread(ok.map(q => q.v)) >= MIN_FIT_SPREAD_ML;
}

/** ESPVR estimate: P = E_es · (V − V0), least squares through the end-systolic points. Null unless allowed, the slope is positive, V0 is below every volume and R² is at least MIN_FIT_R2. */
export function fitESPVR(pts: readonly Pt[]): { slope: number; v0: number; r2: number } | null {
  if (!fitAllowed(pts)) return null;
  const f = linreg(pts.map(q => q.v), pts.map(q => q.p));
  if (!f || f.slope <= 0 || f.r2 < MIN_FIT_R2) return null;
  const v0 = -f.icpt / f.slope;
  if (v0 >= Math.min(...pts.map(q => q.v))) return null;
  return { slope: f.slope, v0, r2: f.r2 };
}

/** EDPVR estimate: P = a · exp(b · V), least squares on ln P through the end-diastolic points (pressures > 0). Null unless allowed with b > 0. */
export function fitEDPVR(pts: readonly Pt[]): { a: number; b: number; r2: number } | null {
  const pos = pts.filter(q => q.p > 0);
  if (!fitAllowed(pos)) return null;
  const f = linreg(pos.map(q => q.v), pos.map(q => Math.log(q.p)));
  if (!f || f.slope <= 0 || f.r2 < MIN_FIT_R2) return null;
  return { a: Math.exp(f.icpt), b: f.slope, r2: f.r2 };
}

export interface Axis { lo: number; hi: number }

/**
 * Axis with hysteresis: grows at once (only on the side that needs it) to contain the data, and shrinks only when the
 * data fill under 60% of the span or sit well inside it, then to a rounded fit. Stops the scale jumping on every beat.
 * `step` rounds the ends (ml or mmHg).
 */
export function rescaleAxis(cur: Axis | null, needLo: number, needHi: number, step: number): Axis {
  if (!Number.isFinite(needLo) || !Number.isFinite(needHi)) return cur ?? { lo: 0, hi: step * 10 };
  const pad = 0.08 * Math.max(needHi - needLo, step);
  const fit: Axis = { lo: Math.floor((needLo - pad) / step) * step, hi: Math.ceil((needHi + pad) / step) * step };
  if (!cur) return fit;
  const span = cur.hi - cur.lo;
  if (needLo < cur.lo || needHi > cur.hi) return { lo: Math.min(cur.lo, fit.lo), hi: Math.max(cur.hi, fit.hi) };
  if (needHi - needLo < 0.6 * span || needLo - cur.lo > 0.3 * span || cur.hi - needHi > 0.3 * span) return fit;
  return cur;
}
