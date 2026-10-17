import { PROCEDURE, Procedure } from "../config/management";
import { Graft, Lesion, graftsFor } from "./network";
import { Tree } from "../anatomy/tree";
import { mulberry32 } from "./ecg";

/** A revascularization that has been ordered and is on its way: it takes clinical minutes to reach the artery. */
export interface Pending { kind: Procedure; remaining: number; total: number }

/** What the vessel looks like after the artery has been treated. */
export interface Treated { stent: boolean; lysed: boolean | null; grafts: Graft[] }
export const untreated = (): Treated => ({ stent: false, lysed: null, grafts: [] });

export const order = (kind: Procedure): Pending => ({ kind, remaining: PROCEDURE[kind].delayMin, total: PROCEDURE[kind].delayMin });

/** Fibrinolysis opens the artery in about 55% of patients; this patient's draw is fixed by the case so it can be replayed. */
export const lysisWorks = (seed: number) => mulberry32(seed)() < PROCEDURE.lysisSuccess;

/**
 * The lesion after a procedure lands.
 *  - PCI: the lesion is stented open.
 *  - Fibrinolytic: if it works, the clot goes and a residual stenosis is left; if not, nothing changes.
 *  - CABG: the lesion is untouched; a graft is sewn on beyond it.
 */
export function applyProcedure(kind: Procedure, lesion: Lesion | null, tree: Tree, seed: number): { lesion: Lesion | null; graft?: Graft[]; lysed?: boolean } {
  if (!lesion) return { lesion };
  if (kind === "pci") return { lesion: null };
  if (kind === "cabg") return { lesion, graft: graftsFor(tree, lesion) };
  if (!lesion.occluded) return { lesion }; // no clot to lyse in a stenosis
  if (!lysisWorks(seed)) return { lesion, lysed: false };
  return { lesion: { ...lesion, ds: PROCEDURE.lysisResidual, occluded: false }, lysed: true };
}
