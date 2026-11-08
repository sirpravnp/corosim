// Bedside readings the monitor cannot measure directly: respiratory rate and
// body temperature. Pure and DOM-free.

export interface BedsideInput {
  respRateBase: number;
  map: number;
  spo2: number;
  lactate: number;
  congestion: number;
  arrest: "none" | "arrest" | "rosc" | "dead";
  tempOverrideC?: number;
}

/** Finite numbers pass through; NaN and infinities contribute nothing. */
function fin(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Respiratory rate in breaths/min: base plus additive compensatory terms,
 * rounded and clamped to 4..40. Zero in arrest or death. Coefficients are
 * teaching approximations. [assumed]
 */
export function estimateRespRate(i: BedsideInput): number {
  if (i.arrest === "arrest" || i.arrest === "dead") return 0;
  const base = fin(i.respRateBase, 15);
  // Hypotension below MAP 65 mmHg drives rate up 0.4/min per mmHg. [assumed]
  const hypotension = Math.max(0, 65 - fin(i.map, 65)) * 0.4;
  // Lactate above 2 mmol/L (metabolic acidosis) adds 2/min per mmol/L. [assumed]
  const acidosis = Math.max(0, fin(i.lactate, 0) - 2) * 2;
  // Pulmonary congestion (0..1) adds up to 6/min. [assumed]
  const congestion = Math.max(0, fin(i.congestion, 0)) * 6;
  // SpO2 below 0.94 adds 0.8/min per saturation point. [assumed]
  const hypoxia = Math.max(0, 0.94 - fin(i.spo2, 0.94)) * 100 * 0.8;
  const rate = Math.round(base + hypotension + acidosis + congestion + hypoxia);
  return Math.min(40, Math.max(4, rate));
}

/** Core temperature in degrees C: 37.0 unless a case overrides it. */
export function bodyTempC(i: BedsideInput): number {
  return i.tempOverrideC !== undefined && Number.isFinite(i.tempOverrideC) ? i.tempOverrideC : 37.0;
}

/** The case's body temperature (degrees C), read by the monitor. Unset gives the 37.0 default. */
export const bedsideOverride: { tempOverrideC?: number } = {};
/** Set the case's body temperature; undefined clears it back to the default. */
export function setBedsideTemp(c: number | undefined): void {
  bedsideOverride.tempOverrideC = c;
}
