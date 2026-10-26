/**
 * Which beats a hemodynamic readout may use (task B1): ONE definition, shared by the numbers, the oxygen solve, the cath panels,
 * the JVP, the loops and the monitor roll-up. DOM-free.
 *
 * Why. After a coronary occlusion about a third of beats are premature and each one disturbs its neighbours: the beat BEFORE it is
 * cut short (its "end-diastolic" pressure is read mid-relaxation or mid-ejection, 70-90 mmHg), the premature beat itself ejects little,
 * and the beats AFTER it take about three beats to settle (long compensatory pause, potentiated stroke volume, then recovery).
 * Averages over all of them swing with how many fall in the window. A readout is therefore taken only from steady beats.
 *
 * Policy. A beat is steady when it is not premature (`pvc`), is not cut short by the next one (`prematureNext`, or the next beat in
 * the array when the flag is absent), and none of the 3 beats before it was premature. The newest beat's successor is unknown, so it
 * is left out while any ectopy is present (a normal rhythm keeps it: nothing can cut it short, and the numbers stay what they were).
 * When no beat is steady (sustained AF, VT, a paced or blocked rhythm where every beat is "ectopic", or a very high PVC burden) the
 * readout falls back to the beats that are not premature themselves, and if there are none, to all beats; `used` says which.
 * The heart RATE is not a readout of this kind: it counts every beat (beats per minute over elapsed time) and does not use this.
 */

/** Settling time after a premature beat, in beats (compensatory pause, potentiated beat, recovery). */
export const SETTLE_BEATS = 3;

export type HemoBeatsUsed = "steady" | "non-premature" | "all";

export interface HemoBeatSelection<T> {
  /** The beats a readout may average, in order. */
  beats: T[];
  /** Which rule produced them: the steady beats, else the non-premature ones, else every beat. */
  used: HemoBeatsUsed;
  /** Share of the considered beats that were premature, 0..1. */
  fraction: number;
}

type Beat = { pvc: boolean; prematureNext?: boolean };

/** Which beats of `beats` are steady (see the policy above). */
function steadyMask(beats: readonly Beat[]): boolean[] {
  const ectopy = beats.some((b) => b.pvc);
  return beats.map((b, i) => {
    if (b.pvc || b.prematureNext) return false;
    const next = beats[i + 1];
    if (next ? next.pvc : ectopy) return false; // no successor yet: it may still be cut short
    for (let j = Math.max(0, i - SETTLE_BEATS); j < i; j++) if (beats[j].pvc) return false;
    return true;
  });
}

/**
 * Select the hemodynamic beats of `beats` (oldest first). The first `context` beats are history only: they decide whether the beats
 * after them follow a premature beat, but are neither returned nor counted (pass the 3 beats before a window there).
 */
export function hemodynamicBeats<T extends Beat>(beats: readonly T[], context = 0): HemoBeatSelection<T> {
  const own = beats.slice(context), mask = steadyMask(beats).slice(context), fraction = own.length ? own.filter((b) => b.pvc).length / own.length : 0;
  const steady = own.filter((_, k) => mask[k]);
  if (steady.length) return { beats: steady, used: "steady", fraction };
  const nonPremature = own.filter((b) => !b.pvc);
  if (nonPremature.length) return { beats: nonPremature, used: "non-premature", fraction };
  return { beats: [...own], used: "all", fraction };
}

/** Fewest steady beats a readout is averaged over when ectopy is frequent (older steady beats are borrowed to reach it). */
export const MIN_STEADY_BEATS = 5;

/**
 * The same policy for a readout over a window: `beats[from..]` is the window (a monitor's last seconds), `beats[..from]` is history.
 * With frequent ectopy a window holds few steady beats (a premature beat takes its neighbour and the next three with it, so at
 * a 30 % burden an 8 s window often holds one or none) and the average of one or two beats is as unsteady as the raw one. So when the
 * window has fewer than `minSteady`, the most recent steady beats before it are added, up to `minSteady`, at most `maxBack` beats back.
 * Only the steady rule borrows, and only when the window holds a non-premature beat: a window of premature beats alone (VT, AF, pacing)
 * and the fall-backs stay on the window, so those follow a change as fast as before. `fraction` is that of the window alone. Normal rhythm: exactly the window's beats.
 */
export function windowedHemodynamicBeats<T extends Beat>(beats: readonly T[], from: number, minSteady = MIN_STEADY_BEATS, maxBack = 40): HemoBeatSelection<T> {
  const mask = steadyMask(beats), win = beats.slice(from), fraction = win.length ? win.filter((b) => b.pvc).length / win.length : 0;
  const picked: number[] = [], borrow = win.some((b) => !b.pvc); // a window of premature beats only is a sustained rhythm (VT, AF, pacing): older sinus beats are not its readout
  for (let i = beats.length - 1, back = 0; i >= 0; i--) {
    if (i < from && (!borrow || picked.length >= minSteady || ++back > maxBack)) break;
    if (mask[i]) picked.push(i);
  }
  if (picked.length) return { beats: picked.reverse().map((i) => beats[i]), used: "steady", fraction };
  const ctx = Math.min(from, SETTLE_BEATS), sel = hemodynamicBeats(beats.slice(from - ctx), ctx);
  return { ...sel, fraction };
}

/**
 * The hemodynamic beats among the newest of a source's `beats(n + SETTLE_BEATS)`, for the panels that draw one beat or a few (JVP,
 * cath pull-back and gradients, loops): the extra leading beats are only context for "follows a premature beat".
 */
export function recentHemodynamicBeats<T extends Beat>(beats: readonly T[]): HemoBeatSelection<T> {
  return hemodynamicBeats(beats, beats.length > SETTLE_BEATS ? SETTLE_BEATS : 0);
}
