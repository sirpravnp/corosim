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
  reservePerStiffness: 16,
  adaptTauS: Infinity,
  /** An effusion that keeps accumulating stops at this volume (ml): the sac cannot hold an unlimited amount (a chronic effusion rarely exceeds about 2 L; the spec's own range ends here too). Without it a continuing rate filled the sac to many litres at a fast clock. [assumed] */
  maxEffusionMl: 2000,
  /** Fastest the sac may fill per simulated second (ml/s): the clinical clock is slowed so a rate per clinical minute never fills it faster, so the heart follows the effusion as it would in real time and a fast clock cannot outrun the tamponade. [assumed] */
  maxFillMlPerS: 20,
};

/**
 * Electrical alternans (B4): the heart swings in the fluid once the sac holds enough of it, so the QRS amplitude alternates beat to beat
 * (the preset "alternans" of the EKG library). It is a sign of a large effusion, not of its pressure, so it is tied to the size: none up to
 * `thresholdMl`, then the alternation depth (a fraction of the QRS amplitude, +/-) rises linearly to `maxAmplitude` over `rampMl`.
 * Threshold 250 ml: the effusion at which the simulator's resting adult is in a developed tamponade (output down by half, the four diastolic
 * pressures within 4 mmHg of the sac pressure) and the sac holds more fluid than the heart has room to float in; below it a small or moderate
 * effusion has a still heart and no alternans. Clinically the sign needs a large effusion (echo: a swinging heart in a collection over about
 * 2 cm, several hundred ml). [lit, qualitative; the number is assumed]
 */
export const ALTERNANS = {
  thresholdMl: 250,
  rampMl: 50,
  /** The depth of the EKG library preset "alternans" (src/ekg/presets.ts: QRS x(1 ± 0.32)). */
  maxAmplitude: 0.32,
  /** The library preset the sign stands for. */
  presetId: "alternans",
};

/** Alternation depth (QRS x(1 ± a) on alternate beats) for an effusion of `effusionMl` ml in a sac that is not open: 0 below the threshold. */
export function alternansAmplitude(effusionMl: number | undefined, open = false): number {
  if (open || !(effusionMl && effusionMl > ALTERNANS.thresholdMl)) return 0;
  return ALTERNANS.maxAmplitude * Math.min(1, (effusionMl - ALTERNANS.thresholdMl) / ALTERNANS.rampMl);
}
