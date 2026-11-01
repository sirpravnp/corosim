import type { State } from "./states";
import { matrixLesionStates } from "./matrixLesions";
import { matrixValveStates } from "./matrixValves";
import { matrixRhythmStates } from "./matrixRhythm";
import { matrixSupportStates } from "./matrixSupport";

/** Every matrix state. Off the nightly job: run with `--suite matrix`. */
export function matrixStates(): State[] {
  return [...matrixLesionStates(), ...matrixValveStates(), ...matrixRhythmStates(), ...matrixSupportStates()];
}
