import { CIRC } from "./circulation";
import { Support } from "./support";

/** The facts the next-step advisor reads. All derived from the live simulation; none is hidden from the learner. */
export interface Situation {
  hasLesion: boolean; occluded: boolean; ds: number; ffr: number | null; leftMain: boolean;
  stElevation: boolean;
  map: number; cardiacOutput: number; lvIschemia: number; rvIschemia: number;
  avDegree: 0 | 1 | 2 | 3; hr: number; vagal: number; congestion: number;
  minutesIschemic: number; infarctSize: number; // clinical minutes with ischemia present; fraction of LV infarcted
  reperfused: boolean; pending: string | null; grafted: boolean;
  support: Support;
}

export interface Issue { tone: "bad" | "warn" | "ok"; text: string }
export interface Step { text: string; why: string }
export interface Warning { tag: string; text: string }
export interface Assessment { issues: Issue[]; warnings: Warning[]; steps: Step[] }

const shock = (s: Situation) => s.map < CIRC.shockMap;
const lowOutput = (s: Situation) => s.cardiacOutput < 3.6;

/**
 * Where the patient stands and what the guidelines would do next, in the order they would do it.
 * Teaching logic from the usual STEMI and cardiogenic-shock teaching points (ACC/AHA); not a clinical decision aid.
 */
export function assess(s: Situation): Assessment {
  const issues: Issue[] = [], warnings: Warning[] = [], steps: Step[] = [];
  const sup = s.support;
  const stemi = s.hasLesion && (s.occluded || s.stElevation) && !s.reperfused;
  const rvDown = s.rvIschemia > 0.3 && s.map < CIRC.hypotensionMap;
  const block = s.avDegree >= 2, slow = s.hr < 50;

  if (stemi) issues.push({ tone: "bad", text: `Acute occlusion, ischemic for ${Math.round(s.minutesIschemic)} min` });
  else if (s.hasLesion && !s.reperfused && (s.ds >= 0.7 || (s.ffr !== null && s.ffr <= 0.8))) issues.push({ tone: "warn", text: `Flow-limiting stenosis${s.ffr !== null ? ` (FFR ${s.ffr.toFixed(2)})` : ""}` });
  if (shock(s)) issues.push({ tone: "bad", text: `Shock: MAP ${Math.round(s.map)}, output ${s.cardiacOutput.toFixed(1)} L/min` });
  else if (s.map < CIRC.hypotensionMap) issues.push({ tone: "warn", text: `Hypotension: MAP ${Math.round(s.map)}` });
  if (s.rvIschemia > 0.3) issues.push({ tone: "warn", text: "Right-ventricular infarct: preload-dependent" });
  if (s.avDegree === 3) issues.push({ tone: "bad", text: "Complete heart block" });
  else if (s.avDegree === 2) issues.push({ tone: "warn", text: "Second-degree AV block" });
  else if (slow) issues.push({ tone: "warn", text: `Bradycardia, ${Math.round(s.hr)} bpm` });
  if (s.congestion > 0.3) issues.push({ tone: "warn", text: "Pulmonary congestion from volume" });
  if (s.infarctSize > 0.02) issues.push({ tone: s.infarctSize > 0.15 ? "bad" : "warn", text: `Infarct ${Math.round(s.infarctSize * 100)}% of the left ventricle` });
  if (s.reperfused && s.infarctSize <= 0.02) issues.push({ tone: "ok", text: "Reperfused with little muscle lost" });

  // Things the team is doing that are hurting.
  if (sup.nitro > 0 && (s.rvIschemia > 0.3 || s.map < CIRC.hypotensionMap)) warnings.push({ tag: "nitroglycerin in a preload-dependent patient", text: "Nitroglycerin is lowering a preload this patient depends on. Stop it." });
  if (sup.norepi > 0 && s.lvIschemia > 0.3 && lowOutput(s)) warnings.push({ tag: "a pressor on a failing ventricle", text: "The pressor raises MAP but adds afterload to a failing ventricle; output may not follow." });
  if (sup.dobutamine > 0 && s.hasLesion && !s.reperfused) warnings.push({ tag: "dobutamine with the artery still closed", text: "Dobutamine raises oxygen demand in muscle that is still ischemic. Open the artery." });
  if (sup.fluids > 1 && s.congestion > 0.3) warnings.push({ tag: "volume into congested lungs", text: "More volume is backing up into the lungs. Stop fluids." });
  if (sup.impella && s.rvIschemia > 0.4) warnings.push({ tag: "a left-sided pump in right-ventricular failure", text: "A left-sided pump cannot move blood the failing right ventricle does not deliver." });

  // Steps, in order.
  if (stemi && !s.pending) {
    steps.push({
      text: s.minutesIschemic < 120 ? "Reperfuse now: primary PCI" : "Reperfuse now: primary PCI; every minute is muscle",
      why: "Primary PCI is preferred when first device time is 90 min or less; a fibrinolytic is the alternative if PCI cannot be done within 120 min of first contact, and works best in the first 3 h. CABG is for those who are not PCI candidates.",
    });
  } else if (stemi && s.pending) steps.push({ text: `Support the patient until the ${s.pending} lands`, why: "Reperfusion is on its way. Hold the pressure and rate with what the patient needs, and avoid anything that raises demand." });
  if (shock(s) && !s.reperfused) steps.push({ text: "Revascularize the culprit; do not delay for stabilization", why: "In shock complicating MI early revascularization is the one intervention that improves survival (SHOCK)." });
  if (shock(s) && sup.norepi === 0) steps.push({ text: "Start norepinephrine to hold MAP above 65", why: "A pressure that perfuses the coronaries and brain comes first; norepinephrine is the usual first pressor." });
  else if (shock(s) && lowOutput(s) && sup.dobutamine === 0 && s.map >= CIRC.shockMap) steps.push({ text: "Consider dobutamine for the low output", why: "Once MAP is adequate, an inotrope raises output. It costs oxygen and provokes ectopy." });
  if (shock(s) && lowOutput(s) && s.lvIschemia > 0.3 && !sup.impella && !sup.iabp) steps.push({ text: "If shock persists, mechanical support", why: "A microaxial pump unloads the ventricle and raises output; a balloon pump adds modest coronary augmentation. Trials of the balloon pump in infarct shock did not improve survival; devices bleed and injure vessels." });
  if (rvDown && sup.fluids < 1) steps.push({ text: "Give IV fluid", why: "A right ventricle that is infarcted needs filling pressure to push blood through the lungs. Avoid nitrates and diuretics." });
  if (block && (s.avDegree === 3 || s.hr < 50) && s.map < CIRC.hypotensionMap && !sup.pacing) {
    steps.push(!sup.atropine && s.vagal > 0.3 && s.avDegree < 3
      ? { text: "Atropine for the tone-mediated block", why: "Inferior infarcts load the vagus. Atropine helps while the AV node itself is still alive; it does nothing for an infarcted node." }
      : { text: "Pace", why: "A node that has lost its artery will not respond to atropine. Pacing restores rate; in a right-ventricular infarct atrioventricular synchrony matters." });
  }
  if (s.congestion > 0.3) steps.push({ text: "Stop fluids; unload the ventricle", why: "A failing left ventricle cannot take more volume. Diuresis and unloading, not more filling." });
  if (!stemi && s.hasLesion && !s.reperfused && (s.ds >= 0.7 || (s.ffr !== null && s.ffr <= 0.8)) && !s.pending) {
    steps.push(s.leftMain
      ? { text: "Revascularize: CABG favored for a left-main lesion", why: "Left main stenosis threatens the whole left ventricle; surgery is the usual choice when anatomy is complex, PCI when it is suitable. Here it is one lesion." }
      : { text: "Revascularize: PCI for a single, flow-limiting lesion", why: "FFR 0.80 or lower with symptoms or ischemia justifies a stent; medical therapy is the alternative in stable disease. Bypass for left-main or multivessel disease." });
  }
  if (s.reperfused && s.map >= CIRC.hypotensionMap && (sup.norepi > 0 || sup.dobutamine > 0 || sup.impella || sup.iabp)) steps.push({ text: "Wean the support as pressure recovers", why: "Support buys time for the artery; once flow is back and stunned muscle recovers, take it off in reverse order." });
  if (s.reperfused && s.hasLesion && s.grafted && s.occluded) steps.push({ text: "The native artery is still blocked; the graft is carrying the territory", why: "A bypass supplies the muscle beyond the block. The native lesion stays." });
  if (!steps.length && !issues.some((i) => i.tone !== "ok")) steps.push({ text: "Nothing to do: the patient is stable", why: "No flow-limiting lesion, no hemodynamic compromise." });
  return { issues, warnings, steps };
}
