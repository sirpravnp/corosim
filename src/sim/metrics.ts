/** One ventricular beat as the headless simulation records it. */
export interface BeatRecord {
  n: number; t: number; // beat index and time (s)
  interval: number; // s since the previous ventricular beat
  hr: number; // bpm, instantaneous (60 / interval)
  sbp: number; dbp: number; map: number; // mmHg; map ≈ diastolic + ⅓ pulse
  sv: number; // ml
  pvc: boolean; atrialKick: boolean;
  sympathetic: number; vagal: number; // autonomic tone 0..1
  afferent: number; // −1..1 baroreceptor drive
  respPhase: number; // rad, 0 = start of inspiration
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a: number[]) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r = (x: number, d = 1) => (Number.isFinite(x) ? +x.toFixed(d) : null);

export interface Metrics {
  durationS: number; beats: number; pvcs: number;
  hr: { mean: number | null; min: number | null; max: number | null };
  sbp: { mean: number | null; sd: number | null }; dbp: { mean: number | null }; map: { mean: number | null; sd: number | null };
  strokeVolume: { mean: number | null; cv: number | null };
  hrv: { sdnnMs: number | null; rmssdMs: number | null; pnn50: number | null; lfMs2: number | null; hfMs2: number | null; lfHf: number | null; lfPeakHz: number | null } | null;
  baroreflexSensitivity: { msPerMmHg: number | null; sequences: number };
  respiratorySinusArrhythmia: { peakToTroughMs: number | null };
  note: string;
}

/** Normal-to-normal intervals: drop PVCs and the beat after each (compensatory pause), as HRV convention requires. */
export function nnSeries(beats: BeatRecord[]): { t: number[]; rr: number[]; sbp: number[] } {
  const t: number[] = [], rr: number[] = [], sbp: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].pvc || beats[i - 1].pvc) continue;
    t.push(beats[i].t); rr.push(beats[i].interval * 1000); sbp.push(beats[i].sbp);
  }
  return { t, rr, sbp };
}

/**
 * Sequence-method baroreflex sensitivity: runs of ≥3 beats where systolic pressure and the *following*
 * RR interval move in the same direction, with r² ≥ 0.85; BRS is the mean regression slope (ms/mmHg).
 */
export function sequenceBrs(beats: BeatRecord[]): { brs: number | null; sequences: number } {
  const slopes: number[] = [];
  const x = beats.map((b) => b.sbp), y = beats.map((b, i) => (i + 1 < beats.length && !b.pvc && !beats[i + 1].pvc ? beats[i + 1].interval * 1000 : NaN));
  let i = 0;
  while (i < beats.length - 3) {
    const dir = Math.sign(x[i + 1] - x[i]);
    let j = i;
    while (j + 1 < beats.length - 1 && dir !== 0 && Math.sign(x[j + 1] - x[j]) === dir && Math.sign(y[j + 1] - y[j]) === dir && Number.isFinite(y[j + 1]) && Number.isFinite(y[j])) j++;
    if (j - i + 1 >= 3) {
      const xs = x.slice(i, j + 1), ys = y.slice(i, j + 1), mx = mean(xs), my = mean(ys);
      let sxy = 0, sxx = 0, syy = 0;
      for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
      if (sxx > 0 && syy > 0 && (sxy * sxy) / (sxx * syy) >= 0.85) slopes.push(sxy / sxx);
      i = j + 1;
    } else i++;
  }
  return { brs: slopes.length ? r(mean(slopes)) : null, sequences: slopes.length };
}

/** Power of an evenly resampled, detrended RR tachogram at frequency f, Hann-windowed, in ms²/Hz. */
function psd(rr: number[], fs: number, f: number): number {
  const n = rr.length, m = mean(rr);
  let re = 0, im = 0, w2 = 0;
  for (let k = 0; k < n; k++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (n - 1)));
    const v = (rr[k] - m) * w;
    re += v * Math.cos((2 * Math.PI * f * k) / fs); im -= v * Math.sin((2 * Math.PI * f * k) / fs); w2 += w * w;
  }
  return ((re * re + im * im) / (fs * w2)) * 2;
}

/** Heart-rate variability from beats: time-domain always, frequency-domain when there are ≥ 60 s of normal beats. */
export function hrv(beats: BeatRecord[]): Metrics["hrv"] {
  const { t, rr } = nnSeries(beats);
  if (rr.length < 10) return null;
  const d = rr.slice(1).map((v, i) => v - rr[i]);
  const out = {
    sdnnMs: r(sd(rr)), rmssdMs: r(Math.sqrt(mean(d.map((x) => x * x)))), pnn50: r((100 * d.filter((x) => Math.abs(x) > 50).length) / d.length),
    lfMs2: null as number | null, hfMs2: null as number | null, lfHf: null as number | null, lfPeakHz: null as number | null,
  };
  if (t[t.length - 1] - t[0] < 60) return out;
  const fs = 4, n = Math.floor((t[t.length - 1] - t[0]) * fs);
  const ev: number[] = [];
  for (let k = 0, p = 0; k < n; k++) {
    const tk = t[0] + k / fs;
    while (p < t.length - 2 && t[p + 1] < tk) p++;
    ev.push(rr[p] + ((rr[p + 1] - rr[p]) * (tk - t[p])) / (t[p + 1] - t[p]));
  }
  const df = 0.005; let lf = 0, hf = 0, peak = 0, peakP = 0;
  for (let f = 0.04; f < 0.4; f += df) {
    const p = psd(ev, fs, f);
    if (f < 0.15) { lf += p * df; if (p > peakP) { peakP = p; peak = f; } } else hf += p * df;
  }
  out.lfMs2 = r(lf); out.hfMs2 = r(hf); out.lfHf = hf > 0 ? r(lf / hf, 2) : null; out.lfPeakHz = r(peak, 3);
  return out;
}

/** Respiratory sinus arrhythmia as the mean RR difference between the end-inspiratory and end-expiratory halves of the cycle. */
export function rsaPeakToTrough(beats: BeatRecord[]): number | null {
  const insp: number[] = [], exp: number[] = [];
  for (const b of beats) { if (b.pvc) continue; (Math.cos(b.respPhase) < 0 ? insp : exp).push(b.interval * 1000); }
  return insp.length > 5 && exp.length > 5 ? r(mean(exp) - mean(insp)) : null;
}

/**
 * Mean heart rate of a run of beats, bpm: beats per minute over the time they took (60 x n / total interval), not the mean of each
 * beat's instantaneous 60/interval. With irregular intervals (a premature beat then its pause, atrial fibrillation) the mean of
 * reciprocals reads high: intervals of 0.34 s and 0.81 s are 176 and 74 bpm, mean 125, but two beats in 1.15 s is 104 bpm.
 */
export function meanRate(beats: readonly { interval: number }[]): number {
  const T = beats.reduce((s, b) => s + b.interval, 0);
  return T > 0 ? (60 * beats.length) / T : NaN;
}

export function computeMetrics(beats: BeatRecord[], durationS: number): Metrics {
  const hrs = beats.map((b) => b.hr), sv = beats.map((b) => b.sv);
  const brs = sequenceBrs(beats);
  return {
    durationS: r(durationS) as number, beats: beats.length, pvcs: beats.filter((b) => b.pvc).length,
    hr: { mean: r(meanRate(beats)), min: r(Math.min(...hrs)), max: r(Math.max(...hrs)) },
    sbp: { mean: r(mean(beats.map((b) => b.sbp))), sd: r(sd(beats.map((b) => b.sbp))) },
    dbp: { mean: r(mean(beats.map((b) => b.dbp))) },
    map: { mean: r(mean(beats.map((b) => b.map))), sd: r(sd(beats.map((b) => b.map))) },
    strokeVolume: { mean: r(mean(sv)), cv: r((100 * sd(sv)) / mean(sv)) },
    hrv: hrv(beats), baroreflexSensitivity: { msPerMmHg: brs.brs, sequences: brs.sequences },
    respiratorySinusArrhythmia: { peakToTroughMs: rsaPeakToTrough(beats) },
    note: "Frequency-domain HRV needs ≥ 60 s of normal beats; baroreflex sensitivity uses the sequence method (≥3 beats, r² ≥ 0.85).",
  };
}
