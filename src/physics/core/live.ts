import { LIVE, MODIFIER_RANGE, VENOUS_TONE } from "../../config/live";
import { buildModel, volumeOffsetFor, type Model, type StructuralSpec } from "../structural";
import type { Beat } from "../ecg";
import type { BeatHemo } from "../beatHemo";
import { ElastanceChamber } from "./chamber";
import { createEngine } from "./engine";
import { defaultPr, fromModel, type FromModelOptions } from "./fromModel";
import { BeatRecorder, type NodeStat, type ValveStat } from "./recorder";
import { Resistor } from "./valves";
import type { Thorax } from "./thorax";
import { Compliance } from "./vessels";
import type { Element, Engine, HeartEvent } from "./types";

/**
 * Slow inputs to the heart, as multipliers on the design point (1 = unchanged). The names mirror `BeatModifiers` and
 * `AutonomicEffects`. `setModifiers` replaces the whole set: a field left out is 1, so applying the same set twice gives the same
 * state and patches never compound.
 *
 *  - `contractility`  LV and RV end-systolic elastance Ees × factor (range 0.2-3). Sympathetic inotropy, beta blockade, inotropes.
 *  - `resistance`     systemic bed resistances BEDU and BEDL × factor (range 0.2-4). The pulmonary bed is not touched.
 *  - `venousTone`     unstressed volume Vu of SPL, IVC, SVC: Vu = Vu_design · clamp(1 − gain·(tone − 1), 0.2, 1.8) with gain 0.8 (SPL),
 *                     0.4 (IVC, SVC) and tone in 0.5-2 (`VENOUS_TONE`). Higher tone = lower Vu = more stressed volume (higher mean
 *                     systemic filling pressure, more venous return); total blood volume is unchanged. [assumed]
 *  - `preload`        alias of `venousTone` (used when `venousTone` is not given), so a `BeatModifiers` record can be passed on
 *                     as it is. `AutonomicEffects.preloadResp` carries breathing too; the respiratory part belongs to B3.
 *  - `relax`          relaxScale of both ventricles × factor (range 0.5-3): > 1 is slower relaxation (longer τ).
 *  - `thoracic`       intrathoracic pressure, mmHg. Added as a constant to the thoracic and pericardial nodes when the heart was built with `core.thorax` (B3); otherwise stored and returned only.
 * `hrScale` and `deviceFlow` are not parameters of the heart: rate arrives as beats, a pump is a device element.
 */
export interface LiveModifiers { contractility?: number; resistance?: number; venousTone?: number; preload?: number; relax?: number; thoracic?: number }

/**
 * Record of one completed beat. The `BeatHemo` fields are those of the legacy per-beat model, from the engine: `t` is the
 * ventricular event (stream time, s), `interval` the time since the previous one, `strokeVolume` the net ml through the aortic valve
 * during the beat, `systolic` the peak aortic pressure of the beat and `diastolic` the aortic pressure when it began. A record is
 * emitted when the NEXT ventricular event arrives (the beat ends there), so it lags its own beat by one RR.
 */
export interface LiveBeat extends BeatHemo {
  /** Mean aortic pressure over the beat, mmHg. */
  map: number;
  /** Pressure and volume statistics of every node over the beat (mmHg, ml), by node name. */
  p: Record<string, NodeStat>;
  v: Record<string, NodeStat>;
  /** End-diastolic volume (volume at the beat's event) and end-systolic volume (minimum over the beat) of each ventricle, ml. */
  edv: { LV: number; RV: number };
  esv: { LV: number; RV: number };
  /** Net ml through the pulmonary valve during the beat. */
  rvStrokeVolume: number;
  /** Peak gradients, volumes and open time of each cardiac valve over the beat. */
  valves: Record<string, ValveStat>;
  /** Relaxation time constant of each ventricle, ms (NaN if the beat has no measurable relaxation). */
  tauMs: Record<string, number>;
  /** Activation strength the ventricle was driven with (1 = normal). */
  strength: number;
}

/** Downsampled history of the last `LIVE.traceSeconds`: stream time (s, strictly increasing), node pressures (mmHg) and chamber volumes (ml). */
export interface LiveTrace { t: Float64Array; p: Record<string, Float32Array>; v: Record<"RA" | "RV" | "LA" | "LV", Float32Array> }

export interface LiveOptions {
  /** Options of `fromModel` (defaults as in `simulate`). */
  core?: FromModelOptions;
  /** Extra elements (devices) to add to the graph. */
  extra?: readonly Element[];
}

interface BeatMeta { t: number; rr: number; pvc: boolean; atrialKick: boolean; strength: number }
interface Cur extends BeatMeta { aoStart: number; edvLV: number; edvRV: number }
const CHAMBERS = ["RA", "RV", "LA", "LV"] as const;
const range = (x: number, [lo, hi]: readonly [number, number] | readonly number[]) => Math.min(hi, Math.max(lo, x));

/**
 * The core engine driven live by beats (A6). Beats from the rhythm model (`Beat`: ecg.ts) become events and the engine is stepped
 * between them; slow inputs (autonomic tone, drugs, volume status) are parameter patches applied between steps.
 *
 * Time. Stream time is the clock of the beats, 0 at construction, or at the end of `warm()`. `time` and every `t` this class reports
 * are stream time; the engine's own clock is offset by the warm-up. Beats are scheduled as they come (the stream looks ahead
 * ~0.5 s) and must arrive in time order; the same `Beat` object given twice is ignored.
 *
 * Events from a beat `b` (engine time = b.t + offset, pr = b.pr, else the default PR at b.rr):
 *  - conducted beat: atrial event at b.t − pr, ventricular event at b.t;
 *  - PVC (`pvc`): ventricular only, strength `LIVE.pvcStrength`;
 *  - `pOnly` (blocked P wave): atrial event only, at b.t − pr;
 *  - `noP` (junctional escape, atrial fibrillation): ventricular only;
 *  - the first ventricular beat after a PVC: strength `LIVE.potentiatedStrength`.
 * An atrial event already in the past when its beat arrives is dropped (right after `warm()`, whose last cycle already contained it).
 * The first ventricular event after `warm()` measures its RR from the last event of the warm-up, so put it at about one RR after 0
 * (a beat at 0 follows the warm-up at the steady rate).
 */
export class LiveHeart {
  readonly model: Model;
  readonly engine: Engine;
  private offset = 0;
  private attached = false;
  private seen = new WeakSet<Beat>();
  private lastVentT = -Infinity;
  private afterPvc = false;
  private queue: BeatMeta[] = [];
  private cur: Cur | null = null;
  private prevVentT = NaN;
  private listeners: ((b: LiveBeat) => void)[] = [];
  /** Completed beats, newest last (at most `LIVE.maxRecords`). */
  readonly records: LiveBeat[] = [];
  private mods: Required<Omit<LiveModifiers, "preload">> = { contractility: 1, resistance: 1, venousTone: 1, relax: 1, thoracic: 0 };
  // design point
  private readonly ventricles: { el: ElastanceChamber; ees: number; relax: number }[];
  private readonly beds: { el: Resistor; R: number }[];
  private readonly veins: { el: Compliance; vu: number; gain: number }[];
  // trace ring buffer
  private readonly cap = Math.ceil(LIVE.traceSeconds / LIVE.traceEvery) + 2;
  private readonly trT = new Float64Array(this.cap);
  private readonly trP: Float32Array[]; private readonly trV: Float32Array[];
  private trN = 0; private trHead = 0; private trNext = 0;
  private readonly nodeNames: string[]; private readonly chamberIdx: number[];

  constructor(spec: StructuralSpec = {}, opts: LiveOptions = {}) {
    this.model = buildModel(spec, volumeOffsetFor(spec, opts.core));
    const g = fromModel(this.model, opts.core);
    const marker: Element = { name: "beatMarker", onEvent: (ev: HeartEvent) => { if (ev.kind === "ventricular") this.onVentricular(ev); } };
    this.engine = createEngine(g.nodes, [...g.elements, marker, ...(opts.extra ?? [])], g.options);
    const eng = this.engine;
    this.ventricles = (["LV", "RV"] as const).map((n) => { const el = eng.element<ElastanceChamber>(n); return { el, ees: el.params.ees, relax: el.params.relaxScale ?? 1 }; });
    this.beds = (["BEDU", "BEDL"] as const).map((n) => { const el = eng.element<Resistor>(n); return { el, R: el.params.R }; });
    this.veins = Object.entries(VENOUS_TONE.gain).map(([n, gain]) => { const el = eng.element<Compliance>(n); return { el, vu: el.params.Vu, gain }; });
    this.nodeNames = eng.nodes.map((n) => n.name);
    this.chamberIdx = CHAMBERS.map((n) => eng.node(n));
    this.trP = this.nodeNames.map(() => new Float32Array(this.cap));
    this.trV = CHAMBERS.map(() => new Float32Array(this.cap));
    const valves = this.model.edges.filter((e) => e.type === "valve" && (e.name !== "RVAO" || e.area)).map((e) => e.name);
    this.valveNames = valves;
  }
  private valveNames: string[];
  private off: (() => void) | null = null;
  private recorder: BeatRecorder | null = null;

  /** Stream time, s. */
  get time(): number { return this.engine.t - this.offset; }
  /** The most recent completed beat. */
  get last(): LiveBeat | null { return this.records[this.records.length - 1] ?? null; }
  get modifiers(): Readonly<Required<Omit<LiveModifiers, "preload">>> { return this.mods; }

  /** Call `cb` with every completed beat. Returns the function that removes it. */
  onRecord(cb: (b: LiveBeat) => void): () => void {
    this.listeners.push(cb);
    return () => { const i = this.listeners.indexOf(cb); if (i >= 0) this.listeners.splice(i, 1); };
  }

  /** Start from the steady state at `hr` (beats/min) instead of the cold start: `periodic(hr)`, then stream time 0. Only before the first beat or step. */
  warm(hr: number): { beats: number; converged: boolean } {
    if (this.attached) throw new Error("LiveHeart.warm() must come before the first beat or step");
    const r = this.engine.periodic(hr);
    this.offset = this.engine.t;
    this.attach();
    return r;
  }

  /** Schedule the events of one beat. */
  onBeat(b: Beat) {
    if (this.seen.has(b)) return;
    this.seen.add(b);
    this.attach();
    const tv = b.t + this.offset, pr = b.pr ?? defaultPr(b.rr);
    const atrial = () => { if (tv - pr >= this.engine.t - 1e-6) this.engine.schedule({ kind: "atrial", t: tv - pr }); };
    if (b.pOnly) { atrial(); return; }
    if (b.t <= this.lastVentT) return; // out of order or duplicate
    this.lastVentT = b.t;
    const kick = !b.noP && !b.pvc;
    if (kick) atrial();
    const strength = b.pvc ? LIVE.pvcStrength : this.afterPvc ? LIVE.potentiatedStrength : 1;
    this.afterPvc = b.pvc;
    this.queue.push({ t: tv, rr: b.rr, pvc: b.pvc, atrialKick: kick, strength });
    this.engine.schedule({ kind: "ventricular", t: tv, strength, pvc: b.pvc });
  }

  /** Advance dt seconds (split into steps of at most `LIVE.maxStep`; the engine cuts a step at every event). */
  step(dt: number) {
    this.attach();
    let rem = dt;
    while (rem > 1e-12) { const h = Math.min(rem, LIVE.maxStep); this.engine.step(h); rem -= h; }
  }

  /** Apply the slow inputs between steps, as factors on the design point (see `LiveModifiers`). Replaces the previous set. */
  setModifiers(m: LiveModifiers) {
    const f = (x: number | undefined, r: readonly number[]) => (x !== undefined && Number.isFinite(x) ? range(x, r) : 1);
    const tone = m.venousTone ?? m.preload;
    const mods = { contractility: f(m.contractility, MODIFIER_RANGE.contractility), resistance: f(m.resistance, MODIFIER_RANGE.resistance), venousTone: f(tone, VENOUS_TONE.toneRange), relax: f(m.relax, MODIFIER_RANGE.relax), thoracic: m.thoracic !== undefined && Number.isFinite(m.thoracic) ? m.thoracic : 0 };
    this.mods = mods;
    for (const v of this.ventricles) v.el.set({ ees: v.ees * mods.contractility, relaxScale: v.relax * mods.relax });
    for (const b of this.beds) b.el.set({ R: b.R * mods.resistance });
    for (const v of this.veins) v.el.set({ Vu: v.vu * range(1 - v.gain * (mods.venousTone - 1), VENOUS_TONE.factorRange) });
    this.thorax()?.set({ offsetMmHg: mods.thoracic }); // B3: constant intrathoracic pressure on top of the breath (only when built with `core.thorax`)
  }
  private thorax(): Thorax | null { try { return this.engine.element<Thorax>("thorax"); } catch { return null; } }

  /** The traces of the last `LIVE.traceSeconds` (or since stream time `from`), oldest first. Copies. */
  trace(from = -Infinity): LiveTrace {
    const idx: number[] = [];
    for (let k = 0; k < this.trN; k++) { const i = (this.trHead - this.trN + k + this.cap) % this.cap; if (this.trT[i] >= from) idx.push(i); }
    const t = Float64Array.from(idx, (i) => this.trT[i]);
    const p: Record<string, Float32Array> = {};
    this.nodeNames.forEach((n, j) => (p[n] = Float32Array.from(idx, (i) => this.trP[j][i])));
    const v = {} as LiveTrace["v"];
    CHAMBERS.forEach((n, j) => (v[n] = Float32Array.from(idx, (i) => this.trV[j][i])));
    return { t, p, v };
  }

  // ---- internals ------------------------------------------------------------------------------
  /** Start recording (after any warm-up). */
  private attach() {
    if (this.attached) return;
    this.attached = true;
    this.recorder = new BeatRecorder(this.engine, null, this.valveNames);
    this.engine.resetFlowVolumes();
    this.trNext = this.engine.t;
    this.off = this.engine.onSample((s) => {
      if (s.t < this.trNext - 1e-9) return;
      const i = this.trHead;
      this.trT[i] = s.t - this.offset;
      for (let j = 0; j < this.trP.length; j++) this.trP[j][i] = s.P[j];
      for (let j = 0; j < this.chamberIdx.length; j++) this.trV[j][i] = s.V[this.chamberIdx[j]];
      this.trHead = (i + 1) % this.cap; if (this.trN < this.cap) this.trN++;
      while (this.trNext <= s.t + 1e-9) this.trNext += LIVE.traceEvery;
    });
  }

  /** A ventricular event was delivered: the beat in progress ends here and the next begins. */
  private onVentricular(ev: { t: number; strength?: number; pvc?: boolean }) {
    if (!this.attached || !this.recorder) return; // warm-up events
    const rec = this.recorder;
    const qi = this.queue.findIndex((m) => Math.abs(m.t - ev.t) < 1e-6);
    const meta: BeatMeta = qi >= 0 ? this.queue[qi] : { t: ev.t, rr: NaN, pvc: !!ev.pvc, atrialKick: false, strength: ev.strength ?? 1 };
    if (qi >= 0) this.queue.splice(0, qi + 1);
    const started = rec.duration > 0;
    const done = started ? rec.closeBeat() : null;
    const fv = this.engine.flowVolumes();
    this.engine.resetFlowVolumes();
    const cur = this.cur;
    if (cur && done) {
      const sv = fv.fwd.AV - fv.bwd.AV;
      const interval = Number.isFinite(this.prevVentT) ? cur.t - this.prevVentT : cur.rr;
      const out: LiveBeat = {
        t: cur.t - this.offset, interval, strokeVolume: sv, systolic: done.p.AO.max, diastolic: cur.aoStart, pvc: cur.pvc, atrialKick: cur.atrialKick,
        map: done.p.AO.mean, p: done.p, v: done.v, edv: { LV: cur.edvLV, RV: cur.edvRV }, esv: { LV: done.v.LV.min, RV: done.v.RV.min },
        rvStrokeVolume: fv.fwd.PVL - fv.bwd.PVL, valves: done.valves, tauMs: done.tauMs, strength: cur.strength,
      };
      this.records.push(out);
      if (this.records.length > LIVE.maxRecords) this.records.splice(0, this.records.length - LIVE.maxRecords);
      for (const l of this.listeners) l(out);
    }
    if (cur) this.prevVentT = cur.t;
    // state at the event: the end of the beat just closed, or the engine's own instant before any beat has run
    const P = done ? undefined : this.engine.sample();
    const ao = this.nodeNames.indexOf("AO");
    this.cur = {
      ...meta,
      aoStart: done ? done.p.AO.end : P!.P[ao],
      edvLV: done ? done.v.LV.end : P!.V[this.engine.node("LV")],
      edvRV: done ? done.v.RV.end : P!.V[this.engine.node("RV")],
    };
  }
}
