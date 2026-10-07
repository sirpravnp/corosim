import { BedSite } from "./ecgLink";
import { RhythmState } from "./rhythm";

/**
 * Systemic circulation, lumped: MAP = cardiac output × systemic vascular resistance.
 *  - Stroke volume falls with the fraction of left-ventricular muscle that is ischemic (lost contraction)
 *    and with right-ventricular ischemia (less blood delivered to the left heart).
 *  - Slower rates fill the ventricle longer, so stroke volume rises a little, but not enough to keep
 *    output up: heart block and vagal bradycardia lower cardiac output.
 *  - Sympathetic drive constricts and the Bezold–Jarisch reflex dilates the resistance vessels.
 *  - The baroreflex buffers part of any fall in pressure.
 * Constants are teaching assumptions calibrated to a resting adult (72 bpm, 70 ml, 90 mmHg).
 */
export const CIRC = {
  baseRate: 72, // bpm
  baseStrokeVolume: 70, // ml
  baseMap: 90, // mmHg
  fillingExponent: 0.5, // SV ∝ (baseRate / HR)^k, clamped
  fillingMin: 0.7,
  fillingMax: 1.35,
  lvContractileLoss: 0.8, // SV × (1 − loss × ischemic LV fraction)
  rvPreloadLoss: 0.45, // SV × (1 − loss × ischemic RV fraction)
  sympatheticSvr: 0.2, // SVR × (1 + k × sympathetic)
  vagalSvr: 0.12, // SVR × (1 − k × vagal)
  baroreflexRetained: 0.6, // fraction of the open-loop pressure fall that remains
  arterialCompliance: 1.4, // ml/mmHg: pulse pressure = SV / compliance
  shockMap: 65,
  hypotensionMap: 75,
};
const BASE_SVR = CIRC.baseMap / ((CIRC.baseRate * CIRC.baseStrokeVolume) / 1000); // mmHg·min/L

/** Right-ventricular beds: the acute marginal, the conus, and the RCA's own small branches. */
export const isRightVentricular = (key: string) => /^(AM|CONUS|RCA)#/.test(key);
const isNodal = (key: string) => /^(SAN|AVN)#/.test(key);

/** Ventricular rate implied by the rhythm (not the noisy measured one). */
export function ventricularRate(r: RhythmState): number {
  if (r.avDegree === 3) return r.escapeRate;
  if (r.avDegree === 2) return r.sinusRate * 0.75; // a 4:3 Wenckebach drops one beat in four
  return r.sinusRate;
}

export interface Circulation {
  hr: number; strokeVolume: number; cardiacOutput: number; // bpm, ml, L/min
  map: number; systolic: number; diastolic: number; svr: number; // mmHg, mmHg·min/L
  lvIschemia: number; rvIschemia: number; // severity-weighted fraction of each ventricle
  state: "stable" | "hypotension" | "shock";
}

export function circulation(sites: BedSite[], sev: Record<string, number>, rhythm: RhythmState): Circulation {
  let lvMass = 0, lvIsch = 0, rvMass = 0, rvIsch = 0;
  for (const s of sites) {
    if (isNodal(s.key)) continue;
    const k = (sev[s.key] ?? 0) * s.mass;
    if (isRightVentricular(s.key)) { rvMass += s.mass; rvIsch += k; } else { lvMass += s.mass; lvIsch += k; }
  }
  const lvF = lvMass ? lvIsch / lvMass : 0, rvF = rvMass ? rvIsch / rvMass : 0;
  const hr = ventricularRate(rhythm);
  const filling = Math.min(CIRC.fillingMax, Math.max(CIRC.fillingMin, Math.pow(CIRC.baseRate / hr, CIRC.fillingExponent)));
  const sv = CIRC.baseStrokeVolume * filling * (1 - CIRC.lvContractileLoss * lvF) * (1 - CIRC.rvPreloadLoss * rvF);
  const co = (hr * sv) / 1000;
  const svr = BASE_SVR * (1 + CIRC.sympatheticSvr * rhythm.sympathetic) * (1 - CIRC.vagalSvr * rhythm.vagal);
  const open = co * svr;
  const map = CIRC.baseMap - (CIRC.baseMap - open) * CIRC.baroreflexRetained;
  const pulse = sv / CIRC.arterialCompliance;
  const diastolic = map - pulse / 3, systolic = diastolic + pulse;
  const state = map < CIRC.shockMap ? "shock" : map < CIRC.hypotensionMap ? "hypotension" : "stable";
  return { hr, strokeVolume: sv, cardiacOutput: co, map, systolic, diastolic, svr, lvIschemia: lvF, rvIschemia: rvF, state };
}
