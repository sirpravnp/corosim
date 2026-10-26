/**
 * What every hemodynamic panel reads (docs/HEMODYNAMICS_CORE.md §4G). Panels never touch an engine: the bridge over
 * today's engines (task P2) and the core engine (task P16) both implement this, so panels survive the swap.
 *
 * Pull, not push: a panel asks for what it draws when it draws. Trace buffers are kept by the source, so a panel opened
 * late still shows the last seconds. Types only.
 *
 * Units: mmHg, ml, ml/s, L/min, seconds, saturations 0..1. NaN means "not available in this patient" (no ductus, no device).
 */

/** Nodes every source provides. The core engine may add more (venous reservoirs); panels must ignore names they do not know. */
export type HemoNode = "SVC" | "IVC" | "RA" | "RV" | "PA" | "PV" | "LA" | "LV" | "AO" | "DAO";
export type Chamber = "RA" | "RV" | "LA" | "LV";

export interface Series { t: Float32Array; v: Float32Array } // seconds on the source's clock, value

/** One completed ventricular beat, from one R wave to the next. */
export interface BeatSummary {
  t: number; // s, start of the beat
  rr: number; // s
  pvc: boolean;
  /**
   * The next beat was premature (a PVC), so this beat ended early, mid-ejection or mid-relaxation. Its loop is a partial trajectory
   * (it continues into the premature beat's), not a closed cycle, and its end-diastolic readings are not end-diastolic. Absent means false.
   */
  prematureNext?: boolean;
  /** Pressure–volume samples per chamber over the beat, for loops. */
  loops: Record<Chamber, { p: Float32Array; v: Float32Array }>;
  /** Pressure samples per node over the beat, for traces of a single beat (cath pullbacks, JVP). */
  pressure: Record<HemoNode, Float32Array>;
  /** Sample times for `loops` and `pressure`, s from `t`. */
  time: Float32Array;
  /** Atrial activation times within the beat, s from `t` (none in AF; two or more in heart block). JVP a waves and cannon waves. */
  atrial: Float32Array;
  edv: Record<Chamber, number>; esv: Record<Chamber, number>;
  strokeVolume: number; // LV, ml
  /** Per valve over the beat: forward and regurgitant volume, ml, and how long it was open, ms (Gorlin and Hakki areas). */
  valves: Record<"AV" | "MV" | "TV" | "PV", { forwardMl: number; regurgMl: number; openMs: number }>;
}

/** The numbers a catheter, a monitor or an echo would read now. */
export interface HemoNumbers {
  hr: number;
  map: number; systolic: number; diastolic: number;
  cvp: number; // mean RA
  pa: { systolic: number; diastolic: number; mean: number };
  pcwp: number; // mean LA (wedge)
  lvedp: number; rvedp: number;
  co: number; ci: number; // L/min, L/min/m²
  svr: number; pvr: number; // Wood units
  lvEf: number; rvEf: number;
  qpQs: number;
  /**
   * Premature beats and the beats the readouts above were taken from (hemoBeats.ts): `fraction` of the beats of the window that were
   * premature, `beats` the number averaged, `used` which rule selected them ("steady": not premature, not cut short, not within 3 beats
   * after one; else the non-premature ones; else all). Absent when the source does not select beats (the steady-state bridge).
   */
  ectopy?: { fraction: number; beats: number; used: "steady" | "non-premature" | "all" };
}

export interface Saturations {
  /** Blood saturation in each node. */
  node: Record<HemoNode, number>;
  spo2: number; // a finger probe on the right hand (pre-ductal)
  preductal: number; postductal: number;
  svo2: number; // mixed venous (pulmonary artery)
  do2: number; vo2: number; // ml O₂/min
  lactate: number; // mmol/L, NaN until oxygen-in-time (E6)
  /** Per coronary bed: tissue oxygenation 0..1, and whether the value is physics or derived from ischemia severity. */
  bed: Record<string, number>;
  bedSource: "ischemia-derived" | "supply-demand";
}

/** A device's console, as its screen would show it. */
export interface DeviceConsole {
  id: string; // "impella", "iabp", "ecmo", "impellaRp"
  label: string;
  readings: Record<string, number>; // e.g. { flowLpm, motorCurrent, level } — panels show what they recognise
  /** Waveforms the console draws (Impella placement signal, IABP arterial trace). */
  traces?: Record<string, Series>;
  alarms: string[];
}

export interface HemoSource {
  /** Seconds on the source's clock. */
  now(): number;
  /** Nodes this source has; at least every `HemoNode`. */
  nodes(): readonly string[];
  /** The last `seconds` of a node's pressure (or a chamber's volume), downsampled to at most `maxPoints`. */
  trace(node: string, seconds: number, opts?: { quantity?: "pressure" | "volume"; maxPoints?: number }): Series;
  /** The last completed beats, newest last. */
  beats(count?: number): readonly BeatSummary[];
  numbers(): HemoNumbers;
  saturations(): Saturations;
  devices(): readonly DeviceConsole[];
  /** Called after each completed beat; returns an unsubscribe function. */
  onBeat(cb: (b: BeatSummary) => void): () => void;
  /** Whether the numbers come from a steady-state solve replayed (bridge) or a live beat-by-beat engine. */
  readonly kind: "bridge" | "live";
  /**
   * True when the numbers are the patient's own baseline solve and are NOT tied to the ACS monitor (a neonate, or any
   * patient whose baseline is not the adult one the ACS model represents). On such a patient the monitor (ACS, adult) is not
   * meaningful next to these numbers. Absent means false.
   */
  readonly standalone?: boolean;
  /** Baseline physiology of the patient behind the numbers (valves are graded against its own normal areas). Absent means "adult". */
  readonly patientKind?: "adult" | "neonate";
}
