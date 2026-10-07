import { Vec3 } from "../config/ecg";
import { RHYTHM } from "../config/ecg";
import { BedSite } from "./ecgLink";
import { Beat, mulberry32 } from "./ecg";

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

export type AvDegree = 0 | 1 | 2 | 3;
export interface RhythmState {
  sinusRate: number; // bpm
  pr: number; // s, for 0/1st degree
  avDegree: AvDegree;
  escapeRate: number;
  pvcSeverity: number; // 0..1, drives ectopy as before
  vagal: number; sympathetic: number; sinusNodeIschemia: number; avNodeIschemia: number;
}

/** Inferoposterior beds face the feet or the back (ECG frame: +y down, −z posterior). */
export const isInferoposterior = (dir: Vec3) => dir[1] > 0.3 || dir[2] < -0.3;

export function rhythmState(sites: BedSite[], sev: Record<string, number>, globalSeverity: number): RhythmState {
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
  return { sinusRate, pr, avDegree, escapeRate: C.junctionalEscape, pvcSeverity: globalSeverity, vagal, sympathetic, sinusNodeIschemia, avNodeIschemia };
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
  constructor(seed = 1, t0 = 0.4) { this.rng = mulberry32(seed); this.nextP = t0 - CONDUCTION.basePr; this.nextEscape = t0; }

  advance(until: number, state: RhythmState): Beat[] {
    const out: Beat[] = [];
    const C = CONDUCTION;
    const pp = () => (60 / state.sinusRate) * (1 + RHYTHM.hrv * (2 * this.rng() - 1));
    const ectopy = Math.max(0, (state.pvcSeverity - RHYTHM.pvcOnsetSeverity) / (1 - RHYTHM.pvcOnsetSeverity));
    if (state.avDegree < 3) this.nextEscape = Math.max(this.nextEscape, this.lastR + 60 / state.escapeRate);
    while (true) {
      if (state.avDegree === 3) {
        // Atria and ventricles dissociate: P waves march through; the junction escapes regularly.
        const tP = this.nextP, tE = this.nextEscape;
        if (Math.min(tP, tE) > until) break;
        if (tP <= tE) { out.push({ t: tP + C.basePr, rr: 60 / state.escapeRate, pvc: false, pr: C.basePr, pOnly: true }); this.nextP = tP + pp(); }
        else { const rr = 60 / state.escapeRate; out.push({ t: tE, rr, pvc: false, noP: true }); this.lastR = tE; this.nextEscape = tE + rr * (1 + 0.01 * (2 * this.rng() - 1)); }
        continue;
      }
      const tP = this.nextP;
      if (tP > until) break;
      const interval = pp();
      this.nextP = tP + interval;
      let pr = state.pr, conducts = true;
      if (state.avDegree === 2) {
        if (this.wenckPr > C.wenckebachMaxPr) { conducts = false; this.wenckPr = C.wenckebachStartPr; }
        else { pr = this.wenckPr; this.wenckPr += C.wenckebachStep; }
      } else this.wenckPr = C.wenckebachStartPr;
      if (!conducts) { out.push({ t: tP + C.basePr, rr: interval, pvc: false, pr: C.basePr, pOnly: true }); continue; }
      const tR = tP + pr;
      out.push({ t: tR, rr: interval, pvc: false, pr });
      this.lastR = tR;
      if (this.rng() < RHYTHM.pvcMaxProbability * ectopy) {
        const tv = tR + interval * RHYTHM.pvcCoupling;
        out.push({ t: tv, rr: interval, pvc: true });
        this.lastR = tv;
        // The next sinus P still fires but falls inside the PVC and cannot conduct (compensatory pause).
        out.push({ t: this.nextP + C.basePr, rr: interval, pvc: false, pr: C.basePr, pOnly: true });
        this.nextP += pp();
      }
    }
    return out;
  }
}
