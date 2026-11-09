import type { PatientSpec } from "../sim/patient";

/**
 * The learner-edit gate for cases. In a case the learner may do what a clinician can do at the bedside to a patient: treat. They may not
 * create or edit disease (rhythm, conduction, coronary lesions, valve lesions, effusion, baseline blood volume, reflex settings, anything
 * structural). The case author's own path (the start state, checkpoint outcomes, the opening) never passes through this file.
 *
 * `TREATMENT_KEYS` is an allowlist by dotted path into a `PatientSpec`; a path allows its whole subtree. Anything not listed is refused
 * (fail closed), so a field added to the spec tomorrow is pathology until someone writes down why it is a treatment.
 */
export type Edit = PatientSpec;
export type Verdict = { ok: true } | { ok: false; why: string };

export const TREATMENT_KEYS: Readonly<Record<string, string>> = {
  "drugs.betaBlocker": "a beta blocker is given at the bedside",
  "drugs.atropine": "atropine is given at the bedside",
  "drugs.vasopressor": "a pressor or a vasodilator is given at the bedside",
  "support.fluids": "a fluid bolus is given at the bedside",
  "support.norepinephrine": "norepinephrine is an infusion",
  "support.dobutamine": "dobutamine is an infusion",
  "support.nitroglycerin": "nitroglycerin is an infusion",
  "support.epinephrine": "epinephrine is given at the bedside",
  "support.milrinone": "milrinone is an infusion",
  "support.vasopressin": "vasopressin is an infusion",
  "support.nitroprusside": "nitroprusside is an infusion",
  "support.furosemide": "a diuretic is given at the bedside",
  "support.diltiazem": "a rate-control drug is given at the bedside",
  "support.pacing": "pacing is a bedside therapy",
  "support.paceRate": "the pacing rate is a pacemaker setting",
  "support.iabp": "an intra-aortic balloon pump is a device a team places",
  "support.coroPump": "a CoroPump is a device a team places",
  "fluids.given": "fluids and blood are given at the bedside",
  "fluids.legRaise": "a passive leg raise is a bedside maneuver",
  "ventilation.mode": "ventilation is set at the bedside (oxygen and ventilator mode)",
  "ventilation.peep": "PEEP is a ventilator setting",
  "ventilation.tidalMlKg": "tidal volume is a ventilator setting",
  "devices.coroPump.level": "the CoroPump P-level is a bedside setting",
  "devices.coroPump.model": "the CoroPump model is chosen when the device is placed",
  "devices.coroPump.purge.solution": "the purge solution is a bedside setting",
  "devices.coroPump.purge.heparinUml": "heparin concentration in the purge is a bedside setting",
  "devices.coroPump.purge.clearLine": "clearing a purge line is a bedside task",
  "devices.coroPump.exchange": "exchanging a pump is a procedure",
  "devices.coroPump.reposition": "repositioning is a procedure under echo",
  "devices.coroPumpRp": "the right-sided CoroPump is a device a team places",
  "devices.iabp": "balloon pump settings belong to the device the team placed",
  "devices.ecmo": "ECMO is a device a team places and sets",
  "pericardium.drainMl": "pericardiocentesis removes fluid; it is a procedure, not a state",
};

/** Why a family of fields is disease, as one sentence each; the longest matching path prefix wins. */
const DISEASE: readonly (readonly [string, string])[] = [
  ["patient.rhythm", "You cannot choose the patient's rhythm; read it on the monitor and treat it."],
  ["patient.bbb", "You cannot give the patient a bundle branch block; conduction is the patient's own."],
  ["patient", "You cannot change who the patient is; treat the patient you have."],
  ["lesions", "You cannot create or remove a coronary lesion; order a test or a procedure to find and treat it."],
  ["anatomy", "You cannot change the patient's coronary anatomy."],
  ["heart", "You cannot create or edit a valve lesion or any structural defect; a clinician can only find and treat one."],
  ["pericardium", "You cannot make a pericardial effusion; you can drain one."],
  ["bloodLoss", "You cannot set the patient's blood volume; give fluids or blood instead."],
  ["fluids.hemorrhageMlMin", "You cannot make the patient bleed; give fluids or blood instead."],
  ["fluids.capillaryLeak", "You cannot give the patient a capillary leak."],
  ["autonomic", "You cannot change the patient's reflexes or autonomic settings."],
  ["electrolytes", "You cannot set the patient's electrolytes; order labs and replace what is low."],
  ["ectopyTendency", "You cannot change how irritable the patient's heart is."],
  ["arrhythmiaTendency", "You cannot change how irritable the patient's heart is."],
  ["exertion", "You cannot put the patient under exertion."],
  ["septum", "You cannot change the patient's septum or chamber interaction."],
  ["seed", "You cannot start the patient over with different random beats."],
  ["devices.coroPump.position", "You cannot malposition the pump; read placement on the console and reposition if needed."],
  ["devices.coroPump.purge.line", "You cannot block the purge line; clear it or exchange the pump if purge pressure rises."],
  ["devices.coroPump.initial", "You cannot set thrombus or hemolysis at the bedside; treat what you find on the console and in labs."],
];
/** Why a running case refuses to swap in a whole new patient. */
export const REPLACE_WHY = "A case patient can only be treated, not replaced.";
/** Whether the learner may swap in a whole new patient: never while the gate is on (a running case), always otherwise. */
export const mayReplace = (gateOn: boolean): Verdict => (gateOn ? { ok: false, why: REPLACE_WHY } : { ok: true });
const GENERIC = "A clinician cannot change that at the bedside.";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const reasonFor = (path: string): string => {
  let best = "", why = GENERIC;
  for (const [p, w] of DISEASE) if ((path === p || path.startsWith(p + ".")) && p.length > best.length) { best = p; why = w; }
  return why;
};

function firstRefusal(v: unknown, path: string): string | null {
  if (v === undefined) return null;
  if (path in TREATMENT_KEYS) return null;
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) { const r = firstRefusal(x, path ? `${path}.${k}` : k); if (r) return r; }
    return null; // an empty section changes nothing
  }
  return reasonFor(path);
}

/** Whether the learner may apply this edit. A mixed edit is refused as a whole, with the reason for the first disease field in it. */
export function learnerMayApply(edit: Edit): Verdict {
  const why = firstRefusal(edit, "");
  return why ? { ok: false, why } : { ok: true };
}
/** True when the edit is only treatment (an empty edit is). */
export const isTreatment = (edit: Edit): boolean => learnerMayApply(edit).ok;

/**
 * What changed between two patients, as an edit: changed leaves keep their new value, and a field that went away is `null` (so removing a
 * lesion is a change to disease, while clearing a bolus is a change to treatment). For editors that hand over the whole next state.
 */
export function editBetween(before: Edit, after: Edit): Edit {
  const diff = (a: unknown, b: unknown): unknown => {
    if ((isObj(a) || a === undefined) && (isObj(b) || b === undefined) && (isObj(a) || isObj(b))) { // a whole section appearing or going away is read field by field
      const x = (a ?? {}) as Record<string, unknown>, y = (b ?? {}) as Record<string, unknown>, out: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = diff(x[k], y[k]); if (d !== undefined) out[k] = d; }
      return Object.keys(out).length ? out : undefined;
    }
    if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
    return b === undefined ? null : b;
  };
  return (diff(before, after) ?? {}) as Edit;
}
