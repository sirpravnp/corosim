/**
 * The lipid lab's visual vocabulary: the thermal ramp for particle cores, and one sign per apolipoprotein, receptor, enzyme and
 * drug class. Ligands and receptors are designed as lock-and-key pairs (the ApoB-100 wedge seats in the LDLR cup). The same markup
 * is used in the HTML key and, rendered to images, on the canvas.
 */
const RAMP: [number, string][] = [[0, "#3a0603"], [0.22, "#8c130b"], [0.48, "#d8401a"], [0.7, "#f49218"], [0.86, "#fbd24a"], [1, "#fff6dc"]];
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function ramp(t: number): string {
  t = Math.max(0, Math.min(1, t)); let k = 0;
  while (k < RAMP.length - 2 && t > RAMP[k + 1][0]) k++;
  const [t0, c0] = RAMP[k], [t1, c1] = RAMP[k + 1], u = (t - t0) / (t1 - t0), a = hex(c0), b = hex(c1);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`;
}
/** Particle core color: the thermal ramp, hot for a triglyceride-rich core. */
export const coreColor = (tg: number) => ramp(0.18 + 0.82 * tg);

export const S = 'stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round" stroke-linecap="round"';
const F = 'fill="currentColor"';
const hexPts = (r: number, rot = 0) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i + rot; return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`; }).join(" ");
const ring = (r: number, ticks: number) => `<circle r="${r}" ${S}/>` + Array.from({ length: ticks }, (_, i) => { const a = 2 * Math.PI * i / ticks - Math.PI / 2; return `<path d="M${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)} L${((r + 3.5) * Math.cos(a)).toFixed(2)},${((r + 3.5) * Math.sin(a)).toFixed(2)}" ${S}/>`; }).join("");
/** Every sign on the page, as SVG markup in a 24-unit box centered on the origin, drawn in currentColor. */
export const G: Record<string, string> = {
  apoB100: `<path d="M0,-7 L7,6 L-7,6 Z" ${F}/>`,
  apoB48: `<path d="M-7,6 L-3,-2 L3,-2 L7,6 Z" ${S}/>`,
  apoE: `<path d="M0,-7 L6,0 L0,7 L-6,0 Z" ${F}/>`,
  apoCII: `<circle r="6" ${S}/><circle r="2.2" ${F}/>`,
  apoCIII: `<path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  apoAI: `<polygon points="${hexPts(6.5)}" ${S}/>`,
  apoAII: `<polygon points="${hexPts(5)}" ${F}/>`,
  apoAIV: `<rect x="-5" y="-5" width="10" height="10" ${S}/>`,
  apoAV: `<rect x="-4.5" y="-4.5" width="9" height="9" ${F}/>`,
  apoa: `<path d="M-9,0 H9" ${S}/><circle cx="-6" r="2.6" ${S}/><circle cx="0" r="2.6" ${S}/><circle cx="6" r="2.6" ${S}/>`,
  LDLR: `<path d="M-7,-7 L0,4 L7,-7 M0,4 V10" ${S}/>`,
  LRP1: `<path d="M-9,-6 L-4.5,3 L0,-6 L4.5,3 L9,-6 M-4.5,3 V10 M4.5,3 V10" ${S}/>`,
  SRB1: `<path d="M-7,-6 L-7,0 L-3.5,5 L3.5,5 L7,0 L7,-6 M0,5 V10" ${S}/>`,
  ABCA1: `<path d="M-4,-9 V9 M4,-9 V9 M0,6 V-6 M-2.5,-3.5 L0,-6 L2.5,-3.5" ${S}/>`,
  ABCG58: `<path d="M-8,-9 V9 M-2,-9 V9 M2,-9 V9 M8,-9 V9 M-5,5 V-5 M5,5 V-5 M-6.5,-3 L-5,-5 L-3.5,-3 M3.5,-3 L5,-5 L6.5,-3" ${S}/>`,
  NPC1L1: `<path d="M-8,-8 L-2.5,1 V9 M8,-8 L2.5,1 V9" ${S}/>`,
  LPL: `<path d="M0,0 L-4,-5.7 A7,7 0 1,0 4,-5.7 Z" ${F}/><path d="M0,7 V10.5" ${S}/>`,
  HL: `<path d="M0,0 L-4,-5.7 A7,7 0 1,0 4,-5.7 Z" ${S}/>`,
  CETP: `<path d="M-8,4 Q0,-8 8,4" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  LCAT: `<path d="M0,-7 V7 M-6,-3.5 L6,3.5 M6,-3.5 L-6,3.5" ${S}/>`,
  PCSK9: `<path d="M3,-9 V2 A4.5,4.5 0 0,1 -6,2" ${S} stroke-width="2.2"/>`,
  ANGPTL3: `<path d="M0,9 V-1 M-5,-8 V-1 H5 V-8 M0,-1 V-8" ${S}/>`,
  ANGPTL4: `<path d="M0,9 V-1 M-5,-8 V-1 H5 V-8" ${S}/>`,
  MTP: `<path d="M-7,-7 H-2 V7 H-7 M7,-7 H2 V7 H7" ${S}/>`,
  HMGCR: ring(5, 6),
  ACL: ring(5, 3),
  SREBP2: `<path d="M-8,0 H8 M-8,0 L-4,-5 M-8,0 L-4,5" ${S}/><circle cx="5" r="2" ${F}/>`,
  PPARa: `<path d="M-7,-6 H7 V6 H-7 Z" ${S}/><path d="M-3,0 H3 M0,-3 V3" ${S}/>`,
  mAb: `<path d="M0,9 V1 L-5.5,-5 M0,1 L5.5,-5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="-7" cy="-7" r="2.6" fill="currentColor"/><circle cx="7" cy="-7" r="2.6" fill="currentColor"/>`,
  siRNA: `<path d="M-9,-3 q2.25,-3 4.5,0 t4.5,0 t4.5,0 t4.5,0 M-9,3 q2.25,-3 4.5,0 t4.5,0 t4.5,0 t4.5,0" ${S}/>`,
  ASO: `<path d="M-9,0 q2.25,-3.5 4.5,0 t4.5,0 t4.5,0 t4.5,0" ${S} stroke-width="2"/>`,
  small: `<circle r="3.6" ${F}/><circle r="7" ${S} stroke-dasharray="2 2.4"/>`,
  edit: `<path d="M0,-9 V-2.5 M0,2.5 V9 M-5,-2.5 H5 M-5,2.5 H5" ${S}/>`,
  SRA: `<path d="M-7,-7 A7,7 0 0,0 7,-7" ${S}/><path d="M0,0 V9" ${S}/><circle cx="0" cy="-3" r="1.6" fill="currentColor"/>`,
  bile: `<path d="M-7,6 C-7,-4 7,4 7,-6" ${S}/><circle cx="-7" cy="6" r="2" ${F}/>`,
};
export const svgG = (id: string, cls = "", vb = 24) => `<svg viewBox="${-vb / 2} ${-vb / 2} ${vb} ${vb}" class="${cls}" aria-hidden="true">${G[id]}</svg>`;

/** The full glyph reference: group heading, then [glyph id, name, description]. */
export const LEGEND: [string, [string, string, string][]][] = [
  ["Apolipoproteins (on particles)", [
    ["apoB100", "ApoB-100", "One per VLDL, IDL, LDL and Lp(a). The wedge is the LDLR-binding site."],
    ["apoB48", "ApoB-48", "Intestinal, truncated ApoB. Hollow, cut wedge: no LDLR-binding domain."],
    ["apoE", "ApoE", "Remnant clearance through LDLR and LRP1. E2/E2 binds poorly."],
    ["apoCII", "ApoC-II", "LPL cofactor. The dot is the activating contact."],
    ["apoCIII", "ApoC-III", "Inhibits LPL and remnant uptake. Drawn as a cross."],
    ["apoAI", "ApoA-I", "HDL scaffold, LCAT activator, ligand for ABCA1 and SR-B1."],
    ["apoAII", "ApoA-II", "Second HDL protein."],
    ["apoAIV", "ApoA-IV", "Intestinal, on chylomicrons."],
    ["apoAV", "ApoA-V", "Raises LPL activity; variants cause severe hypertriglyceridemia."],
    ["apoa", "apo(a)", "Kringle chain tethered to ApoB-100, makes Lp(a)."],
  ]],
  ["Receptors and transporters (on cells)", [
    ["LDLR", "LDLR", "Liver. Cup takes the ApoB-100 wedge or the ApoE diamond, then recycles."],
    ["LRP1", "LRP1", "Liver. Double cup for ApoE-rich remnants."],
    ["SRB1", "SR-B1", "Liver. Half-hexagon socket; selective CE uptake from HDL."],
    ["ABCA1", "ABCA1 / ABCG1", "Macrophage. Channel pushing cholesterol out to ApoA-I."],
    ["NPC1L1", "NPC1L1", "Enterocyte. Funnel for dietary and biliary cholesterol."],
    ["ABCG58", "ABCG5/G8", "Enterocyte and liver. Pumps sterol back to gut and bile."],
    ["SRA", "SR-A / CD36", "Macrophage. Scavenger receptors that take up oxidized LDL."],
  ]],
  ["Enzymes and regulators", [
    ["LPL", "LPL", "Capillary wall, anchored on GPIHBP1. Hydrolyzes TG."],
    ["HL", "Hepatic lipase", "Liver surface. IDL to LDL, HDL2 to HDL3."],
    ["CETP", "CETP", "Shuttles CE from HDL to ApoB particles, TG back."],
    ["LCAT", "LCAT", "Esterifies HDL cholesterol so HDL matures."],
    ["PCSK9", "PCSK9", "Hook. Binds LDLR so it is destroyed, not recycled."],
    ["ANGPTL3", "ANGPTL3", "Fork. Inhibits LPL and endothelial lipase."],
    ["ANGPTL4", "ANGPTL4", "Two-prong fork. Inhibits LPL in fasting adipose."],
    ["MTP", "MTP", "Clamp. Loads lipid onto ApoB in liver and gut."],
    ["HMGCR", "HMG-CoA reductase", "Rate-limiting step in cholesterol synthesis."],
    ["ACL", "ATP citrate lyase", "Upstream of HMG-CoA reductase."],
    ["SREBP2", "SREBP-2", "Low liver sterol switches on LDLR and PCSK9."],
    ["PPARa", "PPAR-α", "Nuclear receptor; raises LPL, lowers ApoC-III."],
  ]],
  ["Drug classes", [
    ["small", "Small molecule", "Statins, ezetimibe, bempedoic acid, obicetrapib, muvalaplin, enlicitide."],
    ["mAb", "Monoclonal antibody", "Evolocumab, alirocumab, evinacumab."],
    ["siRNA", "siRNA", "Inclisiran, olpasiran, lepodisiran, zerlasiran, plozasiran, zodasiran."],
    ["ASO", "Antisense", "Pelacarsen, olezarsen, volanesorsen."],
    ["edit", "Gene editing", "One-time base editing of PCSK9 or ANGPTL3."],
    ["bile", "Bile acid sequestrant", "Binds bile acids in the gut lumen."],
  ]],
];
/** Ligand and receptor pairs drawn as lock and key. */
export const PAIRS: [string, string, string][] = [["apoB100", "LDLR", "ApoB-100 → LDLR"], ["apoE", "LDLR", "ApoE → LDLR"], ["apoE", "LRP1", "ApoE → LRP1"], ["apoAI", "SRB1", "ApoA-I → SR-B1"], ["apoCII", "LPL", "ApoC-II → LPL"], ["PCSK9", "LDLR", "PCSK9 → LDLR"], ["mAb", "PCSK9", "antibody → PCSK9"]];
