import { THORAX } from "../../config/thorax";
import type { Pericardium } from "./pericardium";
import type { Ctx, Element, NodeId, Rates, Tunable } from "./types";

/**
 * Parameters of the thorax (changed between steps via `set`).
 *  - mode: "spontaneous" (negative-pressure inspiration), "positive" (mechanical ventilation, no effort) or "off" (no breathing effect);
 *  - rate: breaths/min;
 *  - depth: 0..2, scale of the spontaneous swing (the scale of the autonomic module's `respDepth`);
 *  - peep: cmH2O, positive end-expiratory pressure (positive mode);
 *  - tidalMlKg: tidal volume of the positive-pressure breath, ml/kg;
 *  - offsetMmHg: constant pressure added to the thoracic and pericardial nodes (the `thoracic` modifier of `LiveHeart`), mmHg;
 *  - peepTransmission, abdominalTransmission, constrictionShield: see `THORAX`.
 */
export interface ThoraxParams {
  mode: "spontaneous" | "positive" | "off";
  rate: number; depth: number; peep: number; tidalMlKg: number; offsetMmHg: number;
  peepTransmission: number; abdominalTransmission: number; constrictionShield: number;
}

/**
 * Pleural pressure, a field element. Inspiratory fraction of the breath
 *
 *   s(φ) = (1 − cos φ)/2        0 at end-expiration (φ = 0), 1 at peak inspiration (φ = π), back to 0 at φ = 2π
 *
 * (a raised cosine, the same shape as the autonomic module's lung volume: inspiration and expiration are equal in length; a
 * mechanical breath is nearer 1:2, which shifts the timing of the dip by a fraction of a second).
 *
 *   spontaneous:  P_pl = P_ee − depth·ΔP_sp·s                                      mmHg   (P_ee = −5, ΔP_sp = THORAX.spontaneousSwing = 4)
 *                 P_ab = ΔP_ab·(depth·s − 1/2)                                      (diaphragm descent; ΔP_ab = THORAX.diaphragmAbdominal; zero mean at depth 1)
 *   positive:     P_pl = P_ee + f·PEEP·0.7355 + k·tidal·s                           (f = peepTransmission, k = ppvSwingPerMlKg)
 *                 P_ab = a·(P_pl − P_ee)                                            (a = abdominalTransmission)
 *
 * What the nodes receive is relative to the model's own zero, the mean pleural pressure of quiet spontaneous breathing,
 * P_ref = −7 (so the breath-averaged normal numbers are those of the model; see `THORAX`):
 *
 *   "thoracic" and "pericardial" nodes:  addExternal(P_pl − P_ref + offsetMmHg)       (the sac's own pressure adds on top: it is another element)
 *   "abdominal" nodes:                   addExternal(P_ab)
 *
 * Constriction shields the heart. A stiff, scarred sac does not pass the pleural pressure on to the cavities (the intrathoracic and
 * intracardiac pressures dissociate; Hatle 1989 [lit]), so the chambers, the four "pericardial" nodes, receive only a fraction
 * τ = 1/(1 + k·(s − 1)) of the chest pressure (s = the sac's `stiffness`, k = constrictionShield; τ = 1 for a normal or opened sac and
 * when no sac was given), together with the SVC (its lower end lies inside the pericardial reflection; shielding the chambers
 * alone would put a false pressure step between the SVC and the right atrium). PA, PV and AO still see all of it. In inspiration
 * the right atrium then cannot follow the fall of the pleural pressure, and its pressure falls little or not at all (Kussmaul's
 * sign: venous pressure fails to fall on inspiration).
 *
 * Mode "off" applies nothing. Spontaneous depth 0 (no effort) is P_pl = P_ee, 2 mmHg above P_ref.
 *
 * Pressures a node reports therefore include the pleural swing (the arch and the cavity pressures dip with spontaneous
 * inspiration), as a catheter referenced to atmosphere would show; transmural pressure is node pressure minus the tap value. The
 * peripheral arteries (DAO, "abdominal") do not carry the swing: use them for pulsus and pulse-pressure variation, as a radial line would.
 * The vessels of the lungs (PA, PV) are "thoracic": the effect of lung inflation on pulmonary vascular resistance under positive
 * pressure is not modelled (open question).
 *
 * Phase. By default the breath runs on the engine clock: φ = 2π·rate/60·t. `setPhase(φ, t)` anchors it from outside (the
 * autonomic module's respiratory phase, 0 = start of inspiration): from then on φ = φ_set + 2π·rate/60·(t − t_set), so it keeps
 * advancing between calls and does not step within an RK4 evaluation; call it again to follow a changing rate. The phase is a
 * function of t, so the result does not depend on the step size.
 *
 * No own states. Taps: pleuralPressure (absolute, mmHg), thoracicPressure (applied to chest nodes, mmHg), abdominalPressure
 * (mmHg), lung (inspiratory fraction 0-1), phase (rad, 0-2π).
 */
export class Thorax implements Element, Tunable<ThoraxParams> {
  readonly name = "thorax";
  readonly params: ThoraxParams;
  private anchor: { phase: number; t: number } | null = null;
  constructor(private readonly chest: readonly NodeId[], private readonly abdomen: readonly NodeId[], params: Partial<ThoraxParams> = {}, private readonly heart: readonly NodeId[] = [], private readonly sac: Pericardium | null = null) {
    this.params = { mode: "spontaneous", rate: THORAX.defaultRate, depth: 1, peep: 0, tidalMlKg: THORAX.defaultTidalMlKg, offsetMmHg: 0, peepTransmission: THORAX.peepTransmission, abdominalTransmission: THORAX.abdominalTransmission, constrictionShield: THORAX.constrictionShield, ...params };
  }
  set(patch: Partial<ThoraxParams>) { Object.assign(this.params, patch); }
  /** Follow an external respiratory phase (rad, 0 = start of inspiration) that was `phase` at engine time `t` (s). */
  setPhase(phase: number, t: number) { if (Number.isFinite(phase) && Number.isFinite(t)) this.anchor = { phase, t }; }
  /** Back to the engine clock. */
  clearPhase() { this.anchor = null; }
  /** Phase at time t, rad in [0, 2π). */
  phaseAt(t: number): number {
    const w = (2 * Math.PI * Math.max(0, this.params.rate)) / 60, a = this.anchor;
    const x = (a ? a.phase + w * (t - a.t) : w * t) % (2 * Math.PI);
    return x < 0 ? x + 2 * Math.PI : x;
  }
  /** Pressures at time t: absolute pleural, applied to chest nodes, applied to abdominal nodes (all mmHg) and the inspiratory fraction. */
  at(t: number) {
    const p = this.params, s = 0.5 * (1 - Math.cos(this.phaseAt(t)));
    const depth = Math.min(THORAX.depthRange[1], Math.max(THORAX.depthRange[0], p.depth));
    let pl: number = THORAX.refPleural, ab = 0;
    if (p.mode === "spontaneous") { pl = THORAX.endExpPleural - depth * THORAX.spontaneousSwing * s; ab = THORAX.diaphragmAbdominal * (depth * s - 0.5); }
    else if (p.mode === "positive") { const up = p.peepTransmission * Math.max(0, p.peep) * THORAX.mmHgPerCmH2O + THORAX.ppvSwingPerMlKg * Math.max(0, p.tidalMlKg) * s; pl = THORAX.endExpPleural + up; ab = p.abdominalTransmission * up; }
    return { pleural: pl + p.offsetMmHg, chest: pl - THORAX.refPleural + p.offsetMmHg, abdomen: ab, lung: s };
  }
  /**
   * Breath-averaged pressure applied to the chest nodes, mmHg (the mean of `at(t).chest` over a breath; the inspiratory fraction averages 1/2).
   * A heart settled with the thorax "off" and this as `offsetMmHg` is at the mean load of the breathing pattern, so it needs no
   * long re-settling when the breaths start: breathing makes the beat-to-beat state non-periodic, which `periodic()` cannot settle.
   */
  static meanChest(p: Pick<ThoraxParams, "mode" | "depth" | "peep" | "tidalMlKg" | "peepTransmission">): number {
    const depth = Math.min(THORAX.depthRange[1], Math.max(THORAX.depthRange[0], p.depth));
    if (p.mode === "spontaneous") return THORAX.endExpPleural - depth * THORAX.spontaneousSwing * 0.5 - THORAX.refPleural;
    if (p.mode === "positive") return THORAX.endExpPleural + p.peepTransmission * Math.max(0, p.peep) * THORAX.mmHgPerCmH2O + THORAX.ppvSwingPerMlKg * Math.max(0, p.tidalMlKg) * 0.5 - THORAX.refPleural;
    return 0;
  }
  /** Fraction of the chest pressure that reaches the cavities: 1/(1 + k·(s − 1)); 1 without a sac, with an open sac or a sac that is not stiff. */
  shield(): number {
    const sac = this.sac;
    if (!sac || sac.params.open) return 1;
    return 1 / (1 + Math.max(0, this.params.constrictionShield) * Math.max(0, sac.params.stiffness - 1));
  }
  field(ctx: Ctx, out: Rates) {
    const x = this.at(ctx.t), tau = this.shield();
    for (const i of this.chest) out.addExternal(i, x.chest);
    for (const i of this.heart) out.addExternal(i, tau * x.chest);
    for (const i of this.abdomen) out.addExternal(i, x.abdomen);
  }
  taps(ctx: Ctx) {
    const x = this.at(ctx.t);
    return { pleuralPressure: x.pleural, thoracicPressure: x.chest, abdominalPressure: x.abdomen, lung: x.lung, phase: this.phaseAt(ctx.t) };
  }
}
