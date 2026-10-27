import { LeadName, Vec3 } from "../config/ecg";
import type { LesionSpec, Scenario } from "../sim/scenario";
import { EkgSpec, VM } from "./engine";

/**
 * The EKG page's library: common rhythms, blocks, ischemia and the patterns that imitate it. Each preset is a rhythm
 * and a morphology for the shared dipole engine; the acute coronary ones take their ST vector from the coronary model
 * itself (a real lesion in the simulator's tree), so they are the same tracings the simulator draws. Teaching text is
 * for learning to read tracings, not for clinical decisions.
 *
 * Data only (no Simulation import), so the simulator's rhythm source can read it without an import cycle; the functions that
 * build a coronary Simulation for a preset are in presets.ts, which re-exports everything here.
 */
export type Category =
  | "Sinus" | "Atrial" | "Junctional & re-entry" | "AV block" | "Bundle branch & fascicular" | "Ventricular"
  | "Ischemia & infarction" | "STEMI mimics" | "Electrolytes, drugs & other";
export const CATEGORIES: Category[] = [
  "Sinus", "Atrial", "Junctional & re-entry", "AV block", "Bundle branch & fascicular", "Ventricular",
  "Ischemia & infarction", "STEMI mimics", "Electrolytes, drugs & other",
];

export interface EkgPreset {
  id: string;
  name: string;
  category: Category;
  spec: EkgSpec;
  /** ST from the coronary model: these lesions, settled, scaled; `morph` adds anything the model does not make. */
  coronary?: { scenario: Scenario; scale?: number };
  summary: string;
  features: string[]; // what to look for on the tracing
  pearls: string[]; // teaching points
  mimics?: string[]; // what else looks like this
  next?: string; // what usually happens next (educational)
  leads?: LeadName[]; // leads worth looking at first
}

const sinus = (rate = 75, extra: Partial<Extract<EkgSpec["rhythm"], { kind: "sinus" }>> = {}): EkgSpec["rhythm"] => ({ kind: "sinus", rate, ...extra });
const occlude = (artery: string, position = 0.15): LesionSpec => ({ artery, occluded: true, position });
const v = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const PRESETS: EkgPreset[] = [
  // ------------------------------------------------------------------ sinus
  {
    id: "nsr", name: "Normal sinus rhythm", category: "Sinus", spec: { rhythm: sinus(72) },
    summary: "Sinus rhythm at 72 with normal intervals and axis.",
    features: ["A P wave before every QRS, upright in I and II, inverted in aVR", "PR 120–200 ms, QRS under 120 ms, QTc under 450–460 ms", "Axis between −30° and +90°; R waves grow from V1 to V5"],
    pearls: ["Read every tracing in the same order: rate, rhythm, axis, intervals, morphology (P, QRS, ST, T), then compare with an old one.", "Use the 3D view: a lead records an upright deflection when the heart's vector points toward its positive pole."],
  },
  {
    id: "sinus-brady", name: "Sinus bradycardia", category: "Sinus", spec: { rhythm: sinus(46) },
    summary: "Sinus rhythm under 50–60 bpm.",
    features: ["Normal P–QRS–T, every P conducts", "Rate under 60 (often under 50 by newer definitions)", "Long TP segment between beats"],
    pearls: ["Normal in athletes and during sleep; also beta blockers, hypothyroidism, hypothermia, raised intracranial pressure and inferior MI (vagal reflex).", "Treat the patient, not the number: symptoms and perfusion decide."],
    next: "If unstable: atropine, then pacing or a chronotrope.",
  },
  {
    id: "sinus-tachy", name: "Sinus tachycardia", category: "Sinus", spec: { rhythm: sinus(122) },
    summary: "Sinus rhythm over 100 bpm.",
    features: ["Upright P in II before every QRS", "Rate usually under 220 − age", "P may merge with the preceding T at high rates"],
    pearls: ["Almost always a response to something: pain, fever, hypovolemia, hypoxia, PE, sepsis, anemia, thyrotoxicosis.", "Look for the cause rather than slowing the rate."],
    mimics: ["Atrial flutter with 2:1 block (rate fixed near 150)", "Atrial tachycardia"],
  },
  {
    id: "sinus-arrhythmia", name: "Sinus arrhythmia", category: "Sinus", spec: { rhythm: sinus(68, { resp: 0.18, hrv: 0.01 }) },
    summary: "Sinus rhythm whose rate rises with inspiration and falls with expiration.",
    features: ["Identical P waves and constant PR", "R–R interval varies cyclically, with breathing", "Gradual speeding and slowing, no premature beats"],
    pearls: ["Respiratory sinus arrhythmia is vagal and healthy, most obvious in the young.", "The simulator's autonomic model produces the same thing from breathing-gated vagal tone."],
  },

  // ------------------------------------------------------------------ atrial
  {
    id: "af", name: "Atrial fibrillation (rate controlled)", category: "Atrial", spec: { rhythm: { kind: "af", rate: 82 } },
    summary: "No organized atrial activity; irregularly irregular ventricular response.",
    features: ["No P waves; fine fibrillatory baseline (best in V1 and II)", "Irregularly irregular R–R intervals", "Narrow QRS unless there is a bundle branch block"],
    pearls: ["Loss of atrial kick costs 15–25% of filling, more in a stiff ventricle.", "Stroke risk (CHA₂DS₂-VASc) drives anticoagulation whatever the rhythm strategy."],
    mimics: ["Multifocal atrial tachycardia (P waves present, varying shape)", "Flutter with variable block"],
  },
  {
    id: "af-rvr", name: "Atrial fibrillation with rapid ventricular response", category: "Atrial", spec: { rhythm: { kind: "af", rate: 148, irregularity: 0.3, fMv: 0.05 } },
    summary: "Atrial fibrillation with a fast, irregular ventricular rate.",
    features: ["Irregularly irregular, rate over 110", "No P waves", "Rate-related ST depression is common and not specific"],
    pearls: ["At high rates the irregularity is harder to see: march out the R–R intervals.", "Unstable patient: synchronized cardioversion. Stable: rate control and look for a trigger."],
  },
  {
    id: "flutter-21", name: "Atrial flutter with 2:1 block", category: "Atrial", spec: { rhythm: { kind: "flutter", ratio: 2 } },
    summary: "Atrial macro-reentry at 300/min, every second wave conducted: ventricular rate 150.",
    features: ["Regular narrow-complex tachycardia at about 150", "Sawtooth F waves, negative in II, III, aVF; discrete positive waves in V1", "One F wave is often hidden in the QRS or T"],
    pearls: ["Any regular narrow tachycardia at 150 is flutter until proven otherwise.", "Vagal manoeuvres or adenosine slow the AV node and unmask the sawtooth; they do not stop flutter."],
    mimics: ["Sinus tachycardia", "AVNRT"],
    leads: ["II", "III", "aVF", "V1"],
  },
  {
    id: "flutter-var", name: "Atrial flutter with variable block", category: "Atrial", spec: { rhythm: { kind: "flutter", ratio: "variable" } },
    summary: "Flutter waves at 300/min with 2:1 to 4:1 conduction.",
    features: ["Continuous sawtooth baseline, no isoelectric segment between waves", "Irregular R–R, but each an exact multiple of the flutter cycle", "Atrial rate about 300"],
    pearls: ["Variable block is 'regularly irregular': the R–R intervals fall into a few fixed values.", "Typical (cavotricuspid) flutter is cured by ablation in most patients."],
    mimics: ["Atrial fibrillation (irregularly irregular, no fixed multiples)"],
    leads: ["II", "aVF", "V1"],
  },
  {
    id: "mat", name: "Multifocal atrial tachycardia", category: "Atrial", spec: { rhythm: { kind: "mat", rate: 112 } },
    summary: "Irregular rhythm from several atrial foci.",
    features: ["At least three different P-wave shapes", "Varying PR and P–P intervals", "Rate over 100 (under 100: wandering atrial pacemaker)"],
    pearls: ["Classically in decompensated COPD, hypoxia, hypokalemia and hypomagnesemia.", "Treat the lung and the electrolytes; cardioversion does not work."],
    mimics: ["Atrial fibrillation"],
  },

  // ------------------------------------------------------------------ junctional and re-entry
  {
    id: "junctional", name: "Junctional rhythm", category: "Junctional & re-entry", spec: { rhythm: { kind: "junctional", rate: 48 } },
    summary: "AV-junction escape at 40–60 bpm, narrow QRS, retrograde or absent P waves.",
    features: ["Regular narrow QRS at 40–60", "No P before the QRS; an inverted P may follow it (II, III, aVF)", "Normal QRS morphology"],
    pearls: ["An escape rhythm: ask why the sinus node is quiet (drugs, ischemia, sick sinus).", "Faster junctional rhythms (60–100: accelerated) suggest digoxin toxicity, myocarditis or post-op irritation."],
    leads: ["II", "aVF"],
  },
  {
    id: "accel-junctional", name: "Accelerated junctional rhythm", category: "Junctional & re-entry", spec: { rhythm: { kind: "junctional", rate: 82 } },
    summary: "Junctional focus firing at 60–100 bpm, overtaking the sinus node.",
    features: ["Regular narrow QRS at 60–100", "Retrograde P after the QRS, or none", "Onset and offset are gradual (warm-up), unlike re-entry"],
    pearls: ["Think digoxin toxicity, inferior MI, myocarditis and cardiac surgery."],
  },
  {
    id: "svt", name: "AV nodal re-entrant tachycardia (SVT)", category: "Junctional & re-entry", spec: { rhythm: { kind: "svt", rate: 182 } },
    summary: "Re-entry within the AV node: regular narrow-complex tachycardia, 150–250 bpm.",
    features: ["Regular, narrow, rate 150–250", "No visible P before the QRS; a retrograde P may show as a pseudo-r′ in V1 or pseudo-S in II", "Abrupt onset and termination"],
    pearls: ["Vagal manoeuvres (modified Valsalva) first, then adenosine, which usually terminates it.", "Rate-related ST depression is common and does not by itself mean coronary disease."],
    mimics: ["Flutter with 2:1 block", "Sinus tachycardia"],
  },
  {
    id: "wpw", name: "Wolff–Parkinson–White pattern", category: "Junctional & re-entry",
    spec: { rhythm: sinus(74, { pr: 0.1 }), morph: { qrsWide: 1.1, comps: [{ k: "wave", v: [0.36, 0.3, -0.06], t: -0.05, w: 0.019 }], tVec: v(0.18, 0.12, 0.3) } },
    summary: "An accessory pathway pre-excites the ventricle: short PR and a slurred delta wave.",
    features: ["PR under 120 ms", "Slurred upstroke of the QRS (delta wave), QRS over 110 ms", "Secondary ST–T changes opposite the delta wave"],
    pearls: ["Delta waves can mimic Q waves (pseudo-infarction) or hide a real infarct.", "In atrial fibrillation with WPW avoid AV-nodal blockers (adenosine, verapamil, digoxin): they can push conduction down the pathway into VF."],
    mimics: ["Bundle branch block", "Inferior MI (negative delta waves in III, aVF)"],
  },

  // ------------------------------------------------------------------ AV block
  {
    id: "avb1", name: "First-degree AV block", category: "AV block", spec: { rhythm: sinus(68, { pr: 0.29 }) },
    summary: "Every P conducts, but slowly: PR over 200 ms.",
    features: ["Constant PR over 200 ms", "1:1 conduction, no dropped beats", "Normal QRS"],
    pearls: ["Usually benign; seen with vagal tone, AV-nodal drugs, inferior MI and Lyme carditis.", "A very long PR can put the P wave on the preceding T."],
  },
  {
    id: "wenckebach", name: "Second-degree AV block, Mobitz I (Wenckebach)", category: "AV block", spec: { rhythm: sinus(78, { pr: 0.2, av: "wenckebach", cycle: 4 }) },
    summary: "PR lengthens beat by beat until a P wave does not conduct; then the cycle restarts.",
    features: ["Progressive PR prolongation, then a dropped QRS", "Grouped beating (here 4:3)", "The pause is shorter than two P–P intervals; R–R shortens before the drop"],
    pearls: ["Block in the AV node itself: usually benign, vagal, or from inferior MI (the AV-node artery).", "Often responds to atropine."],
    mimics: ["Blocked PACs", "Mobitz II"],
    leads: ["II", "V1"],
  },
  {
    id: "mobitz2", name: "Second-degree AV block, Mobitz II", category: "AV block", spec: { rhythm: sinus(76, { pr: 0.17, av: "mobitz2", cycle: 4 }), morph: { bbb: "rbbb" } },
    summary: "Constant PR with sudden non-conducted P waves; disease below the AV node.",
    features: ["PR constant before and after the dropped beat", "Sudden blocked P wave", "Often a wide QRS (bundle branch disease)"],
    pearls: ["Infranodal: prone to sudden complete heart block; atropine does not help and may worsen the ratio.", "Needs pacing (transcutaneous standby, then permanent)."],
    mimics: ["Wenckebach (look at the PR before and after the drop)"],
  },
  {
    id: "avb-21", name: "2:1 AV block", category: "AV block", spec: { rhythm: sinus(84, { pr: 0.18, av: "2:1" }) },
    summary: "Every second P wave is blocked.",
    features: ["Two P waves per QRS, one hiding near the T wave", "Constant PR of the conducted beats", "Ventricular rate half the atrial rate"],
    pearls: ["You cannot tell Mobitz I from II on 2:1 alone: a narrow QRS suggests nodal, a wide one infranodal.", "A longer strip often shows a 3:2 group that settles it."],
  },
  {
    id: "chb", name: "Third-degree (complete) heart block", category: "AV block", spec: { rhythm: sinus(80, { av: "complete", escape: { rate: 40 } }) },
    summary: "No P wave conducts; atria and ventricles beat independently.",
    features: ["P waves march through at their own rate", "Regular escape QRS at its own slower rate", "PR varies at random (AV dissociation, atrial rate > ventricular)"],
    pearls: ["A narrow junctional escape (40–60) means block in the node, as in inferior MI.", "Pacing is the treatment; atropine rarely works for infranodal block."],
    leads: ["II", "V1"],
  },
  {
    id: "chb-wide", name: "Complete heart block, ventricular escape", category: "AV block", spec: { rhythm: sinus(84, { av: "complete", escape: { rate: 32, vm: VM.escape } }) },
    summary: "Complete block with a slow wide-complex ventricular escape.",
    features: ["Dissociated P waves", "Wide escape QRS at 20–40", "Unreliable escape: risk of asystole"],
    pearls: ["Typical of block below the His bundle (anterior MI, degenerative conduction disease).", "Pace now."],
  },

  // ------------------------------------------------------------------ bundle branch and fascicular
  {
    id: "rbbb", name: "Right bundle branch block", category: "Bundle branch & fascicular", spec: { rhythm: sinus(72), morph: { bbb: "rbbb" } },
    summary: "The right ventricle activates late through muscle: RSR′ in V1, broad S in I and V6.",
    features: ["QRS ≥ 120 ms", "rSR′ ('M') in V1–V2", "Wide slurred S in I, aVL, V5–V6; secondary T inversion in V1–V3"],
    pearls: ["Can be normal; new RBBB with chest pain or hypoxia raises PE or anterior MI.", "ST elevation is still readable in RBBB (unlike LBBB)."],
    leads: ["V1", "V6", "I"],
  },
  {
    id: "lbbb", name: "Left bundle branch block", category: "Bundle branch & fascicular", spec: { rhythm: sinus(72), morph: { bbb: "lbbb" } },
    summary: "Left ventricle activates late through muscle; ST–T discordant to the QRS.",
    features: ["QRS ≥ 120 ms, broad notched R in I, aVL, V5–V6, no septal q", "QS or rS in V1–V3", "Discordant ST and T: elevated where the QRS is negative"],
    pearls: ["The baseline discordant ST elevation in V1–V3 is expected and is not a STEMI.", "Use Sgarbossa (or Smith-modified) criteria to find infarction in LBBB."],
    leads: ["V1", "V2", "V6", "I"],
  },
  {
    id: "lafb", name: "Left anterior fascicular block", category: "Bundle branch & fascicular", spec: { rhythm: sinus(70), morph: { axisShift: -100 } },
    summary: "Left axis deviation from block of the anterior fascicle.",
    features: ["Axis −45° to −90°", "qR in I and aVL, rS in II, III, aVF", "QRS under 120 ms"],
    pearls: ["The commonest cause of left axis deviation.", "With RBBB it is bifascicular block; add a long PR and it is sometimes called trifascicular."],
    leads: ["I", "aVL", "II", "aVF"],
  },
  {
    id: "bifascicular", name: "Bifascicular block (RBBB + LAFB)", category: "Bundle branch & fascicular", spec: { rhythm: sinus(70), morph: { bbb: "rbbb", axisShift: -100 } },
    summary: "Right bundle branch block with left anterior fascicular block.",
    features: ["RBBB pattern in V1", "Left axis deviation beyond −45°", "Only the posterior fascicle still conducts"],
    pearls: ["In syncope, consider intermittent complete heart block."],
  },

  // ------------------------------------------------------------------ ventricular
  {
    id: "pvc-bigeminy", name: "Ventricular bigeminy (PVCs)", category: "Ventricular", spec: { rhythm: sinus(76, { ectopy: { every: 1, vm: VM.rvot } }) },
    summary: "Every sinus beat followed by a premature ventricular complex.",
    features: ["Wide, bizarre premature QRS with no P wave", "T wave opposite the QRS", "Full compensatory pause: the sinus P inside the PVC does not conduct"],
    pearls: ["This PVC is LBBB-like with an inferior axis: right-ventricular outflow tract origin, usually benign.", "A pulse oximeter may count half the rate: PVCs eject little blood."],
  },
  {
    id: "aivr", name: "Accelerated idioventricular rhythm", category: "Ventricular", spec: { rhythm: { kind: "ventricular", rate: 78, vm: VM.rvot, atrial: 70 } },
    summary: "Ventricular focus at 50–110 bpm, often after reperfusion.",
    features: ["Wide regular QRS at 50–110", "Sinus P waves dissociated or captured", "Gradual onset as the sinus rate slows"],
    pearls: ["A classic reperfusion arrhythmia after PCI or lysis: benign and self-limited.", "Do not suppress it: it may be the only rhythm."],
  },
  {
    id: "vt-mono", name: "Monomorphic ventricular tachycardia", category: "Ventricular", spec: { rhythm: { kind: "ventricular", rate: 172, vm: VM.vtLv, atrial: 82 } },
    summary: "Regular wide-complex tachycardia from one ventricular focus or scar circuit.",
    features: ["QRS over 120 ms, every beat identical, rate 120–250", "Extreme (northwest) axis", "AV dissociation: P waves marching through (look for capture and fusion beats)"],
    pearls: ["A wide regular tachycardia is VT until proven otherwise, especially after an MI.", "Pulseless: defibrillate. Unstable: synchronized cardioversion. Stable: amiodarone or procainamide."],
    mimics: ["SVT with aberrancy", "Hyperkalemia", "Paced rhythm"],
    leads: ["V1", "aVR", "II"],
  },
  {
    id: "vt-poly", name: "Polymorphic ventricular tachycardia", category: "Ventricular", spec: { rhythm: { kind: "ventricular", rate: 225, vm: VM.vtLv, poly: true } },
    summary: "Ventricular tachycardia whose QRS shape changes beat to beat, with a normal QT.",
    features: ["Wide QRS, changing axis and amplitude", "Rate 200–250, irregular", "Baseline QT normal (contrast torsades)"],
    pearls: ["With a normal QT, think acute ischemia first.", "Usually unstable: defibrillate (unsynchronized), then treat the cause."],
  },
  {
    id: "torsades", name: "Torsades de pointes", category: "Ventricular", spec: { rhythm: { kind: "torsades" }, morph: { qt: 1.5, t: 1.1, comps: [{ k: "wave", v: [0.08, 0.06, 0.05], t: 0.17, w: 0.05, anchor: "T" }] } },
    summary: "Polymorphic VT on a long QT, its axis twisting around the baseline.",
    features: ["Long QT in the sinus beats before it", "Short–long–short: a PVC lands on the T wave", "QRS amplitude waxes and wanes as the axis turns (spindles)"],
    pearls: ["Magnesium sulphate 2 g IV, whatever the magnesium level.", "Remove QT-prolonging drugs, correct K⁺ and Mg²⁺; overdrive pacing or isoproterenol prevent recurrence."],
    leads: ["II", "V2"],
  },
  {
    id: "vf-coarse", name: "Ventricular fibrillation (coarse)", category: "Ventricular", spec: { rhythm: { kind: "vf", mv: 0.55 } },
    summary: "Chaotic ventricular activity with no organized QRS: cardiac arrest.",
    features: ["No identifiable QRS, P or T", "Irregular undulations, varying amplitude and rate", "No pulse"],
    pearls: ["Defibrillate immediately; CPR between shocks; epinephrine and amiodarone per ACLS.", "Check the leads and the patient: artifact can look like VF."],
  },
  {
    id: "vf-fine", name: "Ventricular fibrillation (fine)", category: "Ventricular", spec: { rhythm: { kind: "vf", mv: 0.14 } },
    summary: "Low-amplitude VF, typically later in an arrest.",
    features: ["Small chaotic waves", "May be mistaken for asystole at low gain", "No pulse"],
    pearls: ["Turn up the gain and check two leads before calling asystole: fine VF is shockable."],
    mimics: ["Asystole"],
  },
  {
    id: "asystole", name: "Asystole (P-wave only)", category: "Ventricular", spec: { rhythm: { kind: "asystole", atrial: 40 } },
    summary: "No ventricular activity; here a few atrial P waves remain (ventricular standstill).",
    features: ["Flat line apart from P waves", "No QRS", "No pulse"],
    pearls: ["Not shockable: CPR and epinephrine, look for reversible causes (Hs and Ts).", "P waves without QRS may respond to pacing; true asystole rarely does."],
  },
  {
    id: "paced", name: "Ventricular paced rhythm", category: "Ventricular", spec: { rhythm: { kind: "ventricular", rate: 70, vm: VM.paced, paced: true, atrial: 64 } },
    summary: "Right-ventricular apical pacing: spike, then a wide LBBB-like QRS with a left axis.",
    features: ["Narrow pacing spike before each QRS", "Wide QRS, LBBB morphology, left superior axis", "Discordant ST–T"],
    pearls: ["Paced complexes hide ischemia as LBBB does; modified Sgarbossa criteria apply.", "Look for failure to capture (spike without QRS) and failure to sense."],
  },

  // ------------------------------------------------------------------ ischemia and infarction
  {
    id: "stemi-anterior", name: "Anterior STEMI (proximal LAD)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(92) }, coronary: { scenario: { lesions: [occlude("LAD", 0.08)] } },
    summary: "Proximal LAD occlusion: ST elevation across the precordium.",
    features: ["ST elevation V1–V4 (often V5–V6, I, aVL)", "Reciprocal ST depression inferiorly", "Hyperacute T waves early"],
    pearls: ["Proximal LAD: STE in aVL and I too; reciprocal inferior depression.", "Time is muscle: primary PCI within 90 minutes of first medical contact."],
    mimics: ["LV aneurysm", "Early repolarization", "LBBB", "Takotsubo"],
    leads: ["V2", "V3", "V4", "aVL", "III"],
    next: "Activate the cath lab; aspirin, anticoagulation; treat shock and arrhythmias.",
  },
  {
    id: "stemi-inferior", name: "Inferior STEMI (RCA)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(62, { pr: 0.21 }) }, coronary: { scenario: { lesions: [occlude("RCA", 0.2)] } },
    summary: "Right coronary occlusion: ST elevation in II, III, aVF with reciprocal depression in aVL.",
    features: ["ST elevation II, III, aVF (III > II suggests RCA)", "Reciprocal ST depression in aVL and I", "Vagal slowing and AV block are common"],
    pearls: ["Check right-sided leads (V4R) for RV infarction: avoid nitrates, give fluid if hypotensive.", "The AV-node artery comes from the RCA in most people: watch for heart block."],
    mimics: ["Pericarditis (no reciprocal depression except aVR)"],
    leads: ["II", "III", "aVF", "aVL"],
  },
  {
    id: "stemi-inferior-chb", name: "Inferior STEMI with complete heart block", category: "Ischemia & infarction",
    spec: { rhythm: sinus(84, { av: "complete", escape: { rate: 42 } }) }, coronary: { scenario: { lesions: [occlude("RCA", 0.12)] } },
    summary: "RCA occlusion with AV-node ischemia: inferior ST elevation and a junctional escape.",
    features: ["Inferior ST elevation", "P waves dissociated from a narrow escape QRS", "Bradycardia and hypotension"],
    pearls: ["Nodal block from inferior MI usually recovers after reperfusion; temporary pacing bridges it.", "Atropine may help nodal block; it does not help infranodal block."],
    leads: ["II", "III", "aVF"],
  },
  {
    id: "stemi-lateral", name: "High lateral STEMI (diagonal)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(88) }, coronary: { scenario: { lesions: [occlude("D1", 0.1)] }, scale: 1.5 },
    summary: "First diagonal occlusion: ST elevation in I and aVL with inferior reciprocal depression.",
    features: ["ST elevation in I and aVL (may be under 1 mm)", "Reciprocal depression in III and aVF", "Sometimes STE in V2 alone ('South African flag')"],
    pearls: ["High lateral STEMI is easy to miss: inferior depression may be the clearest sign.", "aVL depression is also an early reciprocal sign of inferior MI."],
    leads: ["I", "aVL", "III", "aVF"],
  },
  {
    id: "stemi-posterior", name: "Posterior STEMI (circumflex)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(84) }, coronary: { scenario: { lesions: [occlude("LCX", 0.25)] } },
    summary: "Circumflex occlusion of the posterior wall: ST depression V1–V3, elevation in V7–V9.",
    features: ["Horizontal ST depression V1–V3 with upright T waves", "Tall broad R in V1–V2 later (mirror-image Q waves)", "ST elevation in posterior leads V7–V9"],
    pearls: ["Anterior ST depression maximal in V1–V3 is a posterior STEMI until proven otherwise: record V7–V9.", "Turn on V7–V9 below: 0.5 mm elevation counts in the posterior leads."],
    mimics: ["Anterior subendocardial ischemia (NSTEMI)"],
    leads: ["V1", "V2", "V3", "V8", "V9"],
  },
  {
    id: "hyperacute", name: "Hyperacute T waves (early LAD occlusion)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(90), morph: { tBoost: 1.3 } }, coronary: { scenario: { lesions: [occlude("LAD", 0.15)] }, scale: 0.18 },
    summary: "The first minutes of an occlusion: broad, tall, symmetric T waves before the ST rises.",
    features: ["Tall, broad-based, symmetric T waves in V2–V4", "Little ST elevation yet", "T wave large relative to the QRS"],
    pearls: ["Repeat the tracing every 15–30 minutes: it evolves.", "Compare with hyperkalemia (narrow, peaked T)."],
    mimics: ["Hyperkalemia", "Early repolarization"],
    leads: ["V2", "V3", "V4"],
  },
  {
    id: "de-winter", name: "De Winter T waves", category: "Ischemia & infarction",
    spec: { rhythm: sinus(84), morph: { t: 1.5, tVec: v(0.32, 0.22, 0.62), comps: [{ k: "st", v: [-0.06, -0.06, -0.14], shape: "jpoint" }, { k: "st", v: [-0.02, -0.03, 0], shape: "plateau" }] } },
    summary: "Proximal LAD occlusion without ST elevation: upsloping J-point depression into tall symmetric T waves.",
    features: ["1–3 mm upsloping ST depression at the J point in V1–V6", "Tall, prominent, symmetric T waves", "Often 1–2 mm ST elevation in aVR"],
    pearls: ["A STEMI equivalent: about 2% of anterior occlusions. Activate the cath lab.", "It does not evolve into classic STE in many patients."],
    mimics: ["Hyperkalemia", "Hyperacute T waves", "NSTEMI"],
    leads: ["V2", "V3", "V4", "aVR"],
  },
  {
    id: "wellens-a", name: "Wellens syndrome, type A", category: "Ischemia & infarction",
    spec: { rhythm: sinus(68), morph: { comps: [{ k: "wave", v: [0.05, 0.02, -0.33], t: 0.07, w: 0.05, anchor: "T" }] } },
    summary: "Biphasic T waves in V2–V3 after chest pain has resolved: a critical proximal LAD stenosis.",
    features: ["Biphasic T in V2–V3: up, then down", "Little or no ST elevation, no Q waves", "Preserved R-wave progression"],
    pearls: ["The patient is pain-free when this is recorded: a reperfused LAD at risk of re-occlusion.", "Avoid stress testing; it needs angiography."],
    mimics: ["Hypokalemia (U waves)"],
    leads: ["V2", "V3"],
  },
  {
    id: "wellens-b", name: "Wellens syndrome, type B", category: "Ischemia & infarction",
    spec: { rhythm: sinus(68), morph: { tVec: v(0.18, 0.12, -0.52), t: 1.2 } },
    summary: "Deep, symmetric T-wave inversion in V2–V3: critical proximal LAD stenosis.",
    features: ["Deep symmetric T inversion in V2–V3 (may extend V1–V6)", "Isoelectric or minimal ST", "No Q waves, R waves preserved"],
    pearls: ["Pain-free at the time of the tracing; high risk of anterior MI within days.", "Type B is the more common (about 75%)."],
    mimics: ["Persistent juvenile T waves", "PE", "LVH strain", "CNS T waves"],
    leads: ["V2", "V3", "V4"],
  },
  {
    id: "nstemi", name: "NSTEMI: subendocardial ischemia", category: "Ischemia & infarction",
    spec: { rhythm: sinus(102) }, coronary: { scenario: { lesions: [{ artery: "LAD", stenosis: 0.82, position: 0.2 }], exertion: true } },
    summary: "Demand ischemia of the inner wall: non-localizing ST depression.",
    features: ["Horizontal or downsloping ST depression, most in V4–V6, I and II", "Reciprocal ST elevation in aVR", "The pattern does not show which artery"],
    pearls: ["Subendocardial ST depression does not localize: the vector points from the inner wall toward the cavity in every territory.", "Troponin decides NSTEMI from unstable angina."],
    mimics: ["Posterior STEMI (depression maximal V1–V3)", "LVH strain", "Digoxin"],
    leads: ["V4", "V5", "V6", "aVR"],
  },
  {
    id: "avr-ste", name: "Diffuse ST depression with STE in aVR", category: "Ischemia & infarction",
    spec: { rhythm: sinus(110) }, coronary: { scenario: { lesions: [{ artery: "LM", stenosis: 0.75, position: 0.5 }], exertion: true } },
    summary: "Global subendocardial ischemia: left main, three-vessel disease, or severe demand.",
    features: ["ST depression in eight or more leads", "ST elevation in aVR (and often V1)", "Tachycardia"],
    pearls: ["Not a STEMI pattern by itself; consider left main or three-vessel disease, but also hypotension, anemia and tachyarrhythmia.", "Urgent cardiology review if it persists."],
    leads: ["aVR", "V5", "II"],
  },
  {
    id: "sgarbossa", name: "LBBB with concordant ST elevation (Sgarbossa)", category: "Ischemia & infarction",
    spec: { rhythm: sinus(90), morph: { bbb: "lbbb" } }, coronary: { scenario: { lesions: [occlude("LCX", 0.15)] }, scale: 1.3 },
    summary: "Acute occlusion in a patient with LBBB: ST elevation in the same direction as the QRS.",
    features: ["LBBB background", "Concordant ST elevation ≥ 1 mm where the QRS is positive (5 points)", "Concordant ST depression ≥ 1 mm in V1–V3 (3 points)"],
    pearls: ["Sgarbossa ≥ 3 points is specific for MI in LBBB; Smith modification uses ST/S ratio ≤ −0.25 for discordant excess.", "Compare with the LBBB preset to see the expected discordance."],
    leads: ["I", "aVL", "V5", "V6"],
  },
  {
    id: "lv-aneurysm", name: "LV aneurysm (old anterior MI)", category: "STEMI mimics",
    spec: { rhythm: sinus(76), morph: { t: 0.6, comps: [{ k: "wave", v: [0.08, 0.06, -0.45], t: -0.03, w: 0.011 }, { k: "wave", v: [-0.15, 0, -0.32], t: 0.0, w: 0.013 }, { k: "st", v: [-0.03, 0.0, 0.17] }] } },
    summary: "Persistent ST elevation with deep Q waves weeks after an anterior infarct.",
    features: ["QS waves in V1–V4", "Persistent ST elevation, usually 1–2 mm", "Small T waves: T/QRS amplitude ratio under 0.36 in V1–V4"],
    pearls: ["The scar does not repolarize normally, so ST stays up; nothing to open.", "A large T relative to the QRS points to acute occlusion instead."],
    mimics: ["Acute anterior STEMI"],
    leads: ["V1", "V2", "V3", "V4"],
  },

  // ------------------------------------------------------------------ STEMI mimics
  {
    id: "pericarditis", name: "Acute pericarditis", category: "STEMI mimics",
    spec: { rhythm: sinus(104), morph: { comps: [{ k: "st", v: [0.1, 0.13, 0.1] }, { k: "pr", v: [-0.04, -0.05, -0.02] }] } },
    summary: "Inflamed epicardium everywhere: diffuse concave ST elevation and PR depression.",
    features: ["Diffuse concave ST elevation (I, II, aVF, V2–V6) not matching one artery", "PR depression (most in II), PR elevation in aVR", "ST depression only in aVR (and V1)"],
    pearls: ["Reciprocal depression outside aVR and V1 means STEMI, not pericarditis.", "Spodick sign: a downsloping TP segment."],
    mimics: ["Inferior or anterior STEMI", "Early repolarization"],
    leads: ["II", "aVR", "V5"],
  },
  {
    id: "early-repol", name: "Benign early repolarization", category: "STEMI mimics",
    spec: { rhythm: sinus(56), morph: { qrs: 1.2, t: 1.45, comps: [{ k: "st", v: [0.05, 0.05, 0.13] }, { k: "wave", v: [0.11, 0.08, 0.1], t: 0.045, w: 0.008 }] } },
    summary: "Young, healthy, slow heart rate: J-point notching and concave ST elevation in V2–V5.",
    features: ["Concave ST elevation, usually under 2 mm, V2–V5", "Notched or slurred J point (fish hook), best in V4", "Tall T waves, stable over time; no reciprocal depression"],
    pearls: ["Diagnose it only after excluding ischemia: compare with old tracings, repeat, check troponin.", "Inferolateral J waves with ventricular arrhythmia are a different, malignant entity."],
    mimics: ["Anterior STEMI", "Pericarditis"],
    leads: ["V3", "V4", "V5"],
  },
  {
    id: "lvh", name: "Left ventricular hypertrophy with strain", category: "STEMI mimics",
    spec: { rhythm: sinus(70), morph: { qrs: 2.1, comps: [{ k: "wave", v: [0.5, 0.1, -0.6], t: 0.0, w: 0.012 }, { k: "st", v: [-0.08, 0, 0.04], shape: "jpoint" }], tVec: v(-0.25, -0.05, 0.25) } },
    summary: "Thick left ventricle: tall voltages, with ST depression and asymmetric T inversion laterally.",
    features: ["S in V1 + R in V5 or V6 ≥ 35 mm (Sokolow–Lyon)", "Lateral ST depression with asymmetric T inversion ('strain')", "ST elevation in V1–V3, discordant to deep S waves"],
    pearls: ["The V1–V3 ST elevation of LVH is proportional to the S wave depth; disproportionate elevation is suspicious.", "Voltage criteria are insensitive; echo measures mass."],
    mimics: ["Anterior STEMI", "Lateral ischemia"],
    leads: ["V1", "V5", "V6", "aVL"],
  },
  {
    id: "brugada", name: "Brugada pattern, type 1", category: "STEMI mimics",
    spec: { rhythm: sinus(70), morph: { comps: [{ k: "st", v: [-0.15, -0.08, 0.31], shape: "jpoint" }, { k: "wave", v: [-0.1, -0.02, 0.15], t: 0.045, w: 0.011 }, { k: "wave", v: [0.12, 0.02, -0.26], t: 0.02, w: 0.05, anchor: "T" }] } },
    summary: "A sodium-channel disorder: coved ST elevation in V1–V2 falling into an inverted T.",
    features: ["Coved ST elevation ≥ 2 mm in V1–V2", "Followed by T-wave inversion", "RBBB-like r′ without a broad S in V6"],
    pearls: ["Fever and sodium-channel blockers unmask it; risk of polymorphic VT and sudden death.", "Syncope with type 1 pattern: refer for ICD evaluation."],
    mimics: ["Anterior STEMI", "RBBB"],
    leads: ["V1", "V2"],
  },
  {
    id: "takotsubo", name: "Takotsubo (stress) cardiomyopathy", category: "STEMI mimics",
    spec: { rhythm: sinus(106), morph: { comps: [{ k: "st", v: [0.12, 0.12, 0.16] }] } },
    summary: "Apical ballooning after emotional or physical stress: anterior ST elevation without one artery's pattern.",
    features: ["ST elevation V2–V6 and often II, aVF", "Little reciprocal depression (except aVR)", "Deep T inversion and long QT develop over days"],
    pearls: ["Cannot be told from anterior STEMI on the ECG: angiography decides.", "Most common in post-menopausal women after a stressor."],
    mimics: ["Anterior STEMI"],
    leads: ["V3", "V4", "II", "aVR"],
  },
  {
    id: "pe", name: "Pulmonary embolism (right heart strain)", category: "STEMI mimics",
    spec: { rhythm: sinus(116), morph: { tVec: v(0.35, -0.05, -0.25), comps: [{ k: "wave", v: [-0.32, 0.12, 0.12], t: 0.035, w: 0.012 }, { k: "wave", v: [0.12, -0.14, 0], t: -0.025, w: 0.01 }, { k: "wave", v: [-0.2, 0, 0.22], t: 0.055, w: 0.014 }] } },
    summary: "Acute right-ventricular strain: sinus tachycardia, S1Q3T3, T inversion V1–V3.",
    features: ["Sinus tachycardia (the commonest finding)", "S wave in I, Q wave and inverted T in III (S1Q3T3)", "T inversion V1–V3; incomplete or complete RBBB; right axis"],
    pearls: ["S1Q3T3 is specific but insensitive: a normal ECG does not exclude PE.", "Anterior T inversion with inferior T inversion favours PE over anterior ischemia."],
    mimics: ["Wellens", "Anterior NSTEMI"],
    leads: ["I", "III", "V1", "V2", "V3"],
  },
  {
    id: "alternans", name: "Pericardial effusion: electrical alternans", category: "STEMI mimics",
    spec: { rhythm: sinus(118, { alternans: 0.32 }), morph: { qrs: 0.45, t: 0.55, p: 0.7 } },
    summary: "The heart swings in a large effusion: QRS height alternates beat to beat, low voltage, tachycardia.",
    features: ["Alternating QRS amplitude", "Low voltage (limb QRS under 5 mm)", "Sinus tachycardia"],
    pearls: ["Alternans + low voltage + tachycardia = large effusion; think tamponade (hypotension, raised JVP, pulsus paradoxus).", "Bedside echo, then pericardiocentesis if tamponade."],
    leads: ["II", "V3"],
  },

  // ------------------------------------------------------------------ electrolytes, drugs, other
  {
    id: "hyperk", name: "Hyperkalemia", category: "Electrolytes, drugs & other",
    spec: { rhythm: sinus(64), morph: { t: 2.5, tNarrow: 0.5, p: 0.4, pWide: 1.4, qrsWide: 1.3 } },
    summary: "High potassium: peaked narrow T waves, flattening P waves and a widening QRS.",
    features: ["Tall, narrow, peaked T waves (tented), symmetric", "Flat or absent P waves, long PR", "Widening QRS; at the extreme a sine wave"],
    pearls: ["Calcium first to stabilize the membrane, then insulin with glucose and salbutamol to shift K⁺, then remove it.", "The ECG is insensitive: a normal tracing does not rule out a dangerous K⁺."],
    mimics: ["Hyperacute T waves", "De Winter"],
    leads: ["V2", "V3", "V4", "II"],
  },
  {
    id: "hyperk-sine", name: "Severe hyperkalemia (sine wave)", category: "Electrolytes, drugs & other",
    spec: { rhythm: sinus(52), morph: { p: 0, qrsWide: 2.6, qrs: 0.9, t: 1.9, tNarrow: 1.1 } },
    summary: "Pre-arrest hyperkalemia: QRS and T merge into a sine wave.",
    features: ["No P waves", "Very wide QRS merging into the T wave", "Slow rate; can degenerate into VF or asystole"],
    pearls: ["Treat empirically now: IV calcium, insulin–glucose, and arrange dialysis."],
    mimics: ["Slow VT", "Idioventricular rhythm"],
  },
  {
    id: "hypok", name: "Hypokalemia", category: "Electrolytes, drugs & other",
    spec: { rhythm: sinus(78), morph: { t: 0.35, qt: 1.1, comps: [{ k: "wave", v: [0.08, 0.08, 0.13], t: 0.17, w: 0.045, anchor: "T" }, { k: "st", v: [-0.03, -0.04, -0.03], shape: "plateau" }] } },
    summary: "Low potassium: flat T waves, prominent U waves and subtle ST depression.",
    features: ["Flattened or inverted T waves", "Prominent U waves (V2–V3), apparent long QT (really QU)", "Mild ST depression"],
    pearls: ["Correct magnesium too: hypokalemia is refractory without it.", "Predisposes to torsades and digoxin toxicity."],
    mimics: ["Wellens type A", "Long QT"],
    leads: ["V2", "V3", "II"],
  },
  {
    id: "long-qt", name: "Long QT", category: "Electrolytes, drugs & other",
    spec: { rhythm: sinus(62), morph: { qt: 1.5, t: 0.9 } },
    summary: "Prolonged repolarization: QTc over 470 ms (men) or 480 ms (women); over 500 ms is high risk.",
    features: ["QT more than half the R–R interval at normal rates", "Broad or notched T waves", "Risk of torsades"],
    pearls: ["Causes: drugs (antiarrhythmics, macrolides, antipsychotics, ondansetron, methadone), low K⁺/Mg²⁺/Ca²⁺, congenital channelopathies.", "Bazett over-corrects at high rates; use Fridericia when tachycardic."],
    leads: ["II", "V5"],
  },
  {
    id: "hypothermia", name: "Hypothermia (Osborn waves)", category: "Electrolytes, drugs & other",
    spec: { rhythm: sinus(42, { pr: 0.22 }), morph: { qt: 1.3, comps: [{ k: "wave", v: [0.28, 0.26, 0.22], t: 0.052, w: 0.013 }] }, tremor: 0.03 },
    summary: "Cold heart: bradycardia, long intervals, J (Osborn) waves and shivering artifact.",
    features: ["Positive hump at the J point (Osborn wave), bigger as the temperature falls", "Sinus bradycardia, long PR and QT", "Shivering artifact on the baseline"],
    pearls: ["Atrial fibrillation is common below 32 °C; VF below about 28 °C.", "Rewarm; the heart is irritable, so handle gently."],
    mimics: ["Early repolarization", "STEMI"],
    leads: ["II", "V3", "V4"],
  },
];

/** Presets by id. */
export const PRESET_BY_ID: Record<string, EkgPreset> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** Find a preset by id or loose name ("afib", "torsades", "anterior stemi"). */
export function findPreset(q: string): EkgPreset | undefined {
  const key = q.trim().toLowerCase();
  if (PRESET_BY_ID[key]) return PRESET_BY_ID[key];
  const alias: Record<string, string> = {
    afib: "af", "a fib": "af", "atrial fibrillation": "af", aflutter: "flutter-21", flutter: "flutter-21", "atrial flutter": "flutter-21",
    vfib: "vf-coarse", vf: "vf-coarse", "v fib": "vf-coarse", vtach: "vt-mono", vt: "vt-mono", "v tach": "vt-mono", "polymorphic vt": "vt-poly",
    tdp: "torsades", "complete heart block": "chb", "third degree": "chb", chb: "chb", "mobitz i": "wenckebach", "mobitz 1": "wenckebach", "mobitz 2": "mobitz2",
    "mobitz ii": "mobitz2", stemi: "stemi-anterior", "inferior stemi": "stemi-inferior", "anterior stemi": "stemi-anterior", "posterior stemi": "stemi-posterior",
    "lateral stemi": "stemi-lateral", nstemi: "nstemi", "de winter": "de-winter", dewinter: "de-winter", wellens: "wellens-b", junctional: "junctional",
    avnrt: "svt", psvt: "svt", wpw: "wpw", "hyperkalemia": "hyperk", "hypokalemia": "hypok", brugada: "brugada", pericarditis: "pericarditis", pe: "pe",
    "pulmonary embolism": "pe", "early repolarization": "early-repol", ber: "early-repol", lvh: "lvh", takotsubo: "takotsubo", "first degree": "avb1",
  };
  if (alias[key]) return PRESET_BY_ID[alias[key]];
  const words = key.split(/\s+/);
  return PRESETS.find((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.id.includes(w)));
}
