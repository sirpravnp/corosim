import { mulberry32 } from "./ecg";

/**
 * Closed-loop autonomic control with respiration and physiological noise, stepped in continuous time.
 *
 *   arterial pressure (per beat) ─▶ baroreceptor sigmoid ─┬─▶ vagal arm        fast: ~0.6 s latency, τ 0.4 s
 *                                                         └─▶ sympathetic arm  slow: ~1.7 s latency, τ 1.5 s
 *   tone ─▶ heart rate, contractility, vascular resistance (resistance adds a further τ of several s)
 *
 * The slow sympathetic arm plus the delay put a resonance at about 0.13 Hz (the Mayer wave; in people ~0.1 Hz). Noise pushed through
 * the loop shows up as heart-rate and blood-pressure variability; nothing here is a fixed sinusoid except
 * respiration, whose vagal gating produces respiratory sinus arrhythmia (RSA).
 *
 * Ischemic reflexes (Bezold–Jarisch, pain-driven sympathetic surge) stay open-loop in rhythm.ts / circulation.ts;
 * this module adds the pressure feedback around them. Tone is relative to a resting set point, so with a
 * normal pressure the effect on rate and contractility is 1.0.
 * All constants are teaching assumptions, not measured values.
 */
export const AUTONOMIC = {
  // baroreceptor afferent: logistic in sensed pressure, centred on the set point
  setPoint: 88.7, // mmHg of sensed pressure at which the curve is steepest and the reflex is neutral
  width: 15, // mmHg; slope at the set point = 1/(2·width) per mmHg on the normalised −1..1 afferent
  pulseWeight: 1 / 3, // sensed = diastolic + weight × pulse pressure
  // resting tone (0..1) and how far the loop can push it
  restSympathetic: 0.3, restVagal: 0.4,
  sympatheticGain: 0.5, vagalGain: 0.35,
  // arm dynamics (s)
  vagalDelay: 0.1, vagalTau: 0.4, // + ~0.5 s of beat look-ahead = ~0.6 s total vagal latency
  sympatheticDelay: 1.2, sympatheticTau: 1.5, vascularTau: 4.0,
  // effector sensitivities: effect = (1 + k·tone) / (1 + k·restingTone)
  hrSympathetic: 0.8, hrVagal: 0.6, // vagal enters as (1 − k·tone)
  contractility: 0.3,
  resistance: 1.5, // vasoconstriction has the most reserve (SVR +55 % at full drive)
  venous: 0.15, // preload gain from sympathetic venoconstriction
  // Below the baroreceptor range the CNS ischemic response takes over, and low filling pressure drives sympathetic
  // tone through cardiopulmonary receptors regardless of arterial pressure.
  cnsOnset: 60, cnsFull: 40, // mmHg of sensed pressure
  cnsSympathetic: 0.5, cnsVascular: 1.2, cnsTau: 3,
  volumeSympathetic: 0.7, volumeVagal: 0.45, // tone added per unit fraction of blood volume lost
  volumeVascularShare: 0.3, // the volume reflex acts mostly on the heart and veins, only partly on resistance
  // respiration
  respRate: 15, // breaths/min
  respDepth: 1, // 0..2 scale on tidal volume
  rsaVagal: 0.10, // peak vagal-tone swing at 15/min and depth 1 (≈ ±6 % in heart rate)
  rsaCutoff: 0.35, // Hz: central RSA gain falls as 1/√(1+(f/fc)²)
  rsaLag: 0.5, // rad: vagal inhibition peaks slightly after inspiration starts
  intrathoracicSv: 0.04, // fractional stroke-volume swing with tidal breathing (inspiratory dip)
  // physiological noise: Ornstein–Uhlenbeck (σ is the stationary standard deviation)
  noiseSympathetic: { sigma: 0.05, tau: 6 },
  noiseVagal: { sigma: 0.025, tau: 1.2 },
  noiseResistance: { sigma: 0.015, tau: 12 },
  noiseContractility: 0.025, // white, per beat (log-normal σ)
  sinusJitter: 0.012, // intrinsic sinus-node cycle-length jitter (uniform ±)
};
export type AutonomicParams = typeof AUTONOMIC;

export interface AutonomicControls {
  /** Multiplies both baroreflex arms. 0 = denervated, 1 = normal, 2–3 = enough loop gain for sustained Mayer oscillation. */
  baroreflexGain: number;
  /** Fraction of β-adrenergic effect removed (heart rate and contractility). */
  betaBlock: number;
  /** Fraction of vagal effect on the sinus node removed (atropine). */
  vagalBlock: number;
  /** Added to the sensed pressure's set point (mmHg): chronic hypertension resets the curve upward. */
  setPointShift: number;
  respRate: number; // breaths/min
  respDepth: number; // 0..2
  /** Multiplies the noise terms. 0 gives a deterministic loop. */
  noiseScale: number;
  /** 0..~0.5: fraction of blood volume lost, as seen by cardiopulmonary receptors. Set by the simulation, not by users. */
  volumeDeficit: number;
}
export const defaultControls = (): AutonomicControls => ({
  baroreflexGain: 1, betaBlock: 0, vagalBlock: 0, setPointShift: 0,
  respRate: AUTONOMIC.respRate, respDepth: AUTONOMIC.respDepth, noiseScale: 1, volumeDeficit: 0,
});

/** Standard normal from a uniform source (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Ornstein–Uhlenbeck process with an exact discretisation, so the result does not depend on the step size. */
export class OU {
  x = 0;
  constructor(private rng: () => number, public sigma: number, public tau: number) { this.x = sigma * gaussian(rng); }
  step(dt: number, scale = 1): number {
    const a = Math.exp(-dt / this.tau);
    this.x = this.x * a + this.sigma * scale * Math.sqrt(1 - a * a) * gaussian(this.rng);
    return this.x;
  }
}

/** A value looked up `delay` seconds ago from a stream of samples. */
class DelayLine {
  private ts: number[] = []; private vs: number[] = [];
  constructor(private keep: number) {}
  push(t: number, v: number) { this.ts.push(t); this.vs.push(v); while (this.ts.length > 2 && this.ts[1] < t - this.keep) { this.ts.shift(); this.vs.shift(); } }
  at(t: number): number {
    const n = this.ts.length;
    if (!n) return 0;
    if (t <= this.ts[0]) return this.vs[0];
    if (t >= this.ts[n - 1]) return this.vs[n - 1];
    let i = n - 1; while (this.ts[i - 1] > t) i--;
    const f = (t - this.ts[i - 1]) / (this.ts[i] - this.ts[i - 1]);
    return this.vs[i - 1] + (this.vs[i] - this.vs[i - 1]) * f;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface AutonomicEffects {
  sympathetic: number; vagal: number; // tone, 0..1
  hrScale: number; // multiplies the sinus rate (slow tones only; respiration is added by hrScaleAt)
  contractility: number; resistance: number; // multipliers on stroke volume and systemic resistance
  preloadResp: number; // multiplier on filling from breathing and venous tone
  vascular: number; // vascular sympathetic tone, 0..1.6 (the venoconstriction drive; rests at restSympathetic)
  afferent: number; // −1..1, normalised baroreceptor drive (+ = pressure above the set point)
  respPhase: number; // rad, 0 = start of inspiration
}

export class Autonomic {
  readonly p: AutonomicParams;
  controls: AutonomicControls = defaultControls();
  t = 0;
  private rng: () => number;
  private symNoise: OU; private vagNoise: OU; private resNoise: OU;
  private afferentLine = new DelayLine(6);
  private afferent = 0;
  private sensed = NaN;
  private respPhase = 0;
  // filtered tone deviations from rest
  private dSym = 0; private dVag = 0; private dVasc = 0; private cns = 0;

  constructor(seed = 1, params: AutonomicParams = AUTONOMIC) {
    this.p = params;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.symNoise = new OU(this.rng, params.noiseSympathetic.sigma, params.noiseSympathetic.tau);
    this.vagNoise = new OU(this.rng, params.noiseVagal.sigma, params.noiseVagal.tau);
    this.resNoise = new OU(this.rng, params.noiseResistance.sigma, params.noiseResistance.tau);
    this.respPhase = this.rng() * 2 * Math.PI;
  }

  /** Baroreceptors sample the pressure of each beat; between beats the afferent holds its last value. */
  sense(systolic: number, diastolic: number) {
    this.sensed = diastolic + this.p.pulseWeight * (systolic - diastolic);
    const x = (this.sensed - (this.p.setPoint + this.controls.setPointShift)) / (2 * this.p.width);
    this.afferent = Math.tanh(x); // = 2·logistic − 1
  }

  step(dt: number) {
    const P = this.p, C = this.controls, ns = C.noiseScale;
    this.t += dt;
    this.respPhase = (this.respPhase + 2 * Math.PI * (C.respRate / 60) * dt) % (2 * Math.PI);
    this.afferentLine.push(this.t, this.afferent);
    const g = C.baroreflexGain;
    // Targets of the two arms: pressure above the set point withdraws sympathetic tone and adds vagal tone.
    const cnsTarget = Number.isFinite(this.sensed) ? clamp((P.cnsOnset - this.sensed) / (P.cnsOnset - P.cnsFull), 0, 1) : 0;
    this.cns += (cnsTarget - this.cns) * (1 - Math.exp(-dt / P.cnsTau));
    const vol = C.volumeDeficit;
    const baro = -P.sympatheticGain * g * this.afferentLine.at(this.t - P.sympatheticDelay);
    const symTarget = baro + P.volumeSympathetic * vol + P.cnsSympathetic * this.cns + this.symNoise.step(dt, ns);
    const vagTarget = P.vagalGain * g * this.afferentLine.at(this.t - P.vagalDelay) - P.volumeVagal * vol + this.vagNoise.step(dt, ns);
    const lp = (x: number, target: number, tau: number) => x + (target - x) * (1 - Math.exp(-dt / tau));
    this.dSym = lp(this.dSym, symTarget, P.sympatheticTau);
    this.dVag = lp(this.dVag, vagTarget, P.vagalTau);
    this.dVasc = lp(this.dVasc, symTarget - (1 - P.volumeVascularShare) * P.volumeSympathetic * vol + P.cnsVascular * this.cns, P.vascularTau);
    this.resNoise.step(dt, ns);
  }

  private tone() {
    const P = this.p;
    return {
      s: clamp(P.restSympathetic + this.dSym, 0, 1),
      v: clamp(P.restVagal + this.dVag, 0, 1),
      sv: clamp(P.restSympathetic + this.dVasc, 0, 1.6), // vascular tone can exceed the cardiac range in shock
    };
  }

  /** Respiratory vagal gating at an arbitrary time, so beats generated ahead of the clock still get the right phase. */
  private rsaAt(t: number): number {
    const P = this.p, f = this.controls.respRate / 60;
    const phase = this.respPhase + 2 * Math.PI * f * (t - this.t);
    const roll = 1 / Math.sqrt(1 + (f / P.rsaCutoff) ** 2);
    return -P.rsaVagal * this.controls.respDepth * roll * Math.sin(phase - P.rsaLag);
  }

  /** Sinus-rate multiplier from the slow tones; use hrScaleAt for a beat that has not happened yet. */
  hrScaleAt(t: number): number {
    const P = this.p, C = this.controls, { s, v } = this.tone();
    const vEff = clamp(v + this.rsaAt(t), 0, 1) * (1 - C.vagalBlock);
    const sEff = s * (1 - C.betaBlock);
    return ((1 + P.hrSympathetic * sEff) / (1 + P.hrSympathetic * P.restSympathetic))
      * ((1 - P.hrVagal * vEff) / (1 - P.hrVagal * P.restVagal));
  }

  /** Cycle-length jitter of the sinus node (uniform, fraction of the interval). */
  jitter(): number { return this.p.sinusJitter * (2 * this.rng() - 1) * this.controls.noiseScale; }

  /**
   * The vagal arm's own gain at the current operating point, in ms of RR per mmHg of sensed pressure: the
   * model's ground truth, to compare with what the sequence method recovers from noisy beats.
   */
  vagalBaroreflexGain(rrMs: number): number {
    const P = this.p, C = this.controls;
    const x = Number.isFinite(this.sensed) ? (this.sensed - (P.setPoint + C.setPointShift)) / (2 * P.width) : 0;
    const dAff = (1 - Math.tanh(x) ** 2) / (2 * P.width); // d afferent / d pressure
    const v = clamp(P.restVagal + this.dVag, 0, 1);
    const dVdP = P.vagalGain * C.baroreflexGain * dAff;
    // RR ∝ 1 / (1 − k·v·(1 − block)): d(RR)/dv = RR · k(1 − block) / (1 − k·v(1−block))
    const eff = 1 - C.vagalBlock;
    return (rrMs * P.hrVagal * eff * dVdP) / (1 - P.hrVagal * v * eff);
  }

  effects(): AutonomicEffects {
    const P = this.p, C = this.controls, { s, v, sv } = this.tone();
    const sBeta = s * (1 - C.betaBlock);
    const contractility = ((1 + P.contractility * sBeta) / (1 + P.contractility * P.restSympathetic))
      * Math.exp(P.noiseContractility * C.noiseScale * gaussian(this.rng));
    const resistance = ((1 + P.resistance * sv) / (1 + P.resistance * P.restSympathetic)) * (1 + this.resNoise.x);
    const lung = 0.5 * (1 - Math.cos(this.respPhase)); // 0 = end expiration, 1 = full inspiration
    const venous = (1 + P.venous * (sv - P.restSympathetic));
    const preloadResp = (1 - P.intrathoracicSv * C.respDepth * (lung - 0.5) * 2) * venous;
    return {
      sympathetic: s, vagal: v, hrScale: this.hrScaleAt(this.t), contractility, resistance,
      preloadResp, vascular: sv, afferent: this.afferent, respPhase: this.respPhase,
    };
  }
}
