import { LYTE } from "../config/electrolytes";
import type { RhythmState } from "./rhythm";

/**
 * Serum potassium, calcium and magnesium as the ECG and the conduction system show them. `electrolyteEffects` turns the three levels into
 * a waveform change (`morph`, drawn by physics/ecg.ts on every beat of the patient's own rhythm), a PR change, a rate change and a floor on
 * the degree of AV block, plus the findings a reader would report. The arrhythmia hazard has its own curve (config/arrhythmia.ts).
 */

/** How the waves of a beat are changed: multipliers on the normal wave, and added voltage. */
export interface LyteMorph {
  tAmp: number; tWidth: number; qtScale: number; // T-wave height, T-wave width, timing of repolarization
  pAmp: number; pWide: number;
  qrsWide: number;
  stDep: number; // fraction of the T vector subtracted through the ST segment
  uAmp: number; // mV, a U wave after the T
}
export interface LyteEffects {
  /** Null when every level is in the normal range: the beats are drawn exactly as before. */
  morph: LyteMorph | null;
  prAdd: number; // s
  rateScale: number; // x the sinus / AF ventricular rate
  avFloor: 0 | 1 | 2 | 3; // the lowest degree of AV block the levels cause
  findings: string[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 at `from`, 1 at `full`, linear between (either direction). */
const ramp = (x: number, from: number, full: number) => clamp01((x - from) / (full - from));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function electrolyteEffects(k: number, ca: number, mg: number): LyteEffects {
  const K = LYTE.k, C = LYTE.ca, M = LYTE.mg;
  const hyperT = ramp(k, K.tFrom, K.tFull), pWane = ramp(k, K.pFrom, K.pGone), prT = ramp(k, K.prFrom, K.prFull), qrsT = ramp(k, K.qrsFrom, K.qrsFull);
  const bradyT = ramp(k, K.brady.from, K.brady.full), hypoT = ramp(k, K.hypoFrom, K.hypoFull);
  const caLow = ramp(ca, C.lowFrom, C.lowFull), caHigh = ramp(ca, C.highFrom, C.highFull), mgLow = ramp(mg, M.lowFrom, M.lowFull);

  const morph: LyteMorph = {
    tAmp: lerp(1, K.tAmpMax, hyperT) * lerp(1, K.tAmpAtFull, hypoT) * lerp(1, C.tAmpAtHighFull, caHigh) * lerp(1, M.tAmpAtLowFull, mgLow),
    tWidth: lerp(1, K.tWidthMin, hyperT),
    qtScale: lerp(1, K.qtAtFull, hypoT) * lerp(1, C.qtAtLowFull, caLow) * lerp(1, C.qtAtHighFull, caHigh) * lerp(1, M.qtAtLowFull, mgLow),
    pAmp: 1 - pWane, pWide: lerp(1, K.pWideMax, pWane),
    qrsWide: lerp(1, K.qrsWideMax, qrsT),
    stDep: K.stDepAtFull * hypoT,
    uAmp: K.uMvAtFull * hypoT,
  };
  const prAdd = K.prAddMax * prT;
  const rateScale = lerp(1, K.brady.rateAtFull, bradyT);
  const avFloor: LyteEffects["avFloor"] = k >= K.block.third ? 3 : k >= K.block.second ? 2 : prAdd > 0.04 ? 1 : 0;

  const findings: string[] = [];
  if (hyperT > 0.15) findings.push(hyperT > 0.6 ? "tall, narrow, peaked T waves" : "tented T waves");
  if (pWane > 0.15) findings.push(pWane > 0.9 ? "no P waves" : "flattened, widened P waves");
  if (prT > 0.3) findings.push("long PR interval");
  if (qrsT > 0.2) findings.push(qrsT > 0.9 ? "very wide QRS merging into the T wave (sine wave)" : "widened QRS");
  if (avFloor >= 2) findings.push(avFloor === 3 ? "complete heart block" : "second-degree AV block");
  if (bradyT > 0.3) findings.push("bradycardia");
  if (hypoT > 0.25) findings.push("flattened T waves", "U waves", "ST depression");
  if (caLow > 0.25) findings.push("prolonged QT (long ST segment)");
  if (caHigh > 0.25) findings.push("short QT");
  if (mgLow > 0.5) findings.push("slightly long QT");

  const normal = Math.abs(morph.tAmp - 1) < 1e-6 && morph.tWidth === 1 && Math.abs(morph.qtScale - 1) < 1e-6 && morph.pAmp === 1 && morph.qrsWide === 1 && morph.stDep === 0 && morph.uAmp === 0;
  return { morph: normal ? null : morph, prAdd, rateScale, avFloor, findings: [...new Set(findings)] };
}

/** The patient's own rhythm with the electrolyte conduction effects laid on: a longer PR, a slower rate, and at least the degree of block the levels cause. */
export function withElectrolytes(r: RhythmState, e: LyteEffects): RhythmState {
  if (e.prAdd === 0 && e.rateScale === 1 && e.avFloor === 0) return r;
  const out: RhythmState = { ...r, sinusRate: r.sinusRate * e.rateScale, afRate: r.afRate * e.rateScale, pr: r.pr + e.prAdd };
  if (e.avFloor > r.avDegree) out.avDegree = e.avFloor;
  return out;
}
