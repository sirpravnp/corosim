/**
 * Oxygen-in-time (E6) constants. Tags: [lit] from a source, [assumed] teaching/engineering choice.
 * Units: DO₂/VO₂ ml O₂/min, lactate mmol/L, time clinical minutes unless noted.
 */
export const OXYGEN = {
  /** Critical systemic DO₂ (ml/min) below which VO₂ becomes supply-dependent and lactate rises. ~5–6 ml/kg/min × 70 kg. [lit order] */
  criticalDo2MlMin: 400,
  /** Resting arterial lactate, mmol/L. [lit: ~0.5–1.5] */
  lactateRest: 1.0,
  /** Soft upper clamp, mmol/L. [assumed] */
  lactateMax: 20,
  /**
   * Lactate production rate (mmol/L per clinical minute) when DO₂ = 0 relative to critical.
   * At DO₂ = critical/2 this is half; a few minutes of severe low-output reach ~3–4 mmol/L. [assumed]
   */
  lactateRisePerMin: 0.6,
  /** First-order clearance time constant toward rest when DO₂ ≥ critical, clinical minutes. [assumed] */
  lactateClearTauMin: 12,
  /** Floor volume (ml) when integrating content so empty nodes do not blow up. [assumed] */
  minVolumeMl: 8,
  /**
   * Explicit Euler substeps per beat of transport. More steps → closer to the steady Gauss–Seidel solve. [assumed]
   */
  substepsPerBeat: 4,
  /**
   * Approximate resting LV MVO₂ (ml/min) used to normalise the live demand scale from beat work
   * (~8.8 ml/min/100 g × 170 g). [assumed; matches ENERGETICS adult baseline]
   */
  restingMvo2MlMin: 15,
  /**
   * How much the live MVO₂ estimate can move coronary demand relative to the drug/device demand factor.
   * 0 keeps E3 on the previous `coreDemand()` path only; 1 replaces it with MVO₂/rest. [assumed]
   */
  mvo2DemandBlend: 0.35,
  /** Clamp on the MVO₂-derived demand multiplier. [assumed] */
  mvo2DemandMin: 0.55,
  mvo2DemandMax: 2.5,
  /**
   * Myocardial O₂ debt per coronary bed (0..1). Rises when supply/demand ratio < 1; clears on reperfusion.
   * Feeds tissue-O₂ readout and is available for a later injury blend; E3 injury still comes from `sev` by default. [assumed]
   */
  myocardialDebt: {
    risePerMin: 0.35,
    clearTauMin: 6,
    /** Soft gain that can raise regional injury above network severity: injury = max(sev, gain·debt). 0 = E3 unchanged. [assumed] */
    injuryGain: 0.2,
  },
  /**
   * SCAI shock-stage thresholds from MAP (mmHg) and lactate (mmol/L). Teaching map, not a registry implementation. [assumed]
   * A at-risk; B beginning; C classic; D deteriorating; E extremis.
   */
  scai: {
    lactateB: 2.0,
    lactateC: 4.0,
    lactateD: 8.0,
    mapHypotension: 70,
    mapShock: 55,
    mapExtremis: 40,
  },
} as const;

export type ScaiStage = "A" | "B" | "C" | "D" | "E";
