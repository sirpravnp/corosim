// Channel-level antiarrhythmic constants for the EKG module (src/ekg/drugs.ts).
// A drug is a mix of INa, IKr, ICaL and beta drive, not a special-case script per brand. Vaughan–Williams class is a label on
// that mix. Dose is 0..1 of a teaching "full" dose. Magnitudes are teaching assumptions chosen so the size of each ECG effect is
// visible on a 12-lead, not a measured dose-response. [assumed] unless tagged [lit].
//
// Sources (direction and order of magnitude only):
//  - Vaughan Williams EM. Classification of antiarrhythmic drugs. In: Sandoe E, Flensted-Jensen E, Olesen KH, eds. Symposium on
//    Cardiac Arrhythmias. Elsinore, 1970. Class I Na, II beta, III K, IV Ca. [lit]
//  - Ranger S, Talajic M, Lemery R, Roy D, Nattel S. Amplification of flecainide-induced ventricular conduction slowing by
//    exercise. Circulation 1989;79:1000 (use-dependent INa block: QRS widens as rate rises). [lit]
//  - Page RL et al. 2015 ACC/AHA/HRS SVT guideline; ACLS: adenosine terminates AVNRT, unmasks flutter, does not stop VT. [lit]
//  - Crijns HJ, van Gelder IC, Lie KI. Flecainide in atrial flutter: slowing of the atrial rate can produce 1:1 AV conduction
//    with a wide QRS (class Ic + flutter). [lit]
//  - January CT et al. 2014 AHA/ACC/HRS AF guideline: procainamide for preexcited AF; avoid AV-nodal blockers (adenosine,
//    diltiazem, beta blocker) which can force conduction down the accessory pathway toward VF. [lit]
//  - Soyka LF, Wirtz C, Spangenberg RB. Am J Cardiol 1990;65:74A (sotalol: IKr block, pause-dependent torsades). [lit]
//  - Kudenchuk PJ et al. Amiodarone, Lidocaine, or Placebo in Out-of-Hospital Cardiac Arrest (ALPS). N Engl J Med 2016;374:1711.
//    Amiodarone and lidocaine as shock-refractory VT/VF drugs; ECG effect sizes here are assumed. [lit]

export const ANTIARRHYTHMICS = [
  "adenosine", "flecainide", "procainamide", "lidocaine", "amiodarone", "sotalol", "diltiazem", "metoprolol",
] as const;
export type Antiarrhythmic = typeof ANTIARRHYTHMICS[number];

export const DRUG_LABEL: Record<Antiarrhythmic, string> = {
  adenosine: "Adenosine",
  flecainide: "Flecainide",
  procainamide: "Procainamide",
  lidocaine: "Lidocaine",
  amiodarone: "Amiodarone",
  sotalol: "Sotalol",
  diltiazem: "Diltiazem",
  metoprolol: "Metoprolol",
};

/**
 * Channel drive at a full teaching dose (0 = none, ~1 = a full clinical effect on that channel). `useDependence` scales INa
 * QRS widening with rate: positive = class Ic (more block at faster rates), negative = class Ib (little QRS change at rest;
 * the drug still acts on a fast ventricular rate). [assumed]
 */
export interface ChannelDrive { ina: number; ikr: number; ical: number; beta: number; useDependence: number }

export const PROFILES: Record<Antiarrhythmic, ChannelDrive> = {
  flecainide: { ina: 0.9, ikr: 0, ical: 0, beta: 0, useDependence: 1.2 }, // class Ic: strong use-dependent INa
  procainamide: { ina: 0.5, ikr: 0.3, ical: 0, beta: 0, useDependence: 0.4 }, // class Ia: INa + some IKr
  lidocaine: { ina: 0.35, ikr: 0, ical: 0, beta: 0, useDependence: -0.3 }, // class Ib: fast kinetics, little QRS at NSR
  amiodarone: { ina: 0.3, ikr: 0.45, ical: 0.3, beta: 0.4, useDependence: 0 }, // acute IV: mixed, modest QT
  sotalol: { ina: 0, ikr: 0.85, ical: 0, beta: 0.6, useDependence: 0 }, // class III IKr + beta
  diltiazem: { ina: 0, ikr: 0, ical: 1, beta: 0, useDependence: 0 }, // class IV
  metoprolol: { ina: 0, ikr: 0, ical: 0, beta: 1, useDependence: 0 }, // class II
  adenosine: { ina: 0, ikr: 0, ical: 1, beta: 0, useDependence: 0 }, // bolus maneuver, not a standing morph scale
};

/**
 * Teaching gains applied to QRS, QT, PR and rate. All [assumed]. QRS multiplier =
 * `1 + qrs · ina · dose · (1 + useDependence · (u − 0.3))` with `u = clamp(0..1, (rateBpm − 60) / 90)`.
 */
export const MORPH = {
  qrs: 0.4, // INa → QRS duration increment
  qt: 0.38, // IKr → morph.qt scale
  tNarrow: 0.18, // IKr → T width (tNarrow up = broader T)
  pr: 0.04, // seconds of PR added per unit ICaL (beta counts 0.6)
  sinus: 0.22, // fractional sinus slowing from ICaL + 0.7·beta
  afIcal: 0.42, // AF ventricular slowing from ICaL (diltiazem stronger than metoprolol)
  afBeta: 0.22,
  vtSlow: 0.12, // lidocaine / amiodarone / procainamide on VT rate
  vmW: 0.08, // slight widening of a ventricular-origin complex (vm.w)
  preAfRise: 0.22, // AV-nodal blocker in preexcited AF: ventricular rate up
  preAfWide: 0.18, // and qrsWide up
  preProcSlow: 0.28, // procainamide in preexcited AF: ventricular rate down
  icAtrial: 60, // flecainide: atrial flutter rate drop (bpm) at dose 1, 300 → ~240
} as const;
