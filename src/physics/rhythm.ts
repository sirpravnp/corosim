import { AF, Bbb, Rhythm, Vec3 } from "../config/ecg";
import { RHYTHM } from "../config/ecg";
import { BedSite } from "./ecgLink";
import { Beat, mulberry32 } from "./ecg";
import { ECTOPY } from "../config/ectopy";
import type { EctopySource } from "./ectopy";

/**
 * Rate and conduction from where the ischemia is, not only how much.
 *  - Sympathetic drive rises with ischemia outside the inferoposterior wall (anterior, lateral): tachycardia.
 *  - Vagal drive (Bezold–Jarisch reflex) rises when inferoposterior ischemia dominates: bradycardia.
 *  - SA-node artery ischemia slows the sinus node directly.
 *  - AV-node artery ischemia (from whichever artery is dominant) lengthens the PR interval, then causes
 *    Mobitz I (Wenckebach), then complete heart block with a junctional escape rhythm.
 * Thresholds are teaching assumptions, not measured values.
 */
export const CONDUCTION = {
  sympatheticFull: 0.25, // non-inferior ischemic mass for full sympathetic effect
  sympatheticGain: 0.35, // ×(1 + gain) at full effect
  vagalFull: 0.2, // net inferoposterior ischemic mass for full vagal effect
  vagalGain: 0.28, // ×(1 − gain) at full effect
  inferiorOffset: 0.6, // vagal drive counts inferior burden minus this × other burden
  sinusNodeGain: 0.3, // ×(1 − gain) with a fully ischemic SA-node artery
  minSinusRate: 35,
  basePr: 0.16, // s
  firstDegreeAt: 0.15, // AV-node ischemia thresholds
  secondDegreeAt: 0.5,
  thirdDegreeAt: 0.85,
  firstDegreeExtraPr: 0.14, // s added to PR across the first-degree range
  wenckebachStartPr: 0.22,
  wenckebachStep: 0.07, // s per conducted beat
  wenckebachMaxPr: 0.4, // the next P after this is blocked
  junctionalEscape: 42, // bpm, narrow-complex escape from the AV junction
};

/** Beat-by-beat autonomic control of the pacemaker: `rate(t)` multiplies the rate at time t, `jitter()` is cycle noise. */
export interface SinusModulation { rate(t: number): number; jitter(): number }

export type AvDegree = 0 | 1 | 2 | 3;
/** What the patient brought with them: an existing rhythm and any bundle branch block. */
export interface Patient { rhythm: Rhythm; bbb: Bbb }
export const HEALTHY: Patient = { rhythm: "sinus", bbb: "none" };
export interface RhythmState {
  rhythm: Rhythm; bbb: Bbb;
  sinusRate: number; // bpm
  afRate: number; // bpm, mean ventricular response in atrial fibrillation
  pr: number; // s, for 0/1st degree
  avDegree: AvDegree;
  escapeRate: number;
  pvcSeverity: number; // 0..1, drives ectopy as before
  vagal: number; sympathetic: number; sinusNodeIschemia: number; avNodeIschemia: number;
}

/** Inferoposterior beds face the feet or the back (ECG frame: +y down, −z posterior). */
export const isInferoposterior = (dir: Vec3) => dir[1] > 0.3 || dir[2] < -0.3;

export function rhythmState(sites: BedSite[], sev: Record<string, number>, globalSeverity: number, patient: Patient = HEALTHY): RhythmState {
  const C = CONDUCTION;
  let inferior = 0, other = 0;
  for (const s of sites) { const k = (sev[s.key] ?? 0) * s.mass; if (isInferoposterior(s.dir)) inferior += k; else other += k; }
  const sympathetic = Math.min(1, other / C.sympatheticFull);
  const vagal = Math.max(0, Math.min(1, (inferior - C.inferiorOffset * other) / C.vagalFull));
  const sinusNodeIschemia = sev["SAN#end"] ?? 0, avNodeIschemia = sev["AVN#end"] ?? 0;
  const sinusRate = Math.max(C.minSinusRate,
    RHYTHM.baseHr * (1 + C.sympatheticGain * sympathetic) * (1 - C.vagalGain * vagal) * (1 - C.sinusNodeGain * sinusNodeIschemia));
  const avDegree: AvDegree = avNodeIschemia >= C.thirdDegreeAt ? 3 : avNodeIschemia >= C.secondDegreeAt ? 2 : avNodeIschemia >= C.firstDegreeAt ? 1 : 0;
  const pr = avDegree === 0 ? C.basePr
    : C.basePr + C.firstDegreeExtraPr * Math.min(1, (avNodeIschemia - C.firstDegreeAt) / (C.secondDegreeAt - C.firstDegreeAt)) + 0.04;
  // In atrial fibrillation the ventricles follow the AV node, not the sinus node: autonomic tone and AV-node
  // ischemia set the response, and the SA-node artery no longer matters.
  const afRate = Math.max(C.minSinusRate, AF.baseRate * (1 + C.sympatheticGain * sympathetic) * (1 - C.vagalGain * vagal) * AF.slowedBy[Math.min(2, avDegree)]);
  return { rhythm: patient.rhythm, bbb: patient.bbb, sinusRate, afRate, pr, avDegree, escapeRate: C.junctionalEscape, pvcSeverity: globalSeverity, vagal, sympathetic, sinusNodeIschemia, avNodeIschemia };
}

/**
 * Event-driven pacemaker and AV node. The atria fire at the sinus rate; each P wave either conducts
 * (after the current PR), is blocked, or — in complete heart block — is ignored while the junction
 * escapes on its own clock. Keeps its state between calls, so Wenckebach cycles run across chunks.
 */
export class Conduction {
  private rng: () => number;
  private nextP: number;
  private nextEscape: number;
  private wenckPr = CONDUCTION.wenckebachStartPr;
  private lastR = -Infinity;
  private nextAf: number;
  /**
   * The core engine's ectopy model (physics/ectopy.ts). When set it decides every PVC, after any ventricular beat it may follow
   * (sinus-conducted, AF or escape), from its own random stream; when unset (the legacy engine) the old rule below runs untouched,
   * draw for draw, so the legacy beats and fixtures do not move.
   */
  ectopy?: EctopySource;
  constructor(seed = 1, t0 = 0.4) { this.rng = mulberry32(seed); this.nextP = t0 - CONDUCTION.basePr; this.nextEscape = t0; this.nextAf = t0; }

  /**
   * Take over from another rhythm source (an EKG-library rhythm, rhythmSource.ts) whose beats run up to `t`, the last ventricular
   * one at `lastR`: no beat of this pacemaker falls before `t` (its clocks were stopped meanwhile and would otherwise catch up).
   */
  resync(t: number, lastR = -Infinity) {
    this.nextP = Math.max(this.nextP, t - CONDUCTION.basePr + 0.25);
    this.nextEscape = Math.max(this.nextEscape, t + 0.25); this.nextAf = Math.max(this.nextAf, t + 0.25);
    this.lastR = Math.max(this.lastR, lastR);
  }

  /**
   * `mod` lets a closed-loop autonomic model set each cycle: it scales the sinus rate at each P wave (and, in
   * atrial fibrillation, the AV node's mean response) and replaces the default uniform ±hrv noise. Omitted, the
   * rhythm is open-loop.
   */
  advance(until: number, state: RhythmState, mod?: SinusModulation): Beat[] {
    const out: Beat[] = [];
    const C = CONDUCTION;
    const bbb = state.bbb === "none" ? undefined : state.bbb;
    const pp = (tAt: number) => (60 / (state.sinusRate * (mod ? mod.rate(tAt) : 1))) * (1 + (mod ? mod.jitter() : RHYTHM.hrv * (2 * this.rng() - 1)));
    const ectopy = Math.max(0, (state.pvcSeverity - RHYTHM.pvcOnsetSeverity) / (1 - RHYTHM.pvcOnsetSeverity));
    if (state.avDegree < 3) this.nextEscape = Math.max(this.nextEscape, this.lastR + 60 / state.escapeRate);
    const af = state.rhythm === "af";
    if (af && state.avDegree < 3) {
      // No P waves; the ventricles follow at irregular intervals as the AV node lets fibrillation through.
      this.nextAf = Math.max(this.nextAf, this.lastR + 0.3);
      while (this.nextAf <= until) {
        const mean = 60 / (state.afRate * (mod ? mod.rate(this.nextAf) : 1));
        const rr = mean * (1 + AF.irregularity * (2 * this.rng() - 1));
        const tR = this.nextAf;
        if (this.ectopy) {
          out.push({ t: tR, rr, pvc: false, noP: true, bbb });
          const pv = this.ectopy.decide(tR, rr);
          for (const tv of pv) out.push({ t: tv, rr, pvc: true });
          this.lastR = pv.length ? pv[pv.length - 1] : tR; this.nextAf = pv.length ? this.lastR + rr * 1.3 : tR + rr;
          continue;
        }
        if (this.rng() < RHYTHM.pvcMaxProbability * ectopy) { out.push({ t: tR, rr, pvc: true }); this.lastR = tR; this.nextAf = tR + rr * 1.3; continue; }
        out.push({ t: tR, rr, pvc: false, noP: true, bbb });
        this.lastR = tR; this.nextAf = tR + rr;
      }
      this.nextP = Math.max(this.nextP, this.nextAf - C.basePr); // so a return to sinus rhythm starts from now, not from a backlog
      return out;
    }
    while (true) {
      if (state.avDegree === 3) {
        // Atria and ventricles dissociate: P waves march through (none in fibrillation); the junction escapes regularly.
        const tP = this.nextP, tE = this.nextEscape;
        if (Math.min(tP, tE) > until) break;
        if (tP <= tE) { if (!af) out.push({ t: tP + C.basePr, rr: 60 / state.escapeRate, pvc: false, pr: C.basePr, pOnly: true }); this.nextP = tP + pp(tP); }
        else {
          const rr = 60 / state.escapeRate; out.push({ t: tE, rr, pvc: false, noP: true, bbb }); this.lastR = tE; this.nextEscape = tE + rr * (1 + 0.01 * (2 * this.rng() - 1)); this.nextAf = tE;
          // core: the ischemic myocardium fires whatever drives the ventricles; a PVC resets the junctional pacemaker
          const pv = this.ectopy ? this.ectopy.decide(tE, rr) : [];
          for (const tv of pv) out.push({ t: tv, rr, pvc: true });
          if (pv.length) { this.lastR = pv[pv.length - 1]; this.nextEscape = this.lastR + rr; }
        }
        continue;
      }
      this.nextAf = Math.max(this.nextAf, this.nextP);
      const tP = this.nextP;
      if (tP > until) break;
      const interval = pp(tP);
      this.nextP = tP + interval;
      let pr = state.pr, conducts = true;
      if (state.avDegree === 2) {
        if (this.wenckPr > C.wenckebachMaxPr) { conducts = false; this.wenckPr = C.wenckebachStartPr; }
        else { pr = this.wenckPr; this.wenckPr += C.wenckebachStep; }
      } else this.wenckPr = C.wenckebachStartPr;
      if (!conducts) { out.push({ t: tP + C.basePr, rr: interval, pvc: false, pr: C.basePr, pOnly: true }); continue; }
      const tR = tP + pr;
      out.push({ t: tR, rr: interval, pvc: false, pr, bbb });
      this.lastR = tR;
      if (this.ectopy) {
        const pv = this.ectopy.decide(tR, interval);
        if (pv.length) {
          for (const tv of pv) out.push({ t: tv, rr: interval, pvc: true });
          this.lastR = pv[pv.length - 1];
          // The next sinus P fires but cannot conduct (compensatory pause), nor can any whose QRS would fall inside the PVCs'
          // refractory period (after a couplet, sometimes two).
          do { out.push({ t: this.nextP + C.basePr, rr: interval, pvc: false, pr: C.basePr, pOnly: true }); this.nextP += pp(this.nextP); }
          while (this.nextP + C.basePr < this.lastR + ECTOPY.refractoryS);
        }
      } else if (this.rng() < RHYTHM.pvcMaxProbability * ectopy) {
        const tv = tR + interval * RHYTHM.pvcCoupling;
        out.push({ t: tv, rr: interval, pvc: true });
        this.lastR = tv;
        // The next sinus P still fires but falls inside the PVC and cannot conduct (compensatory pause).
        out.push({ t: this.nextP + C.basePr, rr: interval, pvc: false, pr: C.basePr, pOnly: true });
        this.nextP += pp(this.nextP);
      }
    }
    return out;
  }
}
