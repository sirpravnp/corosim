import type { Scenario } from "./scenario";
import type { StructuralSpec } from "../physics/structural";

/**
 * One patient for every page (docs/HEMODYNAMICS_CORE.md §4G). `Scenario` already is the shared, serialisable description
 * the app, the MCP server, links and LLM prompts use; a `PatientSpec` is a Scenario with the structural heart, the
 * pericardium, fluids, ventilation and devices added. Every new field is optional, so every existing Scenario is a valid
 * PatientSpec and every old link still means the same patient. Types only: encoding is task P1, engines read it in P2/A7.
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
