// Constants of the echo model (src/sim/cath.ts echoModel). Each is tagged [literature] or [assumed], as elsewhere in src/config.

/** Which coronary group supplies each of the 17 AHA segments, as weights over [LAD, LCx, RCA] (rows sum to 1), in volume order:
 *  six basal, six mid (anterolateral, anterior, anteroseptal, inferoseptal, inferior, inferolateral), then apical anterior, septal, inferior, lateral, apex.
 *  [literature: the usual AHA/Cerqueira 2002 territories; the overlaps (anterolateral shared by the diagonals and the obtuse marginals, inferoseptal
 *  by the septal perforators of the LAD and the PDA, the inferior and lateral apex by whichever artery wraps) are assumed teaching weights] */
export type Territory = readonly [lad: number, lcx: number, rca: number];
const BASAL_MID: Territory[] = [[0.5, 0.5, 0], [1, 0, 0], [1, 0, 0], [0.15, 0, 0.85], [0, 0, 1], [0, 1, 0]];
export const SEGMENT_TERRITORY: readonly Territory[] = [
  ...BASAL_MID, ...BASAL_MID,
  [1, 0, 0], [1, 0, 0], [0.5, 0, 0.5], [0.5, 0.5, 0], [1, 0, 0],
];

export const WALL_MOTION = {
  /** Dysfunction (0 moves normally .. 1 no thickening) at which a segment is called hypokinetic, and akinetic. Wall thickening of
   *  about 30–50% of normal is "hypokinetic" and under 10% "akinetic" in clinical scoring; mapped here onto the model's linear scale. [assumed thresholds] */
  hypokinetic: 0.2,
  akinetic: 0.85,
  /** Irreversible injury (scar, 0..1) above which the thinned wall bulges outward in systole (dyskinesis, aneurysm). [assumed] */
  dyskinetic: 0.86,
} as const;

export const SCORE_NAME = ["", "normal", "hypokinetic", "akinetic", "dyskinetic"] as const;
