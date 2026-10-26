// Ischemic ventricular ectopy of the core engine (task B3a, physics/ectopy.ts). Every number says where it comes from: a study
// (first author, year, PMID) or [assumed] with the behaviour it controls. docs/ECTOPY.md has the targets and what is left out.
//
// Units. "Rate" is the expected number of PVCs per eligible ventricular beat (a sinus-conducted, AF or escape beat), before
// saturation; at 75 bpm, a rate of 0.01 is about 45 PVCs an hour, the order of the Holter counts quoted below. Time since onset
// and reperfusion run on the CLINICAL clock (Simulation.clinicalMinutes: 2 clinical minutes per simulated second at 1x);
// beat-to-beat burstiness runs on heartbeat time (simulated seconds), because it shapes beat sequences, not infarct evolution.

export const ECTOPY = {
  /**
   * Ischemic substrate: the bed burden (severity x mass, the whole heart = 1) weighted by how transmural each bed is:
   * weight = subendocardialWeight + (1 - subendocardialWeight) x transmurality. Demand (subendocardial) ischemia is far less
   * arrhythmogenic than the transmural ischemia of an occlusion: ectopy and VF of acute MI belong to ST-elevation ischemia,
   * exercise ischemia of a stable stenosis rarely makes more than isolated PVCs. [assumed weight 0.25; direction clinical consensus]
   * LV and RV beds count alike and no territory is weighted up: anterior infarcts were linked to more VF in a small series
   * (Gupta 1983, PMID 6869924) but inferior infarction predicted early VT/VF in 5745 primary-PCI patients (Mehta 2009 APEX-AMI,
   * PMID 19417195, HR 2.16), so the evidence for a site weighting points both ways and the model uses mass alone.
   */
  subendocardialWeight: 0.25,
  /** Burden below which nothing happens (1% of the myocardium): a tiny distal bed is not a substrate. [assumed] */
  floor: 0.01,
  /**
   * Smooth dose-response on burden above the floor: H(b) = x^n / (1 + x^n), x = (b - floor) / half. Half effect at a quarter of
   * the heart (a mid-LAD occlusion is 0.28 in this anatomy, a proximal LAD 0.43, a distal LAD 0.10, a first diagonal 0.08).
   * Shape [assumed]; the direction (more ectopy with a larger infarct) from Gressin 1992 (PMID 1731450: PVC and VT frequency
   * correlated with peak CK).
   */
  half: 0.25,
  hill: 2,
  /**
   * Rate of a median patient (susceptibility 1) at full burden effect in the hyperacute phase. With H = 0.74 for a proximal
   * LAD occlusion that is about 4.5% of beats at the peak; with the patient spread below the mean across patients is about 9%
   * and the upper decile 15-25%. Target: the plan's D3 (about 10-15% of beats as the usual ceiling, early peak) and Holter
   * counts of tens to hundreds of PVCs an hour in the first day (Cercek 1987, PMID 2441585: median 44/h, range 1-1336/h after
   * reperfusion). [assumed level within those bounds]
   */
  rateAtFullEffect: 0.07,
  /**
   * Time since onset (clinical minutes), the ischemic term's multiplier:
   * T(t) = (1 - e^(-t/rise)) x (hyper x e^(-t/hyperTau) + sub x e^(-t/subTau) + late).
   * Ventricular arrhythmia of acute ischemia starts within minutes (the experimental phase 1a at 2-10 min and 1b at 15-30 min),
   * peaks in the first hour or two and falls over hours: in GISSI-2 (9720 thrombolysed patients) primary VF in the first 4 h was
   * 3.1% against 0.6% from 4 to 48 h, about 50 times the hourly hazard (Volpi 1998, PMID 9708651); lidocaine prophylaxis risk
   * is set by the time since onset more than by "warning arrhythmias" (Goldman 1979, PMID 392960). In the late phase (days 4-25)
   * 76% of patients have under 3 PVCs an hour (Bordalo e Sa 1990, PMID 1706604). Time constants [assumed] to give a
   * first-hour mean about 7 times the 8-hour value and a late floor of a few percent of the peak.
   */
  riseMin: 3,
  hyper: 0.85, hyperTauMin: 120,
  sub: 0.12, subTauMin: 720,
  late: 0.03,
  /** A burden-free spell this long (clinical minutes) ends the episode: a new occlusion starts a new hyperacute phase. [assumed] */
  episodeResetMin: 60,
  /**
   * Reperfusion. A fall of the weighted burden is reperfused myocardium; each fall of at least `deadband` (so the small
   * perfusion-pressure swings of a steady lesion never count) adds (fall x W(ischemic minutes)) to two decaying stores, a burst
   * and a tail, each turned into rate through the same H (without the floor).
   *  - Burst: reperfusion arrhythmias come within seconds to minutes of flow returning; in the rat their incidence is
   *    bell-shaped in the duration of the preceding ischemia (VF 8, 83, 58, 25, 8% after 5, 10, 20, 30, 40 min: Tosaki 1987,
   *    PMID 3618797; in the mouse VT 0-73%: Sakamoto 1999, PMID 10651161). Size and decay [assumed]: a median patient
   *    gets about 6% of beats after a proximal LAD reperfusion, decaying with a 20-minute time constant.
   *  - Tail: after thrombolytic reperfusion nearly every patient had PVCs (median 44/h, range 1-1336/h, about 1% of beats) and
   *    couplets, falling from 8-12 h on (Cercek 1987, PMID 2441585); a patent artery gave 14 times the PVCs of an occluded one
   *    over the first day (Gressin 1992, PMID 1731450). Tail size and an 8-hour time constant [assumed] to give a first-day mean
   *    near 1% of beats for a median patient.
   */
  deadband: 0.02,
  burstRate: 0.15, burstTauMin: 30,
  tailRate: 0.05, tailTauMin: 480,
  /**
   * W(d) = (1 - e^(-d/weightRiseMin)) x (weightLate + (1 - weightLate) x e^(-d/weightFallMin)): reperfusion after a minute of
   * ischemia does nothing, after 15-60 min the most, and less after many hours as the salvageable myocardium has died. The
   * fall is much flatter than the rat's bell (clinical reperfusion at 2-6 h still gives the arrhythmias above). [assumed]
   */
  weightRiseMin: 12, weightFallMin: 480, weightLate: 0.4,
  /**
   * Per-patient susceptibility: a multiplier fixed for the patient, lognormal with median 1 and this sigma (natural log),
   * drawn from the scenario seed. With 1.2 a fifth of patients are below 0.36 (a proximal LAD gives them under 1.5% of beats
   * at the peak and almost nothing later), a tenth above 4.7. Target: the hundred-fold to thousand-fold range between
   * patients of Cercek 1987 (PMID 2441585: 1 to 1336 PVCs an hour, median 44) and the 24% / 76% split above and below
   * 3 PVCs an hour late after infarction (Bordalo e Sa 1990, PMID 1706604). [assumed sigma within that range]
   */
  susceptibilitySigma: 1.2,
  /**
   * Sympathetic drive: rate x exp(gain x (tone - rest)), the cardiac sympathetic tone of the autonomic model after the
   * beta-blocker. Catecholamines and sympathetic activation are pro-arrhythmic in ischemia; beta-blockers lower VF after MI.
   * [assumed gain: a tone of 0.6 against 0.3 at rest doubles the rate]
   */
  sympatheticGain: 2.3, restSympathetic: 0.3,
  /** Adrenergic drugs: rate x (1 + gain x beta-1 drive of the receptor-level drugs), the dobutamine/epinephrine multiplier the old rule used (SUPPORT.dobEctopy). [assumed, carried over] */
  drugGain: 0.6,
  /**
   * Electrolyte hooks, fixed at 1 until an item drives them (rate x potassium x magnesium). Hypokalaemia on admission
   * (K <= 3.5 mmol/l) went with VF in 17.2% against 7.4% of normokalaemic patients, and earlier (Nordrehaug 1983, PMID 6651995);
   * intravenous magnesium lowered PVC and run counts after MI (Thiele 2000, PMID 10907229). A later item can map serum levels to
   * these multipliers (e.g. about 2 at K 3.0).
   */
  potassium: 1, magnesium: 1,
  /**
   * Burstiness. The rate is modulated by exp(sigma x z - sigma^2/2) (mean 1), z an Ornstein-Uhlenbeck process with this
   * correlation time in heartbeat seconds, so PVCs cluster over a minute or two instead of falling as independent coin flips.
   * A beat after a PVC has its probability multiplied by `afterPvc`, which gives runs of bigeminy at a believable frequency.
   * [assumed]
   */
  noiseSigma: 0.5, noiseTauS: 90, afterPvc: 4,
  /**
   * Couplets: after a PVC a second follows directly with probability min(coupletMax, coupletBase + coupletPerRate x p).
   * Target: median 4 couplets an hour against 44 PVCs an hour after reperfusion (Cercek 1987, PMID 2441585), about one couplet
   * per ten PVCs. Triplets and longer runs (non-sustained VT) are left to task B3b. [assumed form]
   */
  coupletBase: 0.05, coupletPerRate: 0.3, coupletMax: 0.2,
  /** Saturation: p = cap x (1 - exp(-rate / cap)), so no patient has PVCs after more than 40% of beats (about 29% of all beats). [assumed] */
  cap: 0.4,
  /**
   * Coupling interval: coupling x RR x (1 + spread x gaussian), clipped to [couplingMin, couplingMax] x RR. The 0.6 centre is
   * the old rule (RHYTHM.pvcCoupling); the spread gives late-coupled PVCs and occasional early ones (about 300-600 ms at
   * 75 bpm). The coupling relative to the end of the T wave (`couplingVsT`, < 1 means R-on-T) is what task B3b's VT/VF
   * initiation reads; this item never lets a PVC start VT. [assumed]
   */
  coupling: 0.6, couplingSpread: 0.08, couplingMin: 0.42, couplingMax: 0.78,
  /** A couplet's second PVC follows the first after this fraction of the sinus RR (a couplet runs at about 120-150/min). [assumed] */
  coupletInterval: 0.55,
  /** Refractory window after the last PVC (s): a sinus P whose QRS would fall in it is blocked (the compensatory pause). [assumed] */
  refractoryS: 0.3,
  /** Clinical-phase boundaries (clinical minutes since onset) reported to B3b: hyperacute to here, then subacute, then late. [assumed] */
  hyperacuteMin: 120, subacuteMin: 720,
  /**
   * The ectopic burden explain() reports is counted over this many heartbeat seconds; at or above `frequent` of the beats it is
   * called frequent (several on every minute of monitor strip), below it occasional. [assumed: a bedside reading, not a Holter
   * grade]
   */
  reportWindowS: 60, frequent: 0.05,
};
