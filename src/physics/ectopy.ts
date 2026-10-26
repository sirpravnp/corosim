import { ECTOPY } from "../config/ectopy";
import { T_CENTER, T_WIDTH } from "../config/ecg";
import { BedSite } from "./ecgLink";
import { mulberry32 } from "./ecg";
import { gaussian } from "./autonomic";

/**
 * Ischemic ventricular ectopy of the core engine (task B3a). DOM-free; constants and their sources in config/ectopy.ts, targets in
 * docs/ECTOPY.md. The legacy engine keeps the old rule in rhythm.ts (`Conduction` without an ectopy source), so the game's cases and
 * fixtures do not move.
 *
 * Per eligible ventricular beat (sinus-conducted, AF or junctional escape: ectopy belongs to the ischemic myocardium, not to the
 * conduction system) the expected number of PVCs is
 *
 *   rate = S x tendency x sympathetic x drugs x K x Mg x [ r0 H(b) T(age)  +  rBurst H(burst)  +  rTail H(tail) ]
 *
 *  - b: the transmurality-weighted ischemic burden (`weightedBurden`), H a smooth Hill function above a 1% floor;
 *  - T(age): time since onset of this ischemic episode in clinical minutes (fast rise, hyperacute peak, decay over hours);
 *  - burst, tail: reperfusion stores, filled by each fall of the burden (scaled by how long the ischemia had lasted) and decaying
 *    over tens of minutes (burst) and hours (tail);
 *  - S: the patient's fixed, seeded susceptibility (lognormal), `tendency` the scenario's teaching override (0 = none);
 *  - sympathetic tone after beta-blockade, the beta-1 drive of the receptor-level drugs, and electrolyte hooks fixed at 1.
 *
 * Each beat's probability is then modulated by a slow random factor (heartbeat time, mean 1) and raised for the beat after a PVC,
 * and saturates at `cap`: p = cap (1 - exp(-rate x noise x memory / cap)). A PVC may be followed directly by a second (a couplet);
 * nothing longer: triplets, VT, VF, idioventricular rhythm and R-on-T initiation are task B3b, which reads `rate()`, `phase()` and
 * `couplingVsT()` from here.
 */

export type EctopyPhase = "none" | "hyperacute" | "subacute" | "late" | "reperfusion";

/** The autonomic and drug state the rate reads: cardiac sympathetic tone (0..1), beta-blockade (0..1), beta-1 drug drive (0..). */
export interface EctopyTone { sympathetic: number; betaBlock: number; drugDrive: number }
export const REST_TONE: EctopyTone = { sympathetic: ECTOPY.restSympathetic, betaBlock: 0, drugDrive: 0 };

/** What the generator needs from an ectopy model: for an eligible beat at `tR` with sinus interval `rr`, the times of the PVCs that follow it (none, one, or a couplet). */
export interface EctopySource { decide(tR: number, rr: number): number[] }

const E = ECTOPY;
const hill = (x: number) => { const y = Math.max(0, x) ** E.hill; return y / (1 + y); };
/** Dose-response of the ischemic term on the weighted burden, with its floor. */
export const burdenEffect = (b: number) => hill((b - E.floor) / E.half);
/** Time-since-onset multiplier of the ischemic term (clinical minutes). */
export const onsetCourse = (min: number) =>
  (1 - Math.exp(-Math.max(0, min) / E.riseMin)) * (E.hyper * Math.exp(-min / E.hyperTauMin) + E.sub * Math.exp(-min / E.subTauMin) + E.late);
/** How much a reperfused bed contributes after `min` clinical minutes of ischemia. */
export const reperfusionWeight = (min: number) =>
  (1 - Math.exp(-Math.max(0, min) / E.weightRiseMin)) * (E.weightLate + (1 - E.weightLate) * Math.exp(-min / E.weightFallMin));
/** End of the T wave after the R peak in the model's ECG (s), for an interval `rr`. */
export const tWaveEnd = (rr: number) => T_CENTER(rr) + 2 * T_WIDTH(rr);
/** Coupling interval relative to the end of the preceding T wave: below 1 the PVC lands on the T wave (R-on-T). */
export const couplingVsT = (coupling: number, rr: number) => coupling / tWaveEnd(rr);

/** Patient susceptibility from the seed alone (lognormal, median 1), so it is fixed for the patient whatever else happens. */
export function susceptibility(seed: number): number {
  const rng = mulberry32(((seed >>> 0) ^ 0x5bd1e995) >>> 0);
  rng(); // decorrelate from neighbouring seeds
  return Math.exp(E.susceptibilitySigma * gaussian(rng));
}

/** Ischemic burden as the ectopy model sees it: severity x mass, transmural beds counted in full and subendocardial ones at a quarter. */
export function weightedBurden(sites: BedSite[], sev: Record<string, number>, transmural: Record<string, number> = {}): number {
  let b = 0;
  for (const s of sites) {
    const v = sev[s.key] ?? 0;
    if (v) b += v * s.mass * (E.subendocardialWeight + (1 - E.subendocardialWeight) * (transmural[s.key] ?? 1));
  }
  return b;
}

export class Ectopy implements EctopySource {
  /** The patient's fixed susceptibility (from the seed). */
  readonly susceptibility: number;
  /** Teaching override from the scenario (`ectopyTendency`, 0..3): multiplies the susceptibility; 0 = no ectopy at all. */
  tendency: number;
  /** Electrolyte multipliers (hooks for a later item; 1 = normal). */
  potassium = E.potassium; magnesium = E.magnesium;
  tone: EctopyTone = { ...REST_TONE };
  /** Weighted ischemic burden now, and the clinical minutes since this episode's onset. */
  burden = 0; age = 0;
  private inEpisode = false; private quiet = 0; private anchor = 0;
  /** Reperfusion stores (burden units, weighted by ischemic duration). */
  burst = 0; tail = 0;
  private rng: () => number;
  private z = 0; private zT = NaN;
  private afterPvc = false;
  private log: { t: number; pvc: boolean }[] = [];

  constructor(seed = 1, tendency = 1) {
    this.susceptibility = susceptibility(seed);
    this.tendency = tendency;
    this.rng = mulberry32(((seed >>> 0) * 2654435761 + 0x2545f491) >>> 0);
    this.z = gaussian(this.rng);
  }

  /** Back to a heart with no ischemic history (the patient, the seed's random streams and the tendency stay). */
  reset() { this.burden = this.age = this.quiet = this.anchor = this.burst = this.tail = 0; this.inEpisode = false; }

  /**
   * Advance `minutes` of clinical time with the current weighted burden (`weightedBurden`) and tone. Called every simulation
   * sub-step; with `minutes` 0 (a stopped clinical clock, a warm-up) nothing evolves but the burden and tone are taken.
   */
  update(minutes: number, burden: number, tone: EctopyTone = this.tone) {
    this.tone = tone;
    if (burden > E.floor) {
      if (!this.inEpisode) { this.inEpisode = true; this.age = 0; this.anchor = burden; }
      this.quiet = 0;
    } else if (this.inEpisode && (this.quiet += minutes) > E.episodeResetMin) { this.inEpisode = false; this.age = 0; }
    if (this.inEpisode) this.age += minutes;
    // Reperfusion: falls of at least the deadband from the last level held count; rises just move the reference up.
    if (burden > this.anchor) this.anchor = burden;
    else if (this.anchor - burden >= E.deadband) {
      const add = (this.anchor - burden) * reperfusionWeight(this.age);
      this.burst += add; this.tail += add; this.anchor = burden;
    }
    if (minutes > 0) { this.burst *= Math.exp(-minutes / E.burstTauMin); this.tail *= Math.exp(-minutes / E.tailTauMin); }
    this.burden = burden;
  }

  /** Multiplier from the patient, the tone and the drugs and electrolytes (everything but the ischemia itself). */
  private gain(): number {
    const t = this.tone, s = t.sympathetic * (1 - t.betaBlock);
    return this.susceptibility * this.tendency * Math.exp(E.sympatheticGain * (s - E.restSympathetic)) * (1 + E.drugGain * t.drugDrive) * this.potassium * this.magnesium;
  }
  /** Expected PVCs per beat from ongoing ischemia, for this patient now. */
  ischemicRate(): number { return this.inEpisode ? this.gain() * E.rateAtFullEffect * burdenEffect(this.burden) * onsetCourse(this.age) : 0; }
  /** Expected PVCs per beat from reperfusion, for this patient now. */
  reperfusionRate(): number { return this.gain() * (E.burstRate * hill(this.burst / E.half) + E.tailRate * hill(this.tail / E.half)); }
  /** Instantaneous expected PVCs per eligible beat (before the slow noise, the after-PVC memory and saturation): B3b's hazard input. */
  rate(): number { return this.ischemicRate() + this.reperfusionRate(); }

  /** Where the patient is in the ischemic time course, for B3b (VT/VF hazard by phase) and for the explanation. */
  phase(): EctopyPhase {
    const i = this.ischemicRate(), r = this.reperfusionRate();
    if (i <= 0 && r < 1e-5) return "none";
    if (r > i) return "reperfusion";
    return this.age < E.hyperacuteMin ? "hyperacute" : this.age < E.subacuteMin ? "subacute" : "late";
  }

  /** Probability that a PVC follows an eligible beat at heartbeat time `t` (advances the slow noise to `t`). */
  probability(t: number): number {
    const dt = Number.isFinite(this.zT) ? Math.max(0, t - this.zT) : 0;
    if (dt > 0) { const a = Math.exp(-dt / E.noiseTauS); this.z = this.z * a + Math.sqrt(1 - a * a) * gaussian(this.rng); }
    this.zT = t;
    const x = this.rate() * Math.exp(E.noiseSigma * this.z - E.noiseSigma ** 2 / 2) * (this.afterPvc ? E.afterPvc : 1);
    return E.cap * (1 - Math.exp(-x / E.cap));
  }

  decide(tR: number, rr: number): number[] {
    const p = this.probability(tR), out: number[] = [];
    if (p > 0 && this.rng() < p) {
      const c = rr * Math.min(E.couplingMax, Math.max(E.couplingMin, E.coupling * (1 + E.couplingSpread * gaussian(this.rng))));
      out.push(tR + c);
      if (this.rng() < Math.min(E.coupletMax, E.coupletBase + E.coupletPerRate * p)) out.push(tR + c + rr * E.coupletInterval);
    }
    this.afterPvc = out.length > 0;
    this.log.push({ t: tR, pvc: false }, ...out.map((t) => ({ t, pvc: true })));
    if (this.log.length > 600) this.log.splice(0, this.log.length - 400);
    return out;
  }

  /** The beats this model saw over the last `window` heartbeat seconds before `t`, and the share that were PVCs. */
  recent(t: number, window = E.reportWindowS): { beats: number; pvcs: number; share: number } {
    let beats = 0, pvcs = 0;
    for (const b of this.log) if (b.t > t - window && b.t <= t) { beats++; if (b.pvc) pvcs++; }
    return { beats, pvcs, share: beats ? pvcs / beats : 0 };
  }
}
