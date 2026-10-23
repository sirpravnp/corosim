/**
 * Left-heart catheterisation (task P8): LV -> aorta pullback, LVEDP, aortic gradients, simultaneous LV-wedge and the valve
 * areas a cath lab would compute. Pure and DOM-free; it reads one beat and the numbers from a HemoSource snapshot
 * (`numbers()`, `beats(1)[0]`: the beat's `pressure` and `valves`).
 *
 * Formulas (pressures mmHg, volumes ml, times s, flows ml/s or L/min, areas cm²):
 *  - LV systolic = max LV; aortic systolic / diastolic = max / min AO; aortic mean = time-average of AO over the beat.
 *  - LVEDP: LV pressure at the onset of systole. dP/dt is the central difference of the LV trace; the rapid rise peaks at
 *    max dP/dt, and the onset is found by walking back from there while dP/dt > ONSET_FRACTION (15 %) of max dP/dt. The
 *    pressure at the first sample at or below that slope is LVEDP. (Atrial-kick slopes are well under 15 % of max dP/dt.)
 *  - Peak-to-peak gradient = max LV - max AO (the two peaks need not coincide).
 *  - Peak instantaneous gradient = max over the beat of (LV - AO).
 *  - Mean aortic gradient = mean of (LV - AO) over the ejection period: the contiguous run of samples with LV > AO that
 *    contains the peak instantaneous gradient.
 *  - Mean mitral (diastolic) gradient = mean of (LA - LV) over the samples with LA > LV (the filling period; LA is the wedge).
 *  - Gorlin, aortic: AVA = (F / SEP) / (44.3 · sqrt(mean gradient)); F = forward volume through the valve per beat
 *    (BeatSummary.valves.AV.forwardMl), SEP = the valve's open time (openMs / 1000), the systolic ejection period.
 *  - Gorlin, mitral: MVA = (F / DFP) / (37.7 · sqrt(mean gradient)); DFP = diastolic filling period = MV openMs / 1000.
 *  - Hakki: area = CO / sqrt(gradient), CO in L/min. Aortic uses the peak-to-peak gradient, mitral the mean diastolic gradient.
 *
 * Areas are NaN (a dash in the panel) when the gradient they divide by is too small to mean anything (config LHC: aortic
 * peak-to-peak or mean under 10 mmHg, mitral mean under 2 mmHg); the severity label is then "none".
 *
 * F is the TOTAL (gross) forward flow, not forward minus regurgitant. A regurgitant valve passes more than the net stroke
 * volume, and using net flow would make a leaky valve look more stenotic than it is. (Hakki uses CO, which is net: it
 * therefore underestimates area in significant regurgitation, as it does at the bedside.)
 *
 * Constants: the engine's orifice law is Q = 44.3 · A · sqrt(dP) at every valve (config/structural.ts GORLIN). The clinical
 * mitral Gorlin constant is 37.7, which is SMALLER, so the clinical formula gives a LARGER number for the same flow and
 * gradient: mitral Gorlin(37.7) = engine area · 44.3 / 37.7 (about 1.18 times). We report that and, beside it, the same
 * measurement with 44.3 (`mitralEngine`), which equals the engine's true orifice. Stenosis grades use the 44.3 area so they
 * agree with the structural page, whose cut-offs (GRADE) are fractions of the engine's normal valve area.
 */
import type { BeatSummary, HemoNumbers } from "./hemoSource";
import { LHC } from "../config/cath";
import { GORLIN, GRADE, PATIENTS, type PatientKind } from "../config/structural";

export const MITRAL_GORLIN = 37.7;
export const ONSET_FRACTION = 0.15;
export type Severity = "none" | "mild" | "moderate" | "severe";

export interface LhcTraces { t: Float32Array; lv: Float32Array; ao: Float32Array; la: Float32Array }
export interface LeftHeartCath {
  hr: number; co: number;
  lv: { systolic: number; lvedp: number; onsetIndex: number };
  ao: { systolic: number; diastolic: number; mean: number };
  /** Aortic gradients, mmHg. */
  gradient: { peakToPeak: number; mean: number; peakInstant: number };
  /** Simultaneous wedge (LA) - LV over diastolic filling. */
  mitral: { meanGradient: number; wedgeMean: number };
  /** cm². `gorlin` uses the clinical constants (44.3 aortic, 37.7 mitral); `engine` uses 44.3 for both. */
  area: { aorticGorlin: number; aorticHakki: number; mitralGorlin: number; mitralEngine: number; mitralHakki: number };
  /** Open times used for SEP and DFP, s, and forward volumes used, ml. */
  sep: number; dfp: number; avForwardMl: number; mvForwardMl: number;
  severity: { aortic: Severity; mitral: Severity };
  /** Sample index ranges [from, to) of the ejection and filling periods on `traces`, for shading. */
  ejection: [number, number]; filling: [number, number];
  traces: LhcTraces;
}

const nan = NaN;
const finite = (x: number) => Number.isFinite(x);
const maxOf = (a: ArrayLike<number>) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };
const minOf = (a: ArrayLike<number>) => { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; };
const meanOf = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : nan; };

/** Index of the systolic onset in an LV pressure trace (see the doc comment). */
export function systolicOnset(lv: ArrayLike<number>, t: ArrayLike<number>): number {
  const n = lv.length;
  if (n < 3) return 0;
  const dp = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) dp[i] = (lv[i + 1] - lv[i - 1]) / Math.max(1e-9, t[i + 1] - t[i - 1]);
  let im = 1;
  for (let i = 1; i < n - 1; i++) if (dp[i] > dp[im]) im = i;
  const lim = ONSET_FRACTION * dp[im];
  let i = im;
  while (i > 0 && dp[i] > lim) i--;
  return i;
}

/** The contiguous run [from, to) of indices where d > 0 that contains `at`. */
function run(d: Float64Array, at: number): [number, number] {
  let a = at, b = at + 1;
  while (a > 0 && d[a - 1] > 0) a--;
  while (b < d.length && d[b] > 0) b++;
  return [a, b];
}

function grade(fraction: number, f: { mild: number; moderate: number; severe: number }): Severity {
  return !finite(fraction) ? "none" : fraction <= f.severe ? "severe" : fraction <= f.moderate ? "moderate" : fraction <= f.mild ? "mild" : "none";
}
const ORDER: Severity[] = ["none", "mild", "moderate", "severe"];

/** The reading a left-heart cath would give, or null before a beat exists. `patient` picks the normal valve areas for grading. */
export function leftHeartCath(n: HemoNumbers, beat: BeatSummary | undefined | null, patient: PatientKind = "adult"): LeftHeartCath | null {
  if (!beat || beat.time.length < 8 || !beat.pressure.LV || !beat.pressure.AO || !beat.pressure.LA) return null;
  const t = beat.time, lv = beat.pressure.LV, ao = beat.pressure.AO, la = beat.pressure.LA, N = lv.length;
  const onset = systolicOnset(lv, t);
  const dAo = new Float64Array(N), dMit = new Float64Array(N);
  let ip = 0;
  for (let i = 0; i < N; i++) { dAo[i] = lv[i] - ao[i]; dMit[i] = la[i] - lv[i]; if (dAo[i] > dAo[ip]) ip = i; }
  const peakInstant = dAo[ip];
  const ejection: [number, number] = peakInstant > 0 ? run(dAo, ip) : [ip, ip];
  const meanAo = ejection[1] > ejection[0] ? meanOf(dAo.subarray(ejection[0], ejection[1])) : 0;
  // filling: samples where LA > LV outside the ejection run
  let mSum = 0, mCount = 0, mFrom = N, mTo = 0;
  for (let i = 0; i < N; i++) if (dMit[i] > 0 && !(i >= ejection[0] && i < ejection[1])) { mSum += dMit[i]; mCount++; mFrom = Math.min(mFrom, i); mTo = Math.max(mTo, i + 1); }
  const meanMit = mCount ? mSum / mCount : 0;

  const lvSys = maxOf(lv), aoSys = maxOf(ao), p2p = lvSys - aoSys;
  const av = beat.valves.AV, mv = beat.valves.MV;
  const sep = av.openMs / 1000, dfp = mv.openMs / 1000;
  const area = (f: number, secs: number, g: number, k: number) => (secs > 0 && g > 0 && f > 0 ? f / secs / (k * Math.sqrt(g)) : nan);
  const aoG = meanAo >= LHC.minAorticGradientMmHg ? meanAo : nan, mitG = meanMit >= LHC.minMitralGradientMmHg ? meanMit : nan;
  const aorticGorlin = area(av.forwardMl, sep, aoG, GORLIN);
  const mitralGorlin = area(mv.forwardMl, dfp, mitG, MITRAL_GORLIN);
  const mitralEngine = area(mv.forwardMl, dfp, mitG, GORLIN);
  const hakki = (g: number, min: number) => (n.co > 0 && g >= min ? n.co / Math.sqrt(g) : nan);

  const normal = PATIENTS[patient].valveAreas;
  let aortic = grade(aorticGorlin / normal.av, GRADE.areaFraction.av);
  if (patient === "adult" && finite(meanAo)) {
    const byMean: Severity = meanAo >= GRADE.asMeanGradient.severe ? "severe" : meanAo >= GRADE.asMeanGradient.moderate ? "moderate" : "none";
    if (ORDER.indexOf(byMean) > ORDER.indexOf(aortic)) aortic = byMean;
  }
  const mitral = grade(mitralEngine / normal.mv, GRADE.areaFraction.mv);

  return {
    hr: n.hr, co: n.co,
    lv: { systolic: lvSys, lvedp: lv[onset], onsetIndex: onset },
    ao: { systolic: aoSys, diastolic: minOf(ao), mean: meanOf(ao) },
    gradient: { peakToPeak: p2p, mean: meanAo, peakInstant },
    mitral: { meanGradient: meanMit, wedgeMean: meanOf(la) },
    area: { aorticGorlin, aorticHakki: hakki(p2p, LHC.minAorticGradientMmHg), mitralGorlin, mitralEngine, mitralHakki: hakki(meanMit, LHC.minMitralGradientMmHg) },
    sep, dfp, avForwardMl: av.forwardMl, mvForwardMl: mv.forwardMl,
    severity: { aortic, mitral },
    ejection, filling: mCount ? [mFrom, mTo] : [0, 0],
    traces: { t, lv, ao, la },
  };
}
