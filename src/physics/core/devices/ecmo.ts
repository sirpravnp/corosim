import { ECMO_OXYGENATOR, ECMO_PUMP, ECMO_SUCTION } from "../../../config/devices";
import { NODES } from "../../structuralGraph";
import type { Model } from "../../structural";
import type { Ctx, Rates, StateDecl } from "../types";
import { inflowResistance, pumpHead, RotaryPump, suctionLevel, type PumpParams } from "./pump";

export interface EcmoConfig {
  /** Target flow, L/min. Default 4. */
  flowLpm?: number;
  /** Sweep gas flow, L/min (oxygenator). Default 3. */
  sweepLpm?: number;
  /** Oxygenator FiO2, 0.21-1. Default 1. */
  fio2?: number;
  /** Drainage site: "RA" (default, a femoral venous cannula with its tip in the right atrium) or "IVC". Fixed at construction. */
  drain?: "RA" | "IVC";
  /** Unloaded volume V0 of the drainage node, ml: the suction and the floor are set relative to it. */
  v0: number;
  /** Starting value of the filtered drainage volume, ml (default V0 + 20). `forModel` passes the node's own starting volume. */
  vStart?: number;
}

/** Saturation of the blood leaving the oxygenator: s_out = s_in + (satMax(FiO₂) − s_in)·(1 − exp(−sweep/sweepTau)), see `ECMO_OXYGENATOR`. [assumed] */
export function oxygenatorSat(sIn: number, sweepLpm: number, fio2: number): number {
  const O = ECMO_OXYGENATOR, f = Math.min(1, Math.max(0, (fio2 - 0.21) / 0.79)), satMax = O.satAir + (O.satO2 - O.satAir) * f;
  return sIn + (satMax - sIn) * (1 - Math.exp(-Math.max(sweepLpm, 0) / O.sweepTau));
}

/**
 * VA-ECMO: a centrifugal `RotaryPump` from the drainage node (RA by default, or IVC) through the oxygenator (a resistance in series,
 * folded into the circuit resistance R0 with the cannulae) into the descending aorta DAO, as a femoral arterial cannula.
 *
 * Flow controller. `flowLpm` is the target. The rotor speed ω is a second state that relaxes (time constant `ECMO_PUMP.speedTau`, 0.5 s,
 * so it follows the mean and not the pulse) toward the closed-form inverse of the HQ curve at the current pressures:
 *     X = (P_out − P_in) + R0·Q*,   a·ω² − b·ω·Q* − c·Q*² = X   ⇒   ω = (b·Q* + √(b²Q*² + 4a(X + c·Q*²))) / (2a),   clamped to [0, speedMax].
 * R is the circuit resistance including the present suction resistance of the drainage node (like a console raising rpm against a
 * rising pre-pump resistance), so the speed rises into collapse until it reaches `speedMax`; past that, and through the floor below, the flow falls below target.
 *
 * Drainage (R-D1). Suction resistance and a soft floor as for the Impella, relative to the drainage node's V0: Q ≤ (Vf − (V0+floor))/floorTau.
 * The volume used is Vf, the drainage node's volume low-pass filtered (third state, time constant `ECMO_SUCTION.volumeTau`): the RA empties to
 * its V0 at every atrial systole even with a normal circulation, so the instantaneous volume cannot tell a collapsing venous bed from a beating atrium.
 * With low venous volume the flow therefore falls below target and the `suctionAlarm` tap goes true (suction level ≥ `ECMO_SUCTION.alarmLevel`).
 *
 * Oxygen. The device exposes `returnSat(sIn)` (see `oxygenatorSat`); `solveOxygen` (physics/structural.ts) treats the pump as a stream
 * from `from` to `to` with the net flow of the beat and the oxygenated content.
 *
 * Taps: those of `RotaryPump` (with `speed` the controlled speed, krpm) plus `rpm`, `targetLpm`, `sweepLpm`, `fio2`, `suctionAlarm`, `membraneDp` (oxygenator pressure drop, mmHg).
 */
export class Ecmo extends RotaryPump {
  readonly drain: "RA" | "IVC";
  target: number; sweep: number; fio2: number;
  private floorV: number;
  private widx = -1;
  private vidx = -1;
  readonly states: readonly StateDecl[];
  constructor(name: string, from: number, to: number, cfg: EcmoConfig) {
    const S = ECMO_SUCTION, P = ECMO_PUMP;
    super(name, from, to, { speed: 0, a: P.a, b: P.b, c: P.c, L: P.L, R0: P.cannulaR + P.oxygenatorR, Rmax: S.Rmax, Pth: S.Pth, wP: S.wP, Vc: cfg.v0 + S.vcMarginMl, wV: S.wV, suctionAt: S.suctionAt });
    this.drain = cfg.drain ?? "RA"; this.target = cfg.flowLpm ?? 4; this.sweep = cfg.sweepLpm ?? 3; this.fio2 = cfg.fio2 ?? 1;
    this.floorV = cfg.v0 + S.floorMl;
    this.states = [{ name: `${name}.Q`, start: 0 }, { name: `${name}.w`, start: 0 }, { name: `${name}.Vf`, start: cfg.vStart ?? cfg.v0 + 20 }];
  }
  /** `fromModel`'s way in: nodes (RA or IVC → DAO) and V0 come from the model (the RA's V0, or the IVC's unstressed volume). */
  static forModel(m: Model, cfg: Omit<EcmoConfig, "v0"> = {}, name = "ecmo"): Ecmo {
    const dao = NODES.indexOf("DAO"), from = NODES.indexOf(cfg.drain === "IVC" ? "IVC" : "RA");
    const v0 = cfg.drain === "IVC" ? m.vu[from] : m.chambers[from]!.v0;
    return new Ecmo(name, from, dao, { vStart: m.start[from], ...cfg, v0 });
  }
  bind(offset: number) { this.idx = offset; this.widx = offset + 1; this.vidx = offset + 2; }
  /** Speed (krpm) that gives `qMl` (ml/s) against pressure difference `dP` (mmHg) through the circuit resistance `r` (default R0): the closed-form inverse of the HQ curve. */
  speedFor(qMl: number, dP: number, r = this.params.R0): number {
    const p = this.params, X = dP + r * qMl, disc = p.b * p.b * qMl * qMl + 4 * p.a * (X + p.c * qMl * qMl);
    return Math.min(ECMO_PUMP.speedMax, Math.max(0, (p.b * qMl + Math.sqrt(Math.max(disc, 0))) / (2 * p.a)));
  }
  /** Saturation of the blood returned, given the saturation drained. */
  returnSat(sIn: number): number { return oxygenatorSat(sIn, this.sweep, this.fio2); }
  /** `flowLpm`, `sweepLpm`, `fio2` and any pump parameter. */
  set(patch: Partial<PumpParams> & { flowLpm?: number; sweepLpm?: number; fio2?: number }) {
    const { flowLpm, sweepLpm, fio2, ...rest } = patch;
    super.set(rest);
    if (flowLpm !== undefined && Number.isFinite(flowLpm)) this.target = Math.max(0, flowLpm);
    if (sweepLpm !== undefined && Number.isFinite(sweepLpm)) this.sweep = Math.max(0, sweepLpm);
    if (fio2 !== undefined && Number.isFinite(fio2)) this.fio2 = Math.min(1, Math.max(0.21, fio2));
  }
  flow(ctx: Ctx, out: Rates) {
    const p = this.params, Q = ctx.y[this.idx], w = ctx.y[this.widx], pIn = ctx.P[this.from], vIn = ctx.y[this.vidx], S = ECMO_SUCTION;
    const rIn = Q > 0 ? inflowResistance(p, pIn, vIn) : p.R0;
    out.flow(this.from, this.to, Q);
    let rate = (pumpHead(p, w, Q) - (ctx.P[this.to] - pIn) - rIn * Q) / p.L;
    const qLim = Math.max(vIn - this.floorV, 0) / S.floorTau, ex = Q - qLim;
    if (ex > 0) rate = -ex / S.limitTau;
    else if (ex > -S.limitBand) { const k = -ex / S.limitBand; rate = rate * k + (1 - k) * (-ex / S.limitTau); }
    out.rate(this.idx, rate);
    out.rate(this.vidx, (ctx.V[this.from] - vIn) / S.volumeTau);
    out.rate(this.widx, (this.speedFor((this.target * 1000) / 60, ctx.P[this.to] - pIn, rIn) - w) / ECMO_PUMP.speedTau);
  }
  taps(ctx: Ctx) {
    const p = this.params, w = ctx.y[this.widx], Q = ctx.y[this.idx], pIn = ctx.P[this.from], dP = ctx.P[this.to] - pIn;
    const s = suctionLevel(p, pIn, ctx.y[this.vidx]), alarm = s >= ECMO_SUCTION.alarmLevel ? 1 : 0;
    return {
      Q, flow: (Q * 60) / 1000, head: pumpHead(p, w, Q), dP, speed: w, rpm: w * 1000, suction: alarm, suctionLevel: s, power: dP * Q, Rin: p.R0 + p.Rmax * s,
      targetLpm: this.target, sweepLpm: this.sweep, fio2: this.fio2, suctionAlarm: alarm, membraneDp: ECMO_PUMP.oxygenatorR * Q,
    };
  }
}
