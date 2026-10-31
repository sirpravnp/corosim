// The specified states of the evaluation. Each starts from the same settled, healthy adult (same seed => same baseline), snapshots it,
// applies `insult` the way the page does (Simulation.apply), then snapshots again at each checkpoint.
// Checkpoints are SIMULATED seconds after the insult; the clinical clock runs 2 clinical minutes per simulated second at 1x, so
// 5 s = 10 min, 20 s = 40 min, 60 s = 2 h, 180 s = 6 h. A state can set its own checkpoints and timed actions.
// To add a state: append here, then `npx tsx scripts/eval/run.ts template <id>` writes its blank spec for you to fill in.
import type { Simulation } from "../../src/sim/simulation";
import type { PatientSpec } from "../../src/sim/patient";

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
}

export const CHECKPOINTS = [5, 20, 60, 180];
const lad = (stenosis?: number, position = 0.2) => ({ artery: "LAD", position, ...(stenosis === undefined ? { occluded: true } : { stenosis }) });

export const STATES: State[] = [
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
];
export const STATE_BY_ID: Record<string, State> = Object.fromEntries(STATES.map((s) => [s.id, s]));
