/**
 * The CoroPump's one-shot treatments, DOM-free. The engine consumes a one-shot flag once (`Simulation.apply`), so the page gives it to
 * the engine and keeps none in the playground state; `afterShot` mirrors what the engine did into the state so a later rebuild does not undo it.
 */
import type { PlaygroundState } from "../sim/playground";
import type { PatientSpec } from "../sim/patient";

export type CoroPumpShot = "reposition" | "clearLine" | "exchange";

/** The one-shot edit as a PatientSpec: what the learner gate checks and what the engine takes. */
export function shotSpec(shot: CoroPumpShot): PatientSpec {
  return { devices: { coroPump: shot === "exchange" ? { exchange: true } : shot === "clearLine" ? { purge: { clearLine: true } } : { reposition: true } } };
}

/** The playground state after the engine has carried out the shot: position back to correct, or the line clear. Never keeps the flag. */
export function afterShot(state: PlaygroundState, shot: CoroPumpShot): PlaygroundState {
  const cp = state.devices?.coroPump;
  if (!cp) return state;
  const next = { ...cp };
  delete next.exchange; delete next.reposition;
  if (shot === "reposition") next.position = "correct";
  else if (next.purge && next.purge.line !== undefined && next.purge.line !== "clear") next.purge = { ...next.purge, line: "clear" };
  if (next.purge) { next.purge = { ...next.purge }; delete next.purge.clearLine; }
  return { ...state, devices: { ...state.devices, coroPump: next } };
}
