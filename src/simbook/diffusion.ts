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
    consumption: D.consumptionBase,
  };
}

/** Steady-state C'' = q/D with C(0)=C_cap and C(L)=0. */
export function o2Profile(p: DiffusionParams, steps = 80): DiffusionSample {
  const effectiveThicknessUm = p.thicknessUm / Math.sqrt(Math.max(p.density, 0.25));
  const L = effectiveThicknessUm;
  const q = D.consumptionBase * p.consumption;
  const capConc = D.capConcBase * (p.flowOn ? 1 : D.flowOffFactor) * Math.sqrt(Math.max(p.density, 0.25));
  const Dcoef = D.dUm2PerS;
  const xUm: number[] = [];
  const conc: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (L * i) / steps;
    const c = capConc * (1 - x / L) + (q / (2 * Dcoef)) * x * (L - x);
    xUm.push(x);
    conc.push(Math.max(c, 0));
  }
  let anoxicDepthUm: number | null = null;
  for (let i = 0; i < xUm.length; i++) {
    if (conc[i]! <= 1e-9) {
      anoxicDepthUm = xUm[i]!;
      break;
    }
  }
  if (anoxicDepthUm == null && conc[conc.length - 1]! <= 1e-9) anoxicDepthUm = L;
  const charX = anoxicDepthUm ?? L;
  const diffusionTimeS = (charX * charX) / (2 * Dcoef);
  return { xUm, conc, anoxicDepthUm, diffusionTimeS, capConc, effectiveThicknessUm: L };
}
