import { Variant, TYPICAL, buildTree } from "../anatomy/tree";
import { Lesion } from "../physics/network";
import { AutonomicControls, defaultControls } from "../physics/autonomic";
import { Patient, HEALTHY } from "../physics/rhythm";
import { simRhythmId } from "../physics/rhythmSource";
import type { Rhythm } from "../config/ecg";
import { Support, noSupport } from "../physics/support";
import { SUPPORT } from "../config/management";
import { ARRHYTHMIA } from "../config/arrhythmia";

/**
 * The complete, serialisable description of a simulated patient and what is being done to them.
 * It is the one structure that the browser app, the MCP server, URL links and LLM prompts all share, so
 * an LLM can build a hemodynamic state by emitting this JSON and a human can open the same state in the UI.
 * Every field is optional; omitted fields keep the typical resting adult.
 */
export interface Scenario {
  /** Coronary anatomy variant. */
  anatomy?: Partial<Variant>;
  /** Fixed lesions. `stenosis` is the fractional diameter reduction at the narrowest point (0.7 = 70 % diameter stenosis). */
  lesions?: LesionSpec[];
  /** Moderate exertion: doubles myocardial oxygen demand. */
  exertion?: boolean;
  /** Fraction of blood volume lost (0.15 = class II hemorrhage). Negative = volume overload. */
  bloodLoss?: number;
  drugs?: {
    betaBlocker?: number; // 0..1 fraction of beta-adrenergic effect blocked
    atropine?: number; // 0..1 fraction of vagal effect on the sinus node blocked
    vasopressor?: number; // −1 (strong vasodilator) .. +1 (strong alpha agonist, e.g. phenylephrine)
  };
  autonomic?: Partial<Pick<AutonomicControls, "baroreflexGain" | "respRate" | "respDepth" | "setPointShift">> & { noise?: number };
  /**
   * What the patient brought with them. `rhythm`: "sinus" or "af" (the coronary model's own: rate and conduction follow the
   * ischemia and the reflexes), or the id of any EKG-library rhythm of the Simulator's categories (physics/rhythmSource.ts
   * `SIM_RHYTHMS`: "flutter-21", "svt", "vt-mono", "vf-coarse", "chb", "paced"...; "nsr" means "sinus"). Library rhythms run on the
   * core engine only; the legacy engine runs sinus instead and warns.
   */
  patient?: { rhythm?: Rhythm; bbb?: "none" | "rbbb" | "lbbb" };
  /** Hemodynamic support the team is giving (the app's management panel). Atropine lives in `drugs`. */
  support?: SupportSpec;
  /** Seed for every random process; the same scenario and seed give the same beats. */
  seed?: number;
  /**
   * Teaching override of the patient's tendency to ischemic ectopy (core engine; the legacy engine ignores it): 0..3, a multiplier
   * on the susceptibility the seed gives the patient (physics/ectopy.ts). 0 = never any PVC, 1 = as the seed has it (default).
   */
  ectopyTendency?: number;
  /**
   * Teaching override of the patient's tendency to ventricular tachycardia, fibrillation and accelerated idioventricular rhythm (core
   * engine, physics/arrhythmia.ts): 0..3, a multiplier on the susceptibility the seed gives. 0 = never any (PVCs still come, see
   * `ectopyTendency`), 1 = as the seed has it (default).
   */
  arrhythmiaTendency?: number;
  /** Serum electrolytes, mmol/l (core engine): potassium (2..7.5, default 4.2) and magnesium (0.2..3, default 0.9); low or high values raise the VT/VF hazard and the PVCs. */
  electrolytes?: { potassium?: number; magnesium?: number };
}

export interface LesionSpec {
  artery: string; // segment id or common name, e.g. "LAD", "RCA", "circumflex", "OM1"
  stenosis?: number; // 0..0.99
  occluded?: boolean;
  position?: number; // 0 (proximal) .. 1 (distal) along the artery
}

export interface SupportSpec {
  fluids?: number; // litres given, 0..3
  norepinephrine?: number; dobutamine?: number; nitroglycerin?: number; // 0..1 of a full dose
  /** Receptor-level drugs of the core engine (0..1 of a full dose; the legacy engine ignores them). */
  epinephrine?: number; milrinone?: number; vasopressin?: number; nitroprusside?: number; furosemide?: number;
  pacing?: boolean; paceRate?: number; // bpm, 40..120
  iabp?: boolean; impella?: boolean;
}

export const DRUG_RANGES = { betaBlocker: [0, 1], atropine: [0, 1], vasopressor: [-1, 1] } as const;

export const ARTERY_ALIASES: Record<string, string> = {
  LM: "LM", "LEFT MAIN": "LM", LMCA: "LM", LAD: "LAD", "LEFT ANTERIOR DESCENDING": "LAD",
  D1: "D1", D2: "D2", DIAGONAL: "D1", "DIAGONAL 1": "D1", "DIAGONAL 2": "D2", RAMUS: "RAMUS",
  LCX: "LCX", LCX_: "LCX", CIRCUMFLEX: "LCX", CX: "LCX", OM1: "OM1", OM2: "OM2", OM: "OM1",
  RCA: "RCA", "RIGHT CORONARY": "RCA", AM: "AM", "ACUTE MARGINAL": "AM", CONUS: "CONUS",
  PDA: "PDA", PDA_R: "PDA_R", PDA_L: "PDA_L", PLV: "PLV", PLV_R: "PLV_R", PLV_L: "PLV_L", SAN: "SAN", AVN: "AVN",
  "SA NODE ARTERY": "SAN", "AV NODE ARTERY": "AVN",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface Normalized {
  scenario: Required<Pick<Scenario, "exertion" | "bloodLoss" | "seed">> & {
    anatomy: Variant; lesions: Lesion[]; lesionSpecs: Required<LesionSpec>[];
    drugs: { betaBlocker: number; atropine: number; vasopressor: number };
    autonomic: AutonomicControls;
    patient: Patient;
    support: Support; // atropine here is always false: it is derived from drugs.atropine
    ectopyTendency: number;
    arrhythmiaTendency: number;
    electrolytes: { potassium: number; magnesium: number };
  };
  warnings: string[];
}

/** Resolve a free-form artery name against the anatomy that actually exists in this variant. */
export function resolveArtery(name: string, variant: Variant): string | null {
  const tree = buildTree(variant);
  const key = name.trim().toUpperCase().replace(/[\s-]+/g, " ");
  let id = ARTERY_ALIASES[key] ?? key.replace(/ /g, "_");
  if (id === "PDA") id = variant.dominance === "left" ? "PDA_L" : "PDA_R";
  if (id === "PLV") id = variant.dominance === "right" ? "PLV_R" : "PLV_L";
  if (id === "LCX_") id = "LCX";
  return tree.byId[id] ? id : null;
}

/**
 * Fill defaults, clamp to the model's valid ranges and report anything that was changed or dropped, so an LLM
 * caller learns what actually ran instead of silently getting something else.
 */
export function normalizeScenario(input: Scenario = {}, base?: Normalized["scenario"]): Normalized {
  const warnings: string[] = [];
  const variant: Variant = { ...(base?.anatomy ?? TYPICAL), ...(input.anatomy ?? {}) };
  const enums: [keyof Variant, string[]][] = [
    ["dominance", ["right", "co", "left"]], ["lm", ["bifurcation", "trifurcation", "absent"]],
    ["saNodeFrom", ["RCA", "LCx"]], ["conusOstium", ["shared", "separate"]], ["ladCourse", ["normal", "short", "wrap"]],
  ];
  for (const [k, ok] of enums) if (!ok.includes(variant[k] as string)) { warnings.push(`anatomy.${k}="${variant[k]}" is not one of ${ok.join("|")}; using ${TYPICAL[k]}`); (variant as unknown as Record<string, string>)[k] = TYPICAL[k] as string; }

  const specs: Required<LesionSpec>[] = [];
  const rawLesions = input.lesions ?? base?.lesionSpecs;
  for (const l of rawLesions ?? []) {
    const id = resolveArtery(l.artery ?? "", variant);
    if (!id) { warnings.push(`lesion on "${l.artery}" dropped: no such artery in this anatomy`); continue; }
    if (specs.some((s) => s.artery === id)) { warnings.push(`second lesion on ${id} dropped: one lesion per artery`); continue; }
    const occluded = !!l.occluded;
    const stenosis = occluded ? 1 : clamp(num(l.stenosis) ? l.stenosis : 0.7, 0, 0.99);
    if (num(l.stenosis) && l.stenosis !== stenosis && !occluded) warnings.push(`${id} stenosis clamped to ${stenosis}`);
    specs.push({ artery: id, stenosis, occluded, position: clamp(num(l.position) ? l.position : 0.15, 0, 1) });
  }
  const lesions: Lesion[] = specs.filter((s) => s.stenosis > 0).map((s) => ({ segId: s.artery, pos: s.position, ds: s.stenosis, occluded: s.occluded }));

  const drugs = { betaBlocker: 0, atropine: 0, vasopressor: 0, ...(base?.drugs ?? {}) };
  for (const k of Object.keys(DRUG_RANGES) as (keyof typeof DRUG_RANGES)[]) {
    const v = input.drugs?.[k];
    if (v === undefined) continue;
    const [lo, hi] = DRUG_RANGES[k];
    if (!num(v)) { warnings.push(`drugs.${k} is not a number; ignored`); continue; }
    drugs[k] = clamp(v, lo, hi);
    if (drugs[k] !== v) warnings.push(`drugs.${k} clamped to ${drugs[k]} (range ${lo}..${hi})`);
  }

  const autonomic = { ...(base?.autonomic ?? defaultControls()) };
  const a = input.autonomic;
  if (a) {
    const set = (k: "baroreflexGain" | "respRate" | "respDepth" | "setPointShift", lo: number, hi: number) => {
      const v = a[k]; if (v === undefined) return;
      if (!num(v)) { warnings.push(`autonomic.${k} is not a number; ignored`); return; }
      autonomic[k] = clamp(v, lo, hi); if (autonomic[k] !== v) warnings.push(`autonomic.${k} clamped to ${autonomic[k]}`);
    };
    set("baroreflexGain", 0, 4); set("respRate", 4, 40); set("respDepth", 0, 2); set("setPointShift", -30, 60);
    if (a.noise !== undefined) autonomic.noiseScale = clamp(num(a.noise) ? a.noise : 1, 0, 3);
  }
  const patient: Patient = { ...(base?.patient ?? HEALTHY) };
  if (input.patient?.rhythm !== undefined) { const id = typeof input.patient.rhythm === "string" ? simRhythmId(input.patient.rhythm) : null; if (id) patient.rhythm = id; else warnings.push(`patient.rhythm="${input.patient.rhythm}" is not sinus, af or a Simulator rhythm of the EKG library; ignored`); }
  if (input.patient?.bbb !== undefined) { if (["none", "rbbb", "lbbb"].includes(input.patient.bbb)) patient.bbb = input.patient.bbb; else warnings.push(`patient.bbb="${input.patient.bbb}" is not none|rbbb|lbbb; ignored`); }

  const support: Support = { ...(base?.support ?? noSupport()), atropine: false };
  const sp = input.support;
  if (sp) {
    const level = (v: unknown, name: string, hi: number) => {
      if (v === undefined) return undefined;
      if (!num(v)) { warnings.push(`support.${name} is not a number; ignored`); return undefined; }
      const c = clamp(v, 0, hi); if (c !== v) warnings.push(`support.${name} clamped to ${c}`); return c;
    };
    support.fluids = level(sp.fluids, "fluids", SUPPORT.maxFluids) ?? support.fluids;
    support.norepi = level(sp.norepinephrine, "norepinephrine", 1) ?? support.norepi;
    support.dobutamine = level(sp.dobutamine, "dobutamine", 1) ?? support.dobutamine;
    support.nitro = level(sp.nitroglycerin, "nitroglycerin", 1) ?? support.nitro;
    support.epi = level(sp.epinephrine, "epinephrine", 1) ?? support.epi;
    support.milrinone = level(sp.milrinone, "milrinone", 1) ?? support.milrinone;
    support.vasopressin = level(sp.vasopressin, "vasopressin", 1) ?? support.vasopressin;
    support.nitroprusside = level(sp.nitroprusside, "nitroprusside", 1) ?? support.nitroprusside;
    support.furosemide = level(sp.furosemide, "furosemide", 1) ?? support.furosemide;
    if (sp.pacing !== undefined) support.pacing = !!sp.pacing;
    if (sp.paceRate !== undefined) { const r = num(sp.paceRate) ? clamp(Math.round(sp.paceRate), SUPPORT.paceMin, SUPPORT.paceMax) : support.paceRate; if (r !== sp.paceRate) warnings.push(`support.paceRate set to ${r}`); support.paceRate = r; }
    if (sp.iabp !== undefined) support.iabp = !!sp.iabp;
    if (sp.impella !== undefined) support.impella = !!sp.impella;
  }

  const bl = input.bloodLoss ?? base?.bloodLoss ?? 0;
  const bloodLoss = clamp(num(bl) ? bl : 0, -0.3, 0.6);
  if (bloodLoss !== bl) warnings.push(`bloodLoss clamped to ${bloodLoss}`);
  let ectopyTendency = base?.ectopyTendency ?? 1;
  if (input.ectopyTendency !== undefined) {
    if (!num(input.ectopyTendency)) warnings.push("ectopyTendency is not a number; ignored");
    else { ectopyTendency = clamp(input.ectopyTendency, 0, 3); if (ectopyTendency !== input.ectopyTendency) warnings.push(`ectopyTendency clamped to ${ectopyTendency} (range 0..3)`); }
  }
  let arrhythmiaTendency = base?.arrhythmiaTendency ?? 1;
  if (input.arrhythmiaTendency !== undefined) {
    if (!num(input.arrhythmiaTendency)) warnings.push("arrhythmiaTendency is not a number; ignored");
    else { arrhythmiaTendency = clamp(input.arrhythmiaTendency, 0, 3); if (arrhythmiaTendency !== input.arrhythmiaTendency) warnings.push(`arrhythmiaTendency clamped to ${arrhythmiaTendency} (range 0..3)`); }
  }
  const electrolytes = { ...(base?.electrolytes ?? { potassium: ARRHYTHMIA.potassium.normal, magnesium: ARRHYTHMIA.magnesium.normal }) };
  for (const [k, R] of [["potassium", ARRHYTHMIA.potassium], ["magnesium", ARRHYTHMIA.magnesium]] as const) {
    const v = input.electrolytes?.[k];
    if (v === undefined) continue;
    if (!num(v)) { warnings.push(`electrolytes.${k} is not a number; ignored`); continue; }
    electrolytes[k] = clamp(v, R.min, R.max);
    if (electrolytes[k] !== v) warnings.push(`electrolytes.${k} clamped to ${electrolytes[k]} (range ${R.min}..${R.max} mmol/l)`);
  }
  return {
    scenario: {
      anatomy: variant, lesions, lesionSpecs: specs, drugs, autonomic, bloodLoss, patient, support, ectopyTendency, arrhythmiaTendency, electrolytes,
      exertion: input.exertion ?? base?.exertion ?? false, seed: Math.trunc(input.seed ?? base?.seed ?? 1) >>> 0,
    },
    warnings,
  };
}

/** The serialisable form (what a link or an LLM sees) of a normalised scenario. */
export function toScenario(n: Normalized["scenario"]): Scenario {
  const a = n.autonomic;
  return {
    anatomy: n.anatomy, lesions: n.lesionSpecs.map((l) => ({ ...l })), exertion: n.exertion, bloodLoss: n.bloodLoss,
    drugs: { ...n.drugs },
    autonomic: { baroreflexGain: a.baroreflexGain, respRate: a.respRate, respDepth: a.respDepth, setPointShift: a.setPointShift, noise: a.noiseScale },
    patient: { ...n.patient },
    support: supportSpec(n.support),
    seed: n.seed,
    ...(n.ectopyTendency !== 1 ? { ectopyTendency: n.ectopyTendency } : {}), // only when set: the plain spec stays as it was
    ...(n.arrhythmiaTendency !== 1 ? { arrhythmiaTendency: n.arrhythmiaTendency } : {}),
    ...(n.electrolytes.potassium !== ARRHYTHMIA.potassium.normal || n.electrolytes.magnesium !== ARRHYTHMIA.magnesium.normal ? { electrolytes: { ...n.electrolytes } } : {}),
  };
}

/** Scenario form of a Support (the model's own names are short). */
export function supportSpec(s: Support): SupportSpec {
  const out: SupportSpec = { fluids: s.fluids, norepinephrine: s.norepi, dobutamine: s.dobutamine, nitroglycerin: s.nitro, pacing: s.pacing, paceRate: s.paceRate, iabp: s.iabp, impella: s.impella };
  for (const [k, v] of [["epinephrine", s.epi], ["milrinone", s.milrinone], ["vasopressin", s.vasopressin], ["nitroprusside", s.nitroprusside], ["furosemide", s.furosemide]] as const) if (v > 0) out[k] = v; // only when given: the plain spec stays as it was
  return out;
}
