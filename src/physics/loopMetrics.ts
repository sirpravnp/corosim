/**
 * PV-loop metrics and myocardial oxygen use (E1). Pure functions of one beat's pressure and volume samples of a ventricle
 * (mmHg, ml, in time order, one beat) plus the chamber's V0 and, where wanted, Ees. No engine state; not wired into any panel.
 *
 *   stroke work   SW  = |∮ P dV|                                   mmHg·ml (×1.333e-4 for J)
 *   PVA           PVA = SW + PE,  PE = ½·Pes·(Ves − V0)             mmHg·ml   (Suga)
 *   MVO2          = a·PVA + b·Ees + c  (per 100 g, scaled to the muscle mass, see config/energetics.ts)
 *   Ea = Pes/SV;  Ees = model value, else Pes/(Ves − V0);  coupling Ea/Ees
 *   CPO = MAP·CO/451  W;  efficiency = SW/PVA
 *
 * End-systolic point: the sample of maximum P/(V − V0), the instantaneous elastance, i.e. the upper-left corner of the loop (the
 * "maximum P/V elastance" point, not the instant of aortic valve closure). With an ejecting ventricle the two coincide within a sample
 * or two; with an Impella unloading the LV there may be no valve closure at all and this point is still defined.
 */
import { ENERGETICS } from "../config/energetics";
import { cleanLoop, loopArea, type Pt } from "./loopMath";

export interface EsPoint extends Pt { index: number }

/** Stroke work, mmHg·ml: the area of the loop ∮P dV, closed from the last sample to the first. 0 with fewer than 3 samples. Positive for a counter-clockwise loop in (V, P). */
export function strokeWork(P: ArrayLike<number>, V: ArrayLike<number>): number { return Math.abs(loopArea(P, V)); }
/** Stroke work in joules (mmHg·ml × 1.333e-4). */
export function toJoules(mmHgMl: number): number { return mmHgMl * ENERGETICS.jPerMmHgMl; }

/** End-systolic point: the sample of maximum P/(V − V0) (samples with V ≤ V0 are skipped). Null when none. `index` is into the cleaned (finite) sample list. */
export function esPoint(P: ArrayLike<number>, V: ArrayLike<number>, v0: number): EsPoint | null {
  let best: EsPoint | null = null, bestE = -Infinity;
  cleanLoop(P, V).forEach((q, index) => { const x = q.v - v0; if (x <= 1e-6) return; const e = q.p / x; if (e > bestE) { bestE = e; best = { ...q, index }; } });
  return best;
}

/** Potential energy PE = ½·Pes·(Ves − V0), mmHg·ml: the area of the triangle under the ESPVR from V0 to the end-systolic point. */
export function potentialEnergy(es: Pt, v0: number): number { return 0.5 * es.p * Math.max(es.v - v0, 0); }

/** Pressure-volume area PVA = SW + PE, mmHg·ml per beat. */
export function pressureVolumeArea(P: ArrayLike<number>, V: ArrayLike<number>, v0: number): number {
  const es = esPoint(P, V, v0); return es ? strokeWork(P, V) + potentialEnergy(es, v0) : NaN;
}

export interface Mvo2Opts {
  /** Heart rate, 1/min, for the per-minute value. */
  hr: number;
  /** Muscle mass, g (default `ENERGETICS.lvMassG`; use `rvMassG` for the right ventricle). */
  massG?: number;
}
export interface Mvo2 { perBeatMl: number; perMinMl: number; per100gPerMinMl: number }

/**
 * MVO2 = a·PVA100 + b·Ees100 + c per 100 g (Suga), times M/100. PVA in mmHg·ml/beat, Ees in mmHg/ml (the whole ventricle), massG in g;
 * PVA100 = PVA/(M/100) and Ees100 = Ees·(M/100) because volume scales with mass. Returns ml O2 per beat, per minute, and per minute per 100 g.
 */
export function mvo2(pva: number, ees: number, o: Mvo2Opts): Mvo2 {
  const k = (o.massG ?? ENERGETICS.lvMassG) / 100, { a, b, c } = ENERGETICS;
  const per100 = a * (pva / k) + b * (ees * k) + c, perBeatMl = per100 * k;
  return { perBeatMl, perMinMl: perBeatMl * o.hr, per100gPerMinMl: per100 * o.hr };
}

/** Cardiac power output, W: MAP (mmHg) × CO (L/min) / 451. Normal about 1 W; below 0.6 W in cardiogenic shock predicts death (Fincke 2004). */
export function cardiacPowerOutput(mapMmHg: number, coLmin: number): number { return (mapMmHg * coLmin) / ENERGETICS.cpoDivisor; }

/** Peak rise and fall of pressure, mmHg/s (min is negative). `t` is the sample times (s) or a uniform step dt (s). NaN with fewer than 2 samples. */
export function dPdt(P: ArrayLike<number>, t: ArrayLike<number> | number): { max: number; min: number } {
  let max = -Infinity, min = Infinity;
  for (let i = 1; i < P.length; i++) {
    const dt = typeof t === "number" ? t : t[i] - t[i - 1], d = (P[i] - P[i - 1]) / dt;
    if (!Number.isFinite(d)) continue;
    if (d > max) max = d; if (d < min) min = d;
  }
  return Number.isFinite(max) ? { max, min } : { max: NaN, min: NaN };
}

export interface LoopMetricsOpts {
  v0: number;
  /** Ees from the model (mmHg/ml, with any contractility gain); absent: the end-systolic point Pes/(Ves − V0). */
  ees?: number;
  hr: number;
  /** Sample times (s) or uniform step (s), for dP/dt. */
  t?: ArrayLike<number> | number;
  massG?: number;
  /** Relaxation time constant from the BeatRecorder (`BeatRecord.tauMs`), ms; passed through. */
  tauMs?: number;
}
export interface LoopMetrics {
  edv: number; esv: number; sv: number; ef: number; // ml, ml, ml, fraction
  pes: number; ves: number; // mmHg, ml: the end-systolic point
  strokeWork: number; strokeWorkJ: number; pe: number; pva: number; pvaJ: number; // mmHg·ml, J, mmHg·ml, mmHg·ml, J
  efficiency: number; // SW/PVA, 0..1
  ea: number; ees: number; coupling: number; // mmHg/ml, mmHg/ml, Ea/Ees
  dpdtMax: number; dpdtMin: number; // mmHg/s
  tauMs: number;
  mvo2: Mvo2;
}

/** All loop metrics of one beat. SV = max V − min V, EF = SV/max V, Ea = Pes/SV. NaN fields when there is no usable loop. */
export function loopMetrics(P: ArrayLike<number>, V: ArrayLike<number>, o: LoopMetricsOpts): LoopMetrics {
  const pts = cleanLoop(P, V), es = esPoint(P, V, o.v0);
  const edv = pts.length ? Math.max(...pts.map(q => q.v)) : NaN, esv = pts.length ? Math.min(...pts.map(q => q.v)) : NaN, sv = edv - esv;
  const pes = es ? es.p : NaN, ves = es ? es.v : NaN;
  const sw = pts.length >= 3 ? strokeWork(P, V) : NaN, pe = es ? potentialEnergy(es, o.v0) : NaN, pva = sw + pe;
  const eesEff = o.ees ?? (es ? pes / (ves - o.v0) : NaN), ea = pes / sv;
  const d = o.t !== undefined ? dPdt(P, o.t) : { max: NaN, min: NaN };
  return {
    edv, esv, sv, ef: sv / edv, pes, ves, strokeWork: sw, strokeWorkJ: toJoules(sw), pe, pva, pvaJ: toJoules(pva), efficiency: sw / pva,
    ea, ees: eesEff, coupling: ea / eesEff, dpdtMax: d.max, dpdtMin: d.min, tauMs: o.tauMs ?? NaN, mvo2: mvo2(pva, eesEff, { hr: o.hr, massG: o.massG }),
  };
}
