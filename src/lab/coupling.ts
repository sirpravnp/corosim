import type { Lesion } from "../physics/network";
import { plaqueToLesions } from "./plaque";
import type { Simulation } from "../sim/simulation";
import type { Plaque } from "./types";

export function applyToSim(
  sim: Simulation,
  plaques: Plaque[],
  extra: { occlusions: Lesion[]; bedResistance: Record<string, number>; liveLesions?: Lesion[] },
): void {
  const lesions = plaques.flatMap(plaqueToLesions);
  for (const l of extra.liveLesions ?? []) lesions.push(l);
  for (const l of extra.occlusions) lesions.push(l);
  sim.setLive(lesions, extra.bedResistance);
}

export function guideTrace(
  pa: number[],
  engagement: { quality: number; engaged: "LM" | "RCA" | null; ostialDs: number },
): number[] {
  const mean = pa.reduce((s, v) => s + v, 0) / pa.length;
  const pulseScale = 0.45 + 0.55 * engagement.quality;
  const vent = engagement.ostialDs >= 0.7 && engagement.engaged ? 0.45 : 0;
  return pa.map((v, i) => {
    const phase = i / Math.max(1, pa.length - 1);
    const base = mean + (v - mean) * pulseScale;
    const diast = phase > 0.35 ? base * (1 - vent) : base;
    return diast;
  });
}

export function contrastEffect(ml: number, egfr: number): { transientMapDrop: number; hrDelta: number; nephropathyRisk: number } {
  const ratio = ml / Math.max(1, egfr);
  return {
    transientMapDrop: Math.min(12, ml * 0.3),
    hrDelta: ml > 80 ? 4 : 0,
    nephropathyRisk: ratio > 3.7 ? Math.min(1, (ratio - 3.7) / 1.4) : 0,
  };
}

import { wireModel } from "../sim/cath";

export function wireReading(sim: Simulation, segId: string, mm: number) {
  const w = wireModel(sim, segId);
  const pt = w.at({ mm });
  return { pa: w.paHyperMmHg, pd: pt.hyperMmHg, ratioRest: pt.restRatio, ratioHyper: pt.hyperRatio };
}
