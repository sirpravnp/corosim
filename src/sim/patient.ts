import { normalizeScenario } from "./scenario";
import type { Normalized, Scenario } from "./scenario";
import { clampStructuralSpec } from "../physics/structural";
import type { StructuralSpec } from "../physics/structural";

/**
 * One patient for every page (docs/HEMODYNAMICS_CORE.md §4G). `Scenario` already is the shared, serialisable description
 * the app, the MCP server, links and LLM prompts use; a `PatientSpec` is a Scenario with the structural heart, the
 * pericardium, fluids, ventilation and devices added. Every new field is optional, so every existing Scenario is a valid
 * PatientSpec and every old link still means the same patient. Encoding and normalisation live below (task P1); engines read it in P2/A7.
 */
export interface PatientSpec extends Scenario {
  /** Baseline physiology the engines are designed around (src/config/structural.ts). Neonates have no coronary view. */
  kind?: "adult" | "neonate";
  /** Valves, septal defects, ductus, shunts and chamber sizes, as the structural engine takes them. */
  heart?: HeartSpec;
  pericardium?: PericardiumSpec;
  fluids?: FluidSpec;
  ventilation?: VentilationSpec;
  /** Mechanical support with settings. `support.iabp` / `support.impella` (booleans) stay valid and mean the defaults here. */
  devices?: DeviceSpec;
}

/** The structural engine's lesion fields, without its patient and rate (those come from the rest of the spec). */
export type HeartSpec = Omit<StructuralSpec, "patient" | "hr">;

export interface PericardiumSpec {
  effusionMl?: number; // fluid in the sac now, ml
  effusionRateMlMin?: number; // ml per clinical minute still accumulating (0 = stable)
  /** Multiplies the sac's stiffness: 1 normal, > 1 constrictive, < 1 a chronically stretched sac. */
  stiffness?: number;
  open?: boolean; // pericardium opened (after cardiac surgery): no constraint
}

export type FluidKind = "crystalloid" | "colloid" | "albumin" | "blood";
export interface FluidDose { kind: FluidKind; ml: number; atMin?: number; overMin?: number } // atMin: clinical minute it starts
export interface FluidSpec {
  given?: FluidDose[];
  /** ml per clinical minute lost from the circulation (bleeding). */
  hemorrhageMlMin?: number;
  /** 0..1, capillary leak (sepsis): scales the filtration coefficient up. */
  capillaryLeak?: number;
  /** Passive leg raise in progress. */
  legRaise?: boolean;
}

export interface VentilationSpec {
  mode?: "spontaneous" | "positive";
  peep?: number; // cmH₂O
  tidalMlKg?: number;
}

export type ImpellaModel = "2.5" | "CP" | "5.5";
export interface DeviceSpec {
  impella?: { model?: ImpellaModel; level?: number /* P-level 0..9 */; position?: "correct" | "aortic" | "deep" };
  impellaRp?: { level?: number };
  iabp?: {
    ratio?: 1 | 2 | 3;
    /** Timing offsets from correct timing, ms: negative is early. */
    inflateMs?: number; deflateMs?: number;
    volumeMl?: number;
  };
  ecmo?: {
    flowLpm?: number; // target flow; the pump speed is solved for it
    sweepLpm?: number; fio2?: number; // oxygenator settings
  };
}

// ---- normalisation (P1) -----------------------------------------------------------------------------------------------

/** Ranges the new fields are clamped to. [assumed]: wide enough for any teaching case, narrow enough to keep the engines stable. */
export const PATIENT_RANGES = {
  effusionMl: [0, 2000], effusionRateMlMin: [0, 100], stiffness: [0.2, 10], // pericardium: ml; ml per clinical minute; multiple of normal
  fluidMl: [0, 5000], fluidAtMin: [0, 1440], fluidOverMin: [0, 1440], hemorrhageMlMin: [0, 500], capillaryLeak: [0, 1], // fluids (a day at most)
  peep: [0, 25], tidalMlKg: [2, 15], // ventilation: cmH2O; ml per kg ideal weight
  impellaLevel: [0, 9], // P-level
  iabpOffsetMs: [-100, 100], iabpVolumeMl: [0, 50], // timing offset from correct, ms; balloon volume, ml
  ecmoFlowLpm: [0, 7], ecmoSweepLpm: [0, 10], fio2: [0.21, 1],
} as const;

/** Defaults the legacy booleans `support.iabp` / `support.impella` stand for: Impella CP at P-level 6 in the correct position; IABP 1:1 at correct timing, 40 ml. */
export const DEFAULT_IMPELLA = { model: "CP", level: 6, position: "correct" } as const;
export const DEFAULT_IABP = { ratio: 1, inflateMs: 0, deflateMs: 0, volumeMl: 40 } as const;

export interface NormalizedPatient {
  /** The cleaned spec: the Scenario part passed through unchanged (normalizeScenario clamps it when an engine reads it), the new fields validated. */
  spec: PatientSpec;
  /** What normalizeScenario made of the Scenario part. */
  scenario: Normalized["scenario"];
  warnings: string[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Validate and clamp the fields a PatientSpec adds to a Scenario. Invalid values are dropped with a warning, never thrown. */
export function normalizePatient(input: PatientSpec = {}): NormalizedPatient {
  const n = normalizeScenario(input), warnings = [...n.warnings];
  const spec: PatientSpec = { ...input };
  for (const k of ["kind", "heart", "pericardium", "fluids", "ventilation", "devices"] as const) delete spec[k];

  const num = (o: Record<string, unknown>, k: string, path: string, [lo, hi]: readonly [number, number]): number | undefined => {
    const v = o[k]; if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) { warnings.push(`${path}.${k} is not a finite number; dropped`); return undefined; }
    const c = Math.min(hi, Math.max(lo, v)); if (c !== v) warnings.push(`${path}.${k} clamped to ${c} (range ${lo}..${hi})`); return c;
  };
  const bool = (o: Record<string, unknown>, k: string, path: string): boolean | undefined => {
    const v = o[k]; if (v === undefined) return undefined;
    if (typeof v !== "boolean") { warnings.push(`${path}.${k} is not true|false; dropped`); return undefined; }
    return v;
  };
  const oneOf = <T extends string | number>(o: Record<string, unknown>, k: string, path: string, ok: readonly T[]): T | undefined => {
    const v = o[k]; if (v === undefined) return undefined;
    if (!ok.includes(v as T)) { warnings.push(`${path}.${k}=${JSON.stringify(v)} is not one of ${ok.join("|")}; dropped`); return undefined; }
    return v as T;
  };
  const section = (v: unknown, path: string): Record<string, unknown> | undefined => {
    if (v === undefined) return undefined;
    if (!isObj(v)) { warnings.push(`${path} is not an object; dropped`); return undefined; }
    return v;
  };
  const compact = <T extends object>(o: T): T | undefined => { const r = Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)); return Object.keys(r).length ? (r as T) : undefined; };
  const R = PATIENT_RANGES;

  const kind = oneOf(input as Record<string, unknown>, "kind", "", ["adult", "neonate"] as const);
  if (kind) spec.kind = kind;

  // heart: the structural engine's own clamping decides the ranges; anything it changes or unsets is reported
  const heart = section(input.heart, "heart");
  if (heart) {
    const known = new Set(["pvri", "svrScale", "satLung", "volumeMl", "valves", "pda", "asd", "vsd", "bt", "lvSize", "laSize", "lvEes", "rvEes", "rvContractility", "rvSize", "raSize", "tof"]);
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(heart)) { if (known.has(k)) kept[k] = v; else warnings.push(`heart.${k} is not a structural field; dropped`); }
    let out: Record<string, unknown> = {};
    try { out = JSON.parse(JSON.stringify(clampStructuralSpec(kept as StructuralSpec))) as Record<string, unknown>; }
    catch { warnings.push("heart could not be read; dropped"); }
    const diff = (a: unknown, b: unknown, path: string) => {
      if (isObj(a)) { for (const [k, v] of Object.entries(a)) diff(v, isObj(b) ? b[k] : undefined, `${path}.${k}`); }
      else if (typeof a === "number" && a !== b) warnings.push(b === undefined ? `${path} is not usable; dropped` : `${path} clamped to ${b}`);
      else if (typeof a !== "number" && b === undefined && a !== undefined) warnings.push(`${path} is not a number or object as expected; dropped`);
    };
    diff(kept, out, "heart");
    delete out.patient; delete out.hr; // those come from kind and the rhythm
    const h = compact(out); if (h) spec.heart = h as HeartSpec;
  }

  const peri = section(input.pericardium, "pericardium");
  if (peri) {
    const p = compact<PericardiumSpec>({
      effusionMl: num(peri, "effusionMl", "pericardium", R.effusionMl), effusionRateMlMin: num(peri, "effusionRateMlMin", "pericardium", R.effusionRateMlMin),
      stiffness: num(peri, "stiffness", "pericardium", R.stiffness), open: bool(peri, "open", "pericardium"),
    });
    if (p) spec.pericardium = p;
  }

  const fl = section(input.fluids, "fluids");
  if (fl) {
    const given: FluidDose[] = [];
    if (fl.given !== undefined) {
      if (!Array.isArray(fl.given)) warnings.push("fluids.given is not an array; dropped");
      else {
        fl.given.slice(0, 20).forEach((d, i) => {
          const path = `fluids.given[${i}]`;
          if (!isObj(d)) { warnings.push(`${path} is not an object; dropped`); return; }
          const kind = oneOf(d, "kind", path, ["crystalloid", "colloid", "albumin", "blood"] as const), ml = num(d, "ml", path, R.fluidMl);
          if (!kind || ml === undefined) { warnings.push(`${path} needs a kind and ml; dropped`); return; }
          given.push(compact<FluidDose>({ kind, ml, atMin: num(d, "atMin", path, R.fluidAtMin), overMin: num(d, "overMin", path, R.fluidOverMin) })!);
        });
        if (fl.given.length > 20) warnings.push("fluids.given keeps the first 20 doses");
      }
    }
    const f = compact<FluidSpec>({
      given: given.length ? given : undefined, hemorrhageMlMin: num(fl, "hemorrhageMlMin", "fluids", R.hemorrhageMlMin),
      capillaryLeak: num(fl, "capillaryLeak", "fluids", R.capillaryLeak), legRaise: bool(fl, "legRaise", "fluids"),
    });
    if (f) spec.fluids = f;
  }

  const vent = section(input.ventilation, "ventilation");
  if (vent) {
    const v = compact<VentilationSpec>({ mode: oneOf(vent, "mode", "ventilation", ["spontaneous", "positive"] as const), peep: num(vent, "peep", "ventilation", R.peep), tidalMlKg: num(vent, "tidalMlKg", "ventilation", R.tidalMlKg) });
    if (v) spec.ventilation = v;
  }

  const dev = section(input.devices, "devices");
  if (dev) {
    const out: DeviceSpec = {};
    const imp = section(dev.impella, "devices.impella");
    if (imp) out.impella = compact({ model: oneOf(imp, "model", "devices.impella", ["2.5", "CP", "5.5"] as const), level: num(imp, "level", "devices.impella", R.impellaLevel), position: oneOf(imp, "position", "devices.impella", ["correct", "aortic", "deep"] as const) }) ?? {};
    const rp = section(dev.impellaRp, "devices.impellaRp");
    if (rp) out.impellaRp = compact({ level: num(rp, "level", "devices.impellaRp", R.impellaLevel) }) ?? {};
    const ia = section(dev.iabp, "devices.iabp");
    if (ia) out.iabp = compact({ ratio: oneOf(ia, "ratio", "devices.iabp", [1, 2, 3] as const), inflateMs: num(ia, "inflateMs", "devices.iabp", R.iabpOffsetMs), deflateMs: num(ia, "deflateMs", "devices.iabp", R.iabpOffsetMs), volumeMl: num(ia, "volumeMl", "devices.iabp", R.iabpVolumeMl) }) ?? {};
    const ec = section(dev.ecmo, "devices.ecmo");
    if (ec) out.ecmo = compact({ flowLpm: num(ec, "flowLpm", "devices.ecmo", R.ecmoFlowLpm), sweepLpm: num(ec, "sweepLpm", "devices.ecmo", R.ecmoSweepLpm), fio2: num(ec, "fio2", "devices.ecmo", R.fio2) }) ?? {};
    if (Object.keys(out).length) spec.devices = out;
  }

  return { spec, scenario: n.scenario, warnings };
}

/**
 * The devices a spec asks for, with the legacy booleans folded in: `support.iabp` / `support.impella` become DEFAULT_IABP /
 * DEFAULT_IMPELLA unless `devices` already sets that device. Returns a new object; the spec is not changed.
 */
export function effectiveDevices(spec: PatientSpec): DeviceSpec {
  const d: DeviceSpec = { ...(spec.devices ?? {}) };
  if (spec.support?.iabp && !d.iabp) d.iabp = { ...DEFAULT_IABP };
  if (spec.support?.impella && !d.impella) d.impella = { ...DEFAULT_IMPELLA };
  return d;
}
