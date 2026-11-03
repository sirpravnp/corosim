import type { PatientSpec } from "./patient";

/**
 * Playground presets (task P12): whole patients as PatientSpec data. Pure data, no behaviour; the playground loads one into
 * every control and every panel, and `tests/playground.test.ts` checks that each normalises, round-trips through a share link
 * and settles on the core engine.
 *
 * What the page's engines read (task P16): the coronary scenario and the structural `heart`,
 * pericardium, ventilation and every device setting. Parts that are only stored in the spec are named in `stored` so the picker can say so (none now:
 * fluids are modelled by the core engine, task C2).
 */
export interface Preset { id: string; label: string; blurb: string; spec: PatientSpec; stored?: string }

export const PRESETS: Preset[] = [
  { id: "normal", label: "Normal adult", blurb: "Resting adult, normal coronaries and valves.", spec: {} },
  {
    id: "anterior-stemi", label: "Anterior STEMI", blurb: "Proximal LAD occlusion: anterior ST elevation, a poorly contracting left ventricle and a rising wedge pressure.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] },
  },
  {
    id: "inferior-stemi-rv", label: "Inferior STEMI, RV involvement, heart block", blurb: "Proximal RCA occlusion with a stunned right ventricle (high venous pressure, low output) and ischemia of the AV node artery: a slow, blocked rhythm. Avoid nitrates.",
    spec: { lesions: [{ artery: "RCA", occluded: true, position: 0.2 }, { artery: "AVN", stenosis: 0.95, position: 0.5 }] },
  },
  {
    id: "stemi-mr", label: "Anterior STEMI with ischemic MR", blurb: "LAD occlusion and a regurgitant mitral valve (orifice 0.3 cm²): the forward stroke volume falls and the left atrium takes a v wave.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }], heart: { valves: { mv: { reg: 0.3 } } } },
  },
  {
    id: "shock-impella", label: "Cardiogenic shock with Impella CP", blurb: "Large anterior infarct on dobutamine with an Impella CP at P6: the wedge pressure falls and the aortic pulse narrows.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { dobutamine: 0.3, impella: true }, devices: { impella: { model: "CP", level: 6, position: "correct" } } },
  },
  {
    id: "impella-aortic", label: "Impella inflow in the aorta", blurb: "Anterior infarct, Impella CP at P8 pulled back so the inlet sits in the aorta: the pump spins and recirculates aorta to aorta, nothing is unloaded (wedge pressure stays high), the placement signal turns into an aortic pulse and the console says position wrong.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { dobutamine: 0.3, impella: true }, devices: { impella: { model: "CP", level: 8, position: "aortic" } } },
  },
  {
    id: "impella-deep", label: "Impella inflow too deep", blurb: "Anterior infarct, Impella CP at P9 pushed in too far: the inlet meets the ventricular wall and papillary apparatus, so the flow collapses in each beat and suction alarms sound. Reposition or turn the P-level down.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { dobutamine: 0.3, impella: true }, devices: { impella: { model: "CP", level: 9, position: "deep" } } },
  },
  {
    id: "rv-infarct-impella", label: "RV infarct starving a left Impella", blurb: "Proximal RCA occlusion with a failed right ventricle in a preload-depleted patient, Impella CP at P9: the left ventricle gets too little blood, the flow falls and suction alarms sound. A fluid bolus, an Impella RP or a lower P-level restores the flow.",
    spec: { lesions: [{ artery: "RCA", occluded: true, position: 0.2 }], heart: { rvEes: 0.2, rvStiffness: 4 }, bloodLoss: 0.25, devices: { impella: { model: "CP", level: 9, position: "correct" } } },
  },
  {
    id: "tamponade", label: "Cardiac tamponade", blurb: "A 270 ml effusion in a normal sac, breathing spontaneously: falling pressure and output, a raised venous pressure and a fast pulse (Beck's triad), the four diastolic pressures drawn together to the pressure of the sac, a blunted y descent, a pulsus paradoxus over 10 mmHg and, above 250 ml, electrical alternans (the EKG page opens its alternans preset). Pericardiocentesis (remove 50-100 ml) relieves it.",
    spec: { pericardium: { effusionMl: 270, stiffness: 1 }, septum: true, ventilation: { mode: "spontaneous" }, autonomic: { respDepth: 1.5 } },
  },
  {
    id: "constrictive-pericarditis", label: "Constrictive pericarditis", blurb: "A scarred, stiff sac (3x normal) with no fluid and 1.5 L of retained volume: a high venous pressure with a steep y descent (the dip-and-plateau, or square-root sign, on the right ventricular trace), both ventricles filling to the same pressure, and Kussmaul's sign (the venous pressure rises on inspiration).",
    spec: { pericardium: { stiffness: 3 }, heart: { volumeMl: 1500 }, septum: true, ventilation: { mode: "spontaneous" } },
  },
  {
    id: "rv-infarct-septal", label: "RV infarct with septal shift", blurb: "Proximal RCA occlusion with a failed, dilated right ventricle: a high venous pressure with clear lungs, and the septum bowing into the left ventricle, which fills less (a low output at a normal wedge pressure). Fluids help; nitrates harm.",
    spec: { lesions: [{ artery: "RCA", occluded: true, position: 0.2 }], septum: true },
  },
  {
    id: "severe-as", label: "Severe aortic stenosis", blurb: "Aortic valve at 20% of its normal opening: a high left ventricular pressure against a normal aortic pressure.",
    spec: { heart: { valves: { av: { open: 0.2 } } } },
  },
  {
    id: "hemorrhage-fluids", label: "Hemorrhage with fluids", blurb: "Class III blood loss (30%), bleeding controlled, then 1 L of crystalloid from minute 5 over 10 minutes. About a quarter of it stays in the vessels; the water goes to the interstitium and Hb falls.",
    spec: { bloodLoss: 0.3, fluids: { given: [{ kind: "crystalloid", ml: 1000, atMin: 5, overMin: 10 }] } },
  },
  {
    id: "flash-pulmonary-edema", label: "Hypertensive acute pulmonary edema", blurb: "A stiff, volume-loaded left ventricle against a high systemic resistance (flash pulmonary edema): the wedge pressure goes to about 28 mmHg and the lungs fill over tens of clinical minutes, so the oxygen saturation falls from 98% toward the low 90s while the pressure is held. Unloading (nitroglycerin, diuresis) lets the lung water clear slowly.",
    spec: { heart: { lvStiffness: 3, volumeMl: 700, svrScale: 1.8, lvEes: 0.8 } },
  },
  {
    id: "va-ecmo-poor-lv", label: "VA-ECMO with a poor LV", blurb: "A large infarct with a left ventricle at 30% of its contractility, on VA-ECMO at 4 L/min. The left ventricle cannot open its valve against the flow and is not vented: the wedge pressure climbs, which is why a vent is added.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], heart: { lvEes: 0.3 }, support: { norepinephrine: 0.3 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 } } },
  },
];
export const PRESET_BY_ID: Record<string, Preset | undefined> = Object.assign(Object.create(null), Object.fromEntries(PRESETS.map((p) => [p.id, p])));
