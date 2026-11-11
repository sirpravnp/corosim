/**
 * The views the simulator teaches, transthoracic and transesophageal. Each says how to get the view and what it shows. Transthoracic
 * views are probe poses on the chest (src/echo/poses.ts); transesophageal views are settings of the esophageal probe's controls
 * (src/echo/tee.ts). Probe placement and the index mark follow the usual teaching conventions (marker toward the right shoulder in the
 * parasternal long axis, the left shoulder in the short axis, the patient's left in the apical four-chamber and subcostal views); they
 * vary a little between labs, so treat them as the common default, not a rule.
 */
export type Window = "Parasternal" | "Apical" | "Subcostal" | "Suprasternal" | "Mid-esophageal" | "Transgastric";
export type Approach = "tte" | "tee";

export interface ViewDef {
  id: string;
  name: string;
  short: string;
  window: Window;
  approach: Approach;
  /** Key into the pose table (TTE: buildPoses; TEE: teeViews). */
  pose: string;
  placement: string;
  marker: string;
  shows: string[];
  lookFor: string;
}

const tte = (v: Omit<ViewDef, "approach">): ViewDef => ({ ...v, approach: "tte" });
const tee = (v: Omit<ViewDef, "approach">): ViewDef => ({ ...v, approach: "tee" });

export const VIEWS: ViewDef[] = [
  tte({ id: "plax", name: "Parasternal long axis", short: "PLAX", window: "Parasternal", pose: "plax",
    placement: "Left sternal border, 3rd or 4th intercostal space; patient on the left side.",
    marker: "Toward the right shoulder (about 10 o'clock).",
    shows: ["Right ventricular outflow", "Septum", "Left ventricle", "LV outflow tract", "Aortic valve and root", "Mitral valve", "Left atrium", "Descending aorta behind the atrium"],
    lookFor: "The aortic valve opening in the middle, the mitral leaflets opening into the LV, and the septum and posterior wall thickening evenly. The M-mode line goes here." }),
  tte({ id: "rv-inflow", name: "Right ventricular inflow", short: "RV inflow", window: "Parasternal", pose: "rvInflow",
    placement: "From the long axis, tilt the beam toward the right hip.",
    marker: "Toward the right shoulder.",
    shows: ["Right atrium", "Tricuspid valve", "Right ventricle"],
    lookFor: "The tricuspid leaflets and the RV filling from the RA; the line for tricuspid regurgitation by CW Doppler." }),
  tte({ id: "psax-av", name: "Parasternal short axis, aortic valve", short: "PSAX AV", window: "Parasternal", pose: "psaxAV",
    placement: "From the long axis, rotate the probe 90 degrees clockwise and tilt up toward the right shoulder.",
    marker: "Toward the left shoulder (about 2 o'clock).",
    shows: ["Aortic valve (three cusps)", "Right atrium", "Tricuspid valve", "RV outflow tract", "Pulmonary valve", "Left atrium"],
    lookFor: "The three cusps meeting in a Y when closed (the 'Mercedes' sign) and opening to a triangle; the RV outflow wrapping around in front." }),
  tte({ id: "psax-mv", name: "Parasternal short axis, mitral valve", short: "PSAX MV", window: "Parasternal", pose: "psaxMV",
    placement: "From the aortic level, tilt toward the apex.",
    marker: "About 2 o'clock.",
    shows: ["Mitral leaflets (the 'fish mouth')", "Basal LV segments", "Right ventricle"],
    lookFor: "The mitral orifice opening wide in diastole; narrow and thick in mitral stenosis." }),
  tte({ id: "psax-pm", name: "Parasternal short axis, papillary muscles", short: "PSAX PM", window: "Parasternal", pose: "psaxPM",
    placement: "From the mitral level, tilt further toward the apex.",
    marker: "About 2 o'clock.",
    shows: ["Anterolateral papillary muscle", "Posteromedial papillary muscle", "LV walls (mid segments)", "Right ventricle"],
    lookFor: "Two papillary muscles, and every mid segment thickening: the view for global and regional LV function." }),
  tte({ id: "psax-apex", name: "Parasternal short axis, apex", short: "PSAX apex", window: "Parasternal", pose: "psaxApex",
    placement: "From the papillary level, slide down an interspace and tilt toward the apex.",
    marker: "About 2 o'clock.",
    shows: ["Apical LV segments", "A sliver of right ventricle"],
    lookFor: "The apical segments, the ones an anterior (LAD) infarct takes first." }),
  tte({ id: "a4c", name: "Apical four-chamber", short: "A4C", window: "Apical", pose: "a4c",
    placement: "At the apex beat, beam aimed at the right shoulder; patient on the left side.",
    marker: "Toward the patient's left (3 o'clock).",
    shows: ["Left and right ventricles", "Left and right atria", "Mitral and tricuspid valves", "Interventricular and interatrial septa"],
    lookFor: "Chamber sizes side by side and both inflows: mitral inflow and tissue Doppler here, and Simpson's EF with the two-chamber view." }),
  tte({ id: "a5c", name: "Apical five-chamber", short: "A5C", window: "Apical", pose: "a5c",
    placement: "From the four-chamber view, tilt the beam up (anteriorly).",
    marker: "Toward the patient's left.",
    shows: ["The four chambers", "LV outflow tract", "Aortic valve"],
    lookFor: "The LV outflow and the aortic valve: PW in the outflow tract, CW through the valve." }),
  tte({ id: "a2c", name: "Apical two-chamber", short: "A2C", window: "Apical", pose: "a2c",
    placement: "From the four-chamber view, rotate the probe about 60 degrees counterclockwise.",
    marker: "Toward the left side of the neck (about 1 o'clock).",
    shows: ["Left ventricle (anterior and inferior walls)", "Mitral valve", "Left atrium and appendage"],
    lookFor: "The anterior and inferior walls; the second plane for Simpson's biplane EF." }),
  tte({ id: "a3c", name: "Apical three-chamber", short: "A3C", window: "Apical", pose: "a3c",
    placement: "From the two-chamber view, rotate a further 60 degrees counterclockwise.",
    marker: "Toward the right shoulder (about 11 o'clock).",
    shows: ["Left ventricle (anteroseptal and inferolateral walls)", "Mitral valve", "LV outflow and aortic valve", "Left atrium"],
    lookFor: "The long axis seen from the apex: the anteroseptal and inferolateral walls." }),
  tte({ id: "subcostal", name: "Subcostal four-chamber", short: "Subcostal", window: "Subcostal", pose: "subcostal",
    placement: "Just below the xiphoid, patient supine with knees bent; beam aimed up and to the left through the liver.",
    marker: "Toward the patient's left (3 o'clock).",
    shows: ["Liver (near field)", "All four chambers", "Interatrial septum", "Pericardium"],
    lookFor: "The interatrial septum nearly at right angles to the beam (the view for a septal defect) and fluid around the heart." }),
  tte({ id: "ivc", name: "Subcostal inferior vena cava", short: "IVC", window: "Subcostal", pose: "ivc",
    placement: "From the subcostal four-chamber view, rotate 90 degrees counterclockwise into a sagittal plane.",
    marker: "Toward the head (12 o'clock).",
    shows: ["Inferior vena cava entering the right atrium", "Liver"],
    lookFor: "The IVC's size and how it changes with breathing (a guide to right atrial pressure)." }),
  tte({ id: "suprasternal", name: "Suprasternal long axis", short: "Suprasternal", window: "Suprasternal", pose: "suprasternal",
    placement: "In the suprasternal notch, neck extended, beam down toward the left.",
    marker: "Toward the left side of the neck.",
    shows: ["Aortic arch", "Start of the descending aorta", "Right pulmonary artery under the arch", "Left atrium"],
    lookFor: "The arch and the descending aorta: coarctation, and the aortic flow aligned for CW." }),
  tee({ id: "me4c", name: "Mid-esophageal four-chamber", short: "ME 4C", window: "Mid-esophageal", pose: "me4c",
    placement: "Probe behind the left atrium at the level of the mitral valve, a little retroflexed.",
    marker: "Omniplane about 0 to 20 degrees.",
    shows: ["Left atrium (near the probe)", "All four chambers", "Mitral and tricuspid valves"],
    lookFor: "The atria close to the probe and the ventricles below: mitral valve function, septal defects." }),
  tee({ id: "me2c", name: "Mid-esophageal two-chamber", short: "ME 2C", window: "Mid-esophageal", pose: "me2c",
    placement: "From the four-chamber view, rotate the omniplane forward.",
    marker: "Omniplane about 80 to 100 degrees.",
    shows: ["Left atrium and appendage", "Left ventricle", "Mitral valve"],
    lookFor: "The appendage (where thrombus forms) and the anterior and inferior LV walls." }),
  tee({ id: "me-lax", name: "Mid-esophageal long axis", short: "ME LAX", window: "Mid-esophageal", pose: "meLax",
    placement: "From the two-chamber view, rotate the omniplane further.",
    marker: "Omniplane about 120 to 160 degrees.",
    shows: ["Left atrium", "Mitral valve", "LV outflow", "Aortic valve and root", "Left ventricle"],
    lookFor: "The mitral and aortic valves in one plane: the transesophageal long axis." }),
  tee({ id: "me-av-sax", name: "Mid-esophageal aortic valve short axis", short: "ME AV SAX", window: "Mid-esophageal", pose: "meAvSax",
    placement: "Withdraw slightly to the aortic valve, anteflex a little.",
    marker: "Omniplane about 30 to 60 degrees.",
    shows: ["Aortic valve (three cusps)", "Left and right atria", "Interatrial septum", "RV outflow"],
    lookFor: "The cusps' number and opening (bicuspid valve, stenosis), and the interatrial septum." }),
  tee({ id: "me-av-lax", name: "Mid-esophageal aortic valve long axis", short: "ME AV LAX", window: "Mid-esophageal", pose: "meAvLax",
    placement: "At the aortic valve level, rotate the omniplane forward.",
    marker: "Omniplane about 120 to 160 degrees.",
    shows: ["LV outflow", "Aortic valve", "Aortic root and ascending aorta"],
    lookFor: "The root and the outflow tract; the place to measure the aortic annulus." }),
  tee({ id: "me-rv-io", name: "Mid-esophageal RV inflow-outflow", short: "ME RV in-out", window: "Mid-esophageal", pose: "meRvIo",
    placement: "From the aortic valve short axis, rotate the omniplane forward.",
    marker: "Omniplane about 60 to 90 degrees.",
    shows: ["Right atrium", "Tricuspid valve", "Right ventricle", "Pulmonary valve"],
    lookFor: "The right heart wrapped around the aortic valve: tricuspid and pulmonary valves in one plane." }),
  tee({ id: "me-bicaval", name: "Mid-esophageal bicaval", short: "ME bicaval", window: "Mid-esophageal", pose: "meBicaval",
    placement: "Turn the probe to the patient's right.",
    marker: "Omniplane about 80 to 110 degrees.",
    shows: ["Superior and inferior venae cavae", "Right atrium", "Interatrial septum", "Left atrium"],
    lookFor: "Both cavae entering the right atrium and the whole interatrial septum: the view for defects and for guiding a closure." }),
  tee({ id: "tg-sax", name: "Transgastric mid short axis", short: "TG SAX", window: "Transgastric", pose: "tgMidSax",
    placement: "Advance into the stomach and anteflex, looking up through the inferior wall.",
    marker: "Omniplane about 0 to 20 degrees.",
    shows: ["LV short axis at the papillary level", "Both papillary muscles", "Right ventricle"],
    lookFor: "Segments supplied by all three coronary arteries in one picture: the monitoring view in the operating room." }),
  tee({ id: "tg-2c", name: "Transgastric two-chamber", short: "TG 2C", window: "Transgastric", pose: "tg2c",
    placement: "From the transgastric short axis, rotate the omniplane forward.",
    marker: "Omniplane about 80 to 100 degrees.",
    shows: ["Left ventricle", "Mitral valve and chords", "Left atrium"],
    lookFor: "The mitral subvalvular apparatus and the inferior and anterior walls." }),
  tee({ id: "deep-tg", name: "Deep transgastric long axis", short: "Deep TG", window: "Transgastric", pose: "deepTgLax",
    placement: "Advance further and anteflex strongly, looking up at the base from below the apex.",
    marker: "Omniplane about 0 to 20 degrees.",
    shows: ["Left ventricle", "LV outflow", "Aortic valve"],
    lookFor: "The aortic flow nearly parallel to the beam: the transesophageal window for aortic valve Doppler." }),
  tee({ id: "desc-aorta", name: "Descending aorta short axis", short: "Desc aorta", window: "Mid-esophageal", pose: "descAortaSax",
    placement: "Turn the probe back and to the left, toward the spine.",
    marker: "Omniplane 0 degrees.",
    shows: ["Descending thoracic aorta (a circle close to the probe)"],
    lookFor: "The aortic wall: atheroma, dissection." }),
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
