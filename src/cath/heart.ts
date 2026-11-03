import { LiveSource } from "../sim/liveSource";
import type { Simulation } from "../sim/simulation";
import type { HemoSource } from "../sim/hemoSource";
import { rightHeartCath } from "../sim/rightHeartCath";
import { leftHeartCath } from "../sim/leftHeartCath";
import { rhcRows } from "../panels/rightHeartCath";
import { cathRows } from "../panels/leftHeartCath";

/**
 * The cath page's heart-cath tabs, DOM-free part: a live source over the page's own core-engine Simulation (so a shared patient's
 * structural lesions show) and the two reports as label/value rows, from the same functions the Simulator's panels draw.
 */
export function openHeartSource(sim: Simulation): LiveSource {
  return new LiveSource(sim);
}

/** Rows of both reports, or null for a side that has no solve yet. */
export function heartReports(src: HemoSource): { right: [string, string][] | null; left: [string, string][] | null } {
  const r = rightHeartCath(src), l = leftHeartCath(src.numbers(), src.beats(1)[0], "adult");
  return { right: r ? rhcRows(r) : null, left: l ? cathRows(l) : null };
}
