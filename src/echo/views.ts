/**
 * The transthoracic views the atlas covers: those with both a probe pose on the 3D heart and a clean open-licensed echo loop. Each has how to get
 * the view and what it shows.
 * Probe placement and orientation are the usual teaching conventions (marker toward the right shoulder in parasternal long axis, the left
 * shoulder in short axis, the patient's left in the subcostal view); they vary a little between labs, so treat them as the common default, not a rule.
 */
export type Window = "Parasternal" | "Subcostal";

export interface ViewDef {
  id: string;
  name: string;
  short: string;
  window: Window;
  /** Key into the pose table (src/echo/poses.ts). */
  pose: string;
  placement: string;
  marker: string;
  shows: string[];
  lookFor: string;
}

export const VIEWS: ViewDef[] = [
  { id: "plax", name: "Parasternal long axis", short: "PLAX", window: "Parasternal", pose: "plax",
    placement: "Left sternal border, 3rd or 4th intercostal space; patient on the left side.",
    marker: "Toward the right shoulder (about 10 o'clock).",
    shows: ["Right ventricular outflow", "Septum", "Left ventricle", "LV outflow tract", "Aortic valve and root", "Mitral valve (anterior and posterior leaflets)", "Left atrium", "Descending aorta behind the atrium"],
    lookFor: "The aortic valve opening and closing in the centre, the mitral leaflets opening into the LV, and the septum and posterior wall thickening evenly." },
  { id: "psax-pm", name: "Parasternal short axis, papillary muscles", short: "PSAX PM", window: "Parasternal", pose: "psaxPM",
    placement: "From the mitral level, tilt further toward the apex.",
    marker: "About 2 o'clock.",
    shows: ["Anterolateral papillary muscle", "Posteromedial papillary muscle", "LV walls (mid-cavity segments)", "Right ventricle"],
    lookFor: "Two papillary muscles at roughly 4 and 8 o'clock, and the mid-cavity wall segments: the view for global and regional LV function." },
  { id: "subcostal", name: "Subcostal four-chamber", short: "Subcostal", window: "Subcostal", pose: "subcostal",
    placement: "Just below the xiphoid, patient supine with knees bent; beam aimed up and to the left through the liver.",
    marker: "Toward the patient's left (3 o'clock).",
    shows: ["Liver (near field)", "Right atrium and ventricle", "Left atrium and ventricle", "Interatrial septum", "Mitral and tricuspid valves"],
    lookFor: "All four chambers seen from below, with the interatrial septum nearly at right angles to the beam: a good view for atrial septal defects, and the usual one when lungs block the other windows." },
];

import type { CleanSpec } from "./cleanVideo";

export interface RefImage {
  view: string;
  kind: "image" | "video";
  file: string;
  width: number;
  height: number;
  alt: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
  /** What this is and how it falls short, shown under the image. */
  note: string;
  /** For a loop: how to crop it to the ultrasound picture alone. */
  clean?: CleanSpec;
}

export const IMAGES: RefImage[] = [
  { view: "plax", kind: "video", file: "plax.webm", width: 445, height: 370,
    alt: "Parasternal long-axis echocardiogram loop of a normal heart",
    author: "I.A.C. van der Bilt, Dept. of Echocardiography, AMC (CardioNetworks ECHOpedia)", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm",
    note: "A short loop of a normal heart. The ECG, text, depth scale and watermark of the source are masked out; the ultrasound is unchanged. Share-alike.",
    clean: { crop: [110, 10, 445, 370], apex: [328, 12], half: [42, 37], radius: 365 } },
  { view: "psax-pm", kind: "video", file: "psax-pm.webm", width: 445, height: 370,
    alt: "Parasternal short-axis echocardiogram loop through the left ventricle at the papillary-muscle level",
    author: "I.A.C. van der Bilt, Dept. of Echocardiography, AMC (CardioNetworks ECHOpedia)", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm",
    note: "A short loop of a short axis through the left ventricle at the papillary-muscle level. The ECG, text, depth scale and watermark of the source are masked out; the ultrasound is unchanged. Share-alike.",
    clean: { crop: [110, 10, 445, 370], apex: [328, 12], half: [42, 37], radius: 365 } },
  { view: "subcostal", kind: "video", file: "subcostal.webm", width: 330, height: 375,
    alt: "Subcostal echocardiogram loop of a normal heart",
    author: "I.A.C. van der Bilt, Dept. of Echocardiography, AMC (CardioNetworks ECHOpedia)", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm",
    note: "A short loop of a normal heart. The ECG, text, depth scale and watermark of the source are masked out; the ultrasound is unchanged. Share-alike.",
    clean: { crop: [170, 10, 330, 375], apex: [328, 12], half: [33, 33], radius: 365 } },
];

export const imageFor = (id: string) => IMAGES.find((i) => i.view === id);
