/**
 * Thresholds of the Oxygen panel's teaching cues (src/sim/oxygenReadout.ts). Tags: [lit] from a source, [assumed] chosen
 * for teaching. Saturations are fractions 0..1, extraction is VO2/DO2 (unitless), differences in percentage points.
 */
export const OXYGEN_PANEL = {
  /** SvO2 below this is a low mixed venous saturation, delivery not meeting demand [lit: normal 65-75 %, below 60 % is a common alarm and shock-work-up cut-off]. */
  svo2Low: 0.60,
  /** O2 extraction ratio above this means the tissues are taking more than usual [lit: normal about 0.25, above 0.30-0.35 flags inadequate delivery]. */
  extractionHigh: 0.35,
  /** SpO2 below this is hypoxemia [lit: the usual 90 % cut-off]. */
  spo2Low: 0.90,
  /** Pre-/post-ductal difference, percentage points, above which it is called out [lit: more than 3 points is the newborn screening criterion for a differential]. */
  ductalDiffPoints: 3,
  /** Pulse-oximeter pleth: seconds of aortic pressure drawn, and the most points asked of the source. [assumed] */
  plethSeconds: 4, plethPoints: 240,
} as const;
