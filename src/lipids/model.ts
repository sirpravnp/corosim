/**
 * The lipid lab's model: a few rate equations that stand in for lipoprotein metabolism, tuned so single drugs and combinations land
 * near typical trial means. It is the source of truth for the page: the labs come from here, and every view on the stage draws as
 * many particles of each class as these concentrations call for.
 *
 * Two state variables move with time (surface LDLR and free PCSK9, relaxing over tens of seconds of stage time); the rest follow
 * from them at once. Units are arbitrary and scaled so that an untreated normal patient reads LDL-C 100 mg/dL, TG 120, HDL-C 50.
 * A teaching model: constants are assumptions, not fits.
 */

export type GenoId = "wt" | "hefh" | "hofh" | "fcs" | "lpa";
export type DrugId = "statin" | "eze" | "bem" | "mab" | "incl" | "obi" | "fib" | "ipe" | "olez" | "evin" | "lomi" | "olpa";

export interface GenoDef { id: GenoId; label: string; blurb: string }
export const GENOS: GenoDef[] = [
  { id: "wt", label: "Normal", blurb: "No lipid disorder." },
  { id: "hefh", label: "HeFH", blurb: "Heterozygous familial hypercholesterolemia: half the usual LDLR." },
  { id: "hofh", label: "HoFH null", blurb: "Homozygous FH with two null LDLR alleles: almost no functional receptor." },
  { id: "fcs", label: "FCS", blurb: "Familial chylomicronemia syndrome: LPL deficiency." },
  { id: "lpa", label: "High Lp(a)", blurb: "Lp(a) about 220 nmol/L, set by the LPA gene." },
];

export interface DrugDef { id: DrugId; label: string; group: "ldl" | "tg" | "lpa"; investigational?: boolean }
export const DRUGS: DrugDef[] = [
  { id: "statin", label: "Statin", group: "ldl" },
  { id: "eze", label: "Ezetimibe", group: "ldl" },
  { id: "bem", label: "Bempedoic acid", group: "ldl" },
  { id: "mab", label: "PCSK9 antibody", group: "ldl" },
  { id: "incl", label: "Inclisiran", group: "ldl" },
  { id: "obi", label: "Obicetrapib", group: "ldl", investigational: true },
  { id: "fib", label: "Fibrate", group: "tg" },
  { id: "ipe", label: "Icosapent ethyl", group: "tg" },
  { id: "olez", label: "Olezarsen", group: "tg" },
  { id: "evin", label: "Evinacumab", group: "tg" },
  { id: "lomi", label: "Lomitapide", group: "tg" },
  { id: "olpa", label: "Olpasiran", group: "lpa", investigational: true },
];

/** Rate constants for one patient on one set of drugs. */
export interface Rates {
  geno: GenoId; drugs: ReadonlySet<DrugId>;
  /** LDLR synthesis, PCSK9 secretion, PCSK9 removal by antibody. */
  S: number; ppc: number; kab: number;
  /** VLDL secretion, receptor-independent LDL and IDL clearance. */
  vldl: number; ki: number; kiIdl: number;
  /** LPL activity and LPL-independent remnant clearance; fraction of particles still carrying ApoC-III; CE carried per LDL. */
  lpl: number; indep: number; c3: number; ce: number;
}

const KR = 0.0017, KD0 = 0.015, KPC = 0.0025, KPCC = 0.025, KCONV = 0.3;
/** Receptor-mediated LDL clearance, saturating at high receptor numbers. */
export const recRate = (R: number) => (KR * R) / (1 + R / 60);

export function rates(geno: GenoId, drugs: ReadonlySet<DrugId>): Rates {
  const d = drugs;
  let S = 0.8, vldl = 1.6, ppc = 0.25, kab = 0, ki = 0.006, kiIdl = 0.12, lpl = 1, c3 = 1, ce = 1;
  if (geno === "hefh") S *= 0.5;
  if (geno === "hofh") S *= 0.004;
  if (geno === "fcs") lpl = 0.06;
  if (d.has("statin")) { S *= 2.4; ppc *= 1.5; vldl *= 0.85; }
  if (d.has("eze")) S *= 1.35;
  if (d.has("bem")) S *= 1.3;
  if (d.has("incl")) ppc *= 0.2;
  if (d.has("mab")) kab = 0.9;
  if (d.has("obi")) { ki += 0.003; ce *= 0.85; }
  if (d.has("evin")) { vldl *= 0.8; ki += 0.0016; kiIdl += 0.2; lpl *= 1.8; }
  if (d.has("lomi")) vldl *= 0.5;
  if (d.has("ipe")) vldl *= 0.8;
  if (d.has("fib")) { vldl *= 0.9; c3 *= 0.8; lpl *= 1.5; }
  if (d.has("olez")) { c3 *= 0.25; kiIdl += 0.25; lpl *= 2; }
  const indep = 0.02 + (d.has("olez") ? 0.27 : 0) + (d.has("evin") ? 0.05 : 0);
  return { geno, drugs, S, ppc, kab, vldl, ki, kiIdl, lpl, indep, c3, ce };
}

/** Steady state of the two moving pools. */
export function steady(r: Rates): { R: number; PC: number } {
  const PC = r.ppc / (KPCC + r.kab);
  return { PC, R: r.S / (KD0 + KPC * PC) };
}

export interface Labs {
  ldl: number; tg: number; tgVldl: number; tgChylo: number; hdl: number; lpa: number; apob: number; nonHdl: number; tc: number;
  /** Lipolysis relative to normal, IDL clearance rate, share of particles carrying ApoC-III. */
  lipolysis: number; idlClearance: number; c3: number;
}

function raw(r: Rates, R: number, meal: number) {
  const Ln = (r.lpl + r.indep) / 1.02, hIdl = r.kiIdl + 0.002 * R, Lc = Math.max(0.3, Ln);
  const f = (KCONV * Lc) / (KCONV * Lc + hIdl), h = r.ki + recRate(R);
  return { ldlRaw: ((r.vldl * f) / h) * r.ce, Ln, hIdl };
}
const NORMAL = (() => { const r = rates("wt", new Set()); return raw(r, steady(r).R, 0).ldlRaw; })();

/** The lab panel for these rates, at surface receptor level R and a meal that has `meal` (0..1) of its chylomicrons still circulating. */
export function labsAt(r: Rates, R: number, meal: number): Labs {
  const { ldlRaw, Ln, hIdl } = raw(r, R, meal), d = r.drugs;
  const ldl = (100 * ldlRaw) / NORMAL;
  const tgVldl = (95 * (r.vldl / 1.6)) / Math.sqrt(Ln), tgChylo = (25 + 260 * meal) / Math.pow(Ln, 1.3), tg = tgVldl + tgChylo;
  const hdl = 50 * (r.geno === "fcs" ? 0.5 : 1) * (d.has("fib") ? 1.1 : 1) * (d.has("obi") ? 2.3 : 1) * (d.has("olez") ? 1.4 : 1) * (d.has("evin") ? 0.7 : 1) * (d.has("statin") ? 1.05 : 1);
  const lpa = (r.geno === "lpa" ? 220 : 20) * (d.has("statin") ? 1.1 : 1) * (d.has("mab") ? 0.75 : 1) * (d.has("incl") ? 0.8 : 1) * (d.has("obi") ? 0.7 : 1) * (d.has("olpa") ? 0.05 : 1);
  const nonHdl = ldl + tgVldl / 5 + tgChylo / 10;
  return { ldl, tg, tgVldl, tgChylo, hdl, lpa, nonHdl, tc: nonHdl + hdl, apob: 0.62 * nonHdl + 12, lipolysis: Ln, idlClearance: hIdl, c3: r.c3 };
}

/** The steady-state panel for a patient on a set of drugs (fasting). */
export function steadyLabs(geno: GenoId, drugs: ReadonlySet<DrugId>, meal = 0): Labs {
  const r = rates(geno, drugs);
  return labsAt(r, steady(r).R, meal);
}

export interface Snapshot extends Labs {
  rates: Rates;
  /** Surface LDLR and free PCSK9, 1 = normal. */
  receptors: number; pcsk9: number;
  /** Share of receptor loss due to PCSK9, which the liver view draws as hooks on receptors. */
  pcsk9Share: number;
  /** Receptor-mediated LDL uptake relative to normal: how often the liver view docks a particle. */
  uptake: number;
  /** The same patient untreated, for the change column. */
  untreated: Labs;
  meal: number;
}

/** The running model: patient, drugs and the two pools that take time to settle. */
export class LipidModel {
  geno: GenoId = "wt";
  drugs = new Set<DrugId>();
  R: number; PC: number; meal = 0;
  constructor() { const s = steady(rates("wt", this.drugs)); this.R = s.R; this.PC = s.PC; }
  rates() { return rates(this.geno, this.drugs); }
  /** A genotype is lifelong, so a new one starts at its own steady state on the current drugs. */
  setGeno(g: GenoId) { this.geno = g; const s = steady(this.rates()); this.R = s.R; this.PC = s.PC; }
  toggle(d: DrugId, on = !this.drugs.has(d)) { if (on) this.drugs.add(d); else this.drugs.delete(d); }
  feed() { this.meal = 1; }
  step(dt: number) {
    const r = this.rates();
    this.PC += (r.ppc - (KPCC + r.kab) * this.PC) * dt;
    this.R += (r.S - (KD0 + KPC * this.PC) * this.R) * dt;
    this.meal *= Math.exp(-dt / 25);
  }
  snapshot(): Snapshot {
    const r = this.rates(), labs = labsAt(r, this.R, this.meal);
    const un = rates(this.geno, new Set()), u = labsAt(un, steady(un).R, this.meal);
    return {
      ...labs, rates: r, receptors: this.R / 20, pcsk9: this.PC / 10, pcsk9Share: (KPC * this.PC) / (KD0 + KPC * this.PC),
      uptake: (recRate(this.R) * labs.ldl) / (recRate(20) * 100), untreated: u, meal: this.meal,
    };
  }
}
