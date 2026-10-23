// Pericardial sac constants (core/pericardium.ts). [lit] = from the literature or a textbook value; [assumed] = a teaching choice.

/**
 * Pressure-volume law of the sac: P = s · A · (exp(B·(V_sac − V0 − stretch + k·(s − 1))) − 1), mmHg, with V_sac the blood in the four
 * chambers plus the effusion (ml). Exponential form: Freeman & LeWinter 1984 and Holmes et al. (pericardial P-V curves are flat,
 * then rise steeply, so a small rapid volume gain is tolerated up to a knee and then pressure climbs). [lit, form]
 */
export const PERICARDIUM = {
  /** Scale A of the pressure law, mmHg. [assumed, tuned] */
  a: 1.0,
  /** Exponent B, 1/ml. With V0 under the end-diastolic heart volume, 150-250 ml of fluid reaches tamponade pressures: normal reserve is small. [assumed, tuned] */
  b: 0.03,
  /** Unstressed sac volume V0, ml (chamber blood + effusion at which P_peri = 0); 25 ml under the adult end-diastolic chamber volume (305 ml; the chambers hold 178-305 ml over a beat), so P_peri is about 0.8 mmHg at end-diastole and 0 for most of the beat. [assumed, tuned] */
  v0: 280,
  /** Time constant (s) of the stretch of V0 toward the sac volume: infinite at engine level (no adaptation); the simulation scales it to clinical time (days). [assumed] */
  /** k: ml of unstressed volume lost per unit of (stiffness − 1), V0_eff = V0 − k·(s − 1): a constricting scar fits the heart tighter. [assumed, tuned] */
  reservePerStiffness: 12,
  adaptTauS: Infinity,
};
