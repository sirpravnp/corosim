/**
 * The ONE vital-signs snapshot of the Simulator page. Every panel that shows a pressure, the heart rate, the cardiac output or the LVEF reads
 * it, so identical labels show identical numbers at every frame. It is a view of `HemoNumbers` (LiveSource.numbers(): the hemodynamic-beats
 * policy of hemoBeats.ts, steady beats for beat-shape values, every beat over the flow window for MAP and CO, HR = beats per minute over the
 * window), never a second computation. DOM-free.
 */
import type { HemoNumbers } from "./hemoSource";

export interface Vitals {
  /** Ventricular rate, bpm (every beat counts, premature ones included). */
  hr: number;
  /** Aortic pressure, mmHg: steady-beat systolic and diastolic, MAP over the flow window. */
  sbp: number; dbp: number; map: number;
  /** Cardiac output L/min and index, stroke volume ml (output / rate, so with ectopy it is the average stroke volume including the weak beats). */
  co: number; ci: number; sv: number;
  /** LV and RV ejection fraction, 0..1. */
  lvEf: number; rvEf: number;
  lvedp: number;
}

export function vitalsOf(n: HemoNumbers): Vitals {
  return { hr: n.hr, sbp: n.systolic, dbp: n.diastolic, map: n.map, co: n.co, ci: n.ci, sv: n.hr > 0 ? (n.co * 1000) / n.hr : NaN, lvEf: n.lvEf, rvEf: n.rvEf, lvedp: n.lvedp };
}

const rnd = (x: number) => (Number.isFinite(x) ? String(Math.round(x)) : "…");

/** The Monitor panel's text for a snapshot (pure, so tests compare it with the Hemodynamics rows). */
export interface MonitorText { hr: string; bp: string; co: string; ef: string; status: "Shock" | "Hypotension" | "Stable" }
export function monitorText(v: Vitals, shockMap: number, hypotensionMap: number): MonitorText {
  const status = !Number.isFinite(v.map) ? "Stable" : v.map < shockMap ? "Shock" : v.map < hypotensionMap ? "Hypotension" : "Stable";
  return {
    hr: Number.isFinite(v.hr) && Math.round(v.hr) > 0 ? `${Math.round(v.hr)} bpm` : "…",
    bp: Number.isFinite(v.sbp) && Number.isFinite(v.dbp) ? `${rnd(v.sbp)}/${rnd(v.dbp)} (${rnd(v.map)})` : `— (${rnd(v.map)})`,
    co: Number.isFinite(v.co) ? `${v.co.toFixed(1)} L/min · SV ${rnd(v.sv)} ml` : "…",
    ef: Number.isFinite(v.lvEf) ? `${Math.round(v.lvEf * 100)}%` : "—",
    status,
  };
}
