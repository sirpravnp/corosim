import { SIMBOOK_AUTOREG as A, SIMBOOK_CIRCUIT as C } from "../config/simbook";
import {
  OrganId,
  OrganParams,
  defaultOrgans,
  resistanceFromRadius,
  solveCircuit,
} from "./circuit";

export type AutoregStatus = "plateau" | "below" | "above" | "passive";

export interface OrganAutoregResult {
  flowLMin: number;
  resistance: number;
  status: AutoregStatus;
  targetFlowLMin: number;
}

export interface AutoregSolution {
  mapMmHg: number;
  cvpMmHg: number;
  deltaPMmHg: number;
  /** Sum of branch flows (heart delivery required at this MAP). */
  cardiacOutputLMin: number;
  organs: Record<OrganId, OrganAutoregResult>;
}

let nominalTargets: Record<OrganId, number> | null = null;

/** Resting target flow per organ at nominal MAP with fixed resistances (pump lesson baseline). */
export function nominalOrganFlows(): Record<OrganId, number> {
  if (!nominalTargets) {
    const s = solveCircuit({
      cardiacOutputLMin: C.baseCoLMin,
      cvpMmHg: C.cvpMmHg,
      organs: defaultOrgans(),
    });
    nominalTargets = { ...s.flows };
  }
  return { ...nominalTargets! };
}

function flowOnPlateau(target: number, map: number, cvp: number, mapLow: number): number {
  if (map >= mapLow) return target;
  if (map <= cvp) return 0;
  return target * ((map - cvp) / (mapLow - cvp));
}

/** MAP is the driver; autoregulating beds hold target flow on the plateau by adjusting local R. */
export function solveAutoreg(mapMmHg: number, organs: OrganParams[] = defaultOrgans(), cvp = C.cvpMmHg): AutoregSolution {
  const targets = nominalOrganFlows();
  const deltaP = Math.max(0, mapMmHg - cvp);
  const out = {} as Record<OrganId, OrganAutoregResult>;

  for (const o of organs) {
    const target = targets[o.id];
    const rPassive = resistanceFromRadius(o.r0, o.radius);
    if (!A.autoreg[o.id]) {
      const q = deltaP > 0 ? deltaP / rPassive : 0;
      out[o.id] = { flowLMin: q, resistance: rPassive, status: "passive", targetFlowLMin: target };
      continue;
    }
    const lo = A.mapLow[o.id];
    const hi = A.mapHigh[o.id];
    let q: number;
    let status: AutoregStatus;
    if (mapMmHg >= lo && mapMmHg <= hi) {
      q = target;
      status = "plateau";
    } else if (mapMmHg < lo) {
      q = flowOnPlateau(target, mapMmHg, cvp, lo);
      status = "below";
    } else {
      q = deltaP > 0 ? deltaP / rPassive : 0;
      status = "above";
    }
    const rEff = q > 1e-6 ? deltaP / q : Infinity;
    out[o.id] = { flowLMin: q, resistance: rEff, status, targetFlowLMin: target };
  }

  const cardiacOutputLMin = (Object.keys(out) as OrganId[]).reduce((s, id) => s + out[id].flowLMin, 0);
  return { mapMmHg, cvpMmHg: cvp, deltaPMmHg: deltaP, cardiacOutputLMin, organs: out };
}
