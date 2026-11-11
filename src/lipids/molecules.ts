import { G, coreColor, ramp } from "./glyphs";

/** The lipoprotein classes as cards: the drawing, its physical data and the back of the card. */
export interface Mol {
  name: string; d: string; dRep: number; dens: string; core: string; tg: number; src: string; seed: number;
  apos: string[]; belt?: "b48" | "b100"; apoa?: boolean; disc?: boolean; extra?: string[];
}
export interface CardBack { fam: string; what: string; binds: [string, string, string][]; drugs: string; pearl: string }

/** A small seeded random generator, so drawings are stable between renders. */
export function rnd(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** One lipoprotein drawn as on its card: stippled shell, ramp-filled core, ApoB belt and its other apolipoproteins. */
export function molSVG(m: Mol, size = 180): string {
  const c = size / 2, r = 8 + 19 * Math.log10(m.dRep / 5), R = rnd(m.seed);
  let out = "";
  if (m.disc) {
    const w = r * 2.6, h = r * 0.9;
    out += `<rect x="${c - w / 2}" y="${c - h / 2}" width="${w}" height="${h}" fill="${coreColor(m.tg)}" opacity="0.55"/>`;
    for (let x = c - w / 2; x <= c + w / 2; x += 3.2) out += `<circle cx="${x.toFixed(1)}" cy="${(c - h / 2).toFixed(1)}" r="0.9" fill="currentColor"/><circle cx="${x.toFixed(1)}" cy="${(c + h / 2).toFixed(1)}" r="0.9" fill="currentColor"/>`;
    ([[c - w / 2 - 8, c], [c + w / 2 + 8, c]] as const).forEach(([x, y]) => out += `<g transform="translate(${x},${y}) scale(0.8)" color="currentColor">${G.apoAI}</g>`);
    return `<svg class="pic" viewBox="0 0 ${size} ${size}" role="img" aria-label="${m.name}">${out}</svg>`;
  }
  out += `<circle cx="${c}" cy="${c}" r="${(r - 2).toFixed(1)}" fill="${coreColor(m.tg)}"/>`;
  const dots = Math.max(18, Math.round(r * 1.1));
  for (let i = 0; i < dots * 3; i++) { // core stipple: CE as darker dots
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (r - 4);
    if (R() > m.tg) out += `<circle cx="${(c + d * Math.cos(a)).toFixed(1)}" cy="${(c + d * Math.sin(a)).toFixed(1)}" r="0.9" fill="${ramp(0.08)}" opacity="0.8"/>`;
  }
  const n = Math.round(2 * Math.PI * r / 3.1);
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out += `<circle cx="${(c + r * Math.cos(a)).toFixed(1)}" cy="${(c + r * Math.sin(a)).toFixed(1)}" r="1" fill="currentColor"/>`; }
  if (m.belt) { // ApoB belt: one per particle
    const br = r + 3, a0 = -Math.PI * 0.95, a1 = Math.PI * (m.belt === "b48" ? 0.05 : 0.55);
    const p = (a: number) => `${(c + br * Math.cos(a)).toFixed(1)},${(c + br * Math.sin(a)).toFixed(1)}`;
    out += `<path d="M${p(a0)} A${br},${br} 0 ${a1 - a0 > Math.PI ? 1 : 0},1 ${p(a1)}" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    const tx = c + (br + 7) * Math.cos(a1), ty = c + (br + 7) * Math.sin(a1), rot = a1 * 180 / Math.PI + 90;
    out += `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(0.75)">${m.belt === "b48" ? G.apoB48 : G.apoB100}</g>`;
  }
  if (m.apoa) {
    const ax = c + (r + 3) * Math.cos(-Math.PI * 0.25), ay = c + (r + 3) * Math.sin(-Math.PI * 0.25);
    out += `<path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${(ax + 12).toFixed(1)},${(ay - 12).toFixed(1)}" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.5"/>`;
    for (let k = 0; k < 6; k++) out += `<circle cx="${(ax + 15 + k * 5.2).toFixed(1)}" cy="${(ay - 15 - k * 3).toFixed(1)}" r="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
  }
  const others = m.apos.filter((a: string) => a !== "apoB100" && a !== "apoB48");
  const start = m.belt ? Math.PI * (m.belt === "b48" ? 0.3 : 0.78) : -Math.PI / 2, span = m.belt ? Math.PI * (m.belt === "b48" ? 0.6 : 0.4) : Math.PI * 2;
  others.forEach((id: string, i: number) => {
    const a = start + span * (others.length === 1 ? 0.5 : (m.belt ? i / (others.length - 1) : i / others.length));
    const gx = c + (r + 9) * Math.cos(a), gy = c + (r + 9) * Math.sin(a);
    out += `<g transform="translate(${gx.toFixed(1)},${gy.toFixed(1)}) scale(0.62)">${G[id]}</g>`;
  });
  // extra apos for large particles: repeat copies of exchangeable apos around the belt-free arc
  const extra = m.extra;
  if (extra) extra.forEach((id: string, i: number) => {
    const a = -Math.PI * 0.95 + (i + 0.5) * (Math.PI * 0.9) / extra.length;
    const gx = c + (r + 13) * Math.cos(a), gy = c + (r + 13) * Math.sin(a);
    out += `<g transform="translate(${gx.toFixed(1)},${gy.toFixed(1)}) scale(0.55)">${G[id]}</g>`;
  });
  return `<svg class="pic" viewBox="0 0 ${size} ${size}" role="img" aria-label="${m.name}">${out}</svg>`;
}
export const APONAME: Record<string, string> = { apoB100: "B-100", apoB48: "B-48", apoE: "E", apoCII: "C-II", apoCIII: "C-III", apoAI: "A-I", apoAII: "A-II", apoAIV: "A-IV", apoAV: "A-V", apoa: "apo(a)" };
export const MOLS: Mol[] = [
  { name: "Chylomicron", d: "75–1,200 nm", dRep: 300, dens: "< 0.95", core: "~ 90 : 10", tg: 0.92, belt: "b48", apos: ["apoB48", "apoCII", "apoCIII", "apoE", "apoAI", "apoAIV", "apoAV"], extra: ["apoCII", "apoCIII", "apoAI", "apoCII"], src: "Intestine", seed: 11 },
  { name: "Chylomicron remnant", d: "30–80 nm", dRep: 60, dens: "< 1.006", core: "~ 55 : 45", tg: 0.55, belt: "b48", apos: ["apoB48", "apoE", "apoCIII"], src: "LPL on chylomicrons", seed: 12 },
  { name: "VLDL", d: "30–80 nm", dRep: 55, dens: "0.95–1.006", core: "~ 70 : 30", tg: 0.72, belt: "b100", apos: ["apoB100", "apoCII", "apoCIII", "apoE", "apoAV"], src: "Liver", seed: 13 },
  { name: "IDL", d: "25–35 nm", dRep: 30, dens: "1.006–1.019", core: "~ 45 : 55", tg: 0.45, belt: "b100", apos: ["apoB100", "apoE", "apoCIII"], src: "LPL on VLDL", seed: 14 },
  { name: "LDL, large buoyant", d: "23–27 nm", dRep: 25, dens: "1.019–1.044", core: "~ 12 : 88", tg: 0.12, belt: "b100", apos: ["apoB100"], src: "HL on IDL", seed: 15 },
  { name: "LDL, small dense", d: "19–23 nm", dRep: 20, dens: "1.044–1.063", core: "~ 20 : 80", tg: 0.2, belt: "b100", apos: ["apoB100"], src: "CETP + HL when TG is high", seed: 16 },
  { name: "Lp(a)", d: "~ 25 nm", dRep: 25, dens: "1.05–1.12", core: "~ 12 : 88", tg: 0.12, belt: "b100", apoa: true, apos: ["apoB100", "apoa"], src: "Liver; level set by LPA gene", seed: 17 },
  { name: "Pre-β HDL", d: "5–9 nm", dRep: 7, dens: "> 1.21", core: "lipid-poor disc", tg: 0.05, disc: true, apos: ["apoAI"], src: "Liver, intestine; ABCA1 loads it", seed: 18 },
  { name: "HDL3", d: "7–9 nm", dRep: 8.5, dens: "1.125–1.21", core: "~ 15 : 85", tg: 0.15, apos: ["apoAI", "apoAII", "apoAI"], src: "LCAT on pre-β HDL", seed: 19 },
  { name: "HDL2", d: "9–12 nm", dRep: 11, dens: "1.063–1.125", core: "~ 15 : 85", tg: 0.15, apos: ["apoAI", "apoAII", "apoAI", "apoCII", "apoCIII", "apoE"], src: "Matured HDL3", seed: 20 },
];
/** The back of each card, in the order of MOLS. */
export const BACKS: CardBack[] = [
  { fam: "ApoB-48 family", what: "Built in the enterocyte after a fatty meal: ApoB-48 wrapped around dietary triglyceride and cholesterol. It leaves through the lacteal and thoracic duct, so it reaches the blood without passing the liver. LPL in muscle and fat capillaries strips most of its triglyceride within minutes.",
    binds: [["apoCII", "LPL", "ApoC-II → LPL"]], drugs: "ApoC-III silencers, fibrates, lomitapide (fewer assembled), evinacumab", pearl: "Persists while fasting in LPL deficiency (FCS): TG above 1,000 mg/dL, pancreatitis, lipemia retinalis, eruptive xanthomas." },
  { fam: "ApoB-48 family", what: "What is left of a chylomicron after LPL: smaller, cholesterol-enriched and carrying ApoE. The liver clears it through LRP1 and LDLR, both binding ApoE.",
    binds: [["apoE", "LRP1", "ApoE → LRP1"], ["apoE", "LDLR", "ApoE → LDLR"]], drugs: "ApoC-III silencers speed its clearance", pearl: "Remnants build up with ApoE2/E2 plus a second hit such as diabetes or hypothyroidism (dysbetalipoproteinemia): palmar and tuberoeruptive xanthomas." },
  { fam: "ApoB-100 family", what: "Secreted by the liver. MTP loads triglyceride onto ApoB-100 in the ER, one ApoB per particle. Carries triglyceride made in the liver to muscle and fat.",
    binds: [["apoCII", "LPL", "ApoC-II → LPL"], ["apoE", "LDLR", "ApoE → LDLR"]], drugs: "Lomitapide, icosapent ethyl, fibrates, evinacumab, statins (modest)", pearl: "Overproduced in insulin resistance, alcohol use and nephrotic syndrome." },
  { fam: "ApoB-100 family", what: "VLDL after LPL. About half is taken up by the liver through ApoE; hepatic lipase turns the rest into LDL.",
    binds: [["apoE", "LDLR", "ApoE → LDLR"], ["apoE", "LRP1", "ApoE → LRP1"]], drugs: "Evinacumab, ApoC-III silencers", pearl: "Rises with remnants in dysbetalipoproteinemia; the TC and TG are often both near 300–400 mg/dL." },
  { fam: "ApoB-100 family", what: "End product of VLDL lipolysis and the main carrier of plasma cholesterol. Only ApoB-100 is left on it, so its clearance depends almost entirely on LDLR.",
    binds: [["apoB100", "LDLR", "ApoB-100 → LDLR"]], drugs: "Statins, ezetimibe, bempedoic acid, PCSK9 antibodies, inclisiran, obicetrapib", pearl: "LDLR, APOB and PCSK9 variants cause familial hypercholesterolemia; lifelong exposure drives ASCVD." },
  { fam: "ApoB-100 family", what: "Made when triglyceride is high: CETP swaps TG into LDL for CE, and hepatic lipase removes the TG, leaving a smaller, denser particle. More particles carry the same LDL-C.",
    binds: [["apoB100", "LDLR", "ApoB-100 → LDLR (weaker)"]], drugs: "Triglyceride lowering, statins", pearl: "Why ApoB or non-HDL-C tracks risk better than LDL-C in metabolic syndrome." },
  { fam: "ApoB-100 family", what: "An LDL-like particle with apo(a) joined to ApoB-100 by a disulfide bond. The level is about 90% genetic (LPA gene, kringle IV-2 copy number) and stable through life. It carries oxidized phospholipids.",
    binds: [["apoB100", "LDLR", "ApoB-100 → LDLR (minor route)"]], drugs: "PCSK9 antibodies (about 25% lower); olpasiran, lepodisiran, zerlasiran, pelacarsen and muvalaplin (investigational). Statins can raise it.", pearl: "Above about 125 nmol/L it raises ASCVD and aortic stenosis risk. Measure it once in every adult." },
  { fam: "ApoA-I family", what: "Lipid-poor ApoA-I from the liver and gut. It collects cholesterol and phospholipid from macrophages through ABCA1, the first step of reverse cholesterol transport.",
    binds: [["apoAI", "ABCA1", "ApoA-I → ABCA1"]], drugs: "CETP inhibition enlarges the HDL pool", pearl: "Tangier disease (ABCA1 loss): very low HDL-C, orange tonsils, neuropathy." },
  { fam: "ApoA-I family", what: "Small, dense HDL after LCAT esterifies its cholesterol so it moves into the core.",
    binds: [["apoAI", "SRB1", "ApoA-I → SR-B1"]], drugs: "Fibrates, CETP inhibitors", pearl: "LCAT deficiency: corneal opacities, very low HDL-C, kidney disease." },
  { fam: "ApoA-I family", what: "Larger, CE-rich HDL. Delivers CE to the liver through SR-B1 or hands it to ApoB particles through CETP.",
    binds: [["apoAI", "SRB1", "ApoA-I → SR-B1"]], drugs: "Obicetrapib raises it; fibrates and olezarsen modestly", pearl: "Raising HDL-C on its own has not cut events. HDL function, not level, is the open question." },
];
