// Constants for what serum potassium, calcium and magnesium do to the ECG, the conduction system and the rate (physics/electrolytes.ts).
// Each curve is calibrated to the reference morphologies the EKG library teaches (ekg/library.ts: "Hyperkalemia", "Severe hyperkalemia (sine wave)",
// "Hypokalemia", "Long QT") so the Simulator and the EKG page agree. Thresholds follow the usual bedside teaching; sizes are teaching assumptions. [assumed]

export const LYTE = {
  /** Potassium, mmol/l. Normal 4.2. */
  k: {
    // Hyperkalemia: tall narrow T from 5.0 (the library's preset is T x2.5, width x0.5), then flat P, long PR and wide QRS from about 6.5, bradycardia and
    // block from 7, and at the extreme (8.5) no P and a very wide QRS merging with the T (library: P 0, QRS x2.6, T x1.9).
    tFrom: 5.0, tFull: 7.0, tAmpMax: 2.5, tWidthMin: 0.5,
    pFrom: 6.0, pGone: 8.5, pWideMax: 1.4,
    prFrom: 6.0, prFull: 8.0, prAddMax: 0.16, // s added to the PR at K 8
    qrsFrom: 6.5, qrsFull: 8.5, qrsWideMax: 2.6,
    brady: { from: 6.5, full: 8.5, rateAtFull: 0.6 }, // sinus rate x this at K 8.5
    block: { second: 7.5, third: 8.5 }, // AV block (Mobitz I, then complete) from these
    // Hypokalemia: flat T, U wave and ST depression (library: T x0.35, QT x1.1, U 0.13 mV, ST -0.035 mV) from 3.6 to full at 2.5.
    hypoFrom: 3.6, hypoFull: 2.5, tAmpAtFull: 0.35, qtAtFull: 1.1, uMvAtFull: 0.13, stDepAtFull: 0.12, // stDep: fraction of the T vector taken off the ST segment
  },
  /** Total calcium, mmol/l. Normal 2.4. Low lengthens the ST segment (long QT); high shortens it. */
  ca: {
    normal: 2.4, min: 1.2, max: 3.6,
    lowFrom: 2.1, lowFull: 1.5, qtAtLowFull: 1.35,
    highFrom: 2.7, highFull: 3.4, qtAtHighFull: 0.78, tAmpAtHighFull: 1.25,
  },
  /** Magnesium, mmol/l. Normal 0.9. Severe deficiency adds a little QT and flattens the T; it matters mostly for the arrhythmia hazard (config/arrhythmia.ts). */
  mg: { lowFrom: 0.7, lowFull: 0.3, qtAtLowFull: 1.12, tAmpAtLowFull: 0.85 },
} as const;
