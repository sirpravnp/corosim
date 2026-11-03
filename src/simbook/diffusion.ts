import { SIMBOOK_DIFFUSION as D } from "../config/simbook";

export interface DiffusionParams {
  /** Half-thickness from capillary to tissue core, µm. */
  thicknessUm: number;
  /** Relative capillary density (1 = reference spacing). */
  density: number;
  flowOn: boolean;
  /** Relative metabolic rate. */
  consumption: number;
}

export interface DiffusionSample {
  xUm: number[];
  conc: number[];
  /** Depth where concentration hits zero, µm; null if oxygen reaches the core. */
  anoxicDepthUm: number | null;
  /** Characteristic diffusion time t ≈ x²/(2D) at the anoxic depth or full thickness, s. */
  diffusionTimeS: number;
  capConc: number;
  effectiveThicknessUm: number;
}

export function defaultDiffusion(): DiffusionParams {
  return {
    thicknessUm: D.thicknessBaseUm,
    density: D.densityBase,
    flowOn: true,
    consumption: 1,
  };
}

/**
 * Steady-state slab with zero-order consumption: C'' = q/D, C(0) = C_cap, no flux at the core (C'(L) = 0).
 * If the core would go negative the tissue is cut off at the critical depth Lc = √(2D·C_cap/q): C reaches 0 there
 * with zero slope, and everything deeper is anoxic.
 */
export function o2Profile(p: DiffusionParams, steps = 80): DiffusionSample {
  const effectiveThicknessUm = p.thicknessUm / Math.sqrt(Math.max(p.density, 0.25));
  const L = effectiveThicknessUm;
  const q = D.consumptionBase * p.consumption;
  const capConc = D.capConcBase * (p.flowOn ? 1 : D.flowOffFactor);
  const Dcoef = D.dUm2PerS;
  const critical = q > 0 ? Math.sqrt((2 * Dcoef * capConc) / q) : Infinity;
  const anoxicDepthUm = critical < L ? critical : null;
  const xUm: number[] = [];
  const conc: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (L * i) / steps;
    const supplied = anoxicDepthUm != null && x >= anoxicDepthUm ? 0 : capConc - (q / (2 * Dcoef)) * (2 * (anoxicDepthUm ?? L) * x - x * x);
    xUm.push(x);
    conc.push(Math.max(supplied, 0));
  }
  const charX = anoxicDepthUm ?? L;
  const diffusionTimeS = (charX * charX) / (2 * Dcoef);
  return { xUm, conc, anoxicDepthUm, diffusionTimeS, capConc, effectiveThicknessUm: L };
}
