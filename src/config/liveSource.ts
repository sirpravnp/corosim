// Constants of the Simulator page's live HemoSource (src/sim/liveSource.ts, task P16). Teaching choices, all [assumed].

export const LIVE_SOURCE = {
  /** `numbers()` and `saturations()` average the beats completed in the last this many seconds, as a bedside monitor does (the 10 s of `Simulation.hemo` is of the same order). [assumed] */
  numbersWindowS: 8,
  /** ... but never fewer than this many beats, so a slow heart (complete heart block at 40/min) still averages. [assumed] */
  minBeats: 3,
  /** Time-averaged readouts (MAP, CO, SVR, PVR, Qp:Qs, the oxygen solve, pump flows) average EVERY beat over this many seconds when the window holds a premature beat (the ring holds 30 s). Longer than `numbersWindowS` because the premature beats and their pauses come irregularly. [assumed] */
  flowWindowS: 30,
  /** Readouts are averaged over at least this many steady beats (hemoBeats.ts): with frequent ectopy the window holds fewer, so older steady beats are borrowed. [assumed] */
  minSteadyBeats: 5,
  /** Completed beats are kept for this long (s) and at most this many: the panels draw the last few, `beats()` serves a cath pullback, and with frequent ectopy the steady-beat readouts borrow from further back (60 s, since at a 40 % burden a 30 s ring can hold none). The flow window (below) is shorter. [assumed] */
  ringSeconds: 60, maxBeats: 120,
  /** Device consoles are rebuilt at most this often (s of simulation time); a panel may ask every frame. [assumed] */
  deviceEveryS: 0.1,
  /** Length (s) of the waveforms a console draws (Impella placement signal, IABP arterial trace). [assumed] */
  deviceTraceS: 6,
  /** Bed oxygenation placeholder: tissue O2 = base - slope x ischemia severity (until tasks E2/E3). [assumed] */
  bedOxygen: { base: 0.75, slope: 0.45 },
};
