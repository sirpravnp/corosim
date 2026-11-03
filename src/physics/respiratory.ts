import { RESPIRATORY } from "../config/thorax";

/**
 * One beat as these outputs need it (a `LiveBeat` or `BeatHemo` record has these fields; for a peripheral arterial line take the
 * systolic and diastolic of a peripheral node such as the descending aorta).
 *  - t: time of the beat (s), any fixed point of the beat;
 *  - systolic, diastolic: arterial pressures, mmHg;
 *  - strokeVolume: ml.
 */
export interface RespBeat { t: number; systolic: number; diastolic: number; strokeVolume: number }

/** Result over several breaths. `breaths` counts the breaths used (those with enough beats). */
export interface Variation { value: number; breaths: number }

type Metric = (b: RespBeat) => number;

/** Beats grouped by breath: breath k holds the beats with t0 + k·T ≤ t < t0 + (k+1)·T, T = breath period (s). Breaths with fewer than `min` beats are dropped. */
export function beatsByBreath(beats: readonly RespBeat[], breathPeriodS: number, t0 = 0, min: number = RESPIRATORY.minBeatsPerBreath): RespBeat[][] {
  const groups = new Map<number, RespBeat[]>();
  if (!(breathPeriodS > 0)) return [];
  for (const b of beats) {
    if (!Number.isFinite(b.t)) continue;
    const k = Math.floor((b.t - t0) / breathPeriodS + 1e-9);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).filter((g) => g.length >= min);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);

function perBreath(beats: readonly RespBeat[], T: number, t0: number, f: (g: RespBeat[]) => number): Variation {
  const v = beatsByBreath(beats, T, t0).map(f).filter(Number.isFinite);
  return { value: mean(v), breaths: v.length };
}

const spread = (g: RespBeat[], m: Metric) => { const x = g.map(m); return { max: Math.max(...x), min: Math.min(...x), mean: mean(x) }; };

/**
 * Pulsus paradoxus, mmHg: over each breath the highest systolic pressure minus the lowest (the fall from expiration to inspiration
 * in spontaneous breathing, where the nadir is inspiratory), averaged over the breaths. Normal under 10 mmHg (a few mmHg in quiet
 * breathing); above 10 mmHg is pulsus paradoxus. `breathPeriodS` = 60/rate; `t0` = start of a breath on the beat clock.
 */
export function pulsusParadoxus(beats: readonly RespBeat[], breathPeriodS: number, t0 = 0): Variation {
  return perBreath(beats, breathPeriodS, t0, (g) => { const s = spread(g, (b) => b.systolic); return s.max - s.min; });
}

/**
 * Pulse-pressure variation, fraction: with PP = systolic − diastolic of each beat, (PPmax − PPmin)/mean PP over a breath, averaged
 * over the breaths. (Michard's clinical form divides by (PPmax + PPmin)/2; the mean of the beats is within a few percent of it.)
 * Above about 0.13 in a ventilated patient without arrhythmia predicts fluid responsiveness.
 */
export function pulsePressureVariation(beats: readonly RespBeat[], breathPeriodS: number, t0 = 0): Variation {
  const pp: Metric = (b) => b.systolic - b.diastolic;
  return perBreath(beats, breathPeriodS, t0, (g) => { const s = spread(g, pp); return (s.max - s.min) / s.mean; });
}

/** Stroke-volume variation, fraction: (SVmax − SVmin)/mean SV over a breath, averaged over the breaths. */
export function strokeVolumeVariation(beats: readonly RespBeat[], breathPeriodS: number, t0 = 0): Variation {
  const sv: Metric = (b) => b.strokeVolume;
  return perBreath(beats, breathPeriodS, t0, (g) => { const s = spread(g, sv); return (s.max - s.min) / s.mean; });
}
