import { COROPUMP_THROMBUS, type PurgeLine, type PurgeSolution } from "../../../config/devices";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ThrombusInput {
  solution: PurgeSolution;
  heparinUml: number;
  line: PurgeLine;
  /** Mean pump flow over the beat, L/min. */
  flowLpm: number;
  running: boolean;
}

/**
 * Thrombus burden on the pump (0..1). Called once per beat with clinical minutes elapsed that beat.
 * Growth slows with heparin; low flow and a blocked line add growth; above `irreversibleBurden` heparin does not clear it.
 */
export function stepThrombus(b: number, dtClinicalMin: number, inp: ThrombusInput): number {
  if (dtClinicalMin <= 0) return clamp(b, 0, 1);
  b = clamp(b, 0, 1);
  if (!inp.running) return 0;

  const C = COROPUMP_THROMBUS;
  const heparin = clamp(inp.heparinUml, 0, 50);
  const protection = clamp(heparin / C.heparinRefUml, 0, 1);
  const solutionScale = inp.solution === "bicarbonate" ? C.bicarbonateGrowthScale : 1;

  let growthPerMin = C.baseGrowthPerMin * solutionScale * (1 - C.heparinProtection * protection);

  if (inp.flowLpm < C.lowFlowLpm) growthPerMin *= C.lowFlowMult;
  if (inp.line === "blocked") growthPerMin += C.blockedGrowthPerMin;
  if (inp.line === "kinked") growthPerMin += C.kinkedGrowthPerMin;

  if (b < C.irreversibleBurden && heparin >= C.decayHeparinUml) {
    b *= Math.exp((-Math.log(2) * dtClinicalMin) / C.decayHalfLifeMin);
  }

  if (growthPerMin > 0) b += growthPerMin * dtClinicalMin * (1 - b);

  return clamp(b, 0, 1);
}
