import { Beat } from "./ecg";
import { CIRC, Circulation } from "./circulation";

/**
 * Per-beat pressure and stroke volume, driven by the actual beats rather than a rate.
 *  - Filling: stroke volume follows the interval since the previous ventricular beat (Frank–Starling),
 *    so a premature beat fills little and the beat after the compensatory pause fills a lot.
 *  - A PVC contracts weakly and has no atrial kick; the beat after it is potentiated.
 *  - A ventricular beat with no preceding P wave (junctional escape) loses the atrial kick.
 *  - Pressure is a two-element Windkessel stepped beat to beat: it decays through the preceding interval
 *    and each stroke adds SV / compliance, so long pauses give low diastolic pressure.
 * The steady circulation() sets the mean state (stroke volume at the mean rate, MAP, resistance).
 * Constants are teaching assumptions, not measured values.
 */
export const BEAT = {
  pvcContractility: 0.75, // PVC stroke volume multiplier from weak, asynchronous contraction
  atrialKickLoss: 0.15, // fraction of filling lost without a preceding P wave
  potentiation: 0.15, // extra contractility on the beat after a PVC
  minInterval: 0.25, // s, guard against a zero or negative interval
};

export interface BeatHemo {
  t: number; // s, time of the ventricular beat
  interval: number; // s since the previous ventricular beat
  strokeVolume: number; // ml
  systolic: number; diastolic: number; // mmHg, this beat's peak and the pressure at its start
  pvc: boolean; atrialKick: boolean;
}

/** Per-beat multipliers from the autonomic loop, drugs and volume status. All default to 1. */
export interface BeatModifiers {
  contractility?: number; // stroke volume (sympathetic inotropy, beta blockade, noise)
  resistance?: number; // systemic resistance (sympathetic vasoconstriction, vasopressor, noise)
  preload?: number; // filling (blood volume, venous tone, breathing)
}

export class BeatHemodynamics {
  private lastT = NaN;
  private peak = NaN; // systolic pressure of the previous beat, mmHg
  private afterPvc = false;
  last: BeatHemo | null = null;

  reset() { this.lastT = NaN; this.peak = NaN; this.afterPvc = false; this.last = null; }

  onBeat(b: Beat, c: Circulation, fx: BeatModifiers = {}): BeatHemo {
    const meanInterval = 60 / c.hr;
    const interval = Number.isNaN(this.lastT) ? meanInterval : Math.max(BEAT.minInterval, b.t - this.lastT);
    const fill = Math.min(CIRC.fillingMax, Math.max(CIRC.fillingMin, Math.pow(interval / meanInterval, CIRC.fillingExponent)));
    const atrialKick = !b.noP && !b.pvc;
    let sv = c.strokeVolume * fill * (fx.preload ?? 1) * (fx.contractility ?? 1) * (atrialKick ? 1 : 1 - BEAT.atrialKickLoss);
    if (b.pvc) sv *= BEAT.pvcContractility;
    else if (this.afterPvc) sv *= 1 + BEAT.potentiation;
    // Windkessel: resistance from the settled mean state, decay over the preceding interval, then the stroke.
    const R = (fx.resistance ?? 1) * (c.map / ((c.cardiacOutput * 1000) / 60)); // mmHg·s/ml
    const tau = R * CIRC.arterialCompliance;
    const diastolic = Number.isNaN(this.peak) ? c.diastolic : this.peak * Math.exp(-interval / tau);
    const systolic = diastolic + sv / CIRC.arterialCompliance;
    this.lastT = b.t; this.peak = systolic; this.afterPvc = b.pvc;
    return (this.last = { t: b.t, interval, strokeVolume: sv, systolic, diastolic, pvc: b.pvc, atrialKick });
  }
}
