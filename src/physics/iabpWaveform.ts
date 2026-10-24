/**
 * Per-beat features of the aortic pressure trace under an intra-aortic balloon pump (D5). Pure functions of sampled traces (time s,
 * pressure mmHg, optionally the aortic valve flow ml/s) and the ventricular event times (the beat boundaries), so they work on an
 * engine run, a `LiveHeart` trace or a recording. A "beat" runs from one ventricular event to the next; it is ASSISTED when the
 * balloon inflates in its diastole (the cycle starts at its R wave). Its own systole follows the previous beat's diastole.
 *
 * Units: s, mmHg, ml/s; pressure-time integrals mmHg·s.
 */

export interface Trace { t: ArrayLike<number>; p: ArrayLike<number> }

export interface IabpBeatOptions {
  /** Time of aortic valve closure in this beat, s (the dicrotic notch). From `avClosureTime`; if absent, the notch is the first local minimum of the pressure after the systolic peak. */
  closureT?: number;
  /** Rise above the running minimum after the systolic peak that counts as the start of augmentation, mmHg (default 3). */
  riseMmHg?: number;
}

export interface IabpBeat {
  t0: number; t1: number;
  /** Systolic pressure, the maximum before valve closure (or in the first 45 % of the beat without a closure time), mmHg. */
  systolic: number; tSystolic: number;
  /** Notch (valve closure) time, s, and the pressure there, mmHg. */
  notchT: number; notchP: number;
  /** Peak diastolic pressure (maximum from the notch to the end of the beat), mmHg, and when. Augmented when the balloon works. */
  peakDiastolic: number; tPeakDiastolic: number;
  /** Pressure at the end of the beat (the next ventricular event), mmHg. */
  edp: number;
  /** Lowest pressure in the last 25 % of the beat, mmHg (the end-diastolic dip of an early deflation shows here, below `edp`). */
  lateMin: number;
  /** First time after the systolic peak at which the pressure has risen `riseMmHg` above its running minimum, s; NaN if it never does. Augmentation onset. */
  augOnsetT: number;
  /** Diastolic pressure-time integral from the notch to the end of the beat, mmHg·s (coronary perfusion proxy; subtract the right-sided pressure for a true DPTI). */
  dpti: number;
}

const lerp = (t: ArrayLike<number>, p: ArrayLike<number>, x: number): number => {
  const n = t.length; if (!n) return NaN;
  if (x <= t[0]) return p[0]; if (x >= t[n - 1]) return p[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  const f = (x - t[lo]) / (t[hi] - t[lo]); return p[lo] + f * (p[hi] - p[lo]);
};
const lowerBound = (t: ArrayLike<number>, x: number): number => { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; };

/**
 * Aortic valve closure time in [t0, t1]: the first time after the flow has exceeded `open` (ml/s) that it falls below `closed`.
 * The dicrotic notch follows within a few ms. NaN if the valve never opens or never closes in the window.
 */
export function avClosureTime(t: ArrayLike<number>, q: ArrayLike<number>, t0: number, t1: number, open = 5, closed = 1): number {
  let opened = false;
  for (let i = lowerBound(t, t0); i < t.length && t[i] <= t1; i++) {
    if (q[i] > open) opened = true; else if (opened && q[i] < closed) return t[i];
  }
  return NaN;
}

/** First time at or after `from` at which `p` has risen `rise` mmHg above its running minimum since `from`; NaN if never before `to`. */
export function augmentationOnset(t: ArrayLike<number>, p: ArrayLike<number>, from: number, to: number, rise = 3): number {
  let mn = Infinity;
  for (let i = lowerBound(t, from); i < t.length && t[i] <= to; i++) {
    if (p[i] < mn) mn = p[i];
    else if (p[i] - mn >= rise) return t[i];
  }
  return NaN;
}

/** Features of the beat from `t0` to `t1`. */
export function iabpBeat(tr: Trace, t0: number, t1: number, assisted = false, o: IabpBeatOptions = {}): IabpBeat & { assisted: boolean } {
  const { t, p } = tr, i0 = lowerBound(t, t0);
  const iEnd = Math.min(t.length - 1, lowerBound(t, t1 + 1e-9));
  const tSysEnd = o.closureT !== undefined && Number.isFinite(o.closureT) ? o.closureT : t0 + 0.45 * (t1 - t0);
  let iS = i0; for (let i = i0; i <= iEnd && t[i] <= tSysEnd; i++) if (p[i] > p[iS]) iS = i;
  // notch: the valve closure time if given, else the first local minimum of the pressure after the systolic peak
  let iN = iS;
  if (o.closureT !== undefined && Number.isFinite(o.closureT)) iN = Math.min(iEnd, lowerBound(t, o.closureT));
  else { iN = iS; while (iN < iEnd && !(p[iN] <= p[iN + 1] && p[iN] <= p[Math.max(iN - 1, 0)] && t[iN] - t[iS] > 0.02)) iN++; }
  let iD = iN; for (let i = iN; i <= iEnd; i++) if (p[i] > p[iD]) iD = i;
  let lateMin = Infinity; const tLate = t0 + 0.75 * (t1 - t0);
  for (let i = lowerBound(t, tLate); i <= iEnd; i++) if (p[i] < lateMin) lateMin = p[i];
  let dpti = 0; for (let i = iN + 1; i <= iEnd; i++) dpti += 0.5 * (p[i] + p[i - 1]) * (t[i] - t[i - 1]);
  return {
    t0, t1, assisted, systolic: p[iS], tSystolic: t[iS], notchT: t[iN], notchP: p[iN], peakDiastolic: p[iD], tPeakDiastolic: t[iD],
    edp: lerp(t, p, t1), lateMin, augOnsetT: augmentationOnset(t, p, t[iS], t1, o.riseMmHg ?? 3), dpti,
  };
}

/** Beats between consecutive event times `events` (n events give n − 1 beats); `assisted[k]` flags beat k. `closure(k)` may give the valve closure time of beat k. */
export function iabpBeats(tr: Trace, events: readonly number[], assisted: readonly boolean[], closure?: (k: number, t0: number, t1: number) => number | undefined, o: Omit<IabpBeatOptions, "closureT"> = {}) {
  const out: (IabpBeat & { assisted: boolean })[] = [];
  for (let k = 0; k + 1 < events.length; k++) out.push(iabpBeat(tr, events[k], events[k + 1], assisted[k] ?? false, { ...o, closureT: closure?.(k, events[k], events[k + 1]) }));
  return out;
}

/**
 * Where an assisted beat's pressure sits above an unassisted one: both traces are compared at the same time since their R wave
 * (`tA` and `tU` are the two R-wave times, `len` the span, s). `start` and `end` are the first and last times (since the R wave) at which
 * the assisted pressure exceeds the unassisted one by more than `thresh` mmHg (NaN if never); `minGap` is the lowest difference after
 * `end` (the end-diastolic undershoot of a deflated balloon, negative) and `endGap` the difference at the end of the span.
 * Valid for a steady rhythm, where the two beats differ only by the balloon.
 */
export function augmentationSpan(tr: Trace, tA: number, tU: number, len: number, thresh = 5, step = 0.002) {
  let start = NaN, end = NaN, minGap = Infinity, endGap = NaN;
  const gap: number[] = [];
  for (let x = 0; x <= len + 1e-9; x += step) { const g = lerp(tr.t, tr.p, tA + x) - lerp(tr.t, tr.p, tU + x); gap.push(g); if (g > thresh) { if (Number.isNaN(start)) start = x; end = x; } endGap = g; }
  if (!Number.isNaN(end)) for (let i = Math.round(end / step); i < gap.length; i++) minGap = Math.min(minGap, gap[i]);
  return { start, end, minGap: Number.isFinite(minGap) ? minGap : NaN, endGap };
}

export interface IabpSummary {
  /** Mean peak diastolic pressure of assisted beats (augmented) and of unassisted ones, mmHg; their systolic pressures. */
  peakDiastolicAssisted: number; peakDiastolicUnassisted: number;
  systolicOfAssistedBeat: number; systolicOfUnassistedBeat: number;
  /** End-diastolic pressure at the end of assisted and of unassisted beats, mmHg. */
  edpAssisted: number; edpUnassisted: number;
  /** Systolic pressure of the beat that follows an assisted beat ("assisted systole") and of the beat that follows an unassisted one, mmHg. The relative drop is `systolicUnloading`. */
  nextSystolicAfterAssisted: number; nextSystolicAfterUnassisted: number;
  /** 1 − nextSystolicAfterAssisted / nextSystolicAfterUnassisted. */
  systolicUnloading: number;
  /** Augmentation: peakDiastolicAssisted − systolicOfAssistedBeat, mmHg (positive: the diastolic peak exceeds the beat's own systole). */
  augmentation: number;
  dptiAssisted: number; dptiUnassisted: number;
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);

/** Group beats into assisted and unassisted and average the features (skip the first `skip` beats). Needs both kinds, with an unassisted beat after an assisted one for the "next systolic" pair. */
export function summarizeIabp(beats: readonly (IabpBeat & { assisted: boolean })[], skip = 0): IabpSummary {
  const b = beats.slice(skip), A = b.filter((x) => x.assisted), U = b.filter((x) => !x.assisted);
  const nextA: number[] = [], nextU: number[] = [];
  for (let k = 0; k + 1 < b.length; k++) (b[k].assisted ? nextA : nextU).push(b[k + 1].systolic);
  const m = (arr: typeof b, f: (x: IabpBeat) => number) => mean(arr.map(f));
  const pdA = m(A, (x) => x.peakDiastolic), sA = m(A, (x) => x.systolic);
  return {
    peakDiastolicAssisted: pdA, peakDiastolicUnassisted: m(U, (x) => x.peakDiastolic), systolicOfAssistedBeat: sA, systolicOfUnassistedBeat: m(U, (x) => x.systolic),
    edpAssisted: m(A, (x) => x.edp), edpUnassisted: m(U, (x) => x.edp),
    nextSystolicAfterAssisted: mean(nextA), nextSystolicAfterUnassisted: mean(nextU), systolicUnloading: 1 - mean(nextA) / mean(nextU),
    augmentation: pdA - sA, dptiAssisted: m(A, (x) => x.dpti), dptiUnassisted: m(U, (x) => x.dpti),
  };
}
