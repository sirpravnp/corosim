import { Scenario } from "../sim/scenario";

export interface CathCase {
  id: string; title: string; blurb: string;
  scenario: Scenario;
  /** How the C-arm and the catheter start: left or right coronary injection, LAO(+)/RAO(−) and cranial(+)/caudal(−) degrees. */
  view: { injection: "both" | "left" | "right"; rot: number; tilt: number };
  /** The vessel the pressure wire opens on. */
  artery: string;
}

/** A small library of patients for the lab. Anyone can also arrive with a simulator link (#s=). */
export const CASES: CathCase[] = [
  { id: "normal", title: "Normal coronaries", blurb: "Smooth vessels, TIMI 3 flow, FFR above 0.9.", scenario: {}, view: { injection: "both", rot: 30, tilt: -20 }, artery: "LAD" },
  { id: "lad50", title: "Mid-LAD 50%", blurb: "A moderate stenosis that is not flow-limiting: a pullback shows a small gradient.", scenario: { lesions: [{ artery: "LAD", stenosis: 0.5, position: 0.5 }] }, view: { injection: "left", rot: -30, tilt: 25 }, artery: "LAD" },
  { id: "lad75", title: "Mid-LAD 75%, on exertion", blurb: "An intermediate-to-severe stenosis: TIMI 3 flow at rest, but the pullback drops across the lesion.", scenario: { lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.5 }], exertion: true }, view: { injection: "left", rot: -30, tilt: 25 }, artery: "LAD" },
  { id: "ladocc", title: "Proximal LAD occlusion", blurb: "Anterior STEMI: the dye stops at the clot (TIMI 0) and nothing downstream fills.", scenario: { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] }, view: { injection: "left", rot: 30, tilt: 30 }, artery: "LAD" },
  { id: "rcaocc", title: "Proximal RCA occlusion", blurb: "Inferior STEMI: a right coronary injection shows the vessel cut off.", scenario: { lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] }, view: { injection: "right", rot: 30, tilt: 0 }, artery: "RCA" },
  { id: "lcxocc", title: "Circumflex occlusion", blurb: "Lateral infarct, often with a quiet ECG: the circumflex fills late or not at all.", scenario: { lesions: [{ artery: "LCX", occluded: true, position: 0.2 }] }, view: { injection: "left", rot: 30, tilt: -20 }, artery: "LCX" },
  { id: "lm90", title: "Left main 90%", blurb: "A critical left main: both left-sided vessels fill slowly (TIMI 1 to 2) and the pullback falls through the lesion.", scenario: { lesions: [{ artery: "LM", stenosis: 0.9, position: 0.5 }] }, view: { injection: "left", rot: 30, tilt: -20 }, artery: "LM" },
];
export const CASE_BY_ID: Record<string, CathCase> = Object.fromEntries(CASES.map((c) => [c.id, c]));
