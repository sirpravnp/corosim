import { Beat } from "./ecg";
import { Conduction, RhythmState, SinusModulation } from "./rhythm";

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
  /** Electrical alternans: QRS amplitude of the conducted beats generated from now on alternates 1 + a, 1 - a (0 = none; a pericardial effusion sets it, B4). */
  alternans = 0;
  private altCount = 0;

  /**
   * `lookahead` is how far beats are generated ahead of the clock and `chunk` how much is added at a time.
   * The ECG strip needs a fraction of a second; a closed-loop run uses a small lookahead so that each
   * sinus interval is set from tone that is only a few tens of milliseconds old.
   */
  constructor(seed = 1, private lookahead = 0.6, private chunk = 0.4) { this.conduction = new Conduction(seed); }

  /** Make sure beats exist through `t + lookahead` s, generated from the current rhythm state. */
  extend(t: number, state: RhythmState, mod?: SinusModulation) {
    if (this.horizon < t + this.lookahead) {
      this.horizon = t + this.lookahead + this.chunk;
      const fresh = this.conduction.advance(this.horizon, state, mod);
      if (this.alternans > 0) for (const b of fresh) if (!b.pOnly && !b.pvc) b.alt = this.altCount++ % 2 ? 1 - this.alternans : 1 + this.alternans;
      this.beats.push(...fresh);
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
