import { DRUGS, DrugId, GenoId, steadyLabs } from "./model";

/**
 * Where each stage drug acts and what it does, for the on-stage callout when it is switched on and for the drug cards. `key` is the
 * sign the views register at the target, so the stage can find it; `views` are the views that draw that target.
 */
export interface DrugInfo { key: string; target: string; views: string[]; action: string }
export const DRUG_INFO: Record<DrugId, DrugInfo> = {
  statin: { key: "HMGCR", target: "HMG-CoA reductase", views: ["liver"], action: "blocks HMG-CoA reductase; the liver adds LDLR" },
  eze: { key: "NPC1L1", target: "NPC1L1", views: ["gut"], action: "blocks NPC1L1, so less cholesterol is absorbed" },
  bem: { key: "ACL", target: "ATP citrate lyase", views: ["liver"], action: "blocks ATP citrate lyase, upstream of the statin step" },
  mab: { key: "mAb", target: "PCSK9", views: ["liver"], action: "captures free PCSK9, so LDLR recycles" },
  incl: { key: "siRNA", target: "PCSK9 mRNA", views: ["liver"], action: "silences PCSK9 mRNA in the hepatocyte" },
  obi: { key: "CETP", target: "CETP", views: ["plasma"], action: "stops CETP shuttling cholesteryl ester to ApoB particles" },
  fib: { key: "PPARa", target: "PPAR-α", views: ["cap"], action: "switches on PPAR-α: more LPL, less ApoC-III" },
  ipe: { key: "VLDL", target: "VLDL secretion", views: ["liver"], action: "lowers VLDL secretion from the liver" },
  olez: { key: "LPL", target: "ApoC-III", views: ["cap"], action: "silences ApoC-III, which frees LPL and remnant clearance" },
  evin: { key: "ANGPTL3", target: "ANGPTL3", views: ["cap"], action: "captures ANGPTL3, freeing LPL" },
  lomi: { key: "MTP", target: "MTP", views: ["liver", "gut"], action: "blocks MTP, so fewer VLDL and chylomicrons are built" },
  olpa: { key: "LPA", target: "apo(a) mRNA", views: ["liver"], action: "silences apo(a), so the liver makes far less Lp(a)" },
};

export const LAB_NAMES = { ldl: "LDL-C", tg: "TG", hdl: "HDL-C", lpa: "Lp(a)" } as const;
type LabKey = keyof typeof LAB_NAMES;

/** Percent change in each lab for a drug set against the same patient untreated, at steady state. */
export function effect(geno: GenoId, drugs: Iterable<DrugId>): Record<LabKey, number> {
  const on = steadyLabs(geno, new Set(drugs)), off = steadyLabs(geno, new Set());
  const pct = (k: LabKey) => Math.round((on[k] / off[k] - 1) * 100);
  return { ldl: pct("ldl"), tg: pct("tg"), hdl: pct("hdl"), lpa: pct("lpa") };
}
/** The changes worth naming, largest first: "LDL-C −47%, TG −14%". */
export function effectText(e: Record<LabKey, number>, max = 3): string {
  const parts = (Object.keys(LAB_NAMES) as LabKey[]).filter((k) => Math.abs(e[k]) >= 3).sort((a, b) => Math.abs(e[b]) - Math.abs(e[a])).slice(0, max);
  return parts.length ? parts.map((k) => `${LAB_NAMES[k]} ${e[k] > 0 ? "+" : "−"}${Math.abs(e[k])}%`).join(", ") : "little change in this patient";
}
export const drugLabel = (d: DrugId) => DRUGS.find((x) => x.id === d)!.label;
