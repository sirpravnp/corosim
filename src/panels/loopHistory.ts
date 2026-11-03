/**
 * Which beats the PV-loops panel draws as history, and how faintly (task C7). DOM-free.
 *
 * The panel shows the loops of the last `window` seconds, the newest bold and older ones fading with age. Only whole, steady beats are
 * drawn (hemoBeats.ts): a premature beat, the beat it cut short and the three that follow it are not closed cycles and are left out.
 */
import { hemodynamicBeats, SETTLE_BEATS } from "../sim/hemoBeats";

/** Selectable history lengths, s. */
export const LOOP_WINDOWS = [5, 10, 30] as const;
export const DEFAULT_LOOP_WINDOW = 30;
/** Most loops drawn at once (a fast rhythm over 30 s is about 90 beats; thinning keeps the newest and spreads the rest). */
export const MAX_LOOPS = 60;

type HBeat = { t: number; rr: number; pvc: boolean; prematureNext?: boolean };

export interface LoopHistory<T> {
  /** The loops to draw, oldest first; the last is the live one. */
  beats: T[];
  /** Which rule chose them (hemoBeats.ts). */
  used: "steady" | "non-premature" | "all";
  /** Whether the newest completed beat is not among them (it was premature, or cut short by one). */
  omittedNewest: boolean;
}

/**
 * The hemodynamic beats among `all` (oldest first, as `source.beats` gives them) that ended in the last `window` seconds before `now`.
 * The beats before the window still decide whether a window beat follows a premature one. The newest hemodynamic beat is always kept, even when it
 * is older than the window (a long run of ectopy), so the panel is never blank while a steady beat exists.
 */
export function loopHistory<T extends HBeat>(all: readonly T[], now: number, window: number, max = MAX_LOOPS): LoopHistory<T> {
  const sel = hemodynamicBeats(all, all.length > SETTLE_BEATS ? SETTLE_BEATS : 0);
  const inWindow = sel.beats.filter((b) => b.t + b.rr >= now - window);
  let beats = inWindow.length ? inWindow : sel.beats.slice(-1);
  if (beats.length > max) {
    // keep the newest, spread the rest evenly over the others
    const older = beats.slice(0, -1), keep = max - 1;
    beats = [...Array.from({ length: keep }, (_, i) => older[Math.floor((i * (older.length - 1)) / Math.max(1, keep - 1))]), beats[beats.length - 1]];
  }
  const newest = all[all.length - 1];
  return { beats, used: sel.used, omittedNewest: !!newest && beats[beats.length - 1] !== newest };
}

/** Opacity of a history loop that ended `age` s ago in a window of `window` s: faint at the far edge, fairly strong when new. 0 outside the window. */
export function loopAlpha(age: number, window: number): number {
  if (!(window > 0) || !Number.isFinite(age) || age > window) return 0;
  const f = 1 - Math.max(0, age) / window;
  return 0.1 + 0.5 * f * f;
}
