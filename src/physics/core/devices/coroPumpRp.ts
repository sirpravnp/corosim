import { cannulaInertance, COROPUMP_RP } from "../../../config/devices";
import { NODES } from "../../structuralGraph";
import type { Model } from "../../structural";
import type { Ctx, HeartEvent, NodeId, Rates } from "../types";
import { inflowResistance, pumpHead, RotaryPump, type PumpParams } from "./pump";
import { motorCurrent } from "./coroPump";

export interface CoroPumpRpConfig {
  /** P-level 0..9 (0 = off). Default 6. */
  level?: number;
  /** Unloaded volume V0 of the inflow node (the IVC's unstressed volume), ml: the suction and the floor are set relative to it. */
  v0: number;
}

/** Speed (krpm) of a P-level (clamped and rounded to 0..9) of the CoroPump RP. */
export const rpLevelSpeed = (level: number): number => COROPUMP_RP.speeds[Math.min(9, Math.max(0, Math.round(level)))];

/**
 * CoroPump RP: a `RotaryPump` (core/devices/pump.ts) from the IVC to the PA with its own numbers (`COROPUMP_RP` in config/devices.ts, all
 * [assumed]). Same pump law, suction law and soft floor as the left-sided `CoroPump` (R-D1: relative to the inflow node's V0, here the
 * IVC's unstressed volume), so an emptied IVC trips suction and the flow cannot pull it below V0 + floor.
 *
 * Taps are those of `CoroPump` (`level`, `current`, `placement` = P_PA − P_IVC, `suctionAlarm`, `beat`, ...), so `CoroPumpConsole(engine, "coroPumpRp")`
 * gives the same per-beat console. Wiring: `fromModel(m, { coroPumpRp: { level } })`, or in `LiveHeart` `extra: [(m) => CoroPumpRp.forModel(m, cfg)]`.
 */
export class CoroPumpRp extends RotaryPump {
  private lvl: number;
  private floorV: number;
  private beats = 0;
  constructor(name: string, from: NodeId, to: NodeId, cfg: CoroPumpRpConfig) {
    const D = COROPUMP_RP, S = D.suction, level = cfg.level ?? 6;
    super(name, from, to, { speed: rpLevelSpeed(level), a: D.a, b: D.b, c: D.c, L: cannulaInertance(D.lengthCm, D.diameterMm), R0: D.R0, Rmax: S.Rmax, Pth: S.Pth, wP: S.wP, Vc: cfg.v0 + S.vcMarginMl, wV: S.wV, suctionAt: S.suctionAt });
    this.lvl = level; this.floorV = cfg.v0 + S.floorMl;
  }
  /** `fromModel`'s way in: nodes IVC -> PA, V0 = the IVC's unstressed volume. */
  static forModel(m: Model, cfg: Omit<CoroPumpRpConfig, "v0"> = {}, name = "coroPumpRp"): CoroPumpRp {
    const ivc = NODES.indexOf("IVC");
    return new CoroPumpRp(name, ivc, NODES.indexOf("PA"), { ...cfg, v0: m.vu[ivc] });
  }
  get level(): number { return this.lvl; }
  /** `level` (P-level, sets the speed) and any pump parameter. */
  set(patch: Partial<PumpParams> & { level?: number }) {
    const { level, ...rest } = patch;
    super.set(rest);
    if (level !== undefined && Number.isFinite(level)) { this.lvl = Math.min(9, Math.max(0, Math.round(level))); this.params.speed = rpLevelSpeed(this.lvl); }
  }
  onEvent(ev: HeartEvent) { if (ev.kind === "ventricular") this.beats++; }
  flow(ctx: Ctx, out: Rates) {
    if (this.lvl === 0) {
      const Q = ctx.y[this.idx], L = Math.max(this.params.L, 1e-6);
      out.flow(this.from, this.to, Q);
      out.rate(this.idx, -Q / L);
      return;
    }
    const p = this.params, Q = ctx.y[this.idx], pIn = ctx.P[this.from], vIn = ctx.V[this.from], S = COROPUMP_RP.suction;
    const rIn = Q > 0 ? inflowResistance(p, pIn, vIn) : p.R0;
    out.flow(this.from, this.to, Q);
    let rate = (pumpHead(p, p.speed, Q) - (ctx.P[this.to] - pIn) - rIn * Q) / p.L;
    const qLim = Math.max(vIn - this.floorV, 0) / S.floorTau, ex = Q - qLim;
    if (ex > 0) rate = -ex / S.limitTau;
    else if (ex > -S.limitBand) { const w = -ex / S.limitBand; rate = rate * w + (1 - w) * (-ex / S.limitTau); }
    out.rate(this.idx, rate);
  }
  taps(ctx: Ctx) {
    const t = super.taps(ctx), p = this.params;
    return { ...t, level: this.lvl, current: motorCurrent(p.speed, t.head, t.Q), placement: t.dP, pIn: ctx.P[this.from], pOut: ctx.P[this.to], suctionAlarm: t.suction, beat: this.beats };
  }
}
