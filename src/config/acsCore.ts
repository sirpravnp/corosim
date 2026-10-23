// Constants of the ACS simulation on the core engine (src/sim/simulation.ts, engine "core"). Dose sizes that already exist in
// config/management.ts (SUPPORT) are reused where they map; everything new is here. Every value is a teaching assumption
// [assumed] unless tagged [lit]. Task A7.

export const ACS_CORE = {
  /**
   * Venous tone from the autonomic loop: tone = 1 + gain·(vascular sympathetic tone − resting tone). Small on purpose: the
   * splanchnic reservoir is very sensitive (tone 1.5 drives MAP to 127, A6 review). [assumed]
   */
  venousToneGain: 0.2,
  /**
   * The volume-deficit reflex on the veins: cardiopulmonary receptors constrict the splanchnic bed whatever the arterial pressure
   * (the autonomic loop's own volume term acts mostly on the heart): tone + max·tanh(deficit / scale), deficit the fraction of blood
   * volume lost net of fluids; saturating, so a large loss decompensates. The lumped venous system here is stiff (98 ml/mmHg,
   * stressed volume 0.8 L), so a 15 % loss would otherwise empty it (MAP 65 with the loop's own venous gain). [assumed]
   */
  volumeVenousMax: 0.35, volumeVenousScale: 0.2,
  /**
   * Blood given or lost at the start (ml) is built into the heart up to the range the structural spec accepts; anything beyond
   * (a hemorrhage over about 20 %) is taken out at no more than `maxVolumeRate` ml/s, so it also never changes faster than that. [assumed]
   */
  startVolumeMl: [-1000, 5000] as [number, number], maxVolumeRate: 120,
  /** Norepinephrine (alpha-1) also constricts the veins: tone × (1 + k·dose). Resistance uses SUPPORT.norepiSvr. [assumed] */
  norepiVenousTone: 0.3,
  /**
   * Dobutamine: Ees × (1 + SUPPORT.dobContractility·dose) (beta-1), resistance × (1 − SUPPORT.dobSvr·dose) (beta-2).
   * Nitroglycerin acts on the veins first, then the arteries: the venous effect develops over doses 0..`nitroVenousFull`
   * (tone × (1 − nitroVenousTone·effect)), the arterial one (resistance × (1 − SUPPORT.nitroSvr·effect)) starts at dose
   * `nitroArterialOnset` and is full at dose 1. [assumed]
   */
  nitroVenousTone: 0.2, nitroVenousFull: 0.4, nitroArterialOnset: 0.2,
  /** IABP placeholder (until D5): resistance × (1 − k) from afterload reduction, plus SUPPORT.iabpCoronaryAug on the coronary pressure. [assumed] */
  iabpAfterload: 0.06,
  /** Impella placeholder (until D3): flow SUPPORT.impellaFlow L/min, ramped with this time constant (s), floor margin and width above the LV's V0 (ml). [assumed] */
  impellaTau: 2, deviceFlowTau: 1.5, impellaMargin: 6, impellaWidth: 2,
  /**
   * Fluids: fraction of the litres given that stays in the circulation (blood added, ramped with the volume time constant).
   * Crystalloid mostly leaves the vessels within the hour; this is the part that is there during the resuscitation. C2 replaces
   * it with real compartments. [assumed]
   */
  fluidRetained: 0.5,
  /** Congestion (0..1) from the pulmonary capillary wedge pressure, mmHg: 0 up to `pcwpOnset` (upper normal), 1 at `pcwpFull` (alveolar edema, ~25). [lit-ish] */
  pcwpOnset: 12, pcwpFull: 25,
  /** Baroreceptors read a beat's pressure this long after its ventricular event, s (systole is over; the peak is known). [assumed] */
  senseDelay: 0.25,
  /**
   * The baroreceptor set point (AUTONOMIC.setPoint, 88.7 mmHg of diastolic + a third of the pulse) was tuned to the legacy model's
   * pulse pressure. The core engine's normal adult (MAP 90.0, 109/68 at the proximal aorta, no noise, no reflex) senses 81.9, so without a correction
   * the loop would hold the pressure about 5 mmHg high. Added to the sensed pressures (mmHg): setPoint − 81.9, rounded. [assumed]
   */
  baroOffset: 6.8,
  /** Smoothing time constants (s) of the circulation read-outs the UI shows (stroke volume, output, filling pressures, EF). [assumed] */
  smoothTau: 3,
};

export const PLACEHOLDER_WARNINGS = {
  impella: "Impella (core engine): placeholder — a constant-flow LV-to-aorta element limited at the unloaded LV volume, no pump curve, suction or console. Real device in D2/D3.",
  iabp: "IABP (core engine): placeholder — keeps the old coronary-pressure augmentation and a small afterload reduction, no balloon in the aorta. Real device in D5.",
};
