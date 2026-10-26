// Constants of the Simulator page's live HemoSource (src/sim/liveSource.ts, task P16). Teaching choices, all [assumed].

export const LIVE_SOURCE = {
  /** `numbers()` and `saturations()` average the beats completed in the last this many seconds, as a bedside monitor does (the 10 s of `Simulation.hemo` and the 15 s of the bridge's MAP window are of the same order). [assumed] */
  numbersWindowS: 8,
  /** ... but never fewer than this many beats, so a slow heart (complete heart block at 40/min) still averages. [assumed] */
  minBeats: 3,
  /** Readouts are averaged over at least this many steady beats (hemoBeats.ts): with frequent ectopy the window holds fewer, so older steady beats are borrowed. [assumed] */
  minSteadyBeats: 5,
  /** Completed beats are kept for this long (s) and at most this many: the panels draw the last few and `beats()` serves a cath pullback. [assumed] */
  ringSeconds: 30, maxBeats: 120,
  /** Device consoles are rebuilt at most this often (s of simulation time); a panel may ask every frame. [assumed] */
  deviceEveryS: 0.1,
  /** Length (s) of the waveforms a console draws (Impella placement signal, IABP arterial trace). [assumed] */
  deviceTraceS: 6,
};
