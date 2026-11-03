// Cath lab constants. [lit] = literature-backed, [assumed] = teaching choice that needs a source or a clinician's eye.

/** Angiography: contrast arrival, frame counting and TIMI flow. */
export const ANGIO = {
  samples: 240, // points along each vessel for the contrast front [assumed; the tree is sampled at the same count]
  fps: 30, // frames per second of the cine run, the rate TIMI frame counts are quoted at [lit]
  minVelocity: 0.01, // m/s, floor on the front's speed so a near-closed vessel fills slowly rather than never [assumed]
  slowFrames: 40, // end-of-vessel frame count above which flow is TIMI 2, "slow" (Gibson's corrected TIMI frame count normal is about 21 frames for the LAD, uncorrected about 36) [lit, simplified]
  trickleFrames: 120, // above this (4 s) the dye barely reaches the end: TIMI 1 [assumed]
  injectSeconds: 3.2, // length of a hand injection [assumed]
  runSeconds: 7.5, // length of the cine loop before it repeats [assumed]
};

/** The 17-segment left-ventricular model (Cerqueira et al., AHA 2002), in the order the model lists them. */
export const AHA_SEGMENTS = [
  "basal anterolateral", "basal anterior", "basal anteroseptal", "basal inferoseptal", "basal inferior", "basal inferolateral",
  "mid anterolateral", "mid anterior", "mid anteroseptal", "mid inferoseptal", "mid inferior", "mid inferolateral",
  "apical anterior", "apical septal", "apical inferior", "apical lateral", "apex",
] as const;
export type AhaSegment = (typeof AHA_SEGMENTS)[number];

/** The coronary supply of the left ventricle. `PD` is the posterior descending and posterolateral branches, whichever artery gives them. */
export type Territory = "LAD" | "LCX" | "PD";

/**
 * Share of each segment's blood supply by territory (rows sum to 1). The usual AHA territory figure, with the common overlaps:
 * the anterolateral wall from both the LAD (diagonals) and the circumflex, the inferoseptum mostly from the posterior descending.
 * [assumed; individual anatomy varies, and a dominant circumflex or a short LAD move the borders]
 */
export const SEGMENT_SUPPLY: Record<AhaSegment, Partial<Record<Territory, number>>> = {
  "basal anterolateral": { LAD: 0.5, LCX: 0.5 }, "basal anterior": { LAD: 1 }, "basal anteroseptal": { LAD: 1 },
  "basal inferoseptal": { PD: 0.85, LAD: 0.15 }, "basal inferior": { PD: 1 }, "basal inferolateral": { LCX: 1 },
  "mid anterolateral": { LAD: 0.5, LCX: 0.5 }, "mid anterior": { LAD: 1 }, "mid anteroseptal": { LAD: 1 },
  "mid inferoseptal": { PD: 0.85, LAD: 0.15 }, "mid inferior": { PD: 1 }, "mid inferolateral": { LCX: 1 },
  "apical anterior": { LAD: 1 }, "apical septal": { LAD: 1 }, "apical inferior": { LAD: 0.5, PD: 0.5 }, "apical lateral": { LAD: 0.5, LCX: 0.5 },
  apex: { LAD: 1 },
};

/** Wall motion from how much of a segment's muscle is ischemic or scarred (0..1), on the usual 1..4 scoring. [assumed thresholds] */
export const WALL_MOTION = {
  hypokineticAt: 0.2, // injury (the larger of ischemia and scar) from which the wall moves less
  akineticAt: 0.6, // from which it does not thicken
  dyskineticScar: 0.95, // scar this complete ...
  dyskineticAfterMin: 1440, // ... after this many clinical minutes (a day) bulges outward in systole: an aneurysm forms over days, not in the first hours
};

/** Where the lab labels each vessel: text and the fraction along the vessel it sits at. */
export const VESSEL_LABELS: Record<string, [string, number][]> = {
  LM: [["Left main", 0.5]],
  LAD: [["prox LAD", 0.18], ["mid LAD", 0.5], ["distal LAD", 0.86]], D1: [["D1", 0.55]], D2: [["D2", 0.55]], RAMUS: [["ramus", 0.55]],
  LCX: [["prox LCx", 0.25], ["distal LCx", 0.8]], OM1: [["OM1", 0.6]], OM2: [["OM2", 0.6]],
  RCA: [["prox RCA", 0.15], ["mid RCA", 0.5], ["distal RCA", 0.85]], AM: [["acute marginal", 0.6]], CONUS: [["conus", 0.6]],
  SAN: [["SA node a.", 0.6]], AVN: [["AV node a.", 0.6]], PDA_R: [["PDA", 0.6]], PLV_R: [["PLV", 0.6]], PDA_L: [["PDA", 0.6]], PLV_L: [["PLV", 0.6]],
};

/** Pressure-wire readout. */
export const WIRE = {
  ffrCutoff: 0.8, // FFR at or below which a lesion is treated as flow-limiting [lit, ACC/AHA revascularization guidelines]
  grayZone: [0.75, 0.8] as const, // where the call is a judgment [lit]
};

/**
 * Left-heart cath (src/sim/leftHeartCath.ts). The Gorlin and Hakki formulas divide by sqrt(gradient), so a gradient of
 * a few mmHg gives a huge, meaningless area (Hakki 6.6 cm² at 1 mmHg) and nobody uses them clinically without a real
 * gradient; below these gradients the areas are NaN (shown as a dash) and the valve is labelled "no stenosis". [assumed]
 */
export const LHC = {
  minAorticGradientMmHg: 10, // aortic: peak-to-peak for Hakki, mean for Gorlin [assumed]
  minMitralGradientMmHg: 2, // mitral: mean diastolic gradient, Gorlin and Hakki [assumed]
};
