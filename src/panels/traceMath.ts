/**
 * Pure helpers for the Pressures panel (src/panels/traces.ts): how many points to ask for, the y-axis scale with
 * hysteresis, and the legend numbers. No DOM, so tests can check them. Units: mmHg, seconds.
 */
import type { Series } from "../sim/hemoSource";

/** Selectable time windows, s. */
export const WINDOWS = [3, 6, 12, 30] as const;
export const DEFAULT_WINDOW = 6;

/** Axis tops, mmHg; the same ladder as the structural page's traces. */
const STEPS = [10, 20, 30, 40, 60, 80, 100, 120, 150, 200, 250];
export const niceMax = (v: number): number => STEPS.find(s => s >= v) ?? Math.ceil(v / 50) * 50;

/** `maxPoints` for `source.trace`: about one point per canvas pixel (more is invisible), clamped to a cheap range. */
export function pickMaxPoints(canvasWidthPx: number): number {
  if (!Number.isFinite(canvasWidthPx)) return 300;
  return Math.min(1200, Math.max(100, Math.round(canvasWidthPx)));
}

/** Largest and smallest finite value over all series (NaN, NaN when there is none). */
export function dataRange(series: readonly Series[]): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const s of series) for (const x of s.v) if (Number.isFinite(x)) { if (x < min) min = x; if (x > max) max = x; }
  return min <= max ? { min, max } : { min: NaN, max: NaN };
}

/** A shrink only happens when the data fits in this fraction of the current top, so the axis does not flicker. */
export const SHRINK_BELOW = 0.65;

/**
 * Next axis top. Grows at once when the data does not fit (nothing is clipped); shrinks only when the data would fit
 * in `SHRINK_BELOW` of the current top, to the nice max for the data. `prev` undefined/NaN starts fresh.
 */
export function nextTop(prev: number | undefined, dataMax: number): number {
  if (!Number.isFinite(dataMax)) return prev !== undefined && Number.isFinite(prev) ? prev : 10;
  const need = niceMax(Math.max(1, dataMax * 1.04));
  if (prev === undefined || !Number.isFinite(prev) || need > prev) return need;
  return dataMax < SHRINK_BELOW * prev && need < prev ? need : prev;
}

/** Axis bottom: 0, or a multiple of 10 below the data when pressures go negative. */
export function axisBottom(dataMin: number): number {
  return Number.isFinite(dataMin) && dataMin < -1 ? Math.floor(dataMin / 10) * 10 : 0;
}

/** Gridline spacing for an axis top, mmHg. */
export const gridStep = (top: number): number => (top > 100 ? 40 : top > 40 ? 20 : 10);

export interface LegendValues { sys: number; dia: number; mean: number }

/** Max, min and time-weighted mean of the finite samples in the last `lastSeconds` of a series. NaN when none. */
export function legendValues(s: Series, lastSeconds = 3): LegendValues {
  const n = Math.min(s.t.length, s.v.length);
  let tEnd = -Infinity;
  for (let i = 0; i < n; i++) if (Number.isFinite(s.v[i]) && s.t[i] > tEnd) tEnd = s.t[i];
  if (!Number.isFinite(tEnd)) return { sys: NaN, dia: NaN, mean: NaN };
  let max = -Infinity, min = Infinity, area = 0, span = 0, sum = 0, cnt = 0, pt = NaN, pv = NaN;
  for (let i = 0; i < n; i++) {
    const v = s.v[i], t = s.t[i];
    if (!Number.isFinite(v) || t < tEnd - lastSeconds) { pt = NaN; continue; }
    if (v > max) max = v;
    if (v < min) min = v;
    sum += v; cnt++;
    if (Number.isFinite(pt) && t > pt) { area += 0.5 * (v + pv) * (t - pt); span += t - pt; }
    pt = t; pv = v;
  }
  return { sys: max, dia: min, mean: span > 0 ? area / span : sum / cnt };
}

/** "120/80 (93)", or "–" when not available. */
export function legendText(l: LegendValues): string {
  if (![l.sys, l.dia, l.mean].every(Number.isFinite)) return "–";
  return `${Math.round(l.sys)}/${Math.round(l.dia)} (${Math.round(l.mean)})`;
}

/** True when no series has a finite sample: the worker has not delivered the first solve. */
export const isWaiting = (series: readonly Series[]): boolean => !Number.isFinite(dataRange(series).max);

/** Seconds of history a paused review keeps (the source's trace buffer). */
export const REVIEW_SECONDS = 60;

/**
 * The part of `s` with `from <= t <= to`, thinned to at most `maxPoints` (evenly by index; the first and last kept). Samples are
 * in time order. Used by the paused review, which holds one long copy and shows a sliding window of it.
 */
export function windowSeries(s: Series, from: number, to: number, maxPoints = Infinity): Series {
  const n = Math.min(s.t.length, s.v.length);
  let a = 0;
  while (a < n && s.t[a] < from) a++;
  let b = a;
  while (b < n && s.t[b] <= to) b++;
  const len = b - a;
  if (len <= 0) return { t: new Float32Array(0), v: new Float32Array(0) };
  const m = Math.max(2, Math.min(len, Math.floor(maxPoints)));
  if (m >= len) return { t: s.t.slice(a, b), v: s.v.slice(a, b) };
  const t = new Float32Array(m), v = new Float32Array(m);
  for (let i = 0; i < m; i++) { const k = a + Math.floor((i * (len - 1)) / (m - 1)); t[i] = s.t[k]; v[i] = s.v[k]; }
  return { t, v };
}

/** How far back (s) a paused review can be scrolled: what was kept, less the window shown. Never negative. */
export const maxScrub = (kept: number, window: number): number => Math.max(0, kept - window);
