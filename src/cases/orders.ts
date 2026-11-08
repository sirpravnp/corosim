// The order catalog: everything a case monitor can show and everything the
// learner can order. Pure and DOM-free; later tasks consume these names.
import { BedsideInput } from "../sim/bedside";
import { Analyte, estimateLabs, labLine, labsOverride, toLabsInput } from "../sim/labs";

export interface PatientNow extends BedsideInput {
  hr: number; sbp: number; dbp: number; urineMlHr: number;
  lvIschemia: number; rvIschemia: number; rhythmLabel: string;
  tempC: number; respRate: number;
  /** Optional: a snapshot without them reads as a baseline patient for the labs. */
  co?: number; lvEf?: number; lowFlowMin?: number; caseMin?: number; ageY?: number;
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
/** Whether the page's 3D heart stage (Figure 1) shows: only if the case's monitor lists `heart3d` or the learner has ordered it. */
export function stageVisible(monitor: readonly string[], ordered: Iterable<string> = []): boolean {
  return monitor.includes("heart3d") || [...ordered].includes("heart3d");
}

const panel = (id: string, label: string, delayS = 0, workspaceId = id): OrderItem => ({ id, label, group: "panel", delayS, panel: workspaceId });

/** A lab panel: one line per analyte, flags as text. An estimate unless the case author set every value. */
const lab = (id: string, label: string, delayS: number, analytes: Analyte[]): OrderItem => ({
  id, label, group: "lab", delayS, // delays are teaching approximations [assumed]
  read: (n) => {
    const v = estimateLabs(toLabsInput(n), labsOverride.values);
    const set = labsOverride.values ?? {};
    return { text: analytes.map((a) => labLine(a, v[a])).join("\n"), estimate: !analytes.every((a) => Number.isFinite(set[a])) };
  },
});

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
  panel("lhc", "Left heart catheterization", 0, "left-heart-cath"), // the workspace panel is "left-heart-cath"
  panel("loops", "Pressure-volume loops"),
  panel("traces", "Waveform traces"),
  panel("ischemia", "Ischemia map"),
  panel("numbers", "Hemodynamic numbers"),
  panel("heart3d", "Heart model"),
  panel("twelvelead", "12-lead ECG", 120, "ecg"), // [assumed] the ECG panel is the 12-lead view
  {
    id: "lactate", label: "Lactate", group: "lab", delayS: 600, // [assumed]
    read: (n) => (num(n.lactate) ? { text: `${round(n.lactate, 1)} mmol/L` } : NA),
  },
  lab("bmp", "Basic metabolic panel", 900, ["na", "k", "cl", "hco3", "bun", "cr", "glu", "ca"]),
  lab("renal", "Renal panel", 900, ["bun", "cr", "egfr"]),
  lab("mg-phos", "Magnesium and phosphate", 900, ["mg", "phos"]),
  lab("cbc", "Complete blood count", 900, ["hgb", "wbc", "plt"]),
  lab("lft", "Liver panel", 1800, ["ast", "alt", "alp", "tbili", "alb"]),
  lab("coags", "Coagulation (PT/INR, aPTT)", 1200, ["inr", "aptt"]),
  lab("troponin", "Troponin", 1200, ["trop"]),
  lab("bnp", "BNP and NT-proBNP", 1200, ["bnp", "ntprobnp"]),
  lab("tsh", "TSH and free T4", 3600, ["tsh", "ft4"]),
  lab("abg", "Arterial blood gas", 300, ["ph", "pco2", "po2", "hco3", "be"]),
  lab("ddimer", "D-dimer", 1800, ["ddimer"]),
  lab("lipase", "Lipase", 1800, ["lipase"]),
  lab("procalcitonin", "Procalcitonin", 3600, ["pct"]),
  lab("lipids", "Lipid panel", 3600, ["tchol", "ldl", "hdl", "tg"]),
  lab("a1c", "Hemoglobin A1c", 3600, ["a1c"]),
  lab("ua", "Urinalysis", 900, ["ua"]),
  lab("tox", "Toxicology screen", 1800, ["tox"]),
  {
    id: "urine", label: "Urine output", group: "bedside", delayS: 0,
    read: (n) => (num(n.urineMlHr) ? { text: `${round(n.urineMlHr)} mL/h` } : NA),
  },
];

export const STANDARD_MONITOR: readonly string[] = ["hr", "bp", "ecg", "spo2", "rr", "temp"];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
export const itemById = (id: string): OrderItem | undefined => BY_ID.get(id);

/** A monitor may list only displays: monitor readings and workspace panels. A lab or bedside result is ordered, never pre-shown. */
export function isDisplayId(id: string): boolean {
  const g = BY_ID.get(id)?.group;
  return g === "monitor" || g === "panel";
}

/** The monitor a case shows. A case may never show nothing: no setting, an empty one, or only unknown ids give the standard six. */
export function resolveMonitor(def: { monitor?: string[] }): string[] {
  const kept = (def.monitor ?? []).filter(isDisplayId);
  return kept.length ? kept : [...STANDARD_MONITOR];
}

/** The shown reason an order or skip is refused because its result could not return in time. */
export const TOO_LATE_NOTE = "That result will not be back before the case ends.";

/**
 * Case seconds between an order and its result. Real turnaround (minutes to an hour) is compressed to fit the case: at most a fifth of the
 * time limit, but never under a minute, and never longer than the item's own delay. [assumed]
 */
export function effectiveDelayS(item: Pick<OrderItem, "delayS">, limitS: number): number {
  return Math.min(item.delayS, Math.max(60, 0.2 * limitS));
}

/** Whether an item ordered at case time `t` would be back before the case ends at `limitS`. */
export function backBeforeEnd(item: Pick<OrderItem, "delayS">, t: number, limitS: number): boolean {
  return t + effectiveDelayS(item, limitS) <= limitS;
}
