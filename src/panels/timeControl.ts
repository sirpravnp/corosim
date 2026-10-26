/**
 * Time controls for the Simulator page (task P13): pause, slow motion and "step one beat". DOM-free.
 *
 * The page's frame loop asks `PlayClock.advance(rawDt, simNow, upcoming)` how many simulated seconds to advance this frame
 * and uses the answer for the simulation, the ECG, the particles and the 3D view, so everything pauses together. The
 * clinical-minutes clock is computed from the same answer (minutes per simulated second are unchanged), so slow motion
 * stretches the heartbeat without changing what a clinical minute means. The clinical clock (1×/3×/6×, the page's S.speed) is a
 * separate setting that the page hands to the same control bar as a `ClinicalClock`.
 */

/** Heartbeat-time scales offered next to the 1×/3×/6× clinical scales. */
export const SLOW_SCALES = [0.25, 0.5, 1] as const;
/** Clinical-clock speeds: clinical minutes per second of simulated time are multiplied by this (the page's `S.speed`). */
export const CLINICAL_SCALES = [1, 3, 6] as const;
/** The page's clinical clock, handed to the time controls so both clocks sit in one place (task P12). */
export interface ClinicalClock { scales: readonly number[]; get(): number; set(scale: number): void }
/** A step that finds no upcoming beat gives up after this many simulated seconds (a stopped heart). */
export const STEP_GIVE_UP_S = 5;
const EPS = 1e-6;

/**
 * The time to advance to for "step one beat": the first ventricular beat strictly after `now`. A beat within `EPS` of
 * `now` counts as the one just delivered, so repeated steps move on to the next. null when none is known.
 */
export function nextBeatTime(beatTimes: readonly number[], now: number): number | null {
  let best: number | null = null;
  for (const t of beatTimes) if (Number.isFinite(t) && t > now + EPS && (best === null || t < best)) best = t;
  return best;
}

export interface ClockState {
  paused: boolean;
  /** Simulated seconds per real second, > 0. */
  scale: number;
  /** While stepping: the simulation time to stop at (null = not stepping, or still looking for the next beat). */
  stepTarget: number | null;
  /** While stepping and no beat is known: simulated seconds still allowed. */
  stepBudget: number;
  stepping: boolean;
}

export const initialClock = (): ClockState => ({ paused: false, scale: 1, stepTarget: null, stepBudget: 0, stepping: false });

/**
 * One frame. `rawDt` is the real elapsed time (already capped by the page); `now` the simulation clock; `upcoming` lists
 * ventricular beat times (read only while stepping). Returns the simulated seconds to advance and the next state.
 * Stepping runs at the current scale, lands exactly on the beat, and pauses there.
 */
export function advanceClock(s: ClockState, rawDt: number, now: number, upcoming: () => readonly number[]): { dt: number; state: ClockState } {
  if (s.stepping) {
    const want = Math.max(0, rawDt) * s.scale;
    const target = s.stepTarget ?? nextBeatTime(upcoming(), now);
    if (target !== null) {
      const left = target - now;
      if (left <= want) return { dt: Math.max(0, left), state: { ...s, paused: true, stepping: false, stepTarget: null } };
      return { dt: want, state: { ...s, stepTarget: target } };
    }
    const budget = s.stepBudget - want;
    return { dt: want, state: budget <= 0 ? { ...s, paused: true, stepping: false, stepTarget: null } : { ...s, stepBudget: budget } };
  }
  if (s.paused) return { dt: 0, state: s };
  return { dt: Math.max(0, rawDt) * s.scale, state: s };
}

export class PlayClock {
  state: ClockState = initialClock();
  private subs = new Set<() => void>();

  /** Simulated seconds to advance this frame. */
  advance(rawDt: number, now: number, upcoming: () => readonly number[]): number {
    const r = advanceClock(this.state, rawDt, now, upcoming);
    const changed = r.state.paused !== this.state.paused;
    this.state = r.state;
    if (changed) this.emit();
    return r.dt;
  }

  get paused(): boolean { return this.state.paused; }
  get scale(): number { return this.state.scale; }
  pause(): void { this.set({ paused: true, stepping: false, stepTarget: null }); }
  resume(): void { this.set({ paused: false, stepping: false, stepTarget: null }); }
  toggle(): void { if (this.state.paused) this.resume(); else this.pause(); }
  setScale(scale: number): void { if (scale > 0 && Number.isFinite(scale)) this.set({ scale }); }
  /** Advance to the next ventricular beat, then pause. */
  stepBeat(): void { this.set({ paused: false, stepping: true, stepTarget: null, stepBudget: STEP_GIVE_UP_S }); }
  subscribe(cb: () => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }

  private set(p: Partial<ClockState>): void { this.state = { ...this.state, ...p }; this.emit(); }
  private emit(): void { for (const cb of [...this.subs]) cb(); }
}
