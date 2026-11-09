// ---------------------------------------------------------------- the learner-edit gate on the page (src/cases/gate.ts)
import { learnerMayApply } from "../cases/gate";
import type { PatientSpec } from "../sim/patient";
import { inCases, K } from "./state";

/** True while a case is running or over and its stripped screen is still showing (the phase is idle again only after the learner leaves): a learner may then treat the patient but not give the patient disease. */
export const caseGateOn = () => inCases && K.phase !== "idle";

let timer = 0;
import { mayReplace as replaceVerdict } from "../cases/gate";
/** Say why in plain text beside the dock (no box); it clears itself. */
function say(why: string) {
  const el = document.getElementById("gatewhy");
  if (!el) return;
  el.textContent = why;
  clearTimeout(timer); timer = window.setTimeout(() => { el.textContent = ""; }, 8000);
}

/**
 * Replacing the whole patient (a load, a preset, a new scenario) would wipe the case's disease even if the new patient is "only" treatment,
 * so a running case refuses it outright. The author path (startCase, quit) does not call this.
 */
export function mayReplace(): boolean {
  const v = replaceVerdict(caseGateOn());
  if (!v.ok) say(v.why);
  return v.ok;
}

/**
 * Every edit that starts with the learner goes through here (dock controls, presets, the Advanced sliders, shared links, the console handle).
 * Outside a running case it always passes. The case author's own path (`carry()` in cases.ts, checkpoint patches, a case's start and
 * opening) does not call it.
 */
export function mayEdit(edit: PatientSpec): boolean {
  if (!caseGateOn()) return true;
  const v = learnerMayApply(edit);
  if (v.ok) return true;
  say(v.why);
  return false;
}
