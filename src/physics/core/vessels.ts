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
