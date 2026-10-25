import type { NodeDef, NodeModel, Tunable } from "./types";

export interface ComplianceParams {
  /** ml/mmHg. */
  C: number;
  /** Unstressed volume, ml: the volume at which the transmural pressure is zero. Venoconstriction lowers it (the blood joins the stressed volume). Default 0. */
  Vu: number;
}

/**
 * Vessel with unstressed volume: P = (V − Vu)/C for V ≥ Vu (C ml/mmHg, volumes ml, P mmHg). Below Vu the law is linear too unless
 * `collapse` (mmHg, default 0 = off) is set: then a collapsing vein's pressure only falls toward −collapse,
 * P = −pc·(1 − e^{(V−Vu)/(C·pc)}), which continues the linear law with the same slope at V = Vu (smooth) and never pulls blood back
 * from the heart. With Vu = 0 and no collapse this is the plain P = V/C compliance. The stressed volume is max(V − Vu, 0).
 */
export class Compliance implements NodeModel, Tunable<ComplianceParams> {
  readonly params: ComplianceParams;
  constructor(readonly name: string, C: number, Vu = 0, private readonly collapse = 0) { this.params = { C, Vu }; }
  set(patch: Partial<ComplianceParams>) { Object.assign(this.params, patch); }
  pressure(volume: number): number {
    const x = volume - this.params.Vu, { C } = this.params;
    return x >= 0 || !this.collapse ? x / C : -this.collapse * (1 - Math.exp(x / (C * this.collapse)));
  }
  /** Volume (ml) at transmural pressure `p`: the inverse of `pressure` (Vu + C·p; a collapsing vein never falls below −collapse, so p is clamped just above it). */
  restVolume(p: number): number {
    const { C, Vu } = this.params, pc = this.collapse;
    return p >= 0 || !pc ? Vu + C * p : Vu + C * pc * Math.log(Math.max(1 + p / pc, 1e-4));
  }
  /** Stressed volume at `volume`, ml. */
  stressed(volume: number): number { return Math.max(0, volume - this.params.Vu); }
}

/** Filling state of a set of vessels. All volumes ml, compliance ml/mmHg, pressure mmHg. */
export interface Filling {
  /** Blood in the listed nodes. */
  total: number;
  /** Part of it that is stressed (above each vessel's unstressed volume). */
  stressed: number;
  unstressed: number;
  /** Sum of the compliances of the listed nodes. */
  compliance: number;
  /** Mean systemic filling pressure: the pressure all listed vessels would settle to after a stop-flow, stressed volume / total compliance. */
  msfp: number;
}

/**
 * Stressed volume and mean systemic filling pressure of the named `Compliance` nodes, from node volumes `V` (the engine's
 * `Sample.V`). MSFP = Σ stressed volume / Σ C is the pressure the systemic vessels (arteries and veins, not the heart or the
 * lungs) equalise to when flow stops, if every vessel stays linear above its unstressed volume.
 */
export function fillingOf(nodes: readonly NodeDef[], V: ArrayLike<number>, names: readonly string[]): Filling {
  let total = 0, stressed = 0, compliance = 0;
  nodes.forEach((n, i) => {
    if (!names.includes(n.name) || !(n.model instanceof Compliance)) return;
    total += V[i]; stressed += n.model.stressed(V[i]); compliance += n.model.params.C;
  });
  return { total, stressed, unstressed: total - stressed, compliance, msfp: compliance ? stressed / compliance : NaN };
}

/** One node's share of the blood at a moment. Volumes ml. */
export interface NodeFilling {
  volume: number;
  /** Volume above the node's unstressed volume (its zero-pressure volume): the part that is under pressure. */
  stressed: number;
  unstressed: number;
}

/** Stressed and unstressed volume of the whole circulation and its stop-flow pressure. Volumes ml, pressures mmHg. */
export interface Stressed {
  /** All the blood in the nodes. Conserved by the engine unless blood is given or lost. */
  total: number;
  /** Sum over the nodes of the volume above their unstressed volume (a chamber: above V0, the volume of zero passive pressure). */
  stressed: number;
  unstressed: number;
  /**
   * Mean systemic filling pressure: the one pressure every node would hold after a stop-flow (heart stopped, flow ceased, all nodes
   * in equilibrium, no external pressure), the P that solves Σ restVolume_i(P) = total. It follows from the compliances and the total
   * blood volume alone, so it does not depend on the phase of the beat the volumes were taken in. The heart chambers and pulmonary
   * vessels take part (they hold blood at equilibrium), as in a real circulatory arrest. NaN if the root is not found.
   */
  msfp: number;
  /** Per node, by name. */
  nodes: Record<string, NodeFilling>;
  /** The systemic-only estimate (`fillingOf` over the systemic vessels: their stressed volume / their compliance). It reads the volumes of this instant, so it ripples with the beat. */
  systemic: Filling;
}

/**
 * Stressed volume per node and in total, and the stop-flow equilibrium pressure, from node volumes `V` (the engine's `Sample.V`).
 * Each node's volume at rest at pressure P is `restVolume(P)` (Vu + C·P for a vessel, V0 + ln(1 + P/a)/b for a relaxed chamber),
 * increasing in P, so Σ restVolume(P) = total has one root, found by bisection to 1e-9 mmHg. Valves are not in the sum: with the
 * heart stopped they pass blood only forward, so a small gradient across a closed valve can remain (the left ventricle keeps about
 * 0.01 mmHg above the aorta), below the tolerance of the stop-flow check. External pressures (pericardium, thorax) and device
 * volumes are not included; a node with no `restVolume` keeps its volume out of the sum.
 */
export function stressedVolumes(nodes: readonly NodeDef[], V: ArrayLike<number>, systemic: readonly string[]): Stressed {
  let total = 0, stressed = 0, held = 0;
  const per: Record<string, NodeFilling> = {}, rest: NodeModel[] = [];
  nodes.forEach((n, i) => {
    const m = n.model, u = m.restVolume ? m.restVolume(0) : V[i], s = Math.max(V[i] - u, 0);
    per[n.name] = { volume: V[i], stressed: s, unstressed: V[i] - s };
    total += V[i]; stressed += s;
    if (m.restVolume) rest.push(m); else held += V[i];
  });
  const want = total - held, sum = (p: number) => rest.reduce((a, m) => a + m.restVolume!(p), 0);
  let lo = -0.5, hi = 100;
  for (let k = 0; k < 80 && hi - lo > 1e-9; k++) { const mid = (lo + hi) / 2; if (sum(mid) < want) lo = mid; else hi = mid; }
  return { total, stressed, unstressed: total - stressed, msfp: sum(lo) <= want && sum(hi) >= want ? (lo + hi) / 2 : NaN, nodes: per, systemic: fillingOf(nodes, V, systemic) };
}
