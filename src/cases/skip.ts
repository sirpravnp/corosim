import type { Probe, Cond } from "./engine";
import { OXYGEN_PANEL } from "../config/oxygenPanel";

/** The longest a single skip may run, in case seconds. */
export const SKIP_CAP_S = 60;
/** Case seconds that pass per real second while skipping. */
export const SKIP_SPEED = 30;

const MAP_FLOOR = 65;
const RHYTHM_LABEL: Record<string, string> = {
  vf: "ventricular fibrillation", pulselessVt: "pulseless ventricular tachycardia", asystole: "asystole",
  pea: "pulseless electrical activity", perfusing: "a perfusing rhythm",
};

/**
 * Whether a time skip may start. A skip is refused while the case's stable condition is false, because the patient is
 * then in the middle of a problem the learner has to see.
 */
export function canSkip(p: Probe, stable: Cond): { ok: true } | { ok: false; why: string } {
  if (stable(p)) return { ok: true };
  return { ok: false, why: "Time skip is unavailable while the patient is unstable." };
}

/**
 * Why a running skip must stop now, or null to carry on. `prev` is the probe at the last step and `now` the probe at this one.
 * Every reason begins with "Stopped:" so the page can show it as it is.
 */
export function skipStop(
  prev: Probe,
  now: Probe,
  o: { promptOpen: boolean; harmActive: boolean; spo2: number },
): string | null {
  if (o.promptOpen) return "Stopped: a checkpoint prompt is open.";
  if (now.arrest === "arrest") return "Stopped: the patient is in arrest.";
  if (o.harmActive) return "Stopped: a harm is active.";
  if (now.rhythmClass !== prev.rhythmClass) return `Stopped: rhythm changed to ${RHYTHM_LABEL[now.rhythmClass] ?? now.rhythmClass}.`;
  if (prev.map >= MAP_FLOOR && now.map < MAP_FLOOR) return `Stopped: pressure fell to ${Math.round(now.map)}.`;
  if (o.spo2 < OXYGEN_PANEL.spo2Low) return `Stopped: saturation fell to ${Math.round(o.spo2 * 100)}%.`;
  return null;
}
