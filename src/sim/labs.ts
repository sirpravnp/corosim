// Laboratory estimates for the order system: one finite, plausible value per
// analyte for any patient. Pure and DOM-free. Every baseline, coefficient and
// range here is a teaching approximation, not a measurement. [assumed]
import type { BedsideInput } from "./bedside";

export interface LabsInput extends BedsideInput {
  /** Cardiac output, L/min. */
  co: number;
  /** LV ejection fraction as a fraction (0.6), or a percent (60). */
  lvEf: number;
  lvIschemia: number;
  /** Minutes spent with MAP below 65 mmHg. */
  lowFlowMin: number;
  /** Case minutes since onset. */
  caseMin: number;
  ageY: number;
}

export const ANALYTES = [
  "na", "k", "cl", "hco3", "bun", "cr", "egfr", "glu", "ca", "mg", "phos", "hgb", "wbc", "plt",
  "ast", "alt", "alp", "tbili", "alb", "trop", "bnp", "ntprobnp", "tsh", "ft4", "a1c",
  "inr", "aptt", "ddimer", "lipase", "pct", "tchol", "ldl", "hdl", "tg", "ph", "pco2", "po2", "be",
  "ua", "tox",
] as const;
export type Analyte = (typeof ANALYTES)[number];

/** Reference ranges (adult, inclusive). `ua` and `tox` are codes: 0 is normal or negative, above 0 is abnormal or positive. [assumed] */
export const REF: Record<Analyte, { lo: number; hi: number; unit: string }> = {
  na: { lo: 135, hi: 145, unit: "mmol/L" }, k: { lo: 3.5, hi: 5.0, unit: "mmol/L" }, cl: { lo: 98, hi: 107, unit: "mmol/L" },
  hco3: { lo: 22, hi: 29, unit: "mmol/L" }, bun: { lo: 7, hi: 20, unit: "mg/dL" }, cr: { lo: 0.6, hi: 1.2, unit: "mg/dL" },
  egfr: { lo: 60, hi: 140, unit: "mL/min/1.73 m2" }, glu: { lo: 70, hi: 140, unit: "mg/dL" }, ca: { lo: 8.5, hi: 10.5, unit: "mg/dL" },
  mg: { lo: 1.7, hi: 2.4, unit: "mg/dL" }, phos: { lo: 2.5, hi: 4.5, unit: "mg/dL" }, hgb: { lo: 12, hi: 17, unit: "g/dL" },
  wbc: { lo: 4, hi: 11, unit: "K/uL" }, plt: { lo: 150, hi: 400, unit: "K/uL" }, ast: { lo: 10, hi: 40, unit: "U/L" },
  alt: { lo: 7, hi: 56, unit: "U/L" }, alp: { lo: 44, hi: 147, unit: "U/L" }, tbili: { lo: 0.1, hi: 1.2, unit: "mg/dL" },
  alb: { lo: 3.5, hi: 5.0, unit: "g/dL" }, trop: { lo: 0, hi: 14, unit: "ng/L" }, bnp: { lo: 0, hi: 100, unit: "pg/mL" },
  ntprobnp: { lo: 0, hi: 300, unit: "pg/mL" }, tsh: { lo: 0.4, hi: 4.0, unit: "mIU/L" }, ft4: { lo: 0.8, hi: 1.8, unit: "ng/dL" },
  a1c: { lo: 4.0, hi: 5.6, unit: "%" }, inr: { lo: 0.9, hi: 1.2, unit: "" }, aptt: { lo: 25, hi: 35, unit: "s" },
  ddimer: { lo: 0, hi: 0.5, unit: "ug/mL FEU" }, lipase: { lo: 0, hi: 160, unit: "U/L" }, pct: { lo: 0, hi: 0.5, unit: "ng/mL" },
  tchol: { lo: 125, hi: 200, unit: "mg/dL" }, ldl: { lo: 0, hi: 100, unit: "mg/dL" }, hdl: { lo: 40, hi: 100, unit: "mg/dL" },
  tg: { lo: 0, hi: 150, unit: "mg/dL" }, ph: { lo: 7.35, hi: 7.45, unit: "" }, pco2: { lo: 35, hi: 45, unit: "mmHg" },
  po2: { lo: 80, hi: 120, unit: "mmHg" }, be: { lo: -2, hi: 2, unit: "mmol/L" }, ua: { lo: 0, hi: 0, unit: "" }, tox: { lo: 0, hi: 0, unit: "" },
};

/** Display names and decimals, used by the order items. */
export const LABEL: Record<Analyte, { name: string; dec: number }> = {
  na: { name: "Na", dec: 0 }, k: { name: "K", dec: 1 }, cl: { name: "Cl", dec: 0 }, hco3: { name: "HCO3", dec: 0 }, bun: { name: "BUN", dec: 0 },
  cr: { name: "Creatinine", dec: 1 }, egfr: { name: "eGFR", dec: 0 }, glu: { name: "Glucose", dec: 0 }, ca: { name: "Ca", dec: 1 },
  mg: { name: "Mg", dec: 1 }, phos: { name: "Phosphate", dec: 1 }, hgb: { name: "Hemoglobin", dec: 1 }, wbc: { name: "WBC", dec: 1 },
  plt: { name: "Platelets", dec: 0 }, ast: { name: "AST", dec: 0 }, alt: { name: "ALT", dec: 0 }, alp: { name: "Alk phos", dec: 0 },
  tbili: { name: "Total bilirubin", dec: 1 }, alb: { name: "Albumin", dec: 1 }, trop: { name: "Troponin", dec: 0 }, bnp: { name: "BNP", dec: 0 },
  ntprobnp: { name: "NT-proBNP", dec: 0 }, tsh: { name: "TSH", dec: 2 }, ft4: { name: "Free T4", dec: 1 }, a1c: { name: "HbA1c", dec: 1 },
  inr: { name: "INR", dec: 1 }, aptt: { name: "aPTT", dec: 0 }, ddimer: { name: "D-dimer", dec: 2 }, lipase: { name: "Lipase", dec: 0 },
  pct: { name: "Procalcitonin", dec: 2 }, tchol: { name: "Total cholesterol", dec: 0 }, ldl: { name: "LDL", dec: 0 }, hdl: { name: "HDL", dec: 0 },
  tg: { name: "Triglycerides", dec: 0 }, ph: { name: "pH", dec: 2 }, pco2: { name: "pCO2", dec: 0 }, po2: { name: "pO2", dec: 0 },
  be: { name: "Base excess", dec: 0 }, ua: { name: "Urinalysis", dec: 0 }, tox: { name: "Toxicology screen", dec: 0 },
};

export function flag(a: Analyte, v: number): "H" | "L" | "" {
  const r = REF[a];
  return v > r.hi ? "H" : v < r.lo ? "L" : "";
}

const fin = (x: number | undefined, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Physiologic clamp per analyte (lo, hi), so no model input can produce an impossible value. [assumed] */
const LIMITS: Partial<Record<Analyte, [number, number]>> = {
  na: [100, 170], k: [2.0, 9.0], cl: [70, 130], hco3: [4, 40], bun: [3, 200], cr: [0.3, 15], egfr: [2, 140], glu: [20, 800],
  ca: [5, 14], mg: [0.8, 6], phos: [1, 12], hgb: [3, 20], wbc: [0.5, 60], plt: [5, 1000], ast: [8, 10000], alt: [5, 10000],
  alp: [30, 1000], tbili: [0.1, 30], alb: [1, 5.5], trop: [0, 50000], bnp: [5, 5000], ntprobnp: [20, 35000], tsh: [0.01, 100],
  ft4: [0.1, 6], a1c: [3.5, 15], inr: [0.8, 10], aptt: [20, 150], ddimer: [0.05, 20], lipase: [10, 3000], pct: [0.02, 100],
  tchol: [60, 500], ldl: [20, 350], hdl: [15, 120], tg: [30, 1500], ph: [6.6, 7.8], pco2: [10, 120], po2: [20, 500], be: [-30, 15],
};

/**
 * One value for every analyte. Normal adult baselines plus additive,
 * monotonic adjustments; non-finite inputs contribute nothing (baseline).
 * `override` replaces exactly the named analytes (finite values only) and
 * nothing derived from them changes. [assumed]
 */
export function estimateLabs(i: LabsInput, override?: Record<string, number>): Record<Analyte, number> {
  const lactate = Math.max(0, fin(i.lactate, 1));
  const lf = clamp(fin(i.lowFlowMin, 0), 0, 240) / 120; // 1.0 at two hours of low flow, capped at 2. [assumed]
  const cong = clamp(fin(i.congestion, 0), 0, 1);
  const isch = clamp(fin(i.lvIschemia, 0), 0, 1);
  const co = fin(i.co, NaN);
  const lowCo = Number.isFinite(co) ? clamp(5 - co, 0, 5) : 0; // L/min below 5. [assumed]
  const efRaw = fin(i.lvEf, NaN);
  const ef = Number.isFinite(efRaw) ? (efRaw > 1 ? efRaw / 100 : efRaw) : NaN;
  const lowEf = Number.isFinite(ef) ? clamp(0.55 - ef, 0, 0.55) / 0.55 : 0; // 0 normal, 1 no function. [assumed]
  const age = clamp(fin(i.ageY, 65), 18, 100);
  const spo2 = clamp(fin(i.spo2, 0.98), 0, 1);
  const arrest = i.arrest === "arrest" || i.arrest === "dead";
  const rosc = i.arrest === "rosc";
  const caseMin = clamp(fin(i.caseMin, 0), 0, 1e6);
  const ex = Math.max(0, lactate - 1); // lactate above normal, mmol/L

  const v = {} as Record<Analyte, number>;
  v.cr = 0.9 + 1.0 * lf + 0.08 * lowCo + 0.1 * cong;
  v.bun = 14 + 14 * lf + 1.5 * lowCo + 4 * cong;
  v.k = 4.2 + 0.5 * lf + 0.15 * Math.max(0, lactate - 2) + 0.06 * lowCo + (arrest ? 1.0 : 0);
  v.hco3 = 25 - 0.9 * Math.max(0, lactate - 1.5) - (arrest ? 2 : 0) - 1.5 * lf;
  v.na = 140 - 4 * cong - 1.5 * lf;
  const ag = 10 + 0.9 * ex; // anion gap rises with lactate. [assumed]
  v.cl = v.na - v.hco3 - ag;
  v.glu = 100 + 6 * ex + (arrest ? 40 : 0);
  v.ca = 9.4 - 0.1 * Math.max(0, lactate - 2) - 0.3 * lf;
  v.mg = 2.0 + 0.1 * lf;
  v.phos = 3.5 + 0.8 * lf + 0.15 * Math.max(0, lactate - 2);
  const scr = clamp(v.cr, 0.3, 15);
  // CKD-EPI 2021 shape, sex-neutral (male coefficients). [assumed]
  v.egfr = 142 * Math.pow(Math.min(scr / 0.9, 1), -0.302) * Math.pow(Math.max(scr / 0.9, 1), -1.2) * Math.pow(0.9938, age);
  v.hgb = 14;
  v.wbc = 7.5 + 0.6 * Math.max(0, lactate - 2);
  v.plt = 250 - 40 * lf;
  v.ast = 25 + 60 * lf + 20 * cong;
  v.alt = 25 + 60 * lf + 10 * cong;
  v.alp = 90 + 60 * cong + 20 * lf;
  v.tbili = 0.7 + 1.2 * cong + 0.5 * lf;
  v.alb = 4.2 - 0.4 * lf;
  v.trop = 5 + 800 * isch * clamp(caseMin / 180, 0, 1) + 0.5 * clamp(fin(i.lowFlowMin, 0), 0, 240); // ramps over three hours. [assumed]
  v.bnp = 30 + 900 * cong + 400 * lowEf;
  v.ntprobnp = 3.5 * v.bnp + 20 + 100 * Math.max(0, scr - 0.9);
  v.tsh = 2.0; v.ft4 = 1.2; v.a1c = 5.3;
  v.inr = 1.0 + 0.8 * lf;
  v.aptt = 30 + 8 * lf;
  v.ddimer = 0.3 + 0.1 * lf + (arrest ? 1.0 : 0);
  v.lipase = 60 + 40 * lf;
  v.pct = 0.05 + 0.1 * lf;
  v.ldl = 90; v.hdl = 55; v.tg = 110;
  v.tchol = v.ldl + v.hdl + v.tg / 5;
  // Respiratory compensation (Winter shape) for a metabolic acidosis; arrest retains CO2. [assumed]
  const comp = 1.2 * Math.max(0, 25 - clamp(v.hco3, 4, 40));
  v.pco2 = 40 - comp + (arrest ? 25 : rosc ? 8 : 0) + 6 * cong;
  const pc = clamp(v.pco2, 10, 120), hc = clamp(v.hco3, 4, 40);
  v.ph = 6.1 + Math.log10(hc / (0.03 * pc));
  v.be = 0.93 * (hc - 24.4) + 13.77 * (clamp(v.ph, 6.6, 7.8) - 7.4);
  // Hill curve inverted from saturation (P50 26.8, n 2.7). [assumed]
  const s = clamp(spo2, 0.5, 0.995);
  v.po2 = 26.8 * Math.pow(s / (1 - s), 1 / 2.7);
  v.ua = lf > 0.25 ? 1 : 0; // concentrated urine with casts after prolonged low flow. [assumed]
  v.tox = 0;

  for (const a of ANALYTES) { const lim = LIMITS[a]; if (lim) v[a] = clamp(v[a], lim[0], lim[1]); }
  for (const [k, x] of Object.entries(override ?? {})) if ((ANALYTES as readonly string[]).includes(k) && Number.isFinite(x)) v[k as Analyte] = x;
  return v;
}

/** The case's author-set lab values (analyte id to value). Unset means everything is derived. */
export const labsOverride: { values?: Record<string, number> } = {};
export function setCaseLabs(l: Record<string, number> | undefined): void { labsOverride.values = l; }

/** The fields estimateLabs needs from any patient snapshot; missing ones fall back to baseline. */
export type LabsSource = BedsideInput & Partial<Pick<LabsInput, "co" | "lvEf" | "lvIschemia" | "lowFlowMin" | "caseMin" | "ageY">>;
export function toLabsInput(n: LabsSource): LabsInput {
  return { ...n, co: fin(n.co, NaN), lvEf: fin(n.lvEf, NaN), lvIschemia: fin(n.lvIschemia, 0), lowFlowMin: fin(n.lowFlowMin, 0), caseMin: fin(n.caseMin, 0), ageY: fin(n.ageY, 65) };
}

/** One line per analyte, flag as text: "K 5.6 mmol/L H". The urinalysis and screen are words. */
export function labLine(a: Analyte, x: number): string {
  const f = flag(a, x), tail = f ? ` ${f}` : "";
  if (a === "ua") return `Urinalysis ${x > 0 ? "concentrated, granular casts, protein trace" : "clear, no protein, no blood"}${tail}`;
  if (a === "tox") return `Toxicology screen ${x > 0 ? "positive" : "negative (urine drug screen, ethanol)"}${tail}`;
  const unit = REF[a].unit;
  return `${LABEL[a].name} ${x.toFixed(LABEL[a].dec)}${unit ? ` ${unit}` : ""}${tail}`;
}
