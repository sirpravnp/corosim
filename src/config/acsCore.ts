// Constants of the ACS simulation on the core engine (src/sim/simulation.ts, engine "core"). Dose sizes that already exist in
// config/management.ts (SUPPORT) are reused where they map; everything new is here. Every value is a teaching assumption
// [assumed] unless tagged [lit]. Task A7.

export const ACS_CORE = {
  /**
   * Venous tone from the autonomic loop: tone = 1 + gain·(vascular sympathetic tone − resting tone), in `LiveHeart.setModifiers`
   * (the tone-to-unstressed-volume map is `VENOUS_TONE`, config/live.ts). A7 used 0.2 plus a separate saturating patch on the
   * volume deficit. A7b removes the patch: the model holds only 0.7 L stressed of 4.9 L (unstressed 3.6 L, 2 L of it splanchnic), so
   * a 15 % bleed (0.74 L) must recruit about 0.5 L of unstressed volume, which takes a tone near 1.2-1.3; the reserve is capped
   * by `VENOUS_TONE.factorRange`, so a 30 % bleed cannot be compensated. 0.75 is the largest value that keeps the anterior STEMI
   * pressure 8 mmHg below normal and the RV-infarct fluid response (a high gain lets the loop undo the fluid by venodilating); the
   * smallest that lifts the RV infarct's CVP to 10. The structural venous compliances were not changed (see the A7b notes). [assumed]
   */
  venousToneGain: 0.75,
  /**
   * Blood given or lost at the start (ml) is built into the heart up to the range the structural spec accepts; anything beyond
   * (a hemorrhage over about 20 %) is taken out at no more than `maxVolumeRate` ml/s, so it also never changes faster than that. [assumed]
   */
  startVolumeMl: [-1000, 5000] as [number, number], maxVolumeRate: 120,
  /** Norepinephrine (alpha-1) also constricts the veins: tone × (1 + k·dose). Resistance uses SUPPORT.norepiSvr. A7 used 0.3 which, with the stronger loop gain, over-recovered a bled patient (SV 83, HR 66 against the legacy 53, 83): 0.1 gives a partial recovery. [assumed] */
  norepiVenousTone: 0.3,
  /**
   * Dobutamine: Ees × (1 + SUPPORT.dobContractility·dose) (beta-1), resistance × (1 − SUPPORT.dobSvr·dose) (beta-2).
   * Nitroglycerin acts on the veins first, then the arteries: the venous effect develops over doses 0..`nitroVenousFull`
   * (tone × (1 − nitroVenousTone·effect)), the arterial one (resistance × (1 − SUPPORT.nitroSvr·effect)) starts at dose
   * `nitroArterialOnset` and is full at dose 1. [assumed]
   */
  nitroVenousTone: 0.4, nitroVenousFull: 0.4, nitroArterialOnset: 0.2,
  /** Device flow shown in `circ.deviceFlow` is the Impella's flow smoothed over this time constant (s): it follows the cardiac cycle. */
  deviceFlowTau: 1.5,
  /** Fallback ratio of the mean aortic pressure with the valve closed to the mean aortic pressure, for a balloon pump that runs from the first beat. Normally learned in the warm-up and on unassisted beats (D3). [assumed] */
  diastolicRatio: 0.85,
  /**
   * Fluids: fraction of the litres given that stays in the circulation (blood added, ramped with the volume time constant).
   * Crystalloid mostly leaves the vessels within the hour; this is the part that is there during the resuscitation: 20-30 % at
   * 30 minutes [lit], the figure C2 is to reproduce. (A7 used 0.5, which with the strong venous reserve over-recovered a bled
   * patient.) C2 replaces it with real compartments.
   */
  fluidRetained: 0.45,
  /** Congestion (0..1) from the pulmonary capillary wedge pressure, mmHg: 0 up to `pcwpOnset` (upper normal), 1 at `pcwpFull` (alveolar edema, ~25). [lit-ish] */
  pcwpOnset: 12, pcwpFull: 25,
  /** Baroreceptors read a beat's pressure this long after its ventricular event, s (systole is over; the peak is known). [assumed] */
  senseDelay: 0.25,
  /** Smoothing time constants (s) of the circulation read-outs the UI shows (stroke volume, output, filling pressures, EF). [assumed] */
  smoothTau: 3,
};

/**
 * Core-specific autonomic calibration (`new Autonomic(seed, { ...AUTONOMIC, ...AUTONOMIC_CORE })`; the legacy engine keeps AUTONOMIC
 * as it is, byte for byte). Replaces A7's +6.8 mmHg offset on the sensed pressures. [assumed]
 *  - Baroreceptor set point. AUTONOMIC.setPoint (88.7 mmHg of sensed pressure = diastolic + a third of the pulse, the legacy beat
 *    model's mean) was tuned to the legacy model's narrow, peaked pulse. The core engine's normal adult aortic wave (109/68, MAP 90,
 *    no noise, no reflex) has a broad systole and senses 81.9 by the same rule (68 + 41/3 = 81.7, measured 81.9), so the core's own
 *    neutral point is 81.9 (= 88.7 − 6.8). It keeps the receptors' pulse weighting (a third of the pulse), so a narrow pulse (low
 *    stroke volume) still lowers the sensed pressure. The CNS-ischemic thresholds compare against the same sensed pressure and move
 *    with it (60 → 53.2, 40 → 33.2), so the reflex curve is the legacy one shifted, not distorted.
 *  - Cardiopulmonary (volume) reflex. The legacy `volumeSympathetic` 0.7 and `volumeVascularShare` 0.3 were fitted to a model in which
 *    blood volume entered the beat as a steep preload factor. On the core the venous system holds the loss and recruits its own
 *    unstressed volume, and the low-pressure receptors drive the veins whatever the arterial pressure (a bleed whose MAP is
 *    still held keeps constricting): sympathetic tone 1.8 per unit fraction of volume lost, 0.8 of it on the vascular (venous
 *    and resistance) channel. This replaces A7's separate saturating venous patch: the veins' reserve (`VENOUS_TONE.factorRange`)
 *    does the saturating.
 */
export const AUTONOMIC_CORE = {
  setPoint: 88.7 - 6.8, cnsOnset: 60 - 6.8, cnsFull: 40 - 6.8,
  volumeSympathetic: 1.8, volumeVascularShare: 0.8,
};
