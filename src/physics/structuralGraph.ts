/**
 * Node table of the structural circulation, shared by `structural.ts` (which builds the model) and `core/fromModel.ts` (which
 * turns it into a core graph). It lives here so the two do not import each other.
 */
export const NODES = ["SVC", "IVC", "RA", "RV", "PA", "PV", "LA", "LV", "AO", "DAO"] as const;
export type NodeName = (typeof NODES)[number];
