/**
 * Node table of the structural circulation, shared by `structural.ts` (which builds the model) and `core/fromModel.ts` (which
 * turns it into a core graph). It lives here so the two do not import each other.
 *
 * SPL is the splanchnic venous reservoir (A5): the large, controllable venous compartment between the lower-body bed and the
 * inferior vena cava. It is not a place a catheter can sit and has no drawn structure, so the pages, tables and the bridge list
 * `CATH_NODES` (the first ten) and only the engine and the oxygen solve see all of `NODES`.
 */
export const NODES = ["SVC", "IVC", "RA", "RV", "PA", "PV", "LA", "LV", "AO", "DAO", "SPL"] as const;
export type NodeName = (typeof NODES)[number];
/** Nodes with an anatomical place (a catheter, a drawn vessel or chamber): every node but the splanchnic reservoir. */
export const CATH_NODES = ["SVC", "IVC", "RA", "RV", "PA", "PV", "LA", "LV", "AO", "DAO"] as const;
export type CathNode = (typeof CATH_NODES)[number];
