import { SIMBOOK_FICK as F } from "../config/simbook";

export interface FickParams {
  /** Diffusion coefficient, teaching units. */
  d: number;
  /** Membrane area, cm². */
  areaCm2: number;
  /** Concentration difference across the membrane. */
  deltaC: number;
  /** Membrane thickness, µm. */
  thicknessUm: number;
}

export function defaultFick(): FickParams {
  return { d: F.dDefault, areaCm2: F.areaDefault, deltaC: F.deltaCDefault, thicknessUm: F.thicknessDefault };
}

/** J = D·A·ΔC / x (relative flux units for the widget). */
export function fickFlux(p: FickParams): number {
  const x = Math.max(p.thicknessUm, 0.1);
  return (p.d * p.areaCm2 * p.deltaC) / x;
}
