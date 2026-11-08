import type { Lesion } from "../physics/network";
import { PLAQUE } from "../config/plaque";
import type { DeployedStent, Dissection, Plaque } from "./types";

export type { Plaque, DeployedStent, Dissection } from "./types";

export interface DilationResult {
  plaque: Plaque;
  recoilPct: number;
  dissection: Dissection;
  dissectionRisk: number;
  perforationRisk: number;
  noReflowRisk: number;
  lumenGainMm: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const logistic = (x: number) => 1 / (1 + Math.exp(-8 * (x - 0.5)));

const GRADES = ["A", "B", "C", "D", "E", "F"] as const;

/** Approximate segment length for centerline mm → lesion pos when the tree is not in scope (coupling uses the real length). */
const posFromMm = (p: Plaque, mm: number) => Math.min(0.99, Math.max(0.01, mm / Math.max(p.centerMm * 2, p.lengthMm * 3, 1)));

/** Turn plaque anatomy into network lesions for the coronary solver. */
export function plaqueToLesions(p: Plaque): Lesion[] {
  const out: Lesion[] = [];
  if (p.ds >= PLAQUE.cleanDs) {
    out.push({ segId: p.segId, pos: posFromMm(p, p.centerMm), ds: p.ds, lengthMm: p.lengthMm });
  }
  for (const st of p.stents) {
    const res = Math.max(0, 1 - st.expansionPct / 100);
    if (res >= PLAQUE.cleanDs) {
      out.push({
        segId: p.segId,
        pos: posFromMm(p, (st.fromMm + st.toMm) / 2),
        ds: res,
        lengthMm: st.toMm - st.fromMm,
      });
    }
  }
  return out;
}

const injuryRisks = (p: Plaque, deviceMm: number, pressureAtm: number, ratedAtm: number) => {
  const ratio = deviceMm / p.referenceMm;
  const over = Math.max(0, ratio - 1);
  const edge = Math.max(0, ratio - PLAQUE.overexpandLimit);
  const press = Math.max(0, pressureAtm / ratedAtm - 1);
  const dissectionRisk = logistic(PLAQUE.dissectionBase + 0.9 * over + 0.75 * edge + 0.35 * p.calcium + 0.2 * press);
  const perforationRisk = logistic(0.04 + 2.1 * over + 0.5 * edge + 0.4 * p.calcium + 0.25 * press);
  const noReflowRisk = clamp01(PLAQUE.noReflowThrombusWeight * p.thrombus + PLAQUE.noReflowLipidWeight * p.lipid + 0.1 * over);
  return { dissectionRisk, perforationRisk, noReflowRisk, ratio };
};

const drawDissection = (risk: number, rand: () => number): Dissection => {
  if (rand() >= risk) return null;
  const g = Math.min(5, Math.floor(rand() * 6));
  return GRADES[g];
};

const expandedLumen = (
  p: Plaque,
  deviceMm: number,
  type: "semi" | "noncompliant" | "cutting" | "scoring",
) => {
  const minD = p.referenceMm * (1 - p.ds);
  const target = Math.min(deviceMm, 1.1 * p.referenceMm);
  let resistance = PLAQUE.calciumResistance * p.calcium;
  if (type === "cutting" || type === "scoring") resistance *= 1 - PLAQUE.cuttingRelief;
  resistance = clamp01(resistance);
  return minD + (target - minD) * (1 - resistance);
};

/** Balloon inflation at a plaque. */
export function dilate(
  p: Plaque,
  b: { type: "semi" | "noncompliant" | "cutting" | "scoring"; diameterMm: number; atXMm: number; lengthMm: number; pressureAtm: number },
  rand: () => number,
): DilationResult {
  const beforeMin = p.referenceMm * (1 - p.ds);
  const expanded = expandedLumen(p, b.diameterMm, b.type);
  const afterMin = expanded * (1 - PLAQUE.recoilBalloon);
  const newDs = clamp01(1 - afterMin / p.referenceMm);
  const rated = b.type === "noncompliant" ? 20 : 16;
  const risks = injuryRisks(p, b.diameterMm, b.pressureAtm, rated);
  return {
    plaque: { ...p, ds: newDs, centerMm: b.atXMm },
    recoilPct: PLAQUE.recoilBalloon,
    dissection: drawDissection(risks.dissectionRisk, rand),
    dissectionRisk: risks.dissectionRisk,
    perforationRisk: risks.perforationRisk,
    noReflowRisk: risks.noReflowRisk,
    lumenGainMm: afterMin - beforeMin,
  };
}

/** Stent deployment at a plaque (adds a stent record and lowers residual stenosis). */
export function deployStent(
  p: Plaque,
  s: { diameterMm: number; lengthMm: number; atXMm: number; strutUm: number; pressureAtm: number },
  rand: () => number,
): DilationResult {
  const beforeMin = p.referenceMm * (1 - p.ds);
  const expanded = expandedLumen(p, s.diameterMm, "noncompliant");
  const afterMin = expanded * (1 - PLAQUE.recoilStent);
  const newDs = clamp01(1 - afterMin / p.referenceMm);
  const expansionPct = clamp01(afterMin / p.referenceMm) * 100;
  const half = s.lengthMm / 2;
  const stent: DeployedStent = {
    fromMm: s.atXMm - half,
    toMm: s.atXMm + half,
    diameterMm: s.diameterMm,
    expansionPct,
    apposition: clamp01(0.85 + 0.1 * (1 - p.calcium)),
    strutUm: s.strutUm,
  };
  const risks = injuryRisks(p, s.diameterMm, s.pressureAtm, 16);
  return {
    plaque: { ...p, ds: newDs, centerMm: s.atXMm, stents: [...p.stents, stent] },
    recoilPct: PLAQUE.recoilStent,
    dissection: drawDissection(risks.dissectionRisk, rand),
    dissectionRisk: risks.dissectionRisk,
    perforationRisk: risks.perforationRisk,
    noReflowRisk: risks.noReflowRisk,
    lumenGainMm: afterMin - beforeMin,
  };
}

/** Diameter stenosis apparent in one angiographic projection (eccentric plaques foreshorten). */
export function apparentStenosis(p: Plaque, viewAngleDeg: number): number {
  const rad = ((viewAngleDeg - p.eccentricAngleDeg) * Math.PI) / 180;
  const visible = 1 - p.eccentric + p.eccentric * Math.abs(Math.cos(rad));
  return clamp01(p.ds * visible);
}
