import { NODES } from "../structuralGraph";
import type { Model } from "../structural";
import { atrialTiming, Compliance, ElastanceChamber } from "./chamber";
import { createEngine, type EngineOptions } from "./engine";
import { INERTANCE } from "../../config/structural";
import { InertialValve, inertance, OneWayValve, Orifice, Resistor } from "./valves";
import type { Element, Engine, ExternalGroup, NodeDef } from "./types";

/** Convergence signature of `simulate()`: beat-mean pressure of AO, PA, RA, LA and beat-mean volume of IVC. */
const CONVERGE = { pressure: ["AO", "PA", "RA", "LA"], volume: ["IVC"] };

export interface FromModelOptions {
  /** Build the four cardiac valves (TV, PVL, MV, AV) as `InertialValve`s with their own flow state. Default false (Gorlin valves, no inertance). */
  inertance?: boolean;
}

/**
 * External-pressure group of each node, for fields such as the pericardium and thorax. The four chambers are "pericardial"
 * (they sit inside the sac). The great vessels inside the chest are "thoracic": SVC, PA, PV and the upper aorta (arch). The
 * inferior vena cava and descending aorta carry the lower body's blood and are "abdominal". [assumed grouping]
 */
const GROUPS: Record<(typeof NODES)[number], ExternalGroup> = { SVC: "thoracic", IVC: "abdominal", RA: "pericardial", RV: "pericardial", PA: "thoracic", PV: "thoracic", LA: "pericardial", LV: "pericardial", AO: "thoracic", DAO: "abdominal" };
const valveLength = (name: string): number | undefined => ({ TV: INERTANCE.lengthCm.tv, PVL: INERTANCE.lengthCm.pv, MV: INERTANCE.lengthCm.mv, AV: INERTANCE.lengthCm.av } as Record<string, number>)[name];

/** The structural `Model` as core nodes and elements, named as in the structural engine (nodes SVC…DAO, elements TV, PVL, MV, AV, RVAO, ISTH, BEDU, …), in the same order. */
export function fromModel(m: Model, opts: FromModelOptions = {}): { nodes: NodeDef[]; elements: Element[]; options: EngineOptions } {
  const { ta } = atrialTiming(m.T);
  const nodes: NodeDef[] = NODES.map((name, i) => {
    const c = m.chambers[i];
    const model = c ? new ElastanceChamber(name, c, c.atrial ? "atrial" : "ventricular", m.T, ta) : new Compliance(name, m.comp[i]);
    return { name, model, group: GROUPS[name], start: m.start[i] };
  });
  const elements: Element[] = m.edges.map((e) =>
    e.type === "resistor" ? new Resistor(e.name, e.from, e.to, e.R!) : e.type === "orifice" ? new Orifice(e.name, e.from, e.to, e.area!)
      : opts.inertance && valveLength(e.name) ? new InertialValve(e.name, e.from, e.to, e.area!, e.reg!, inertance(valveLength(e.name)!, Math.max(e.area!, 0.05)))
      : new OneWayValve(e.name, e.from, e.to, e.area!, e.reg!));
  return { nodes, elements, options: { atrialLead: (T) => { const t = atrialTiming(T); return t.ta + t.pr; }, converge: CONVERGE } };
}

/** `fromModel` and `createEngine` in one step. */
export function engineFromModel(m: Model, opts: FromModelOptions = {}): Engine {
  const g = fromModel(m, opts);
  return createEngine(g.nodes, g.elements, g.options);
}
