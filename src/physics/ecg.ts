import { AF, ALL_LEADS, BBB, Bbb, LEAD_AXES, LeadName, RHYTHM, ST, TERRITORY, T_CENTER, T_WIDTH, Vec3, WAVES } from "../config/ecg";

export type Territory = keyof typeof TERRITORY;

/** Seeded RNG so every run (and every test) is repeatable. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Beat {
  t: number; // R-peak time (s); for a blocked P wave, the time its R would have fallen at a normal PR
  rr: number; // interval used for repolarization timing (s)
  pvc: boolean;
  pr?: number; // s from P-wave peak to R (default: normal)
  pOnly?: boolean; // atrial depolarization that did not conduct (AV block)
  noP?: boolean; // ventricular complex with no preceding P (junctional escape, or atrial fibrillation)
  bbb?: Bbb; // conducted with a bundle branch block
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gauss = (t: number, c: number, w: number) => Math.exp(-0.5 * ((t - c) / w) ** 2);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const heartRate = (severity: number) => RHYTHM.baseHr + RHYTHM.hrRiseAtFullIschemia * severity;

/** Beat times from t0 to t1. Severity (a function of time) sets rate and PVC probability. */
export function generateBeats(t1: number, severity: (t: number) => number, seed = 1, t0 = 0): Beat[] {
  const rng = mulberry32(seed);
  const beats: Beat[] = [];
  let t = t0 + 0.4;
  while (t < t1) {
    const s = severity(t);
    const rr = (60 / heartRate(s)) * (1 + RHYTHM.hrv * (2 * rng() - 1));
    const over = Math.max(0, (s - RHYTHM.pvcOnsetSeverity) / (1 - RHYTHM.pvcOnsetSeverity));
    const pvc = rng() < RHYTHM.pvcMaxProbability * over;
    beats.push({ t, rr, pvc: false });
    if (pvc) {
      const tp = t + rr * RHYTHM.pvcCoupling;
      beats.push({ t: tp, rr, pvc: true });
      t = tp + rr * (2 - RHYTHM.pvcCoupling); // compensatory pause
    } else t += rr;
  }
  return beats;
}

/** Dipole (heart vector, mV) at time t for one beat. */
function beatVector(dt: number, beat: Beat, injury: Vec3, tBoost: number): Vec3 {
  const out: [number, number, number] = [0, 0, 0];
  const add = (v: Vec3, k: number) => {
    out[0] += v[0] * k; out[1] += v[1] * k; out[2] += v[2] * k;
  };
  if (beat.pvc) {
    // Wide, tall, premature QRS with discordant (inverted) T and no P wave.
    const w = RHYTHM.pvcWidthScale;
    add(WAVES.R.v, RHYTHM.pvcAmpScale * gauss(dt, 0.02, WAVES.R.w * w));
    add(WAVES.S.v, RHYTHM.pvcAmpScale * gauss(dt, 0.02 + WAVES.S.w * w * 1.6, WAVES.S.w * w));
    add(WAVES.T.v, -0.8 * gauss(dt, 0.28, 0.07));
    return out;
  }
  if (!beat.noP) add(WAVES.P.v, gauss(dt, -(beat.pr ?? -WAVES.P.t), WAVES.P.w));
  if (beat.pOnly) return out;
  const tc = T_CENTER(beat.rr), tw = T_WIDTH(beat.rr), bbb = beat.bbb ?? "none";
  // Injury current flows during the ST segment (J point → end of T); a block's discordant ST shares the window.
  const win = sigmoid((dt - ST.jPoint) / ST.edge) - sigmoid((dt - (tc + 2 * tw)) / ST.edge);
  if (bbb === "lbbb") {
    // No septal q; one broad wave toward the late left ventricle; repolarization runs the other way.
    const L = BBB.lbbb;
    add(L.r.v, gauss(dt, L.r.t, L.r.w));
    add(L.s.v, gauss(dt, L.s.t, L.s.w));
    add(L.t, (1 + tBoost) * gauss(dt, tc + 0.03, tw * 1.2));
    add(L.st, win);
  } else {
    add(WAVES.Q.v, gauss(dt, WAVES.Q.t, WAVES.Q.w));
    add(WAVES.R.v, gauss(dt, WAVES.R.t, WAVES.R.w));
    add(WAVES.S.v, gauss(dt, WAVES.S.t, WAVES.S.w));
    add(WAVES.T.v, (1 + tBoost) * gauss(dt, tc, tw));
    if (bbb === "rbbb") {
      // The right ventricle depolarizes late through muscle: a terminal rightward-anterior wave after the normal QRS.
      const R = BBB.rbbb;
      add(R.rPrime.v, gauss(dt, R.rPrime.t, R.rPrime.w));
      add(R.t, gauss(dt, tc + 0.02, tw));
      add(R.st, win);
    }
  }
  add(injury, win);
  return out;
}

/** Fibrillatory baseline (mV) at time t: a small wandering wave along the atrial axis, around AF.fWaveHz. */
export function fWaves(t: number, amplitude: number): Vec3 {
  if (amplitude <= 0) return [0, 0, 0];
  const w = 2 * Math.PI * AF.fWaveHz;
  const f = amplitude * (0.7 * Math.sin(w * t) + 0.5 * Math.sin(w * 1.37 * t + 1.1) + 0.3 * Math.sin(w * 0.61 * t + 2.3)) * (0.75 + 0.25 * Math.sin(2.2 * t));
  const a = WAVES.P.v, n = Math.hypot(a[0], a[1], a[2]);
  return [(a[0] / n) * f, (a[1] / n) * f, (a[2] / n) * f];
}

/** Injury vector (mV) for a single culprit territory at a given severity. */
export const territoryInjury = (territory: Territory, severity: number): Vec3 =>
  TERRITORY[territory].map((c) => c * ST.fullScaleMv * severity) as unknown as Vec3;

/** Voltage (mV) of all 15 leads at time t for an arbitrary injury vector (mV), hyperacute T boost and f-wave amplitude. */
export function sampleLeadsVec(t: number, beats: Beat[], injury: Vec3, tBoost: number, fWave = 0): Record<LeadName, number> {
  const v: [number, number, number] = fWaves(t, fWave) as [number, number, number];
  for (const b of beats) {
    const dt = t - b.t;
    if (dt < -0.5 || dt > 0.8) continue;
    const bv = beatVector(dt, b, injury, tBoost);
    v[0] += bv[0]; v[1] += bv[1]; v[2] += bv[2];
  }
  const out = {} as Record<LeadName, number>;
  for (const l of ALL_LEADS) out[l] = dot(LEAD_AXES[l], v);
  return out;
}

/** Voltage (mV) of all 12 leads at time t for one culprit territory. */
export const sampleLeads = (t: number, beats: Beat[], severity: number, territory: Territory = "LAD") =>
  sampleLeadsVec(t, beats, territoryInjury(territory, severity), ST.tBoost * severity);

/** Render `seconds` of 12-lead ECG at `fs` Hz. */
export function synthesize(opts: {
  seconds: number; fs?: number; severity: (t: number) => number; territory?: Territory; seed?: number;
}): { fs: number; beats: Beat[]; leads: Record<LeadName, Float32Array> } {
  const fs = opts.fs ?? 250;
  const n = Math.floor(opts.seconds * fs);
  const beats = generateBeats(opts.seconds, opts.severity, opts.seed ?? 1);
  const leads = Object.fromEntries(ALL_LEADS.map((l) => [l, new Float32Array(n)])) as Record<LeadName, Float32Array>;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const s = sampleLeads(t, beats, opts.severity(t), opts.territory);
    for (const l of ALL_LEADS) leads[l][i] = s[l];
  }
  return { fs, beats, leads };
}

/** ST level (mV) of a lead for one beat: voltage at J+60 ms relative to the PR baseline. */
export const stLevel = (lead: LeadName, beat: Beat, beats: Beat[], severity: number, territory: Territory = "LAD") =>
  stLevelVec(lead, beat, beats, territoryInjury(territory, severity), ST.tBoost * severity);

/** ST level (mV) of every lead for one beat under an arbitrary injury vector. */
export function stLevelVec(lead: LeadName, beat: Beat, beats: Beat[], injury: Vec3, tBoost: number): number {
  // Baseline before the QRS (a broad LBBB R starts early, so measure a little further back for it).
  const back = beat.bbb === "lbbb" ? 0.11 : 0.07;
  const base = sampleLeadsVec(beat.t - back, beats, injury, tBoost)[lead];
  return sampleLeadsVec(beat.t + ST.measureAt, beats, injury, tBoost)[lead] - base;
}
