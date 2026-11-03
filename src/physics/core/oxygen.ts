/**
 * Oxygen in time (E6). Generalises the structural steady solve (`solveOxygen`) to a time-stepped transport of content
 * per node, plus systemic lactate and per-bed myocardial O₂ debt. Own states live here (not in the RK4 vector): the engine
 * supplies volumes and beat flow volumes; this model updates content, lactate and debt on the beat / clinical clocks.
 *
 *   Steady: many beat steps at fixed flows land within 1 % of `solveOxygen` (acceptance).
 *   Lactate: rises over clinical minutes when DO₂ < critical; clears when delivery recovers.
 *   ECMO: optional stream uses the same oxygenate hook as the steady solve.
 *   Demand: `mvo2DemandScale` turns a live MVO₂ estimate into a multiplier for the coronary network (feeds E3 via sev).
 */
import { OXYGEN, type ScaiStage } from "../../config/oxygen";
import { O2_PER_G_HB } from "../../config/structural";
import { NODES, type NodeName } from "../structuralGraph";
import { solveOxygen, type Model, type O2Stream } from "../structural";

const NN = NODES.length;
const AO = NODES.indexOf("AO");
const PA = NODES.indexOf("PA");

export type { ScaiStage };
export type { O2Stream };

/** Beat- or window-integrated flows through each named edge (ml of blood). */
export interface OxygenFlows { fwd: Record<string, number>; bwd: Record<string, number> }

export interface OxygenRead {
  /** Content capacity CaO₂ max, ml O₂ / ml blood. */
  capacity: number;
  /** Saturation 0..1 per structural node; NaN where no inflow. */
  sat: Record<NodeName, number>;
  spo2: number;
  preductal: number;
  postductal: number;
  svo2: number;
  /** Systemic DO₂ and realised VO₂, ml O₂/min. */
  do2: number;
  vo2: number;
  /** Requested whole-body VO₂ (from the model), ml O₂/min. */
  vo2Demand: number;
  lactate: number;
  starved: boolean;
  scai: ScaiStage;
  /** Per-bed myocardial O₂ debt 0..1 (keys match ischemia sites when fed). */
  myocardialDebt: Record<string, number>;
  /** Tissue oxygenation 0..1 from debt (same shape as the old ischemia placeholder). */
  bedTissue: Record<string, number>;
}

/**
 * SCAI stage from MAP and lactate (teaching thresholds in `config/oxygen.ts`). Missing MAP falls back to lactate alone.
 */
export function scaiStage(lactate: number, mapMmHg: number): ScaiStage {
  const S = OXYGEN.scai;
  if (!(lactate >= 0) || !Number.isFinite(lactate)) return "A";
  const map = Number.isFinite(mapMmHg) ? mapMmHg : Infinity;
  if (map < S.mapExtremis || lactate >= S.lactateD + 4) return "E";
  if (map < S.mapShock || lactate >= S.lactateD) return "D";
  if (map < S.mapHypotension || lactate >= S.lactateC) return "C";
  if (lactate >= S.lactateB) return "B";
  return "A";
}

/**
 * Coronary demand multiplier from a live MVO₂ estimate (ml/min). Blends toward MVO₂/rest with `OXYGEN.mvo2DemandBlend`;
 * returns 1 when the estimate is missing (safe fallback for the drug/device demand path).
 */
export function mvo2DemandScale(mvo2MlMin: number | null | undefined, blend = OXYGEN.mvo2DemandBlend): number {
  if (!(blend > 0) || mvo2MlMin == null || !Number.isFinite(mvo2MlMin) || mvo2MlMin <= 0) return 1;
  const raw = mvo2MlMin / OXYGEN.restingMvo2MlMin;
  const clamped = Math.min(OXYGEN.mvo2DemandMax, Math.max(OXYGEN.mvo2DemandMin, raw));
  return 1 + blend * (clamped - 1);
}

/**
 * Rough LV MVO₂ (ml/min) from a beat without a full PV loop: PVA ≈ κ·MAP·SV, then Suga a·PVA + basal.
 * Directional for demand scaling; not a substitute for `loopMetrics`. [assumed κ]
 */
export function estimateMvo2MlMin(mapMmHg: number, strokeMl: number, hrBpm: number): number {
  if (!(mapMmHg > 0) || !(strokeMl > 0) || !(hrBpm > 0)) return NaN;
  // κ≈1.25 folds a PE share into SW≈MAP·SV; a from ENERGETICS applied to whole LV (~1.7×100g) ≈ 3e-5 ml/mmHg·ml
  const pva = 1.25 * mapMmHg * strokeMl;
  const perBeat = 3.0e-5 * pva + 0.027; // ~basal 0.01×1.7 + b·Ees term folded
  return perBeat * hrBpm;
}

/** Injury overlay from myocardial debt for E3: max(sev, gain·debt), gain 0 leaves E3 on network severity alone. */
export function debtInjury(sev: number, debt: number, gain: number = OXYGEN.myocardialDebt.injuryGain): number {
  const s = Math.min(1, Math.max(0, sev)), d = Math.min(1, Math.max(0, debt));
  if (!(gain > 0)) return s;
  return Math.min(1, Math.max(s, gain * d));
}

/**
 * One explicit-Euler transport step of length `dt` seconds. `fwd`/`bwd` are ml of blood over that interval (beat integrals
 * when dt = beat length). Mutates `c`. Returns whether any bed was delivery-starved this step.
 */
export function stepOxygenContent(
  c: Float64Array,
  V: ArrayLike<number>,
  m: Model,
  flows: OxygenFlows,
  dt: number,
  capacity: number,
  stream?: O2Stream,
): boolean {
  if (!(dt > 0) || !(capacity > 0)) return false;
  const invDt = 1 / dt;
  const ne = m.edges.length;
  const massIn = new Float64Array(NN);
  const volIn = new Float64Array(NN);
  let starved = false;

  const edgeOut = (i: number, from: number, netMlS: number): number => {
    const e = m.edges[i];
    if (e.role === "lung") return capacity * m.patient.satLung;
    if (e.role === "bedU" || e.role === "bedL") {
      const use = e.role === "bedU" ? m.vo2U : m.vo2L; // ml O₂ / s
      if (netMlS <= 1e-9) { starved = true; return 0; }
      const x = c[from] - use / netMlS;
      if (x < 0) { starved = true; return 0; }
      return x;
    }
    return c[from];
  };

  for (let i = 0; i < ne; i++) {
    const e = m.edges[i];
    const fMl = flows.fwd[e.name] ?? 0, bMl = flows.bwd[e.name] ?? 0;
    const netMlS = (fMl - bMl) * invDt;
    if (fMl > 0) {
      const cout = edgeOut(i, e.from, netMlS);
      massIn[e.to] += fMl * cout;
      volIn[e.to] += fMl;
    }
    if (bMl > 0) {
      massIn[e.from] += bMl * c[e.to];
      volIn[e.from] += bMl;
    }
  }

  if (stream && stream.flow > 1e-9 && dt > 0) {
    const ml = stream.flow * dt;
    const cout = stream.oxygenate(c[stream.from], capacity);
    massIn[stream.to] += ml * cout;
    volIn[stream.to] += ml;
  }

  const minV = OXYGEN.minVolumeMl;
  for (let n = 0; n < NN; n++) {
    const vol = Math.max(V[n] ?? 0, minV);
    const vin = volIn[n];
    if (vin <= 1e-9) continue;
    // Blood leaving carries current content; inflow replaces an equal volume (well-mixed compartment).
    const next = c[n] + (massIn[n] - c[n] * vin) / vol;
    c[n] = Math.max(0, Math.min(capacity, next));
  }
  return starved;
}

/** Advance lactate (mmol/L) over `minutes` of clinical time given current systemic DO₂ (ml/min). */
export function stepLactate(lactate: number, do2MlMin: number, minutes: number): number {
  if (!(minutes > 0)) return lactate;
  const K = OXYGEN;
  let L = Number.isFinite(lactate) ? lactate : K.lactateRest;
  const crit = K.criticalDo2MlMin;
  const do2 = Number.isFinite(do2MlMin) ? Math.max(0, do2MlMin) : crit;
  if (do2 < crit) {
    const deficit = 1 - do2 / crit;
    L += K.lactateRisePerMin * deficit * minutes;
  } else {
    L = K.lactateRest + (L - K.lactateRest) * Math.exp(-minutes / K.lactateClearTauMin);
  }
  return Math.min(K.lactateMax, Math.max(0, L));
}

/** Advance one bed's myocardial debt (0..1) from its supply/demand ratio over clinical minutes. */
export function stepMyocardialDebt(debt: number, supplyDemandRatio: number, minutes: number): number {
  if (!(minutes > 0)) return debt;
  const K = OXYGEN.myocardialDebt;
  let d = Math.min(1, Math.max(0, debt));
  const r = Number.isFinite(supplyDemandRatio) ? Math.max(0, supplyDemandRatio) : 1;
  if (r < 1) d = Math.min(1, d + (1 - r) * K.risePerMin * minutes);
  else d *= Math.exp(-minutes / K.clearTauMin);
  return d;
}

/**
 * Time-evolving oxygen state for the core ACS path. Construct with a model; call `seedSteady` after the first flow window,
 * then `advanceBeat` each completed beat and `advanceClinical` on the clinical clock.
 */
export class OxygenTransport {
  readonly content: Float64Array;
  capacity: number;
  lactate: number = OXYGEN.lactateRest;
  starved = false;
  private debt: Record<string, number> = {};
  private lastDo2 = NaN;
  private lastVo2 = NaN;
  private lastVo2Demand = NaN;
  private map = 90;

  constructor(private model: Model) {
    this.capacity = (O2_PER_G_HB * model.patient.hb) / 100;
    this.content = new Float64Array(NN).fill(0.6 * this.capacity);
  }

  /** Rebuild capacity / VO₂ split when the patient model changes (Hb, satLung, weight). Keeps lactate and debt. */
  setModel(m: Model) {
    this.model = m;
    this.capacity = (O2_PER_G_HB * m.patient.hb) / 100;
  }

  /** Seed content from the steady Gauss–Seidel solve so the first beat starts near equilibrium. */
  seedSteady(flows: OxygenFlows, stream?: O2Stream) {
    const ox = solveOxygen(this.model, flows, stream);
    this.capacity = ox.capacity;
    for (let i = 0; i < NN; i++) this.content[i] = Number.isFinite(ox.content[i]) ? ox.content[i] : 0.6 * this.capacity;
    this.starved = ox.starved;
  }

  /**
   * Advance transport over one beat. `flows` are ml through each edge during the beat; `volumes` are node volumes (ml) at
   * end-beat (or means); `dt` is the beat length in seconds.
   */
  advanceBeat(flows: OxygenFlows, volumes: ArrayLike<number>, dt: number, stream?: O2Stream) {
    if (!(dt > 0)) return;
    const n = Math.max(1, OXYGEN.substepsPerBeat | 0);
    const sub = { fwd: {} as Record<string, number>, bwd: {} as Record<string, number> };
    const scale = 1 / n;
    for (const [k, v] of Object.entries(flows.fwd)) sub.fwd[k] = v * scale;
    for (const [k, v] of Object.entries(flows.bwd)) sub.bwd[k] = v * scale;
    const streamSub = stream && stream.flow > 0 ? { ...stream, flow: stream.flow } : undefined;
    let starved = false;
    for (let i = 0; i < n; i++) starved = stepOxygenContent(this.content, volumes, this.model, sub, dt / n, this.capacity, streamSub) || starved;
    this.starved = starved;
    this.refreshDelivery(flows, dt);
  }

  /** Clinical-minute update: lactate from DO₂, myocardial debt from per-bed supply/demand ratios. */
  advanceClinical(minutes: number, bedRatio: Record<string, number> = {}) {
    if (!(minutes > 0)) return;
    this.lactate = stepLactate(this.lactate, this.lastDo2, minutes);
    for (const [key, ratio] of Object.entries(bedRatio)) {
      const next = stepMyocardialDebt(this.debt[key] ?? 0, ratio, minutes);
      if (next > 1e-4) this.debt[key] = next;
      else delete this.debt[key];
    }
    // Beds not mentioned this tick still clear slowly toward zero when ratios are absent (treated as reperfused).
    for (const key of Object.keys(this.debt)) {
      if (key in bedRatio) continue;
      const next = stepMyocardialDebt(this.debt[key]!, 1, minutes);
      if (next > 1e-4) this.debt[key] = next;
      else delete this.debt[key];
    }
  }

  /** Update the MAP used for SCAI staging (mmHg). */
  setMap(mapMmHg: number) { if (Number.isFinite(mapMmHg)) this.map = mapMmHg; }

  /** Myocardial debt 0..1 for a bed (0 if never tracked). */
  bedDebt(key: string): number { return this.debt[key] ?? 0; }

  /** All tracked debts (copy). */
  debts(): Record<string, number> { return { ...this.debt }; }

  resetDebt() { this.debt = {}; this.lactate = OXYGEN.lactateRest; }

  private refreshDelivery(flows: OxygenFlows, dt: number) {
    const T = dt > 0 ? dt : this.model.T;
    const net = (name: string) => ((flows.fwd[name] ?? 0) - (flows.bwd[name] ?? 0)) / T; // ml/s
    const qs = Math.max(0, net("BEDU") + net("BEDL")); // ml/s systemic
    const cao = this.content[AO];
    this.lastDo2 = qs * 60 * cao; // ml O₂/min
    this.lastVo2Demand = (this.model.vo2U + this.model.vo2L) * 60;
    // Realised extraction cannot exceed what arterial content and flow allow.
    const cVen = Number.isFinite(this.content[PA]) ? this.content[PA] : cao * 0.75;
    this.lastVo2 = Math.max(0, Math.min(this.lastVo2Demand, qs * 60 * Math.max(0, cao - cVen)));
  }

  read(): OxygenRead {
    const sat = {} as Record<NodeName, number>;
    for (let i = 0; i < NN; i++) {
      const v = this.content[i] / this.capacity;
      sat[NODES[i]] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN;
    }
    const bedTissue: Record<string, number> = {};
    for (const [k, d] of Object.entries(this.debt)) {
      bedTissue[k] = Math.min(1, Math.max(0, 0.75 - 0.45 * d)); // same shape as LIVE_SOURCE.bedOxygen
    }
    return {
      capacity: this.capacity,
      sat,
      spo2: sat.AO, preductal: sat.AO, postductal: sat.DAO, svo2: sat.PA,
      do2: this.lastDo2, vo2: this.lastVo2, vo2Demand: this.lastVo2Demand,
      lactate: this.lactate, starved: this.starved,
      scai: scaiStage(this.lactate, this.map),
      myocardialDebt: this.debts(), bedTissue,
    };
  }
}

/** Max relative error of transport content vs `solveOxygen` over nodes with finite steady content. */
export function steadyMatchError(transport: OxygenTransport, m: Model, flows: OxygenFlows, stream?: O2Stream): number {
  const ox = solveOxygen(m, flows, stream);
  let err = 0;
  for (let i = 0; i < NN; i++) {
    if (!Number.isFinite(ox.content[i]) || !(ox.capacity > 0)) continue;
    const a = transport.content[i] / ox.capacity, b = ox.content[i] / ox.capacity;
    if (!Number.isFinite(a) || !(b > 1e-6)) continue;
    err = Math.max(err, Math.abs(a - b) / b);
  }
  return err;
}
