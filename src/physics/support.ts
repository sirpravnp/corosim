import { SUPPORT } from "../config/management";
import { CONDUCTION, RhythmState } from "./rhythm";

/**
 * What the team is doing for the patient's blood pressure, rate and rhythm while the artery is dealt with.
 * Doses are 0..1 of a full effect. Drug and device effects on the circulation are applied in circulation();
 * the ones that act on rate and conduction are applied here, to the rhythm the ischemia produced.
 */
export interface Support {
  fluids: number; // litres given
  norepi: number;
  dobutamine: number;
  nitro: number;
  /** Core engine only (receptor-level drugs, E4): 0..1 of a full dose each. The legacy circulation ignores them. */
  epi: number; milrinone: number; vasopressin: number; nitroprusside: number; furosemide: number; diltiazem: number;
  atropine: boolean;
  pacing: boolean; paceRate: number;
  iabp: boolean;
  impella: boolean;
}
export const NO_SUPPORT: Support = { fluids: 0, norepi: 0, dobutamine: 0, nitro: 0, epi: 0, milrinone: 0, vasopressin: 0, nitroprusside: 0, furosemide: 0, diltiazem: 0, atropine: false, pacing: false, paceRate: SUPPORT.paceDefault, iabp: false, impella: false };
export const noSupport = (): Support => ({ ...NO_SUPPORT });
export const anySupport = (s: Support) =>
  s.fluids > 0 || s.norepi > 0 || s.dobutamine > 0 || s.nitro > 0 || s.epi > 0 || s.milrinone > 0 || s.vasopressin > 0 || s.nitroprusside > 0 || s.furosemide > 0 || s.diltiazem > 0 || s.atropine || s.pacing || s.iabp || s.impella;

/**
 * Support acting on the rhythm the ischemia produced:
 *  - atropine takes off the vagal slowing, and clears 2nd-degree block that was vagal tone (not infarcted node);
 *  - catecholamines speed the sinus node and the AV-node response, and make ischemic ectopy worse;
 *  - pacing holds the rate: atrial pacing for a slow sinus rhythm, ventricular pacing (with its left-bundle-branch
 *    pattern) when the AV node is blocking.
 * `adrenergic` is the core engine's receptor-level drug effect (physics/core/drugs.ts): the rate factor and the beta-1 drive replace
 * the `SUPPORT` multipliers `dobHr`, `norepiHr` and `dobEctopy`.
 */
export function supportedRhythm(r: RhythmState, s: Support, adrenergic?: { hrScale: number; ectopyDrive: number; avSlow?: number }): RhythmState {
  const C = CONDUCTION, K = SUPPORT;
  let out: RhythmState = { ...r };
  if (s.atropine && r.vagal > 0) {
    const undo = 1 / (1 - C.vagalGain * r.vagal);
    out.sinusRate = r.sinusRate * undo; out.afRate = r.afRate * undo; out.vagal = 0;
    if (r.avDegree === 2 && r.vagal >= K.atropineBlockVagal && r.avNodeIschemia < K.atropineBlockMaxIschemia) out.avDegree = 1;
  }
  const chrono = adrenergic ? adrenergic.hrScale : 1 + K.dobHr * s.dobutamine + K.norepiHr * s.norepi;
  out.sinusRate *= chrono; out.afRate *= chrono * (adrenergic?.avSlow ?? 1); // AV-nodal drugs slow the ventricular response in AF, not the sinus node
  out.pvcSeverity = Math.min(1, r.pvcSeverity * (1 + K.dobEctopy * (adrenergic ? adrenergic.ectopyDrive : s.dobutamine)));
  if (s.pacing) {
    if (out.avDegree >= 2) { out.avDegree = 3; out.escapeRate = Math.max(out.escapeRate, s.paceRate); out.bbb = "lbbb"; }
    else if (out.rhythm === "af") out.afRate = Math.max(out.afRate, s.paceRate);
    else out.sinusRate = Math.max(out.sinusRate, s.paceRate);
  }
  return out;
}

/** Myocardial oxygen demand relative to what the patient's own state asks for: drugs and devices move it. */
export function demandFactor(s: Support): number {
  const K = SUPPORT;
  const up = 1 + K.dobDemand * s.dobutamine + K.norepiDemand * s.norepi;
  const down = 1 - K.impellaDemand * +s.impella - K.iabpDemand * +s.iabp - K.nitroDemand * s.nitro;
  return Math.max(0.5, up * down);
}
