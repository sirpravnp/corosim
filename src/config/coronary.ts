// E2: coronary coupling on the core engine (core/coronary.ts). SI-free: pressures in mmHg, weights dimensionless.

/**
 * Per-beat driving pressure of a myocardial layer: Pzf + the time-mean over the beat of max(0, Pao(t) - w * Plv(t) - Pzf), a vascular
 * waterfall (flow only while the pressure exceeds the zero-flow pressure plus the wall pressure; Spaan 1985, Downey & Kirk 1975).
 *  - `zeroFlow`: Pzf, mmHg; the same value the network uses (CORONARY.zeroFlowPressure, 20 mmHg [assumed]).
 *  - `wEndo`, `wEpi`: the intramyocardial pressure of the layer as a fraction of the LV cavity pressure. It is about the cavity pressure
 *    at the endocardium and falls across the wall to a small fraction at the epicardium (Hoffman & Spaan 1990 Physiol Rev 70:331;
 *    Algranati, Dvir & Kassab 2010 Am J Physiol 299:H1136 for the cavity-induced component). In systole this is the squeeze on the
 *    vessels (flow impediment, largest in the subendocardium); in diastole Plv is the LVEDP-level back-pressure the subendocardium must
 *    be perfused against. w_endo 1.0 [lit]; w_epi 0.25 [assumed].
 *  - `offset`: mmHg added to the layer pressure to give the aortic-equivalent pressure the coronary network (`solveNetwork`, whose beds
 *    have a zero-flow pressure and a resting flow set at a reference aortic pressure) is solved at. It is the calibration that makes the
 *    default settled patient's subendocardium see the pressure the fixed-MAP model gave it (`endoRef` + `offset` = the default
 *    patient's MAP of about 90 mmHg), so a healthy heart's supply is unchanged and only tachycardia, LVEDP, intramyocardial pressure and
 *    balloon augmentation move it. [assumed; calibrated on the default patient]
 *  - `endoRef`, `epiRef`: the layers' driving pressures of that default patient, the denominators of the supply index (1 = normal).
 * `beatAvgS`: time constant (s) of the average over beats that `CoronaryCoupling.last` reports (beats weighted by their length).
 * `smoothS`: time constant (s) of the first-order filter on the per-beat value that feeds the network (same as the old MAP filter).
 */
export const COUPLING = { wEndo: 1.0, wEpi: 0.25, zeroFlow: 20, offset: 42, endoRef: 48, epiRef: 77, smoothS: 2, beatAvgS: 3 };
