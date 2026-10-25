// Constants for the bridge HemoSource (src/sim/bridgeSource.ts). [assumed] = a teaching/engineering choice.

export const BRIDGE = {
  /** Re-solve when an input moves by more than this since the last solve. [assumed] */
  threshold: { hrBpm: 3, ischemia: 0.03, mapMmHg: 3, svrFrac: 0.05 },
  /** Never re-solve more often than this, simulated seconds (a solve costs ~100 ms per analyze call). [assumed] */
  minSolveIntervalS: 3,
  /** Volume (ml, added to the circulation) the MAP calibration may use: stands in for venoconstriction and fluids. [assumed] */
  volumeRangeMl: [-800, 1500] as const,
  /** Window over which the simulation's beat MAPs are averaged into the monitor MAP the bridge tracks and calibrates to, s. [assumed] */
  mapWindowS: 15,
  /** MAP calibration: stop when the structural mean aortic pressure is this close to the monitor's, mmHg; at most this many extra analyze calls. [assumed] */
  mapToleranceMmHg: 1, maxCalibrationIterations: 5,
  /** Cardiac-output calibration (phase 2 of the solve): extra analyze calls at most, and the flow tolerance as a fraction of the target. [assumed] */
  volumeToleranceMmHg: 3, maxCoIterations: 6, coToleranceFrac: 0.03,
  /** Range of the multipliers the calibration may put on systemic resistance and on LV end-systolic elastance. [assumed] */
  svrMulRange: [0.3, 3] as const, eesMulRange: [0.3, 1.5] as const,
  /** First-step guess of d(flow)/d(ees multiplier), as a fraction of the target flow (measured about 0.5 to 0.8). [assumed] */
  coPerEes: 0.7,
  /** Re-solve when the monitor's native cardiac output moves by this fraction since the last solve. [assumed] */
  coThresholdFrac: 0.05,
  /** First-step guess of d(MAP)/d(volume), mmHg per ml, before a secant slope is known. [assumed] */
  mapPerMl: 0.04,
  /** Seconds of per-node pressure and chamber volume kept for trace(), and the most beats kept for beats(). [assumed] */
  ringSeconds: 30, maxBeats: 200,
  /** Replay sample spacing, s. [assumed] */
  sampleDt: 0.002,
  /** Length of the end-diastolic segment (atrial contraction) that keeps its real duration when diastole is stretched, s, and its cap as a fraction of the solved beat. [assumed] */
  atrialTailS: 0.2, atrialTailMaxFrac: 0.3,
  /** Shortest diastole (filling + tail) for which the three-piece time warp is used; shorter beats are scaled uniformly, s. [assumed] */
  minWarpDiastoleS: 0.05,
  /** Standalone (non-adult) patients: the P wave leads the beat by this PR interval, s. [assumed] */
  standalonePrS: 0.1,
  /** Bed oxygenation placeholder: tissue O2 = base − slope × ischemia severity (until tasks E2/E3). [assumed] */
  bedOxygen: { base: 0.75, slope: 0.45 },
};
