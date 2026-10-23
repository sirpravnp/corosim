import { NODES } from "../structuralGraph";
import type { Model } from "../structural";
import { Compliance, ElastanceChamber } from "./chamber";
import { createEngine, type EngineOptions } from "./engine";
import { ACTIVATION, INERTANCE, VESSELS } from "../../config/structural";
import { InertialValve, inertance, OneWayValve, Orifice, Resistor } from "./valves";
import type { Element, Engine, ExternalGroup, NodeDef } from "./types";

/**
 * Convergence signature of `simulate()`: beat-mean pressure of AO, PA, RA, LA and beat-mean volume of IVC. With unstressed volume
 * the venous volumes are mostly unstressed volume, so a relative tolerance on them says little about the pressure that is still
 * drifting (the slow mode of the loop, venous refilling, has a time constant near 10 s); the signature then takes the pressures of
 * the IVC and the splanchnic reservoir instead.
 */
const CONVERGE = { pressure: ["AO", "PA", "RA", "LA"], volume: ["IVC"] };
const CONVERGE_VU = { pressure: ["AO", "PA", "RA", "LA", "IVC", "SPL"], volume: [] as string[] };

export interface FromModelOptions {
  /** Build the four cardiac valves (TV, PVL, MV, AV) as `InertialValve`s with their own flow state. Default false (Gorlin valves, no inertance). */
  inertance?: boolean;
  /** Falling-limb stretch of both ventricles (dimensionless; default `ACTIVATION.relaxScale`; 1 = the unmodified curve). */
  relaxScale?: number;
  /** Extra factor on the atrial elastance of the Model (default 1: `buildModel` already designs the atrial drive the engine runs; the frozen-reference pin builds with `atrialEesScale: 1` instead). */
  atrialEesScale?: number;
  /** PR (s from atrial event to ventricular event) at beat period T, for `periodic()` (default `defaultPr`). */
  pr?: (T: number) => number;
}

/**
 * External-pressure group of each node, for fields such as the pericardium and thorax. The four chambers are "pericardial"
 * (they sit inside the sac). The great vessels inside the chest are "thoracic": SVC, PA, PV and the upper aorta (arch). The
 * inferior vena cava and descending aorta carry the lower body's blood and are "abdominal". [assumed grouping]
 */
const GROUPS: Record<(typeof NODES)[number], ExternalGroup> = { SVC: "thoracic", IVC: "abdominal", RA: "pericardial", RV: "pericardial", PA: "thoracic", PV: "thoracic", LA: "pericardial", LV: "pericardial", AO: "thoracic", DAO: "abdominal", SPL: "abdominal" };
const valveLength = (name: string): number | undefined => ({ TV: INERTANCE.lengthCm.tv, PVL: INERTANCE.lengthCm.pv, MV: INERTANCE.lengthCm.mv, AV: INERTANCE.lengthCm.av } as Record<string, number>)[name];

/** Default PR for a steady rate (s from atrial event to ventricular event, beat period T): `ACTIVATION.prBase + prPerT·T`. [assumed] */
export const defaultPr = (T: number): number => ACTIVATION.prBase + ACTIVATION.prPerT * T;

/** The structural `Model` as core nodes and elements, named as in the structural engine (nodes SVC…DAO, elements TV, PVL, MV, AV, RVAO, ISTH, BEDU, …), in the same order. */
export function fromModel(m: Model, opts: FromModelOptions = {}): { nodes: NodeDef[]; elements: Element[]; options: EngineOptions } {
  const nodes: NodeDef[] = NODES.map((name, i) => {
    const c = m.chambers[i];
    const model = c ? new ElastanceChamber(name, c.atrial ? { ...c, ees: c.ees * (opts.atrialEesScale ?? 1) } : { ...c, relaxScale: opts.relaxScale ?? ACTIVATION.relaxScale }, c.atrial ? "atrial" : "ventricular", m.T) : new Compliance(name, m.comp[i], m.vu[i], m.vu[i] > 0 ? VESSELS.collapseMmHg : 0);
    return { name, model, group: GROUPS[name], start: m.start[i] };
  });
  const elements: Element[] = m.edges.map((e) =>
    e.type === "resistor" ? new Resistor(e.name, e.from, e.to, e.R!) : e.type === "orifice" ? new Orifice(e.name, e.from, e.to, e.area!)
      : opts.inertance && valveLength(e.name) ? new InertialValve(e.name, e.from, e.to, e.area!, e.reg!, inertance(valveLength(e.name)!, Math.max(e.area!, 0.05)), e.zc ?? 0)
      : new OneWayValve(e.name, e.from, e.to, e.area!, e.reg!, e.zc ?? 0));
  return { nodes, elements, options: { defaultPr: opts.pr ?? defaultPr, converge: m.vu.some((v) => v > 0) ? CONVERGE_VU : CONVERGE } };
}

/** The options as the engine will use them, every default filled in: what a calibration cache must be keyed on. */
export function resolveCore(opts: FromModelOptions = {}) {
  const pr = opts.pr ?? defaultPr;
  return { inertance: !!opts.inertance, relaxScale: opts.relaxScale ?? ACTIVATION.relaxScale, atrialEesScale: opts.atrialEesScale ?? 1, pr: [0.4, 0.83, 1.5].map((T) => pr(T)) };
}

/** `fromModel` and `createEngine` in one step. */
export function engineFromModel(m: Model, opts: FromModelOptions = {}): Engine {
  const g = fromModel(m, opts);
  return createEngine(g.nodes, g.elements, g.options);
}
