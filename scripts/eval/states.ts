// The specified states of the evaluation. Each starts from the same settled, healthy adult (same seed => same baseline), snapshots it,
// applies `insult` the way the page does (Simulation.apply), then snapshots again at each checkpoint.
// Checkpoints are SIMULATED seconds after the insult; the clinical clock runs 2 clinical minutes per simulated second at 1x, so
// 5 s = 10 min, 20 s = 40 min, 60 s = 2 h, 180 s = 6 h. A state can set its own checkpoints and timed actions.
// To add a state: append here, then `npx tsx scripts/eval/run.ts template <id>` writes its blank spec for you to fill in.
import type { Simulation } from "../../src/sim/simulation";
import type { PatientSpec, HeartSpec } from "../../src/sim/patient";
import { intervene, valveSet } from "../../src/sim/valves";
import { sweepStates } from "./sweep";
import { probeStates } from "./probe";
import { matrixStates } from "./matrix";

export type Suite = "standard" | "edge" | "valve" | "stochastic" | "sweep" | "probe" | "matrix";

export interface State {
  id: string; title: string;
  /** Applied to the healthy baseline at t = 0. */
  insult: PatientSpec;
  /** Simulated seconds after the insult at which every variable is recorded. Default CHECKPOINTS. */
  checkpoints?: number[];
  /** Things done at a time after the insult (a procedure, a shock, a device on). */
  actions?: { atS: number; label: string; run: (s: Simulation) => void }[];
  /** Start from this instead of the healthy adult (the patient the insult is applied to). */
  baseline?: PatientSpec;
  seeds?: number;
  /** Page speed (1, 3 or 6). Clinical minutes per simulated second are 2, 6 and 12. Default 1. */
  speed?: 1 | 3 | 6;
  /** Which command filters include this state. Omitted means `standard`. */
  suite?: Suite;
  /** Invariants are checked; no expectation file is required. */
  invariantsOnly?: boolean;
  /** The infarct is allowed to shrink (no current state does this). */
  removesTissue?: boolean;
  /** Set on an input-sweep state so the report can group by field. */
  sweep?: { field: string; level: string; value: string; noPageControl: boolean };
}

export const CHECKPOINTS = [5, 20, 60, 180];
const lad = (stenosis?: number, position = 0.2) => ({ artery: "LAD", position, ...(stenosis === undefined ? { occluded: true } : { stenosis }) });

const heartOf = (s: Simulation): HeartSpec => (s as unknown as { heartSpec?: HeartSpec }).heartSpec ?? {};
const ladOcc = { artery: "LAD", occluded: true, position: 0.2 };

const HAND: State[] = [
  { id: "healthy", title: "Healthy resting adult (no insult; drift check)", insult: {} },
  // coronary
  { id: "lad-prox-occlusion", title: "Proximal LAD occlusion (anterior STEMI)", insult: { lesions: [lad()] } },
  { id: "lad-distal-occlusion", title: "Distal LAD occlusion", insult: { lesions: [lad(undefined, 0.9)] } },
  { id: "rca-prox-occlusion", title: "Proximal RCA occlusion (inferior STEMI, right dominant)", insult: { lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] } },
  { id: "lcx-occlusion", title: "Circumflex occlusion", insult: { lesions: [{ artery: "LCX", occluded: true, position: 0.3 }] } },
  { id: "lm-occlusion", title: "Left main occlusion", insult: { lesions: [{ artery: "LM", occluded: true, position: 0.5 }] } },
  { id: "lad-50-rest", title: "LAD 50% diameter stenosis at rest", insult: { lesions: [lad(0.5)] } },
  { id: "lad-80-rest", title: "LAD 80% stenosis at rest", insult: { lesions: [lad(0.8)] } },
  { id: "lad-80-exertion", title: "LAD 80% stenosis with exertion", insult: { lesions: [lad(0.8)], exertion: true } },
  // volume
  { id: "hemorrhage-15", title: "Acute 15% blood loss", insult: { bloodLoss: 0.15 } },
  { id: "hemorrhage-30", title: "Acute 30% blood loss", insult: { bloodLoss: 0.3 } },
  { id: "hemorrhage-45", title: "Acute 45% blood loss", insult: { bloodLoss: 0.45 } },
  { id: "bleed-100mlmin", title: "Ongoing bleed 100 ml/min", insult: { fluids: { hemorrhageMlMin: 100 } } },
  { id: "volume-overload", title: "Volume overload (+20%)", insult: { bloodLoss: -0.2 } },
  // drugs and support on the healthy heart
  { id: "norepinephrine-50", title: "Norepinephrine 0.5 (healthy)", insult: { support: { norepinephrine: 0.5 } } },
  { id: "dobutamine-50", title: "Dobutamine 0.5 (healthy)", insult: { support: { dobutamine: 0.5 } } },
  { id: "nitroglycerin-50", title: "Nitroglycerin 0.5 (healthy)", insult: { support: { nitroglycerin: 0.5 } } },
  { id: "beta-blocker-80", title: "Beta blockade 80%", insult: { drugs: { betaBlocker: 0.8 } } },
  { id: "atropine-full", title: "Atropine, full vagal block", insult: { drugs: { atropine: 1 } } },
  // rhythm
  { id: "af", title: "Atrial fibrillation (new)", insult: { patient: { rhythm: "af" } } },
  { id: "chb", title: "Complete heart block", insult: { patient: { rhythm: "chb" } } },
  { id: "vt-mono", title: "Sustained monomorphic VT", insult: { patient: { rhythm: "vt-mono" } } },
  { id: "vf", title: "Ventricular fibrillation, no CPR, no shock", insult: { patient: { rhythm: "vf-coarse" } }, checkpoints: [5, 20, 60, 120] },
  // treatment time courses
  { id: "lad-occlusion-then-pci", title: "LAD occlusion, primary PCI after 10 s (20 clinical min of ischemia)", insult: { lesions: [lad()] }, checkpoints: [5, 20, 60, 100, 180],
    actions: [{ atS: 10, label: "primary PCI", run: (s) => { s.revascularize("pci"); } }] },

  // ---- edge inputs (invariants only). Extreme values are applied, not reset. Warnings are reported, not treated as failures.
  { id: "edge-stenosis-099", suite: "edge", invariantsOnly: true, title: "LAD stenosis 0.99", insult: { lesions: [lad(0.99)] } },
  { id: "edge-stenosis-1.5", suite: "edge", invariantsOnly: true, title: "LAD stenosis 1.5 (above 1)", insult: { lesions: [lad(1.5)] } },
  { id: "edge-stenosis-neg", suite: "edge", invariantsOnly: true, title: "LAD stenosis -0.2", insult: { lesions: [lad(-0.2)] } },
  { id: "edge-stenosis-nan", suite: "edge", invariantsOnly: true, title: "LAD stenosis NaN", insult: { lesions: [{ artery: "LAD", position: 0.2, stenosis: NaN }] } },
  { id: "edge-bloodloss-0.8", suite: "edge", invariantsOnly: true, title: "bloodLoss 0.8 (above 0.6)", insult: { bloodLoss: 0.8 } },
  { id: "edge-bloodloss-neg", suite: "edge", invariantsOnly: true, title: "bloodLoss -1.0 (below -0.3)", insult: { bloodLoss: -1 } },
  { id: "edge-seed-0", suite: "edge", invariantsOnly: true, title: "seed 0 applied after reset", insult: { seed: 0 } },
  { id: "edge-seed-neg", suite: "edge", invariantsOnly: true, title: "seed -1 applied after reset", insult: { seed: -1 } },
  { id: "edge-seed-big", suite: "edge", invariantsOnly: true, title: "seed 2^32+5 applied after reset", insult: { seed: 2 ** 32 + 5 } },
  { id: "edge-seed-nan", suite: "edge", invariantsOnly: true, title: "seed NaN applied after reset", insult: { seed: NaN } },
  { id: "edge-k-2", suite: "edge", invariantsOnly: true, title: "potassium 2.0 mmol/L", insult: { electrolytes: { potassium: 2 } } },
  { id: "edge-k-7.5", suite: "edge", invariantsOnly: true, title: "potassium 7.5 mmol/L", insult: { electrolytes: { potassium: 7.5 } } },
  { id: "edge-arrhythmia-0", suite: "edge", invariantsOnly: true, title: "arrhythmiaTendency 0", insult: { arrhythmiaTendency: 0 } },
  { id: "edge-arrhythmia-3", suite: "edge", invariantsOnly: true, title: "arrhythmiaTendency 3", insult: { arrhythmiaTendency: 3 } },
  { id: "edge-ectopy-3", suite: "edge", invariantsOnly: true, title: "ectopyTendency 3", insult: { ectopyTendency: 3 } },
  // ---- edge combinations
  { id: "edge-3vd", suite: "edge", invariantsOnly: true, title: "LAD, LCx and RCA all occluded", insult: { lesions: [lad(), { artery: "LCX", occluded: true, position: 0.3 }, { artery: "RCA", occluded: true, position: 0.25 }] } },
  { id: "edge-lm-rv-chb", suite: "edge", invariantsOnly: true, title: "Left main occlusion, proximal RCA occlusion, complete heart block", insult: { lesions: [{ artery: "LM", occluded: true, position: 0.5 }, { artery: "RCA", occluded: true, position: 0.2 }], patient: { rhythm: "chb" }, septum: true } },
  { id: "edge-tamponade-bleed", suite: "edge", invariantsOnly: true, title: "Tamponade (270 ml) plus 30% hemorrhage", insult: { pericardium: { effusionMl: 270, stiffness: 1 }, septum: true, bloodLoss: 0.3, ventilation: { mode: "spontaneous" }, autonomic: { respDepth: 1.5 } } },
  { id: "edge-impella-rv-fail", suite: "edge", invariantsOnly: true, title: "Impella CP P6 with a weak right ventricle", insult: { heart: { rvEes: 0.3, rvContractility: 0.4 }, septum: true, devices: { impella: { model: "CP", level: 6, position: "correct" } } } },
  { id: "edge-ecmo-no-vent", suite: "edge", invariantsOnly: true, title: "VA-ECMO 4 L/min, poor LV, no vent", insult: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], heart: { lvEes: 0.3 }, support: { norepinephrine: 0.3 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 } } } },
  { id: "edge-all-drugs", suite: "edge", invariantsOnly: true, title: "Every drug dial at 1", insult: { drugs: { betaBlocker: 1, atropine: 1, vasopressor: 1 }, support: { norepinephrine: 1, epinephrine: 1, dobutamine: 1, milrinone: 1, vasopressin: 1, nitroglycerin: 1, nitroprusside: 1, furosemide: 1, diltiazem: 1 } } },
  // ---- anatomy: proximal LAD occlusion on every non-default value of dominance, left-main pattern, LAD course and nodal origin, plus two combinations (9)
  ...([
    ["anat-dom-left", "Left-dominant", { dominance: "left" as const }],
    ["anat-dom-co", "Co-dominant", { dominance: "co" as const }],
    ["anat-lm-tri", "Left main trifurcation", { lm: "trifurcation" as const }],
    ["anat-lm-absent", "Absent left main", { lm: "absent" as const }],
    ["anat-lad-short", "Short LAD", { ladCourse: "short" as const }],
    ["anat-lad-wrap", "Wraparound LAD", { ladCourse: "wrap" as const }],
    ["anat-san-lcx", "SA node from the circumflex", { saNodeFrom: "LCx" as const }],
    ["anat-left-san-lcx", "Left-dominant and SA node from the circumflex", { dominance: "left" as const, saNodeFrom: "LCx" as const }],
    ["anat-absent-wrap", "Absent left main and wraparound LAD", { lm: "absent" as const, ladCourse: "wrap" as const }],
  ] as const).map(([id, title, anatomy]) => ({ id, suite: "edge" as const, invariantsOnly: true, title: `Proximal LAD occlusion, ${title}`, insult: { anatomy, lesions: [{ ...ladOcc }] } })),

  // ---- valves, shunts, prostheses. Severities are the 0..1 slider (valveSet), the same spans as the valve tests.
  { id: "as-mild", suite: "valve", invariantsOnly: true, title: "Mild aortic stenosis", insult: { heart: { valves: valveSet({ av: { stenosis: 0.45 } }) } } },
  { id: "as-moderate", suite: "valve", invariantsOnly: true, title: "Moderate aortic stenosis", insult: { heart: { valves: valveSet({ av: { stenosis: 0.7 } }) } } },
  { id: "as-severe", suite: "valve", invariantsOnly: true, title: "Severe aortic stenosis", insult: { heart: { valves: valveSet({ av: { stenosis: 0.95 } }) } } },
  { id: "ar", suite: "valve", invariantsOnly: true, title: "Aortic regurgitation", insult: { heart: { valves: valveSet({ av: { regurgitation: 0.6 } }) } } },
  { id: "ms", suite: "valve", invariantsOnly: true, title: "Mitral stenosis", insult: { heart: { valves: valveSet({ mv: { stenosis: 0.75 } }) } } },
  { id: "mr-chronic", suite: "valve", invariantsOnly: true, title: "Chronic mitral regurgitation (enlarged left atrium)", insult: { heart: { valves: valveSet({ mv: { regurgitation: 0.6 } }), laSize: 1.8 } } },
  { id: "mr-acute", suite: "valve", invariantsOnly: true, title: "Acute mitral regurgitation (normal left atrium)", insult: { heart: { valves: valveSet({ mv: { regurgitation: 0.8 } }) } } },
  { id: "ts", suite: "valve", invariantsOnly: true, title: "Tricuspid stenosis", insult: { heart: { valves: valveSet({ tv: { stenosis: 0.7 } }) } } },
  { id: "tr", suite: "valve", invariantsOnly: true, title: "Tricuspid regurgitation", insult: { heart: { valves: valveSet({ tv: { regurgitation: 0.6 } }) } } },
  { id: "ps", suite: "valve", invariantsOnly: true, title: "Pulmonary stenosis", insult: { heart: { valves: valveSet({ pv: { stenosis: 0.7 } }) } } },
  { id: "pr", suite: "valve", invariantsOnly: true, title: "Pulmonary regurgitation", insult: { heart: { valves: valveSet({ pv: { regurgitation: 0.5 } }) } } },
  { id: "asd", suite: "valve", invariantsOnly: true, title: "Atrial septal defect 15 mm", insult: { heart: { asd: { diameterMm: 15 } } } },
  { id: "vsd", suite: "valve", invariantsOnly: true, title: "Ventricular septal defect 8 mm", insult: { heart: { vsd: { diameterMm: 8 } } } },
  { id: "pda", suite: "valve", invariantsOnly: true, title: "Patent ductus arteriosus 4 mm", insult: { heart: { pda: { diameterMm: 4 } } } },
  { id: "as-mr", suite: "valve", invariantsOnly: true, title: "Severe aortic stenosis plus mitral regurgitation (docs/VALVES.md pair)", insult: { heart: { valves: valveSet({ av: { stenosis: 0.95 }, mv: { regurgitation: 0.6 } }) } } },
  { id: "as-lad-80", suite: "valve", invariantsOnly: true, title: "Aortic stenosis plus LAD 80%", insult: { heart: { valves: valveSet({ av: { stenosis: 0.85 } }) }, lesions: [lad(0.8)] } },
  { id: "avr-bio-23", suite: "valve", invariantsOnly: true, title: "23 mm aortic bioprosthesis", insult: { heart: { valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 23 } } } } } },
  { id: "avr-mech-23", suite: "valve", invariantsOnly: true, title: "23 mm mechanical aortic valve", insult: { heart: { valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23 } } } } } },
  { id: "tavr-26", suite: "valve", invariantsOnly: true, title: "26 mm transcatheter aortic valve", insult: { heart: { valves: { av: { prosthesis: { kind: "transcatheter", sizeMm: 26 } } } } } },
  { id: "valve-in-valve", suite: "valve", invariantsOnly: true, title: "23 mm transcatheter valve inside a surgical ring", insult: { heart: { valves: { av: { prosthesis: { kind: "transcatheter", sizeMm: 23, inRing: true } } } } } },
  { id: "as-then-tavr", suite: "valve", invariantsOnly: true, title: "Severe aortic stenosis, then TAVR at 5 s", baseline: { heart: { valves: valveSet({ av: { stenosis: 0.95 } }) } }, insult: {},
    actions: [{ atS: 5, label: "TAVR 26 mm", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "tavr", sizeMm: 26 }).patch }); } }] },

  // ---- stochastic outcomes (24 seeds). Rates are reported with a 95% interval; expectation cells stay blank for the owner.
  { id: "lad-occlusion-then-lysis", suite: "stochastic", seeds: 24, invariantsOnly: true, title: "Proximal LAD occlusion, fibrinolysis at 5 s", insult: { lesions: [lad()] }, checkpoints: [40],
    actions: [{ atS: 5, label: "fibrinolysis", run: (s) => { s.revascularize("lysis"); } }] },
  { id: "vf-shock-200", suite: "stochastic", seeds: 24, invariantsOnly: true, title: "VF, 200 J shock at 20 s", insult: { patient: { rhythm: "vf-coarse" } }, checkpoints: [25, 40],
    actions: [{ atS: 20, label: "shock 200 J", run: (s) => { s.shock({ joules: 200 }); } }] },
  { id: "lad-vt-vf-6h", suite: "stochastic", seeds: 24, invariantsOnly: true, title: "Proximal LAD occlusion, VT/VF by 6 h clinical", insult: { lesions: [lad()] }, checkpoints: [180] },
  { id: "lad-reperfuse-pvc", suite: "stochastic", seeds: 24, invariantsOnly: true, title: "Proximal LAD occlusion, PCI at 10 s, PVCs after reperfusion", insult: { lesions: [lad()] }, checkpoints: [40],
    actions: [{ atS: 10, label: "primary PCI", run: (s) => { s.revascularize("pci"); } }] },
];

export const STATES: State[] = [...HAND, ...probeStates(), ...sweepStates(), ...matrixStates()];
const ids = STATES.map((s) => s.id);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) throw new Error(`duplicate eval state ids: ${[...new Set(dup)].join(", ")}`);
export const STATE_BY_ID: Record<string, State> = Object.fromEntries(STATES.map((s) => [s.id, s]));
