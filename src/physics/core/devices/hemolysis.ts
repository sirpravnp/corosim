import { COROPUMP_HEMOLYSIS, type CoroPumpPosition } from "../../../config/devices";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface HemolysisInput {
  level: number;
  speedKrpm: number;
  flowLpm: number;
  suctionFraction: number;
  position: CoroPumpPosition;
  thrombus: number;
  running: boolean;
}

/** Plasma free hemoglobin appearance from pfHb (mg/dL). */
export function urineColor(pf: number): "clear" | "tea" | "dark" {
  const C = COROPUMP_HEMOLYSIS;
  if (pf < C.urineClearBelow) return "clear";
  if (pf < C.urineTeaBelow) return "tea";
  return "dark";
}

/**
 * Patient plasma free hemoglobin (mg/dL), once per beat. Production rises with shear and suction; clears toward baseline when causes stop.
 */
export function stepHemolysis(pf: number, dtClinicalMin: number, inp: HemolysisInput): number {
  const C = COROPUMP_HEMOLYSIS;
  if (dtClinicalMin <= 0) return clamp(pf, 0, C.maxPfHbMgDl);
  pf = clamp(pf, 0, C.maxPfHbMgDl);
  const clearK = Math.log(2) / C.clearanceHalfLifeMin;

  let prod = 0;
  if (inp.running) {
    const flow = Math.max(inp.flowLpm, C.minFlowLpm);
    const shear = inp.speedKrpm / flow;
    if (shear > C.shearThreshold) prod += C.shearGainPerMin * (shear - C.shearThreshold);
    if (inp.suctionFraction > C.suctionThreshold) prod += C.suctionGainPerMin * (inp.suctionFraction - C.suctionThreshold);
    if (inp.position === "deep") prod += C.deepPositionGainPerMin * (1 + inp.level / C.deepLevelDivisor);
    if (inp.thrombus > C.thrombusShearThreshold) prod += C.thrombusGainPerMin * (inp.thrombus - C.thrombusShearThreshold);
  }

  const excess = Math.max(0, pf - C.baselineMgDl);
  pf += prod * dtClinicalMin - excess * clearK * dtClinicalMin;
  return clamp(pf, 0, C.maxPfHbMgDl);
}
