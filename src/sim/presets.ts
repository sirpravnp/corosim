import type { PatientSpec } from "./patient";

/**
 * Playground presets (task P12): whole patients as PatientSpec data. Pure data, no behaviour; the playground loads one into
 * every control and every panel, and `tests/playground.test.ts` checks that each normalises, round-trips through a share link
 * and gives a converging bridge solve.
 *
 * What the page's engines read today: the coronary scenario, the bridge's structural `heart`, `kind`, and the legacy device
 * switches. Parts that are only stored in the spec (pericardium, fluids, ventilation, device settings) are named in `stored`
 * so the picker can say so.
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
    id: "shock-impella", label: "Cardiogenic shock with Impella CP", blurb: "Large anterior infarct on dobutamine with an Impella CP at P6. The on/off switch drives the page's legacy Impella model.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { dobutamine: 0.3, impella: true }, devices: { impella: { model: "CP", level: 6, position: "correct" } } },
    stored: "Impella model, level and position",
  },
  {
    id: "tamponade", label: "Cardiac tamponade", blurb: "A 450 ml effusion still filling a normal sac: the classic Beck triad.",
    spec: { pericardium: { effusionMl: 450, effusionRateMlMin: 10, stiffness: 1 } },
    stored: "the pericardial effusion",
  },
  {
    id: "severe-as", label: "Severe aortic stenosis", blurb: "Aortic valve at 20% of its normal opening: a high left ventricular pressure against a normal aortic pressure.",
    spec: { heart: { valves: { av: { open: 0.2 } } } },
  },
  {
    id: "vsd-neonate", label: "VSD, neonate", blurb: "A 5 mm ventricular septal defect with falling pulmonary resistance: left-to-right shunt and pulmonary overcirculation.",
    spec: { kind: "neonate", heart: { pvri: 2, vsd: { diameterMm: 5 } } },
  },
  {
    id: "tof", label: "Tetralogy of Fallot", blurb: "A large VSD with right ventricular outflow obstruction: right-to-left shunt and cyanosis.",
    spec: { kind: "neonate", heart: { pvri: 5, tof: { vsdMm: 8, rvotFrac: 0.15, spasm: 0 } } },
  },
  {
    id: "hemorrhage-fluids", label: "Hemorrhage with fluids", blurb: "Class III blood loss (30%) while 1 L of crystalloid goes in. Blood loss and the litre of IV fluid are modelled; the bleeding rate and the dose timing are stored only.",
    spec: { bloodLoss: 0.3, support: { fluids: 1 }, fluids: { hemorrhageMlMin: 30, given: [{ kind: "crystalloid", ml: 1000, atMin: 5, overMin: 10 }] } },
    stored: "the bleeding rate and the dose timing",
  },
  {
    id: "va-ecmo-poor-lv", label: "VA-ECMO with a poor LV", blurb: "A large infarct with a left ventricle at 30% of its contractility, on VA-ECMO at 4 L/min. ECMO is stored only: the circulation shown is the unsupported one.",
    spec: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], heart: { lvEes: 0.3 }, support: { norepinephrine: 0.3 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 } } },
    stored: "VA-ECMO flow, sweep and FiO₂",
  },
];
export const PRESET_BY_ID: Record<string, Preset | undefined> = Object.assign(Object.create(null), Object.fromEntries(PRESETS.map((p) => [p.id, p])));
