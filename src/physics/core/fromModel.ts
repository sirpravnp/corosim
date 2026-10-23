import { NODES, type Model } from "../structural";
import { atrialTiming, Compliance, ElastanceChamber } from "./chamber";
import { createEngine, type EngineOptions } from "./engine";
import { OneWayValve, Orifice, Resistor } from "./valves";
import type { Element, Engine, NodeDef } from "./types";

/** Convergence signature of `simulate()`: beat-mean pressure of AO, PA, RA, LA and beat-mean volume of IVC. */
const CONVERGE = { pressure: ["AO", "PA", "RA", "LA"], volume: ["IVC"] };

/** The structural `Model` as core nodes and elements, named as in the structural engine (nodes SVC…DAO, elements TV, PVL, MV, AV, RVAO, ISTH, BEDU, …), in the same order. */
export function fromModel(m: Model): { nodes: NodeDef[]; elements: Element[]; options: EngineOptions } {
  const { ta } = atrialTiming(m.T);
  const nodes: NodeDef[] = NODES.map((name, i) => {
    const c = m.chambers[i];
    const model = c ? new ElastanceChamber(name, c, c.atrial ? "atrial" : "ventricular", m.T, ta) : new Compliance(name, m.comp[i]);
    return { name, model, group: c ? "pericardial" : "none", start: m.start[i] };
  });
  const elements: Element[] = m.edges.map((e) =>
    e.type === "resistor" ? new Resistor(e.name, e.from, e.to, e.R!) : e.type === "orifice" ? new Orifice(e.name, e.from, e.to, e.area!) : new OneWayValve(e.name, e.from, e.to, e.area!, e.reg!));
  return { nodes, elements, options: { atrialLead: (T) => { const t = atrialTiming(T); return t.ta + t.pr; }, converge: CONVERGE } };
}

/** `fromModel` and `createEngine` in one step. */
export function engineFromModel(m: Model): Engine {
  const g = fromModel(m);
  return createEngine(g.nodes, g.elements, g.options);
}
