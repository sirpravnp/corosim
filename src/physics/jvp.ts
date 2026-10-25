/**
 * Jugular venous pulse from one beat of right-atrial pressure (docs/HEMODYNAMICS_CORE.md §4G). Pure: no DOM, no engine.
 *
 * Input is one beat: RA pressure samples `p` (mmHg) at times `t` (s from the ventricular event, which is t = 0), and the atrial
 * activation times `atrial` (s from t = 0; none in AF or when the atrium never fires; two or more in complete heart block).
 * The beat is treated as periodic where a wave spans its ends: the x descent follows the a wave of the previous beat.
 *
 * Waves (textbook): a = atrial contraction peak; c = small bump at tricuspid closure; x = descent after a/c (atrial relaxation);
 * v = peak at the end of systole as the RA fills against the closed TV; y = descent after the TV opens.
 *
 * Method, all thresholds in src/config/jvp.ts:
 *  1. Systole (TV closed) is estimated as 0.03 s .. 0.5·rr^0.8 after the ventricular event.
 *  2. a: for each atrial activation, the interior pressure peak within 0.2 s after it that rises >= 0.5 mmHg above the lowest pressure from 0.05 s
 *     before the activation to the peak. No activation, or no such peak: no a wave (`aAbsent`). `a` is the tallest.
 *  3. cannon: an a wave whose activation falls while the TV is closed (in systole) and that rises >= 5 mmHg.
 *  4. v: the highest pressure from t = 0 to the first diastolic atrial activation (or 1.25 systoles), skipping the span of a
 *     systolic a wave. y: the lowest pressure from v to the next atrial activation (or the beat's end).
 *  5. c: a local maximum within 0.12 s of tricuspid closure, followed by a dip of >= 0.3 mmHg before v. x: the lowest pressure
 *     between the latest preceding c or a peak (cyclic) and v, if it is >= 0.5 mmHg below that peak.
 *
 * JVP height (cm above the sternal angle, patient at 45 degrees) = mean RA (mmHg) · 1.36 cm H2O/mmHg − 5 cm (the sternal angle
 * is about 5 cm above the mid right atrium). Range about −5 .. +20 cm; 1.8 cm at a mean RA of 5 mmHg.
 *
 * Limits: the bridge (task P2; the page's source for a neonate) replays a steady-state solve and its RA waveform keeps the atrial
 * kick in AF, so the waveform still shows an a peak there while `atrial` is empty; classification follows the events, the drawing
 * does not. The core engine drives the page for an adult (task P16) and has no atrial kick in AF.
 */
import { JVP, type JvpConfig } from "../config/jvp";

export interface JvpInput {
  /** RA pressure, mmHg. */
  p: ArrayLike<number>;
  /** Sample times, s from the ventricular event, increasing, starting near 0. */
  t: ArrayLike<number>;
  /** Atrial activation times, s from the ventricular event. */
  atrial: ArrayLike<number>;
  /** Beat length, s. Default: last sample time plus one sample step. */
  rr?: number;
}

/** A point on the waveform: time s from the ventricular event, pressure mmHg. */
export interface JvpPoint { t: number; p: number }
/** One a wave. `rise` mmHg above the lowest pressure just before the peak; `systolic` when the activation fell with the TV closed. */
export interface AWave extends JvpPoint { activation: number; rise: number; systolic: boolean; cannon: boolean }
/** y descent: trough time and pressure, `depth` mmHg below v, `slope` the steepest fall, mmHg/s (positive). */
export interface YDescent extends JvpPoint { depth: number; slope: number }

export type JvpClass = "aAbsent" | "cannonA" | "giantV" | "steepY" | "bluntedY" | "raised";

export interface JvpResult {
  a: AWave | null; c: JvpPoint | null; x: JvpPoint | null; v: JvpPoint | null; y: YDescent | null;
  /** Every a wave of the beat (two or more in heart block). */
  aWaves: AWave[];
  /** Time-weighted mean RA pressure, mmHg; NaN for an unusable beat. */
  meanRA: number;
  /** cm above the sternal angle (negative: below it); NaN for an unusable beat. */
  heightCm: number;
  classes: JvpClass[];
}

/** Plain words for each class, as the panel prints them. */
export const JVP_WORDS: Record<JvpClass, string> = {
  aAbsent: "no a wave", cannonA: "cannon a waves", giantV: "giant v waves", steepY: "steep y descent", bluntedY: "blunted y descent", raised: "raised JVP",
};

/** "normal waveform" when nothing is flagged. */
export function jvpWords(classes: readonly JvpClass[]): string {
  return classes.length ? classes.map((c) => JVP_WORDS[c]).join(", ") : "normal waveform";
}

/** JVP height, cm above the sternal angle, from a mean RA pressure in mmHg. */
export function jvpHeightCm(meanRA: number, cfg: JvpConfig = JVP): number {
  return meanRA * cfg.cmH2OPerMmHg - cfg.angleToAtriumCm;
}

const EMPTY: JvpResult = { a: null, c: null, x: null, v: null, y: null, aWaves: [], meanRA: NaN, heightCm: NaN, classes: [] };

export function analyzeJvp(input: JvpInput, cfg: JvpConfig = JVP): JvpResult {
  const n = Math.min(input.p.length, input.t.length);
  if (n < 8) return { ...EMPTY, aWaves: [] };
  for (let i = 0; i < n; i++) if (!Number.isFinite(input.p[i]) || !Number.isFinite(input.t[i])) return { ...EMPTY, aWaves: [] };
  const rr = input.rr ?? input.t[n - 1] + (input.t[n - 1] - input.t[0]) / (n - 1);
  if (!(rr > 0)) return { ...EMPTY, aWaves: [] };
  // three periods, so windows can cross either end of the beat
  const te = new Float64Array(3 * n), pe = new Float64Array(3 * n);
  for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) { te[k * n + i] = input.t[i] + (k - 1) * rr; pe[k * n + i] = input.p[i]; }
  const N = 3 * n;
  /** First extended index with time >= x. */
  const lower = (x: number): number => { let lo = 0, hi = N; while (lo < hi) { const m = (lo + hi) >> 1; if (te[m] < x) lo = m + 1; else hi = m; } return lo; };
    /** Extended indices of the samples with time in [from, to]. */
  const span = (from: number, to: number): [number, number] => [lower(from), Math.min(N - 1, lower(to + 1e-9) - 1)];
  const extreme = (from: number, to: number, max: boolean, skip?: (x: number) => boolean): number => {
    const [i0, i1] = span(from, to);
    let best = -1;
    for (let i = i0; i <= i1; i++) {
      if (skip?.(te[i])) continue;
      if (best < 0 || (max ? pe[i] > pe[best] : pe[i] < pe[best])) best = i;
    }
    return best;
  };

  let mean = 0, wsum = 0;
  for (let i = 0; i < n; i++) { const w = (i + 1 < n ? input.t[i + 1] : rr) - input.t[i]; mean += input.p[i] * w; wsum += w; }
  mean /= wsum;

  const tSys = Math.min(0.7 * rr, cfg.sysCoef * Math.pow(rr, cfg.sysExp));
  const acts = Array.from(input.atrial).filter((x) => Number.isFinite(x) && x >= 0 && x < rr).sort((x, y) => x - y);

  // a waves
  const aWaves: AWave[] = [];
  acts.forEach((ta, k) => {
    const systolic = ta >= cfg.tcloseDelay && ta < tSys;
    let end = ta + cfg.aWindow;
    if (!systolic) end = Math.min(end, rr); // the next ventricular event starts the v rise
    if (k + 1 < acts.length) end = Math.min(end, acts[k + 1]);
    const from = ta - cfg.aLead;
    const i = extreme(from, end, true);
    if (i < 0) return;
    const [i0, i1] = span(from, end);
    const lowI = extreme(from, te[i], false);
    const rise = pe[i] - pe[lowI];
    if (i === i0 || i === i1 || rise < cfg.aMinRise) return; // not an interior peak
    aWaves.push({ t: te[i], p: pe[i], activation: ta, rise, systolic, cannon: systolic && rise >= cfg.cannonMinRise });
  });
  const a = aWaves.length ? aWaves.reduce((m, w) => (w.p > m.p ? w : m)) : null;
  const inSystolicA = (x: number) => aWaves.some((w) => w.systolic && x >= w.activation && x <= w.t + cfg.aDecay);

  // v: highest pressure before the first diastolic atrial activation, not counting the atrial wave of a systolic activation
  const firstDiastolic = acts.find((x) => x >= tSys);
  const vEnd = Math.min(cfg.vWindow * tSys, firstDiastolic ?? Infinity, rr);
  const vi = extreme(0, vEnd, true, inSystolicA);
  const v: JvpPoint | null = vi >= 0 ? { t: te[vi], p: pe[vi] } : null;

  // y: lowest pressure from v to the next atrial activation (or the beat's end)
  let y: YDescent | null = null;
  if (v) {
    const next = acts.find((x) => x > v.t + 1e-9);
    const yEnd = next ?? rr;
    const yi = extreme(v.t, yEnd, false);
    if (yi >= 0 && te[yi] > v.t) {
      let slope = 0;
      const [i0] = span(v.t, v.t);
      for (let i = i0; i < yi; i++) slope = Math.max(slope, (pe[i] - pe[i + 1]) / (te[i + 1] - te[i]));
      y = { t: te[yi], p: pe[yi], depth: v.p - pe[yi], slope };
    }
  }

  // c: a bump soon after tricuspid closure, followed by a dip before v
  let c: JvpPoint | null = null;
  if (v) {
    const [i0, i1] = span(cfg.tcloseDelay, Math.min(cfg.tcloseDelay + cfg.cWindow, v.t));
    for (let i = Math.max(i0, 1); i <= i1; i++) {
      if (inSystolicA(te[i]) || !(pe[i] >= pe[i - 1] && pe[i] > pe[i + 1])) continue;
      const dip = extreme(te[i], v.t, false);
      const before = extreme(0, te[i], false);
      if (dip < 0 || before < 0) continue;
      if (pe[i] - pe[dip] >= cfg.cMinProm && pe[i] - pe[before] >= cfg.cMinProm && (!c || pe[i] > c.p)) c = { t: te[i], p: pe[i] };
    }
  }

  // x: lowest pressure between the latest preceding c or a peak and v
  let x: JvpPoint | null = null;
  if (v) {
    const peaks: JvpPoint[] = aWaves.map((w) => ({ t: w.t < v.t ? w.t : w.t - rr, p: w.p }));
    if (c) peaks.push(c);
    if (peaks.length) {
      const prior = peaks.reduce((m, q) => (q.t > m.t ? q : m));
      const xi = extreme(prior.t, v.t, false);
      if (xi >= 0 && prior.p - pe[xi] >= cfg.xMinDrop) x = { t: ((te[xi] % rr) + rr) % rr, p: pe[xi] };
    }
  }

  const classes: JvpClass[] = [];
  if (!a) classes.push("aAbsent");
  if (aWaves.some((w) => w.cannon)) classes.push("cannonA");
  const usual = aWaves.filter((w) => !w.cannon);
  if (v) {
    if (usual.length) {
      const ref = Math.max(...usual.map((w) => w.p));
      if (v.p >= cfg.giantVRatio * ref && v.p - ref >= cfg.giantVExcess) classes.push("giantV");
    } else if (!a) {
      let lo = Infinity;
      for (let i = 0; i < n; i++) lo = Math.min(lo, input.p[i]);
      if (v.p - lo >= cfg.giantVRange) classes.push("giantV");
    }
  }
  if (y && y.depth >= cfg.steepYDepth && y.slope >= cfg.steepYSlope) classes.push("steepY");
  if (!y || y.depth < cfg.bluntedYDepth) classes.push("bluntedY");
  if (mean > cfg.raisedMean) classes.push("raised");

  return { a: a ? { ...a, t: a.t % rr } : null, c, x, v, y: y ? { ...y, t: y.t % rr } : null, aWaves, meanRA: mean, heightCm: jvpHeightCm(mean, cfg), classes };
}
