// The order catalog: everything a case monitor can show and everything the
// learner can order. Pure and DOM-free; later tasks consume these names.
import { BedsideInput } from "../sim/bedside";

export interface PatientNow extends BedsideInput {
  hr: number; sbp: number; dbp: number; urineMlHr: number;
  lvIschemia: number; rvIschemia: number; rhythmLabel: string;
  tempC: number; respRate: number;
}
export interface Reading { text: string; estimate?: boolean }
export interface OrderItem {
  id: string; label: string; group: "monitor" | "panel" | "lab" | "bedside";
  /** Seconds of case time between the order and the result. Values other than 0 are teaching approximations. [assumed] */
  delayS: number;
  /** The workspace panel this item opens. */
  panel?: string;
  read?(n: PatientNow): Reading;
}

const NA: Reading = { text: "not measurable" };
const num = (...xs: number[]) => xs.every(Number.isFinite);
const round = (x: number, d = 0) => x.toFixed(d);

const monitor = (id: string, label: string, read: (n: PatientNow) => Reading): OrderItem => ({ id, label, group: "monitor", delayS: 0, read });
const panel = (id: string, label: string, delayS = 0): OrderItem => ({ id, label, group: "panel", delayS, panel: id });

export const CATALOG: readonly OrderItem[] = [
  monitor("hr", "Heart rate", (n) => (num(n.hr) ? { text: `${round(n.hr)} /min` } : NA)),
  monitor("bp", "Blood pressure", (n) => (num(n.sbp, n.dbp) ? { text: `${round(n.sbp)}/${round(n.dbp)} mmHg` } : NA)),
  monitor("ecg", "ECG rhythm", (n) => ({ text: n.rhythmLabel || "not measurable" })),
  monitor("spo2", "Oxygen saturation", (n) => (num(n.spo2) ? { text: `${round(n.spo2 * 100)}%` } : NA)),
  monitor("rr", "Respiratory rate", (n) => (num(n.respRate) ? { text: `${round(n.respRate)} /min`, estimate: true } : NA)),
  monitor("temp", "Temperature", (n) => (num(n.tempC) ? { text: `${round(n.tempC, 1)} C`, estimate: true } : NA)),
  panel("oxygen", "Oxygen delivery"),
  panel("jvp", "Neck veins"),
  panel("rhc", "Right heart catheterization"),
  panel("lhc", "Left heart catheterization"),
  panel("loops", "Pressure-volume loops"),
  panel("traces", "Waveform traces"),
  panel("ischemia", "Ischemia map"),
  panel("numbers", "Hemodynamic numbers"),
  panel("heart3d", "Heart model"),
  panel("twelvelead", "12-lead ECG", 120), // [assumed]
  {
    id: "lactate", label: "Lactate", group: "lab", delayS: 600, // [assumed]
    read: (n) => (num(n.lactate) ? { text: `${round(n.lactate, 1)} mmol/L` } : NA),
  },
  {
    id: "urine", label: "Urine output", group: "bedside", delayS: 0,
    read: (n) => (num(n.urineMlHr) ? { text: `${round(n.urineMlHr)} mL/h` } : NA),
  },
];

export const STANDARD_MONITOR: readonly string[] = ["hr", "bp", "ecg", "spo2", "rr", "temp"];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
export const itemById = (id: string): OrderItem | undefined => BY_ID.get(id);

/** The monitor a case shows. A case may never show nothing: no setting, an empty one, or only unknown ids give the standard six. */
export function resolveMonitor(def: { monitor?: string[] }): string[] {
  const kept = (def.monitor ?? []).filter((id) => BY_ID.has(id));
  return kept.length ? kept : [...STANDARD_MONITOR];
}
