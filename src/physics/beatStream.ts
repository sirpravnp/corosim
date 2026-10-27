import { Beat } from "./ecg";
import { Conduction, RhythmState, SinusModulation } from "./rhythm";
import type { Ectopy } from "./ectopy";
import type { Arrhythmia } from "./arrhythmia";
import { ARRHYTHMIA } from "../config/arrhythmia";
import { LibraryRhythm, isLibraryRhythm } from "./rhythmSource";
import type { Vec3 } from "../config/ecg";

/**
 * The single source of beats. The ECG strip draws them and the hemodynamics consume them, so a PVC,
 * a blocked P wave or a junctional escape is the same event in both. Wraps the stateful pacemaker/AV-node
 * model and generates a short look-ahead so rate and conduction respond within about a beat of a state change.
 *
 * Two pacemakers feed it (task B2): the coronary model's own (`Conduction`: sinus or AF, with ischemic AV block and ectopy) when
 * the patient's rhythm is "sinus" or "af", and the EKG library's generator (`LibraryRhythm`, rhythmSource.ts) for any other rhythm
 * (flutter, SVT, junctional, VT, VF, paced, the AV blocks...). A change of rhythm takes effect at the end of the beats already
 * generated (the look-ahead), so nothing already drawn changes.
 *
 * A sustained arrhythmia of the core engine (task B3b, physics/arrhythmia.ts: VT, polymorphic VT, VF, AIVR) runs as a library rhythm
 * over whatever the patient's rhythm is, for as long as it lasts. One that a premature beat starts takes over at that beat: the beats
 * generated after it are dropped (they lay ahead of the clock) and the run's first beat follows the trigger.
 */
export class BeatStream {
  beats: Beat[] = [];
  private horizon = 0;
  private conduction: Conduction;
  private delivered = new WeakSet<Beat>();
  /** Electrical alternans: QRS amplitude of the conducted beats generated from now on alternates 1 + a, 1 - a (0 = none; a pericardial effusion sets it, B4). */
  alternans = 0;
  private altCount = 0;
  /** The library rhythm running (null: the coronary model's own), and from when each source ran (for `baseline`). */
  private library: LibraryRhythm | null = null;
  private segments: { from: number; lib: LibraryRhythm | null }[] = [];
  private lastV = -Infinity;
  private key: string | null = null;
  /** VT/VF and AIVR of the core engine (physics/arrhythmia.ts); unset, none. */
  arrhythmia?: Arrhythmia;

  /**
   * `lookahead` is how far beats are generated ahead of the clock and `chunk` how much is added at a time.
   * The ECG strip needs a fraction of a second; a closed-loop run uses a small lookahead so that each
   * sinus interval is set from tone that is only a few tens of milliseconds old.
   */
  constructor(private seed = 1, private lookahead = 0.6, private chunk = 0.4) { this.conduction = new Conduction(seed); }

  /** The core engine's ectopy model (physics/ectopy.ts); unset, the legacy PVC rule of `Conduction` runs. */
  get ectopy(): Ectopy | undefined { return this.conduction.ectopy as Ectopy | undefined; }
  set ectopy(e: Ectopy | undefined) { this.conduction.ectopy = e; if (this.library) this.library.ectopy = e; }

  /** The EKG-library rhythm generating beats now, or null while the coronary model's own sinus or AF runs. */
  get libraryRhythm(): LibraryRhythm | null { return this.library; }

  /** Make sure beats exist through `t + lookahead` s, generated from the current rhythm state. */
  extend(t: number, state: RhythmState, mod?: SinusModulation) {
    if (this.horizon >= t + this.lookahead) return;
    const target = t + this.lookahead + this.chunk;
    for (let guard = 0; this.horizon < target && guard < 4; guard++) {
      const from = this.horizon;
      this.horizon = target;
      this.select(state, from);
      let fresh = this.library ? this.library.advance(target, state, mod) : this.conduction.advance(target, state, mod);
      const cut = this.arrhythmia?.takeCut();
      if (cut !== undefined) {
        // a run started at the trigger beat `cut`: what was generated after it does not happen (it all lies ahead of the clock)
        fresh = fresh.filter((b) => b.t <= cut + 1e-9);
        this.beats = this.beats.filter((b) => b.t <= cut + 1e-9 || this.delivered.has(b));
        this.horizon = Math.max(from, cut);
      }
      if (this.alternans > 0) for (const b of fresh) if (!b.pOnly && !b.pvc && !b.silent) b.alt = this.altCount++ % 2 ? 1 - this.alternans : 1 + this.alternans;
      for (const b of fresh) if (!b.pOnly && !b.silent && b.t > this.lastV) this.lastV = b.t;
      this.beats.push(...fresh);
    }
  }

  /** Switch pacemaker when the patient's rhythm changed or an arrhythmia started or ended; the new one starts where the generated beats end (`from`). */
  private select(state: RhythmState, from: number) {
    const ep = this.arrhythmia?.rhythmAt(from) ?? null;
    const want = ep ? ep.key : isLibraryRhythm(state.rhythm) ? state.rhythm : null, cur = this.library;
    if (this.key === want && (!cur || !!ep || cur.bbb === state.bbb)) return;
    let segFrom = from;
    if (ep) {
      const first = Math.max(ep.firstBeat ?? from + 0.1, from, ep.kind === "vf" ? -Infinity : this.lastV + ARRHYTHMIA.minGapS);
      this.library = new LibraryRhythm(ep.id, (this.seed + 7919 * this.segments.length) >>> 0, first - 0.45, state.bbb, ep.spec);
      if (ep.kind === "vf") segFrom = first;
    } else if (want) {
      this.library = new LibraryRhythm(want, this.seed, from, state.bbb);
      this.library.ectopy = this.conduction.ectopy;
    } else {
      this.library = null;
      if (cur) this.conduction.resync(from, this.lastV);
    }
    this.key = want;
    this.segments.push({ from: segFrom, lib: this.library });
    if (this.segments.length > 8) this.segments.splice(0, this.segments.length - 8);
  }

  /**
   * Continuous electrical activity at `t` that is not a beat (flutter waves, fibrillatory waves, VF), mV, from the library rhythm that
   * ran then; null when the coronary model's own rhythm ran (its AF baseline is the strip's own `fWaves`).
   */
  baseline(t: number): Vec3 | null {
    for (let i = this.segments.length - 1; i >= 0; i--) if (this.segments[i].from <= t) return this.segments[i].lib ? this.segments[i].lib!.baseline(t) : null;
    return null;
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
