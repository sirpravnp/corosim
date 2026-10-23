import { cannulaInertance, IMPELLA, IMPELLA_CONSOLE, IMPELLA_POSITION, IMPELLA_SUCTION, type ImpellaModelName, type ImpellaPosition } from "../../../config/devices";
import { NODES } from "../../structuralGraph";
import type { Model } from "../../structural";
import type { Ctx, Engine, HeartEvent, NodeId, Rates } from "../types";
import { inflowResistance, pumpHead, RotaryPump, type PumpParams } from "./pump";

export interface ImpellaConfig {
  model?: ImpellaModelName;
  /** P-level 0..9 (0 = off). Default 6. */
  level?: number;
  /** Where the inflow sits. Default "correct". Fixed at construction (it decides the nodes). */
  position?: ImpellaPosition;
  /** Unloaded volume V0 of the inflow chamber (the LV), ml: the suction and the floor are set relative to it. */
  v0: number;
}

/** Speed (krpm) of a P-level (clamped and rounded to 0..9) of a model. */
export const levelSpeed = (model: ImpellaModelName, level: number): number => IMPELLA[model].speeds[Math.min(9, Math.max(0, Math.round(level)))];

/**
 * Motor current, mA: I = i0 + i2·ω² + kI·max(H·Q, 0)/ω, with the rotor head H = H(ω,Q) (mmHg), Q ml/s, ω krpm. The first two terms are the
 * speed-dependent loss; the last is proportional to the hydraulic torque (head·Q/ω). Constants: `IMPELLA_CONSOLE` [assumed].
 */
export function motorCurrent(speed: number, head: number, q: number): number {
  const C = IMPELLA_CONSOLE, kI = (1000 * 1.333e-4) / (C.eta * ((2 * Math.PI) / 60) * 1000 * C.kt);
  return speed <= 0 ? 0 : C.i0 + C.i2 * speed * speed + (kI * Math.max(head * q, 0)) / speed;
}

/**
 * Impella 2.5 / CP / 5.5 as a `RotaryPump` (core/devices/pump.ts) with the device's own numbers (`IMPELLA` in config/devices.ts):
 * the P-level picks the rotor speed, the cannula gives the inertance L = ρℓ/A, and the suction law is set relative to the LV's unloaded
 * volume V0 (Vc = V0 + margin), so a hypovolemic or over-drained LV trips suction well before it empties.
 *
 * Positions. `correct`: inflow LV, outflow AO. `aortic`: inflow and outflow both in the aorta, so the blood recirculates AO → AO, nothing
 * is unloaded and the placement signal (P_out − P_in) is flat at zero. `deep`: the inflow is against the wall; suction develops at a higher
 * volume and pressure (`IMPELLA_POSITION.deep`). The volume terms (collapse volume, floor) are LV laws, so they are switched off for `aortic` (the aorta has no such collapse); only the pressure term of suction remains.
 *
 * Floor (R-D1). The chamber's passive law does not stop its volume falling, so the flow is softly limited:
 *     Q ≤ Q_lim = (V_in − (V0 + floor))/floorTau;   with ex = Q − Q_lim:  ex > 0: dQ/dt = −ex/limitTau (replaces the head equation);
 *     −band < ex ≤ 0: dQ/dt = w·(head equation) + (1 − w)·(−ex/limitTau), w = −ex/band  (continuous blend).
 * A plain extra damping term would not do: the head drives Q at about H/L ~ 10³ ml/s², so a damper only moves the equilibrium to Q_lim + H·limitTau/L. At a normal volume Q_lim is far above the flow, so it does nothing; as V_in nears V0 + floor it takes over, and the volume approaches the
 * floor exponentially without crossing it (checked in tests/impella.test.ts).
 *
 * Taps: those of `RotaryPump` plus `level`, `current` (mA, `motorCurrent`), `placement` (P_out − P_in, mmHg: aortic minus LV pressure when
 * correctly placed), `pIn`, `pOut`, `suctionAlarm` (0/1, the suction tap), `beat` (ventricular events seen). Beat-level console numbers (mean
 * flow, current pulsatility, placement amplitude, alarm over a beat) come from `ImpellaConsole`.
 */
export class Impella extends RotaryPump {
  readonly model: ImpellaModelName;
  readonly position: ImpellaPosition;
  private lvl: number;
  private floorV: number;
  private beats = 0;
  constructor(name: string, from: NodeId, to: NodeId, cfg: ImpellaConfig) {
    const model = cfg.model ?? "CP", position = cfg.position ?? "correct", def = IMPELLA[model], S = IMPELLA_SUCTION, level = cfg.level ?? 6;
    const deep = position === "deep" ? IMPELLA_POSITION.deep : { vcExtraMl: 0, pthExtra: 0 };
    super(name, from, to, {
      speed: levelSpeed(model, level), a: def.a, b: def.b, c: def.c, L: cannulaInertance(def.lengthCm, def.diameterMm), R0: def.R0, Rmax: S.Rmax,
      Pth: S.Pth + deep.pthExtra, wP: S.wP, Vc: position === "aortic" ? -1e6 : cfg.v0 + S.vcMarginMl + deep.vcExtraMl, wV: S.wV, suctionAt: S.suctionAt,
    });
    this.model = model; this.position = position; this.lvl = level; this.floorV = position === "aortic" ? -1e6 : cfg.v0 + S.floorMl;
  }
  /** `fromModel`'s way in: the nodes (LV → AO, or AO → AO) and V0 come from the model. */
  static forModel(m: Model, cfg: Omit<ImpellaConfig, "v0"> = {}, name = "impella"): Impella {
    const ao = NODES.indexOf("AO"), lv = NODES.indexOf("LV");
    return new Impella(name, cfg.position === "aortic" ? ao : lv, ao, { ...cfg, v0: m.chambers[lv]!.v0 });
  }
  get level(): number { return this.lvl; }
  /** `level` (P-level, sets the speed) and any pump parameter; a `speed` given alone overrides the table until the next `level`. */
  set(patch: Partial<PumpParams> & { level?: number }) {
    const { level, ...rest } = patch;
    super.set(rest);
    if (level !== undefined && Number.isFinite(level)) { this.lvl = Math.min(9, Math.max(0, Math.round(level))); this.params.speed = levelSpeed(this.model, this.lvl); }
  }
  onEvent(ev: HeartEvent) { if (ev.kind === "ventricular") this.beats++; }
  flow(ctx: Ctx, out: Rates) {
    const p = this.params, Q = ctx.y[this.idx], pIn = ctx.P[this.from], vIn = ctx.V[this.from];
    const rIn = Q > 0 ? inflowResistance(p, pIn, vIn) : p.R0;
    out.flow(this.from, this.to, Q);
    let rate = (pumpHead(p, p.speed, Q) - (ctx.P[this.to] - pIn) - rIn * Q) / p.L;
    const S = IMPELLA_SUCTION, qLim = Math.max(vIn - this.floorV, 0) / S.floorTau, ex = Q - qLim;
    if (ex > 0) rate = -ex / S.limitTau; // over the limit: the limiter overrides the head, however large
    else if (ex > -S.limitBand) { const w = -ex / S.limitBand; rate = rate * w + (1 - w) * (-ex / S.limitTau); } // blended in over `limitBand` ml/s so the rate is continuous
    out.rate(this.idx, rate);
  }
  taps(ctx: Ctx) {
    const t = super.taps(ctx), p = this.params;
    return { ...t, level: this.lvl, current: motorCurrent(p.speed, t.head, t.Q), placement: t.dP, pIn: ctx.P[this.from], pOut: ctx.P[this.to], suctionAlarm: t.suction, beat: this.beats };
  }
}

/** What the console shows for one completed beat (ventricular event to ventricular event). Flow L/min, current mA, pressures mmHg. */
export interface ImpellaBeat {
  /** Time of the beat's end (engine clock), s. */
  t: number;
  level: number;
  flow: { mean: number; min: number; max: number };
  current: { mean: number; min: number; max: number };
  /** Pulsatility of the motor current: max − min over the beat, mA. Large when the LV–AO pressure difference swings (correct position), near zero when it does not (aortic). */
  pulsatility: number;
  /** Placement signal: aortic pressure − LV pressure (the pressure difference across the cannula) over the beat. `amplitude` = max − min. */
  placement: { mean: number; min: number; max: number; amplitude: number };
  /** Fraction of the beat spent in suction (the `suction` tap), the highest suction level (0-1) reached, and the console alarm (that level at or above `IMPELLA_CONSOLE.alarmLevel`). */
  suctionFraction: number;
  suctionLevel: number;
  suctionAlarm: boolean;
}

/**
 * Beat statistics of an `Impella` in an engine: samples its taps every `IMPELLA_CONSOLE.strideS` seconds and closes a beat when the device's
 * `beat` counter advances (it counts ventricular events). `last` is the most recent completed beat, `onBeat` calls back with each one.
 */
export class ImpellaConsole {
  last: ImpellaBeat | null = null;
  private acc = { n: 0, q: [0, 0, -Infinity] as number[], i: [0, 0, -Infinity] as number[], d: [0, 0, -Infinity] as number[], s: 0, lv: 0 };
  private beat = NaN; private next = -Infinity;
  private readonly off: () => void;
  private listeners: ((b: ImpellaBeat) => void)[] = [];
  constructor(engine: Engine, private readonly name = "impella") {
    this.reset();
    this.off = engine.onSample((s) => {
      if (s.t < this.next - 1e-9) return;
      this.next = s.t + IMPELLA_CONSOLE.strideS;
      const t = s.taps[this.name];
      if (!t) return;
      if (Number.isNaN(this.beat)) this.beat = t.beat;
      if (t.beat !== this.beat) { this.close(s.t, t.level); this.beat = t.beat; }
      const a = this.acc; a.n++;
      for (const [arr, x] of [[a.q, t.flow], [a.i, t.current], [a.d, t.placement]] as const) { arr[0] += x; arr[1] = Math.min(arr[1], x); arr[2] = Math.max(arr[2], x); }
      a.s += t.suctionAlarm; a.lv = Math.max(a.lv, t.suctionLevel);
    });
  }
  private reset() { this.acc = { n: 0, q: [0, Infinity, -Infinity], i: [0, Infinity, -Infinity], d: [0, Infinity, -Infinity], s: 0, lv: 0 }; }
  private close(t: number, level: number) {
    const a = this.acc;
    if (a.n >= 5) {
      const stat = (x: number[]) => ({ mean: x[0] / a.n, min: x[1], max: x[2] });
      const d = stat(a.d), frac = a.s / a.n;
      this.last = { t, level, flow: stat(a.q), current: stat(a.i), pulsatility: a.i[2] - a.i[1], placement: { ...d, amplitude: d.max - d.min }, suctionFraction: frac, suctionLevel: a.lv, suctionAlarm: a.lv >= IMPELLA_CONSOLE.alarmLevel };
      for (const l of this.listeners) l(this.last);
    }
    this.reset();
  }
  onBeat(cb: (b: ImpellaBeat) => void): () => void { this.listeners.push(cb); return () => { const i = this.listeners.indexOf(cb); if (i >= 0) this.listeners.splice(i, 1); }; }
  dispose() { this.off(); }
}
