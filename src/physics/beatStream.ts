import { Beat } from "./ecg";
import { Conduction, RhythmState } from "./rhythm";

/**
 * The single source of beats. The ECG strip draws them and the hemodynamics consume them, so a PVC,
 * a blocked P wave or a junctional escape is the same event in both. Wraps the stateful pacemaker/AV-node
 * model and generates a short look-ahead so rate and conduction respond within about a beat of a state change.
 */
export class BeatStream {
  beats: Beat[] = [];
  private horizon = 0;
  private conduction: Conduction;
  private delivered = new WeakSet<Beat>();

  constructor(seed = 1) { this.conduction = new Conduction(seed); }

  /** Make sure beats exist through `t + 0.6` s, generated from the current rhythm state. */
  extend(t: number, state: RhythmState) {
    if (this.horizon < t + 0.6) {
      this.horizon = t + 1.0;
      this.beats.push(...this.conduction.advance(this.horizon, state));
    }
  }

  /** Drop beats older than `keep` seconds before `t`. */
  prune(t: number, keep = 12) { this.beats = this.beats.filter((b) => b.t > t - keep); }

  /** Ventricular beats (anything that contracts the ventricles) due by `t` that were not yet handed out, in time order. */
  drain(t: number): Beat[] {
    const out = this.beats.filter((b) => !b.pOnly && b.t <= t && !this.delivered.has(b));
    out.sort((a, b) => a.t - b.t);
    for (const b of out) this.delivered.add(b);
    return out;
  }
}
