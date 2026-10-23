// Constants for the bridge HemoSource (src/sim/bridgeSource.ts). [assumed] = a teaching/engineering choice.

export const BRIDGE = {
  /** Re-solve when an input moves by more than this since the last solve. [assumed] */
  threshold: { hrBpm: 3, ischemia: 0.03, mapMmHg: 3 },
  /** Never re-solve more often than this, simulated seconds (a solve costs ~100 ms per analyze call). [assumed] */
  minSolveIntervalS: 3,
  /** Window over which the simulation's beat MAPs are averaged into the monitor MAP the bridge tracks and calibrates to, s. [assumed] */
  mapWindowS: 15,
  /** MAP calibration: stop when the structural mean aortic pressure is this close to the monitor's, mmHg; at most this many extra analyze calls. [assumed] */
  mapToleranceMmHg: 1, maxCalibrationIterations: 4,
  /** Seconds of per-node pressure and chamber volume kept for trace(), and the most beats kept for beats(). [assumed] */
  ringSeconds: 30, maxBeats: 200,
  /** Replay sample spacing, s. [assumed] */
  sampleDt: 0.002,
  /** Length of the end-diastolic segment (atrial contraction) that keeps its real duration when diastole is stretched, s, and its cap as a fraction of the solved beat. [assumed] */
  atrialTailS: 0.2, atrialTailMaxFrac: 0.3,
  /** Shortest diastole (filling + tail) for which the three-piece time warp is used; shorter beats are scaled uniformly, s. [assumed] */
  minWarpDiastoleS: 0.05,
  /** Bed oxygenation placeholder: tissue O2 = base − slope × ischemia severity (until tasks E2/E3). [assumed] */
  bedOxygen: { base: 0.75, slope: 0.45 },
};
