import { defaultUnifiedGraph } from "./access";
import type { LesionSlider, Plaque } from "./types";
import type { Scenario } from "../sim/scenario";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Soft plaque defaults matching `src/cath/lab/cases.ts`. */
const softDefaults = {
  referenceMm: 3,
  eccentric: 0.15,
  eccentricAngleDeg: 0,
  calcium: 0.1,
  lipid: 0.4,
  thrombus: 0,
  remodel: "none" as const,
  stents: [] as Plaque["stents"],
};

const CHOICES: { segId: string; label: string; parent: string | null }[] = [
  { segId: "LM", label: "Left main", parent: null },
  { segId: "LAD", label: "LAD", parent: "LM" },
  { segId: "D1", label: "Diagonal 1", parent: "LAD" },
  { segId: "LCX", label: "Circumflex", parent: "LM" },
  { segId: "OM1", label: "OM1", parent: "LCX" },
  { segId: "OM2", label: "OM2", parent: "LCX" },
  { segId: "RCA", label: "RCA", parent: null },
  { segId: "PDA_R", label: "PDA", parent: "RCA" },
  { segId: "PLV_R", label: "PLB", parent: "RCA" },
];

const segLen = (segId: string): number => {
  const s = defaultUnifiedGraph().byId[segId];
  if (!s) throw new Error(`Unknown coronary segment ${segId}`);
  return s.length;
};

/** Coronary segments the Set up step can place a lesion on. */
export function segmentChoices(): { segId: string; label: string; lengthMm: number; parent: string | null }[] {
  return CHOICES.map((c) => ({ ...c, lengthMm: segLen(c.segId) }));
}

/** Clamp a slider onto its segment and turn it into a soft plaque. */
export function sliderToPlaque(s: LesionSlider): Plaque {
  const length = segLen(s.segId);
  const ds = clamp(s.ds, 0, 1);
  let lengthMm = clamp(s.lengthMm, 0, length);
  let centerMm = clamp(s.centerMm, 0, length);
  // Keep the whole lesion on the segment.
  if (centerMm - lengthMm / 2 < 0) centerMm = lengthMm / 2;
  if (centerMm + lengthMm / 2 > length) {
    lengthMm = Math.min(lengthMm, 2 * Math.min(centerMm, length - centerMm));
    centerMm = clamp(centerMm, lengthMm / 2, length - lengthMm / 2);
  }
  return {
    segId: s.segId,
    centerMm,
    lengthMm,
    ds,
    ...softDefaults,
    stents: [],
  };
}

/** Plaques to a Scenario the main simulator understands. Zero-ds plaques drop out. */
export function plaquesToScenario(p: Plaque[], exertion: boolean): Scenario {
  const lesions = p
    .filter((x) => x.ds > 0)
    .map((x) => {
      const len = segLen(x.segId);
      const position = len > 0 ? clamp(x.centerMm / len, 0, 1) : 0;
      if (x.ds >= 1) return { artery: x.segId, occluded: true as const, position };
      return { artery: x.segId, stenosis: x.ds, position };
    });
  return { lesions, exertion };
}

const preset = (
  id: string, title: string, blurb: string, exertion: boolean,
  lesions: { segId: string; position: number; ds: number; occluded?: boolean }[],
): { id: string; title: string; blurb: string; lesions: LesionSlider[]; exertion: boolean } => ({
  id, title, blurb, exertion,
  lesions: lesions.map((l) => {
    const length = segLen(l.segId);
    return {
      segId: l.segId,
      centerMm: l.position * length,
      lengthMm: Math.min(16, length),
      ds: l.occluded ? 1 : l.ds,
    };
  }),
});

/** The seven old diagnostic cath cases, as lesion sliders. */
export const OLD_PRESETS = [
  preset("normal", "Normal coronaries", "Smooth vessels, TIMI 3 flow, FFR above 0.9.", false, []),
  preset("lad50", "Mid-LAD 50%", "A moderate stenosis that is not flow-limiting: a pullback shows a small gradient.", false, [
    { segId: "LAD", position: 0.5, ds: 0.5 },
  ]),
  preset("lad75", "Mid-LAD 75%, on exertion", "An intermediate-to-severe stenosis: TIMI 3 flow at rest, but the pullback drops across the lesion.", true, [
    { segId: "LAD", position: 0.5, ds: 0.75 },
  ]),
  preset("ladocc", "Proximal LAD occlusion", "Anterior STEMI: the dye stops at the clot (TIMI 0) and nothing downstream fills.", false, [
    { segId: "LAD", position: 0.2, ds: 1, occluded: true },
  ]),
  preset("rcaocc", "Proximal RCA occlusion", "Inferior STEMI: a right coronary injection shows the vessel cut off.", false, [
    { segId: "RCA", position: 0.25, ds: 1, occluded: true },
  ]),
  preset("lcxocc", "Circumflex occlusion", "Lateral infarct, often with a quiet ECG: the circumflex fills late or not at all.", false, [
    { segId: "LCX", position: 0.2, ds: 1, occluded: true },
  ]),
  preset("lm90", "Left main 90%", "A critical left main: both left-sided vessels fill slowly (TIMI 1 to 2) and the pullback falls through the lesion.", false, [
    { segId: "LM", position: 0.5, ds: 0.9 },
  ]),
];
