import type { StructuralSpec } from "../physics/structural";
import { LESION_BY_ID, defaults } from "../sim/structural";
import type { HeartOptions } from "./tissue";
import { TERRITORY } from "./motion";

/**
 * Echo patients. Each is a structural-engine patient (the spec the structural page and the simulator use, so the volumes, EF and valve
 * flows come from the same heart model) plus what the engine does not model but an echo shows: wall thickness, regional wall motion,
 * scar, leaflet thickening and calcium, pericardial fluid. The engine has no chronic remodeling, so where a lesion's echo picture depends on
 * years of it (a big left atrium in mitral stenosis, a thick wall in aortic stenosis) the case sets it and says so in `note`.
 */
export interface EchoCase {
  id: string;
  title: string;
  /** One-line summary for the case list. */
  blurb: string;
  /** What to look for, in each view where it shows. */
  findings: string[];
  /** What the case sets by hand rather than taking from the engine. */
  note?: string;
  spec: StructuralSpec;
  look: Omit<HeartOptions, "morph" | "lvScale">;
}

const L = (id: string, v: Record<string, number> = {}): StructuralSpec => {
  const l = LESION_BY_ID[id]!;
  return l.build({ ...defaults(l), ...v });
};
/** A 17-entry contraction pattern: 1 everywhere, `k` in the listed segments. */
const wma = (segs: number[], k: number, base: number[] = new Array(17).fill(1)) => base.map((v, i) => (segs.includes(i) ? k : v));

export const CASES: EchoCase[] = [
  { id: "normal", title: "Normal heart", blurb: "Resting adult, EF about 60 percent.",
    findings: ["All walls thicken evenly in systole.", "The mitral leaflets open twice per beat: the E wave, then the atrial kick.", "Thin aortic cusps open fully against the root."],
    spec: {}, look: {} },
  { id: "dcm", title: "Dilated cardiomyopathy", blurb: "Big, round, weakly beating left ventricle; EF under 30 percent.",
    findings: ["The LV is dilated and more spherical (PLAX and apical views).", "Every segment moves a little: global, not regional, hypokinesis.", "The mitral leaflets open only partly in a low-output ventricle, and close short of each other (functional regurgitation)."],
    spec: { lvEes: 0.3, lvSize: 1.7, valves: { mv: { reg: 0.08 } } }, look: { lvWall: 8, septum: 8, valves: { mv: { gap: 6 } } } },
  { id: "ant-mi", title: "Anterior infarct (LAD)", blurb: "The anterior wall, anterior septum and apex do not move.",
    findings: ["Akinetic anterior septum and apex in the apical four-chamber and two-chamber views.", "The apex bulges slightly outward in systole (dyskinesis).", "The inferior and lateral walls move normally and make up the rest of the stroke."],
    note: "Wall motion is set by hand on the LAD territory; the engine supplies the global contractility.",
    spec: { lvEes: 0.45 }, look: { wma: wma([16], -0.25, wma(TERRITORY.LAD, 0)) } },
  { id: "old-ant-mi", title: "Old anterior infarct with scar", blurb: "Thin, bright, akinetic anterior wall and apex after a healed infarct.",
    findings: ["The scarred segments are thin (under 6 mm) and brighter than living muscle.", "They do not thicken in systole.", "The left ventricle has remodeled: larger, with a lower EF."],
    note: "Scar and wall motion are set by hand on the LAD territory.",
    spec: { lvEes: 0.4, lvSize: 1.3 }, look: { wma: wma([16], -0.3, wma(TERRITORY.LAD, 0)), scar: wma(TERRITORY.LAD, 1, new Array(17).fill(0)) } },
  { id: "inf-mi", title: "Inferior infarct (RCA)", blurb: "The inferior wall and inferior septum do not move.",
    findings: ["Akinetic inferior wall in the apical two-chamber view and the short axis (bottom of the ring).", "PLAX shows the inferolateral wall, which still moves: look for the inferior wall in the short axis and the apical two-chamber view."],
    note: "Wall motion is set by hand on the RCA territory.",
    spec: { lvEes: 0.75 }, look: { wma: wma(TERRITORY.RCA, 0.05) } },
  { id: "hcm", title: "Hypertrophic cardiomyopathy", blurb: "Asymmetric septal hypertrophy, small hyperdynamic cavity.",
    findings: ["Septum about 22 mm against a 12 mm posterior wall (PLAX).", "The cavity nearly closes at end-systole: EF above 70 percent.", "A stiff ventricle: the left atrium is a little large."],
    spec: { lvStiffness: 2.2, lvSize: 0.75, lvEes: 1.4 }, look: { lvWall: 12, septum: 22 } },
  { id: "lvh", title: "Hypertensive heart", blurb: "Concentric left ventricular hypertrophy with normal EF.",
    findings: ["Walls about 14 mm all round (PLAX, short axis).", "Normal EF; a stiff ventricle that fills late."],
    spec: { lvStiffness: 1.7, svrScale: 1.3 }, look: { lvWall: 14, septum: 14 } },
  { id: "as", title: "Calcific aortic stenosis", blurb: "Thick, bright, barely opening aortic cusps.",
    findings: ["The cusps are bright with calcium and shadow the left atrium behind them (PLAX, short axis at the aortic valve).", "They open only a few millimeters in systole.", "The left ventricle is concentrically thickened."],
    note: "Wall thickening is set by hand: the engine has no years of pressure load.",
    spec: { ...L("as"), lvStiffness: 1.5 }, look: { lvWall: 13, septum: 14, valves: { av: { thick: 6, calcium: 1, openMax: 0.3 } } } },
  { id: "ms", title: "Rheumatic mitral stenosis", blurb: "Thick mitral leaflets with a narrow opening and a big left atrium.",
    findings: ["The leaflets are thick at the tips and barely separate in diastole (PLAX, apical four-chamber).", "Fish-mouth opening in the short axis at the mitral level.", "A large left atrium; a normal-sized left ventricle."],
    note: "The atrial enlargement is set by hand (`laSize`): the engine has no years of pressure load.",
    spec: { ...L("ms"), laSize: 1.9 }, look: { valves: { mv: { thick: 4.5, openMax: 0.3, calcium: 0.2 } } } },
  { id: "mr", title: "Severe mitral regurgitation", blurb: "Leaflets that do not meet, a big left atrium and a hyperdynamic left ventricle.",
    findings: ["The mitral leaflets close short of each other: a coaptation gap.", "Left atrium and left ventricle enlarged by the volume load.", "Vigorous wall motion; EF overstates forward function."],
    note: "Chamber enlargement is set by hand (`lvSize`, `laSize`); color Doppler is not simulated, so the jet itself is not shown.",
    spec: { ...L("mr", { severity: 0.7 }), lvSize: 1.3, laSize: 1.8 }, look: { valves: { mv: { gap: 14 } } } },
  { id: "effusion", title: "Large pericardial effusion", blurb: "An echo-free band of fluid all round the heart.",
    findings: ["Black fluid between the epicardium and the bright pericardium, front and back.", "In the parasternal long axis it sits in front of the descending aorta (pleural fluid sits behind it).", "The heart swings within the fluid."],
    note: "The fluid is set by hand; chamber collapse in tamponade is not drawn.",
    spec: { hr: 96 }, look: { effusion: 16 } },
  { id: "rv-overload", title: "Right ventricular pressure overload", blurb: "Dilated, thick-walled right ventricle from high pulmonary resistance.",
    findings: ["The RV is as large as the LV in the apical four-chamber view.", "Its free wall is thick and moves less.", "The left ventricle is small and underfilled."],
    note: "RV wall thickness is set by hand.",
    spec: { pvri: 14, rvContractility: 1.2 }, look: { rvWall: 6.5 } },
  { id: "asd", title: "Atrial septal defect", blurb: "A gap in the middle of the interatrial septum; the right heart is large.",
    findings: ["A gap in the interatrial septum, seen best in the subcostal view where the septum lies across the beam.", "In the apical four-chamber view the thin septum lies along the beam and can drop out without a defect: check subcostal.", "Right atrium and ventricle enlarged by the shunt."],
    spec: L("asd", { diameter: 18 }), look: { asdMm: 18 } },
];

/** By id, with no prototype keys. */
export const CASE_BY_ID: Record<string, EchoCase | undefined> = Object.assign(Object.create(null), Object.fromEntries(CASES.map((c) => [c.id, c])));
