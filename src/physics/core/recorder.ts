import type { Gated } from "./valves";
import type { Element, Engine, NodeId, Sample } from "./types";

/** Pressure (mmHg) or volume (ml) over a beat; `end` is the value at the end of the beat, the instant before the next activation. */
export interface NodeStat { min: number; max: number; mean: number; end: number }
/** Gradients mmHg, volumes ml, `openMs` ms: peak and mean gradient while forward flow is possible, volumes through the valve in the beat, time open, peak gradient while reversed through a regurgitant area. */
export interface ValveStat { peakGradient: number; meanGradient: number; forwardMl: number; regurgMl: number; openMs: number; regurgPeakGradient: number }
/** The beat sampled on a coarse grid: time (s, from the engine clock), pressure and volume of every node by name, and the net flow through the named elements. Values are rounded to 0.01. */
export interface BeatWave { t: number[]; p: Record<string, number[]>; v: Record<string, number[]>; q: Record<string, number[]> }
export interface BeatRecord { p: Record<string, NodeStat>; v: Record<string, NodeStat>; valves: Record<string, ValveStat>; wave?: BeatWave }
/** Waveform capture: `dt` is the solver step of the periodic run, `every` the sampling period in seconds (the grid is the beat start + dt, + every, ...), `flows` the elements to record. */
export interface WaveOptions { dt: number; every: number; flows: readonly string[] }

/**
 * Per-beat statistics built on `onSample`: min, max, time-weighted mean and end value of every node's pressure and volume, and
 * the stats of the named valves. A beat is `T` seconds from the clock at construction; `beat()` reports the one in progress,
 * so right after `periodic()` it is the last beat (forward and backward volumes come from `flowVolumes()`, which `periodic()` resets every beat). Means weight each sample by the step it closes, so a step cut at an event
 * counts for its length. All sample arrays are preallocated; a callback allocates nothing.
 */
export class BeatRecorder {
  private readonly NN: number;
  private readonly pMin: Float64Array; private readonly pMax: Float64Array; private readonly pSum: Float64Array; private readonly pEnd: Float64Array;
  private readonly vMin: Float64Array; private readonly vMax: Float64Array; private readonly vSum: Float64Array; private readonly vEnd: Float64Array;
  private readonly valves: { name: string; el: Gated; dMax: number; dSum: number; dT: number; rMax: number }[];
  private sumT = 0; private tPrev: number; private boundary: number;
  private readonly off: () => void;
  private readonly wave: { dt: number; stride: number; flows: readonly string[]; t: number[]; p: number[][]; v: number[][]; q: number[][]; next: number; start: number } | null = null;
  constructor(private readonly eng: Engine, private readonly T: number, valves: readonly string[] = [], wave?: WaveOptions) {
    const NN = (this.NN = eng.nodes.length);
    const arr = () => new Float64Array(NN);
    this.pMin = arr(); this.pMax = arr(); this.pSum = arr(); this.pEnd = arr(); this.vMin = arr(); this.vMax = arr(); this.vSum = arr(); this.vEnd = arr();
    this.valves = valves.map((name) => ({ name, el: eng.element<Element & Gated>(name), dMax: 0, dSum: 0, dT: 0, rMax: 0 }));
    this.tPrev = eng.t; this.boundary = eng.t + T;
    if (wave) {
      const rows = (n: number) => Array.from({ length: n }, () => [] as number[]);
      this.wave = { dt: wave.dt, stride: Math.max(1, Math.round(wave.every / wave.dt)), flows: wave.flows, t: [], p: rows(NN), v: rows(NN), q: rows(wave.flows.length), next: 0, start: eng.t };
    }
    this.reset();
    this.off = eng.onSample((s) => this.sample(s));
  }
  private reset() {
    this.pMin.fill(Infinity); this.pMax.fill(-Infinity); this.pSum.fill(0); this.vMin.fill(Infinity); this.vMax.fill(-Infinity); this.vSum.fill(0); this.sumT = 0;
    const w = this.wave;
    if (w) { w.t.length = 0; for (const a of w.p) a.length = 0; for (const a of w.v) a.length = 0; for (const a of w.q) a.length = 0; w.start = this.boundary - this.T; w.next = w.start + w.dt; }
    for (const v of this.valves) { v.dMax = 0; v.dSum = 0; v.dT = 0; v.rMax = 0; }
  }
  private sample(s: Sample) {
    while (s.t > this.boundary + 1e-9) { this.boundary += this.T; this.reset(); }
    const h = s.t - this.tPrev; this.tPrev = s.t;
    const P = s.P, V = s.V;
    for (let i = 0; i < this.NN; i++) {
      const p = P[i], v = V[i];
      if (p < this.pMin[i]) this.pMin[i] = p; if (p > this.pMax[i]) this.pMax[i] = p; this.pSum[i] += p * h; this.pEnd[i] = p;
      if (v < this.vMin[i]) this.vMin[i] = v; if (v > this.vMax[i]) this.vMax[i] = v; this.vSum[i] += v * h; this.vEnd[i] = v;
    }
    this.sumT += h;
    if (this.wave && (s.t >= this.wave.next - 1e-9 || s.t >= this.boundary - 1e-9)) this.capture(s);
    for (const g of this.valves) {
      const d = P[g.el.from] - P[g.el.to];
      if (d > 0 && g.el.params.area) { if (d > g.dMax) g.dMax = d; g.dSum += d * h; g.dT += h; }
      else if (d < 0 && g.el.params.reg && -d > g.rMax) g.rMax = -d;
    }
  }
  private capture(s: Sample) {
    const w = this.wave!, r2 = (x: number) => Math.round(x * 100) / 100;
    w.t.push(Math.round((s.t - w.start) * 1e4) / 1e4);
    for (let i = 0; i < this.NN; i++) { w.p[i].push(r2(s.P[i])); w.v[i].push(r2(s.V[i])); }
    if (w.flows.length) { const q = s.q; for (let k = 0; k < w.flows.length; k++) w.q[k].push(r2(q[w.flows[k]])); }
    while (w.next <= s.t + 1e-9) w.next += w.stride * w.dt;
  }
  /** The beat in progress (the last beat after `periodic()`), by node name and valve name. */
  beat(): BeatRecord {
    const p: Record<string, NodeStat> = {}, v: Record<string, NodeStat> = {}, valves: Record<string, ValveStat> = {};
    const stat = (i: NodeId, lo: Float64Array, hi: Float64Array, sum: Float64Array, end: Float64Array): NodeStat => ({ min: lo[i], max: hi[i], mean: sum[i] / this.sumT, end: end[i] });
    this.eng.nodes.forEach((n, i) => { p[n.name] = stat(i, this.pMin, this.pMax, this.pSum, this.pEnd); v[n.name] = stat(i, this.vMin, this.vMax, this.vSum, this.vEnd); });
    const fv = this.eng.flowVolumes();
    for (const g of this.valves) valves[g.name] = { peakGradient: g.dMax, meanGradient: g.dT ? g.dSum / g.dT : 0, forwardMl: fv.fwd[g.name], regurgMl: fv.bwd[g.name], openMs: g.dT * 1000, regurgPeakGradient: g.rMax };
    const w = this.wave;
    if (!w) return { p, v, valves };
    const byNode = (rows: number[][]) => { const o: Record<string, number[]> = {}; this.eng.nodes.forEach((n, i) => (o[n.name] = rows[i].slice())); return o; };
    const q: Record<string, number[]> = {}; w.flows.forEach((n, k) => (q[n] = w.q[k].slice()));
    return { p, v, valves, wave: { t: w.t.slice(), p: byNode(w.p), v: byNode(w.v), q } };
  }
  dispose() { this.off(); }
}
