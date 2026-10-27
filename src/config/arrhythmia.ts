// Ischemic ventricular tachyarrhythmias of the core engine (task B3b, physics/arrhythmia.ts): VT and VF initiation, their course,
// accelerated idioventricular rhythm on reperfusion and late scar VT. Every number says where it comes from: a study (first author,
// year, PMID) or [assumed] with the behaviour it controls. docs/ARRHYTHMIA.md has the targets, the measured rates and what is left out.
//
// Clocks. Hazards (how often a run starts) are per CLINICAL minute (Simulation.clinicalMinutes: 2 clinical minutes per simulated
// second at 1x), because they follow the evolution of the infarct; the course of a running arrhythmia (how long a polymorphic VT lasts
// before it stops or degenerates, how fast a VT that drops the pressure turns into VF, how long an AIVR episode lasts) runs on
// HEARTBEAT time (simulated seconds), because it is a matter of beats and pressure, not of infarct evolution.

export const ARRHYTHMIA = {
  /**
   * Substrate: the transmurality-weighted ischemic burden of the ectopy model (ECTOPY.subendocardialWeight: demand ischemia counts at a
   * quarter) through a steeper Hill curve than the PVCs' (n = 3, half effect at a quarter of the heart, nothing below 1%): a proximal LAD
   * occlusion (burden 0.43) has 0.83, a mid LAD (0.28) 0.56, a circumflex (0.21) 0.33, a distal LAD (0.10) 0.045, a first diagonal
   * 0.02. VF and VT go with large infarcts: anterior infarction OR 2.1 for VF before primary PCI (Jabbari 2015, PMID 25559012),
   * extensive anterior infarction and the LAD predicted reperfusion arrhythmias (Wu 2025, PMID 40618073), anterior infarction and a low
   * ejection fraction predicted sustained VT/VF in GUSTO-I (Newby 1998, PMID 9843464). The steeper curve keeps small and demand
   * ischemia nearly free of VT/VF while they still give occasional PVCs. [shape assumed]
   */
  floor: 0.01, half: 0.25, hill: 3,
  /**
   * Hazard of an initiating event from ongoing ischemia, per clinical minute, for a patient of susceptibility 1 at full substrate and
   * the peak of the time course. An initiating event is a premature beat that finds the ventricle vulnerable and starts a run: a
   * non-sustained VT, a sustained monomorphic VT, a polymorphic VT or VF (`mix.ischemia`). Calibrated on the rig (tests/arrhythmiaRates.test.ts,
   * 400 seeds) so that a proximal LAD occlusion gives VF within the first clinical hour in about one patient in ten: VF before primary
   * PCI in 11.6% of first STEMIs presenting within 12 h (Jabbari 2015, PMID 25559012), 12% (Glinge 2020, PMID 32101559), 9.5% (Ravn
   * Jacobsen 2020, PMID 32067598), anterior infarcts about twice the others; primary VF 4.4% of patients admitted within 24 h (El-Sherif
   * 1976, PMID 57784), a population that had already outlived the first hours.
   */
  ischemicPerMin: 0.043,
  /**
   * Time course of the ischemic hazard, minutes since onset of the episode (Ectopy.age):
   * T(t) = (1 - e^(-t/rise)) x (e^(-t/tau) + sub x e^(-t/subTau) + late). Steeper than the PVCs': in GISSI-2 primary VF was 3.1% in
   * the first 4 h against 0.6% from 4 to 48 h, about 50 times the hourly hazard (Volpi 1998, PMID 9708651); shorter time to treatment
   * predicted in-hospital VF in GUSTO-III (Al-Khatib 2003, PMID 12660676); experimentally the arrhythmias of phase 1a and 1b come in the
   * first half hour (Naito 1982, PMID 6174040). With these constants the first 4 hours hold about 60 times the hourly hazard of hours
   * 4-48, and three quarters of the first 4 hours' events fall in the first hour. The burden itself builds up over the first ~40
   * clinical minutes (the ischemia kinetics run in heartbeat time), so the hazard the patient feels peaks around 20-40 minutes and the
   * first hour holds about twice the VF of the second (rig: tests/arrhythmiaRates.test.ts). [time constants assumed]
   */
  riseMin: 2, tauMin: 30, sub: 0.04, subTauMin: 240, late: 0.001,
  /**
   * Hazard of an initiating event from reperfusion, per clinical minute at full effect of the ectopy model's reperfusion burst store
   * (Ectopy.burst: the fall of the burden weighted by how long the ischemia lasted, decaying over 30 clinical minutes), same Hill
   * curve without the floor. Target, after reperfusing a proximal LAD at 2 hours: non-sustained VT in about a third of patients, VF in
   * one or two percent. Non-sustained VT in 26% of patients during primary PCI (Terkelsen 2009, PMID 19962468); VF during primary PCI in
   * 88 of 5373 (1.6%: Jabbari 2015, PMID 26150175) and 127 of 7929 (1.6%: Ravn Jacobsen 2020, PMID 32067598).
   */
  reperfusionPerMin: 0.03,
  /**
   * Accelerated idioventricular rhythm (AIVR), a reperfusion rhythm of enhanced automaticity, not of re-entry: it is not triggered by
   * a premature beat but takes over when its rate exceeds the sinus rate. Hazard per clinical minute at full effect of the burst store.
   * Target: an AIVR episode in about half the patients after reperfusing a large anterior infarct, fewer after a small one. AIVR was the
   * commonest arrhythmia during primary PCI, 42%, and went with a larger area at risk (35 against 23% of the LV) and a larger final
   * infarct (Terkelsen 2009, PMID 19962468); 18.9% on telemetry after primary PCI, more with extensive anterior infarction (Wu 2025,
   * PMID 40618073).
   */
  aivrPerMin: 0.045,
  /**
   * Late (scar) VT: a re-entry circuit around healed infarct scar, monomorphic, slower, months to years after the infarct. Hazard per
   * clinical minute at full effect of the scar burden (sum of necrosis x mass, same Hill curve with a 2% floor), once the scar has
   * matured (1 - e^(-scar age / matureMin), the healing phase of days). Order of magnitude: sustained VT or VF after a large infarct in
   * a few percent of patients a year; late (> 48 h) arrhythmias in GUSTO-III carried the higher mortality (Al-Khatib 2003, PMID
   * 12660676); incomplete revascularization raised late VT and cardiac arrest (HR 1.77; Thomsen 2023, PMID 36520640). [rate assumed:
   * about 3% a year at full effect; the Simulator's clinical clock rarely reaches it, `induce("scar")` shows it]
   */
  scarPerMin: 6e-8, scarFloor: 0.02, scarMatureMin: 4320,
  /**
   * Per-patient susceptibility to VT/VF: lognormal, median 1, this sigma, drawn from the seed and correlated with the ectopy model's
   * susceptibility (correlation `ectopyCorrelation` on the log scale): patients with much ectopy are somewhat more prone to VF, but
   * "warning arrhythmias" preceded primary VF in 58% of cases and were present in 55% of patients without it (El-Sherif 1976, PMID 57784),
   * so the link is loose. Individual factors (age, alcohol, family history of sudden death, preinfarction angina) shift the odds of VF
   * about 1.5-3 times (Jabbari 2015, PMID 25559012). [sigma and correlation assumed]
   */
  susceptibilitySigma: 0.8, ectopyCorrelation: 0.5,
  /** Sympathetic tone (after the beta-blocker) and adrenergic drugs: the same multipliers as the PVCs' (ECTOPY.sympatheticGain, drugGain). [assumed, carried over] */
  sympatheticGain: 2.3, restSympathetic: 0.3, drugGain: 0.6,
  /**
   * Serum potassium (mmol/l): hazard x exp(lowGain x max(0, lowFrom - K)) x exp(highGain x max(0, K - highFrom)). Hypokalaemia
   * (< 3.5) OR 1.90 and hyperkalaemia (> 5.0) OR 3.36 for VF before primary PCI (Ravn Jacobsen 2020, PMID 32067598); VF 17.2% with
   * K <= 3.5 against 7.4% (Nordrehaug 1983, PMID 6651995). Gains set so K 3.2 gives about 1.9 and 5.5 about 3.4. The same multiplier goes to
   * the ectopy model's potassium hook (B3a). [curve assumed]
   */
  potassium: { normal: 4.2, lowFrom: 4.0, lowGain: 0.8, highFrom: 4.8, highGain: 1.73, min: 2.0, max: 7.5 },
  /**
   * Serum magnesium (mmol/l): hazard x exp(lowGain x max(0, lowFrom - Mg)); IV magnesium lowered PVC and run counts after MI (Thiele 2000,
   * PMID 10907229). [curve assumed: Mg 0.5 gives about 1.6] Also passed to the ectopy model's magnesium hook.
   */
  magnesium: { normal: 0.9, lowFrom: 0.8, lowGain: 1.5, min: 0.2, max: 3 },
  /**
   * What an initiating event becomes (weights, normalized). Ischemia: mostly non-sustained runs, VF next; sustained monomorphic VT is
   * less common than VF early in infarction (GUSTO-I: sustained VT/VF 10.2% over the stay; Newby 1998, PMID 9843464; non-sustained VT
   * 26% against sustained VT and VF a few percent during primary PCI: Terkelsen 2009, PMID 19962468). Reperfusion: almost all runs are
   * short. Scar: re-entry, so monomorphic. [weights assumed within these]
   */
  mix: {
    ischemia: { nsvt: 0.72, vf: 0.16, poly: 0.06, mono: 0.06 },
    reperfusion: { nsvt: 0.9, vf: 0.025, poly: 0.03, mono: 0.045 },
    scar: { nsvt: 0.3, vf: 0, poly: 0, mono: 0.7 },
  },
  /**
   * The trigger beat's coupling against the live T wave (Ectopy.couplingVsT: coupling over the end of the preceding T wave, which
   * shortens with the rate; below 1 the PVC lands on the T wave: R on T). In acute infarction 10 of 17 primary VF episodes started with
   * an R-on-T PVC (59%) and 7 with a late-coupled one (El-Sherif 1976, PMID 57784); R-on-T beats were more frequent and more successful
   * in initiating VT/VF in the delayed (13-30 min) phase of ischemia (Naito 1982, PMID 6174040). So the trigger is R on T with
   * probability `share` (coupling drawn uniformly between `vsTMin` and `vsTMax` of the T wave's end, the downslope of T), else late-coupled
   * like any ischemic PVC; an R-on-T trigger weights VF and polymorphic VT by `fastWeight`, a late-coupled one by `lateWeight` (more
   * monomorphic and short runs). [weights assumed]
   */
  ronT: { share: 0.6, vsTMin: 0.8, vsTMax: 0.98, fastWeight: 1.5, lateWeight: 0.6 },
  /**
   * An ordinary ischemic PVC of the ectopy model that happens to land on the T wave (coupling below the T wave's end: at fast sinus rates
   * the shortest-coupled ones do) starts a run with probability `natural` x the substrate now (burden effect x time course x the
   * patient's gain), the run drawn from the same mix. Most R-on-T PVCs start nothing: they were seen in 49% of patients without primary
   * VF (El-Sherif 1976, PMID 57784). [assumed]
   */
  natural: 0.03,
  /**
   * Non-sustained VT: 3 or more beats, under 30 s. Length 3 + a geometric number with mean `extraMean`, capped at `maxBeats`; rate
   * uniform in `rate` (beats/min) per run. Most runs in acute infarction are short salvos of 3-6 beats. [assumed]
   */
  nsvt: { minBeats: 3, extraMean: 3, maxBeats: 40, rate: [130, 210] as const },
  /**
   * Sustained monomorphic VT of acute ischemia (`rate`) and of scar (`scarRate`, slower re-entry circuits), polymorphic VT (`polyRate`),
   * beats/min, uniform per episode. The library's morphology (ekg/library.ts vt-mono, vt-poly) at that rate, P waves dissociated at the
   * sinus rate. [assumed within the library's ranges]
   */
  monoRate: [150, 210] as const, scarRate: [130, 190] as const, polyRate: [200, 260] as const,
  /**
   * Course of polymorphic VT, per heartbeat second: it stops by itself (`polyEndPerS`) or degenerates to VF (`polyToVfPerS`); about
   * 4 in 7 degenerate, after 3-4 s on average. Polymorphic VT with a normal QT in acute ischemia is usually unstable and often
   * degenerates (ekg/library.ts pearls). [assumed]
   */
  polyEndPerS: 1 / 8, polyToVfPerS: 1 / 6,
  /**
   * Course of sustained monomorphic VT, per heartbeat second: a small chance of stopping by itself (`monoEndPerS`, mean 4 minutes) and
   * degeneration to VF through hemodynamic collapse: hazard `collapseToVfPerS` x c^2, c = clip((okMap - MAP) / (okMap - floorMap), 0, 1),
   * MAP the smoothed mean arterial pressure. A VT the circulation tolerates (MAP 70 or more) stays a VT; one that drops the pressure
   * to 35 turns into VF after about 30 s on average, as global ischemia of a hypotensive heart makes the circuit break up. VT degenerating
   * to VF started 2 of 20 primary VF episodes (El-Sherif 1976, PMID 57784). [assumed]
   */
  monoEndPerS: 1 / 240, collapseToVfPerS: 1 / 30, okMap: 70, floorMap: 35,
  /**
   * A second route of degeneration of a monomorphic VT: ongoing acute ischemia. hazard `ischemicToVfPerS` x substrateEffect(burden),
   * only while an ischemic episode is active, so a fast VT on top of an occluded proximal LAD (substrate 0.83) breaks up into VF after
   * about 2.5 minutes on average even when the baroreflex holds the mean pressure (the core engine keeps MAP near 70 in a VT of 200/min:
   * a short-filled small stroke volume at twice the rate, with vasoconstriction), while a VT in a heart without acute ischemia (scar VT,
   * an induced VT in a healthy heart) is left to the pressure route alone. Acute ischemia makes conduction and refractoriness
   * heterogeneous, the substrate for wave break (Naito 1982, PMID 6174040: initiation of VT and VF in acute ischemia); sustained VT in acute
   * infarction is often hemodynamically unstable and degenerates (GUSTO-I, Newby 1998, PMID 9843464: sustained VT and VF together in
   * 10.2%, "both VT and VF" a group of its own). [rate assumed]
   */
  ischemicToVfPerS: 1 / 120,
  /**
   * AIVR episode: rate = clip(sinus rate x uniform(rateOver), minRate, maxRate) (it shows only when faster than the sinus node; none when
   * the sinus rate is above `maxRate` / rateOver[0]); duration lognormal, median `durMedianS` heartbeat seconds, sigma `durSigma`, at most
   * `maxS`; it ends early if the sinus rate overtakes it by `overdrive`. AIVR runs at 50-110 beats/min with a gradual onset as the sinus
   * slows and is benign and self-limited (ekg/library.ts aivr). [durations assumed]
   */
  aivr: { rateOver: [1.05, 1.2] as const, minRate: 55, maxRate: 110, durMedianS: 20, durSigma: 0.7, maxS: 120, overdrive: 1.05 },
  /** VF starts this long after the trigger beat's R (s): the trigger's QRS is drawn, then fibrillation. [assumed] */
  vfAfterS: 0.2,
  /** A sustained rhythm's first beat comes at least this long after the last ventricular beat (s). [assumed: about a VT cycle] */
  minGapS: 0.3,
  /** An initiating event waits at most this long (heartbeat s) for a beat to ride on (none comes in a VT or VF of the patient's own). [assumed] */
  pendingMaxS: 3,
  /** Episodes kept for the state and the tests. */
  logSize: 200,
};
