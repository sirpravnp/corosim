import type { PatientSpec } from "../sim/patient";

/** Ready-made pieces for the builder, so a case is written by picking, not by typing patient JSON. Each is merged into the field it is added to. */
export interface Preset { label: string; patch: PatientSpec }

/** What the patient can open with. */
export const START_PRESETS: Preset[] = [
  { label: "Proximal LAD occluded", patch: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] } },
  { label: "Left main occluded", patch: { lesions: [{ artery: "LM", occluded: true }] } },
  { label: "Proximal RCA occluded", patch: { lesions: [{ artery: "RCA", occluded: true, position: 0.1 }] } },
  { label: "Circumflex occluded", patch: { lesions: [{ artery: "LCX", occluded: true, position: 0.1 }] } },
  { label: "LAD 85% stenosis", patch: { lesions: [{ artery: "LAD", stenosis: 0.85, position: 0.3 }] } },
  { label: "Atrial fibrillation, fast", patch: { patient: { rhythm: "af-rvr" } } },
  { label: "Complete heart block", patch: { patient: { rhythm: "chb" } } },
  { label: "Ventricular fibrillation", patch: { patient: { rhythm: "vf-coarse" } } },
  { label: "Blood loss, 15%", patch: { bloodLoss: 0.15 } },
];

/** Changes a time point can make to the patient. */
export const CHANGE_PRESETS: Preset[] = [
  { label: "Rhythm: sinus", patch: { patient: { rhythm: "sinus" } } },
  { label: "Rhythm: atrial fibrillation", patch: { patient: { rhythm: "af" } } },
  { label: "Rhythm: ventricular fibrillation", patch: { patient: { rhythm: "vf-coarse" } } },
  { label: "Rhythm: ventricular tachycardia", patch: { patient: { rhythm: "vt-mono" } } },
  { label: "Rhythm: asystole", patch: { patient: { rhythm: "asystole" } } },
  { label: "Start norepinephrine", patch: { support: { norepinephrine: 0.4 } } },
  { label: "Start dobutamine", patch: { support: { dobutamine: 0.4 } } },
  { label: "Start nitroglycerin", patch: { support: { nitroglycerin: 0.25 } } },
  { label: "Give a beta blocker", patch: { drugs: { betaBlocker: 0.6 } } },
  { label: "Give 1 L of fluid", patch: { support: { fluids: 1 } } },
  { label: "Start pacing at 70", patch: { support: { pacing: true, paceRate: 70 } } },
  { label: "Place an Impella (P6)", patch: { devices: { impella: { level: 6 } } } },
  { label: "Start VA-ECMO (4 L/min)", patch: { devices: { ecmo: { flowLpm: 4 } } } },
  { label: "Place an IABP (1:1)", patch: { devices: { iabp: { ratio: 1 } } } },
  { label: "Bleeding, 15% of blood volume", patch: { bloodLoss: 0.15 } },
];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** Merge `add` into `into` (objects merge key by key; anything else, arrays included, is replaced). */
export function mergePatch<T>(into: T | undefined, add: unknown): T {
  if (!isObj(into) || !isObj(add)) return (add as T) ?? (into as T);
  const out: Record<string, unknown> = { ...into };
  for (const [k, v] of Object.entries(add)) out[k] = isObj(v) && isObj(out[k]) ? mergePatch(out[k], v) : v;
  return out as T;
}
