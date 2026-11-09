import type { Probe, Cond } from "./engine";
import { OXYGEN_PANEL } from "../config/oxygenPanel";

/**
 * The longest the general "Skip ahead" (no pending order as its target) may run, in case seconds. "Skip to result" has no cap: it runs
 * to that result, protected by the auto-stop reasons of `skipStop` and by the refusal of `canSkip`.
 */
export const SKIP_CAP_S = 60;
/** Case seconds that pass per real second while skipping. */
export const SKIP_SPEED = 30;

/** The note shown when a skip is cancelled or refused because the page clock is paused (a paused clock would hold the skip forever). */
export const SKIP_PAUSED_NOTE = "Skip is unavailable while the clock is paused.";

/**
 * The clinical speed (`S.speed`) that makes the next frame land exactly on a target `leftCaseS` case seconds away. Case time per frame is
 * `frameS * clockScale * speed`, `frameS` being the longest real time a frame can carry (the page caps it) and `clockScale` the play clock's
 * scale. Capped at SKIP_SPEED; a target nearer than one frame gets a speed below the normal one so it is not overshot. At or past the target
 * (`leftCaseS <= 0`) the normal speed 1 is returned.
 */
export function skipSpeed(leftCaseS: number, frameS: number, clockScale: number): number {
  if (!(leftCaseS > 0) || !(frameS > 0) || !(clockScale > 0)) return 1;
  return Math.min(SKIP_SPEED, leftCaseS / (frameS * clockScale));
}

const MAP_FLOOR = 65;

/**
 * Whether a time skip may start. A skip is refused while the case's stable condition is false, because the patient is
 * then in the middle of a problem the learner has to see.
 */
export function canSkip(p: Probe, stable: Cond): { ok: true } | { ok: false; why: string } {
  if (stable(p)) return { ok: true };
  return { ok: false, why: "Time skip is unavailable right now." };
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
  if (o.harmActive) return "Stopped: the patient changed.";
  if (now.rhythmClass !== prev.rhythmClass) return "Stopped: the rhythm changed.";
  if (prev.map >= MAP_FLOOR && now.map < MAP_FLOOR) return `Stopped: pressure fell to ${Math.round(now.map)}.`;
  if (o.spo2 < OXYGEN_PANEL.spo2Low) return `Stopped: saturation fell to ${Math.round(o.spo2 * 100)}%.`;
  return null;
}
