/**
 * The drug reference table: drug, class sign, target sign, what it does on the stage, typical LDL-C, TG and Lp(a) effects, and
 * regulatory status ("inv" for investigational). Effects are approximate trial means through late 2025, kept here for teaching;
 * they need a sourced review before the page is presented as reference material.
 */
export type DrugRow = [name: string, drugClass: string, target: string, mechanism: string, ldl: string, tg: string, lpa: string, status: string];
export const DRUG_TABLE: DrugRow[] = [
  ["High-intensity statin", "small", "HMGCR", "Synthesis dims; SREBP-2 adds LDLR and also PCSK9", "≥ 50%↓", "10–30%↓", "0–20%↑", "Approved"],
  ["Ezetimibe", "small", "NPC1L1", "Less cholesterol from the gut; liver adds LDLR", "~ 25%↓", "small", "—", "Approved"],
  ["Bempedoic acid", "small", "ACL", "Upstream of the statin step; activated only in liver", "~ 18–25%↓", "—", "—", "Approved"],
  ["Bile acid sequestrant", "bile", "bile", "Bile lost to stool; liver uses cholesterol, adds LDLR", "15–25%↓", "↑", "—", "Approved"],
  ["Evolocumab, alirocumab", "mAb", "PCSK9", "Antibody captures PCSK9; receptors recycle", "~ 60%↓", "small ↓", "~ 25%↓", "Approved"],
  ["Inclisiran", "siRNA", "PCSK9", "Hepatic PCSK9 production silenced, twice yearly", "~ 50%↓", "small ↓", "~ 20%↓", "Approved"],
  ["Enlicitide", "small", "PCSK9", "Oral macrocycle blocks PCSK9–LDLR binding", "~ 55–60%↓", "small ↓", "~ 25%↓", "inv"],
  ["Lerodalcibep", "mAb", "PCSK9", "Monthly anti-PCSK9 fusion protein", "~ 60%↓", "small ↓", "↓", "inv"],
  ["VERVE-102", "edit", "PCSK9", "One-time base edit switches off hepatic PCSK9", "~ 50%↓ (early)", "—", "—", "inv"],
  ["Obicetrapib", "small", "CETP", "CE no longer shuttled to ApoB particles", "~ 30–40%↓", "—", "↓", "inv"],
  ["Evinacumab", "mAb", "ANGPTL3", "LPL and endothelial lipase freed; works without LDLR", "~ 50%↓ in HoFH", "~ 50%↓", "—", "Approved (HoFH)"],
  ["Zodasiran, solbinsiran", "siRNA", "ANGPTL3", "ANGPTL3 production silenced", "↓", "~ 50–60%↓", "—", "inv"],
  ["Lomitapide", "small", "MTP", "Fewer VLDL and chylomicrons assembled; liver fat rises", "~ 40–50%↓", "↓", "—", "Approved (HoFH)"],
  ["Fenofibrate, pemafibrate", "small", "PPARa", "More LPL, less ApoC-III", "variable", "30–50%↓", "—", "Approved"],
  ["Icosapent ethyl", "small", "PPARa", "Less VLDL secreted", "—", "~ 20%↓", "—", "Approved"],
  ["Olezarsen, volanesorsen", "ASO", "apoCIII", "ApoC-III silenced; TG cleared even without LPL", "—", "40–70%↓", "—", "Approved (FCS)"],
  ["Plozasiran", "siRNA", "apoCIII", "ApoC-III silenced by siRNA", "—", "~ 80%↓ in FCS", "—", "Approved (FCS)"],
  ["Pelacarsen", "ASO", "apoa", "apo(a) production silenced", "small", "—", "~ 80%↓", "inv"],
  ["Olpasiran, lepodisiran, zerlasiran", "siRNA", "apoa", "apo(a) production silenced", "small", "—", "> 90%↓", "inv"],
  ["Muvalaplin", "small", "apoa", "Oral; blocks apo(a) docking onto ApoB-100", "small", "—", "~ 65–85%↓", "inv"],
];
