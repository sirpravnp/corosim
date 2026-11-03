// Receptor-level drug constants for the core engine (task E4, src/physics/core/drugs.ts).
// A dose is 0..1 of a clinical "full" dose (below). A drug drives receptors (alpha-1, beta-1, beta-2, V1, PDE3, NO/cGMP); a
// receptor drives a target: arteriolar resistance, venous tone (unstressed volume), Ees, relaxation (tau), sinus rate, urine.
// The directions and the rough sizes are from the sources named below; the magnitudes are teaching assumptions chosen so the size of
// each effect is plausible for a healthy adult, not a measured dose-response. [assumed] unless tagged [lit].
//
// Sources (direction and order of magnitude only):
//  - Katzung, Basic & Clinical Pharmacology, ch. 6-9, 11-13 (receptor profiles of the catecholamines, vasopressin, nitrates, PDE3 inhibitors).
//  - Mason DT, Braunwald E. Circulation 1965;32:755 (nitroglycerin pools blood in the veins first; arterial effect needs more drug). [lit]
//  - Persichini R et al. Crit Care Med 2012;40:3146 (norepinephrine raises mean systemic filling pressure: venoconstriction). [lit]
//  - Colucci WS et al. N Engl J Med 1986;314:290, 349 (inotropic agents: dobutamine, milrinone: Ees up, SVR and wedge pressure down). [lit]
//  - Landry DW, Oliver JA. N Engl J Med 2001;345:588 (vasopressin: V1 vasoconstriction without inotropy). [lit]
//  - Dikshit K et al. N Engl J Med 1973;288:1087 (furosemide venodilates within minutes, before the diuresis). [lit]

export const DRUG_NAMES = [
  "norepinephrine", "epinephrine", "dobutamine", "milrinone", "vasopressin", "phenylephrine",
  "nitroglycerin", "nitroprusside", "betaBlocker", "furosemide", "diltiazem",
] as const;
export type DrugName = (typeof DRUG_NAMES)[number];

/**
 * Effect-site kinetics: e-folding times in CLINICAL minutes (the simulation's `minutesPerSecond` clock) for the level to rise to a
 * higher dose (`on`) and fall to a lower one (`off`). First order: level += (dose − level)·(1 − exp(−minutes/τ)). The values are
 * elimination half-lives / ln 2 of the infusions (catecholamines, nitrates: minutes) or the duration of the clinical effect
 * (milrinone and the beta-blocker, furosemide: hours). [assumed, from standard half-lives]
 */
export const KINETICS: Record<DrugName, { on: number; off: number }> = {
  norepinephrine: { on: 1.5, off: 3 }, // half-life 2-3 min
  epinephrine: { on: 1.5, off: 3 },
  dobutamine: { on: 2, off: 3 }, // half-life 2 min
  milrinone: { on: 12, off: 90 }, // half-life 1-2 h; the effect builds over 10-15 min with no loading dose
  vasopressin: { on: 4, off: 15 }, // half-life 10-20 min
  phenylephrine: { on: 1.5, off: 5 }, // half-life 5 min
  nitroglycerin: { on: 1.5, off: 3 }, // half-life 2-3 min
  nitroprusside: { on: 0.7, off: 2 }, // half-life ~2 min: titrates in seconds-minutes
  betaBlocker: { on: 8, off: 180 }, // IV metoprolol: effect in minutes, half-life 3-4 h
  furosemide: { on: 8, off: 90 }, // IV: onset 5 min, peak 30 min, duration 2-3 h
  diltiazem: { on: 4, off: 120 }, // IV bolus: rate slowing within minutes, effect 1-3 h
};

/**
 * What a full dose drives, as receptor activation 0..1 (1 = the receptor's full response to a full dose). `noVen` and `noArt` are the
 * NO/cGMP drive in the veins and the arterioles (nitroglycerin acts on veins at low concentration, nitroprusside on both). [assumed]
 * Full dose reference: norepinephrine 0.3 ug/kg/min, epinephrine 0.1 ug/kg/min, dobutamine 10 ug/kg/min, milrinone 0.5 ug/kg/min,
 * vasopressin 0.04 U/min, phenylephrine 1 ug/kg/min, nitroglycerin 200 ug/min, nitroprusside 3 ug/kg/min, furosemide 80 mg IV; the
 * beta-blocker's dose is the fraction of beta-1 receptors blocked.
 */
export interface ReceptorProfile { a1?: number; b1?: number; b2?: number; v1?: number; pde3?: number; noVen?: number; noArt?: number; block?: number; loop?: number; ccb?: number }
export const PROFILES: Record<DrugName, ReceptorProfile> = {
  norepinephrine: { a1: 1, b1: 0.4 }, // alpha-1 >> beta-1, almost no beta-2
  epinephrine: { a1: 0.5, b1: 0.9, b2: 0.6 }, // beta at low dose, alpha added with dose
  dobutamine: { b1: 1, b2: 0.4, a1: 0.1 }, // beta-1 > beta-2, alpha-1 mostly cancelled in the racemate
  milrinone: { pde3: 1 }, // cAMP: inodilator, independent of the beta receptor
  vasopressin: { v1: 1 },
  phenylephrine: { a1: 1 }, // the scenario's "vasopressor" dial above 0: a pure alpha agonist
  nitroglycerin: { noVen: 1, noArt: 1 }, // the veins respond at a lower concentration (see `NO`)
  nitroprusside: { noVen: 1.5, noArt: 3 }, // arterial and venous, arterial more
  betaBlocker: { block: 1 },
  furosemide: { loop: 1 },
  diltiazem: { ccb: 1 }, // non-dihydropyridine calcium channel blocker: AV node, myocardium and arterioles
};

/**
 * What a receptor at full activation does to each target. `art` and `ven` are fractional changes of resistance and of venous tone
 * (tone > 1 = less unstressed volume, more stressed volume: `LiveModifiers.venousTone`); `ees`, `relax`, `hr` fractional changes of
 * Ees, of the relaxation time scale (tau) and of sinus rate. Effects of different receptors multiply. [assumed]
 */
export const RECEPTOR = {
  a1: { art: 0.6, ven: 0.3 }, // full alpha-1: SVR +60 %, veins 30 % tighter
  v1: { art: 0.5, ven: 0.05 }, // vasopressin: arterial; hardly any capacitance effect
  b2: { art: -0.25, ven: -0.05 },
  b1: { ees: 0.5, relax: -0.2, hr: 0.2 }, // inotropy, lusitropy, chronotropy of full beta-1 drive (before any blockade)
  pde3: { ees: 0.3, relax: -0.25, art: -0.3, ven: -0.1, hr: 0.04 }, // inodilator
  ccb: { ees: -0.5, relax: 0.05, art: -0.2, ven: 0 }, // diltiazem: negative inotropy and arteriolar dilation at a full dose
};

/**
 * AV-nodal slowing: the ventricular response in atrial fibrillation is multiplied by (1 − `betaBlock`·blockade)(1 − `ccb`·ccb), floored at `floor`. Beta
 * blockade and a calcium channel blocker both slow the node, and together more than either (and with more hypotension and bradycardia). [assumed]
 */
export const AV_NODE = { betaBlock: 0.4, ccb: 0.5, floor: 0.35 };

/**
 * NO/cGMP vasodilation: a Hill curve of the drive in each bed, response = max · d^n / (d^n + EC50^n). The veins have the lower EC50, so
 * a low dose of nitroglycerin lowers preload before afterload (Mason & Braunwald). [assumed]
 */
export const NO = {
  ven: { max: 0.45, ec50: 0.15, n: 1 }, // venous tone × (1 − response)
  art: { max: 0.45, ec50: 0.6, n: 2 }, // resistance × (1 − response)
};

/** Beta-blocker: fraction of beta-1 effect blocked = level; it also takes `blockerRelax` off lusitropy (tau × (1 + k·block)) at rest. [assumed] */
export const BETA_BLOCK = { blockerRelax: 0.08 };

/** Loop diuretic: urine flow multiplier 1 + `urine`·level (an IV dose gives roughly 8-10 times the resting flow at its peak), and a venodilation within minutes (tone × (1 − `ven`·level)). [assumed] */
export const LOOP = { urine: 8, ven: 0.1 };

/**
 * Myocardial oxygen demand relative to the patient's own, from the drug effects on the ventricle (the wall tension and heart rate terms
 * of the demand; the devices keep `SUPPORT`): demand = (1 + inotropy·(Ees − 1)) · (1 + rate·(HR factor − 1)) · (1 + afterload·(R − 1)) · (1 − preload·(1 − tone)).
 * Sized so a full dobutamine dose raises it by about 0.3 and norepinephrine by about 0.15 as the old multipliers did. [assumed]
 */
export const DEMAND = { inotropy: 0.6, rate: 0.8, afterload: 0.15, preload: 0.3 };
