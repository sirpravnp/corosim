import type { Lesion } from "../physics/network";
import type { Simulation } from "../sim/simulation";
import type { Effect, RiskContext } from "./complications";

/** Distal coronary bed terminal key for the network solver. */
export const terminalBedKey = (segId: string) => `${segId}#end`;

export function applyEffect(sim: Simulation, eff: Effect): void {
  if (eff.bloodLoss && eff.bloodLoss > 0) {
    const cur = sim.scenario().bloodLoss ?? 0;
    sim.apply({ bloodLoss: Math.min(0.55, cur + eff.bloodLoss) });
  }
  if (eff.tamponade && eff.tamponade > 0) {
    sim.apply({
      pericardium: {
        effusionMl: eff.tamponade * 100,
        effusionRateMlMin: Math.max(4, eff.tamponade * 40),
      },
    });
  }
  if (eff.rhythm === "vf") {
    sim.apply({ patient: { rhythm: "vf-coarse" } });
  }
}

export function mergeBedResistance(into: Record<string, number>, eff: Effect): void {
  if (!eff.bedResistance) return;
  for (const [k, mult] of Object.entries(eff.bedResistance)) {
    into[k] = (into[k] ?? 1) * mult;
  }
}

export function mergeLiveLesions(into: Lesion[], eff: Effect, gLen: (id: string) => number): void {
  if (!eff.lesions) return;
  into.push(...eff.lesions);
  if (eff.coronaryBlock) {
    const len = gLen(eff.coronaryBlock.segId);
    into.push({
      segId: eff.coronaryBlock.segId,
      pos: Math.min(0.98, eff.coronaryBlock.posMm / Math.max(len, 1)),
      ds: 0.99,
      occluded: true,
    });
  }
}

export function ostialJailLesion(branchSeg: string, ostialDs: number): Lesion {
  return { segId: branchSeg, pos: 0.03, ds: Math.max(ostialDs, 0.55), lengthMm: 10 };
}

export function baseRiskContext(over: Partial<RiskContext> = {}): RiskContext {
  return {
    tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm: 0, ratedAtm: 16,
    hydrophilic: false, act: 250, radial: false, ...over,
  };
}
