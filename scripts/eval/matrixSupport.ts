import type { State } from "./states";

/**
 * Condition matrix, volume, pericardium, drugs, devices, shunts and ventilation.
 * Filled from docs/CONDITION_MATRIX.md sections 2.5, 3.4 and 3.6.
 * Suite `matrix`, id prefix `mx-`, invariants only. Empty until that section is generated.
 */
export function matrixSupportStates(): State[] {
  return [];
}
