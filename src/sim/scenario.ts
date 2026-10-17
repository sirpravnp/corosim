import { Variant, TYPICAL, buildTree } from "../anatomy/tree";
import { Lesion } from "../physics/network";
import { AutonomicControls, defaultControls } from "../physics/autonomic";

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
  /** Seed for every random process; the same scenario and seed give the same beats. */
  seed?: number;
}

export interface LesionSpec {
  artery: string; // segment id or common name, e.g. "LAD", "RCA", "circumflex", "OM1"
  stenosis?: number; // 0..0.99
  occluded?: boolean;
  position?: number; // 0 (proximal) .. 1 (distal) along the artery
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
  const bl = input.bloodLoss ?? base?.bloodLoss ?? 0;
  const bloodLoss = clamp(num(bl) ? bl : 0, -0.3, 0.6);
  if (bloodLoss !== bl) warnings.push(`bloodLoss clamped to ${bloodLoss}`);
  return {
    scenario: {
      anatomy: variant, lesions, lesionSpecs: specs, drugs, autonomic, bloodLoss,
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
    seed: n.seed,
  };
}
