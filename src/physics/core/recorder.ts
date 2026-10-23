import type { Gated } from "./valves";
import type { Element, Engine, NodeId, Sample } from "./types";

/** Pressure (mmHg) or volume (ml) over a beat; `end` is the value at the end of the beat, the instant before the next activation. */
export interface NodeStat { min: number; max: number; mean: number; end: number }
/** Gradients mmHg, volumes ml, `openMs` ms: peak and mean gradient while forward flow is possible, volumes through the valve in the beat, time open, peak gradient while reversed through a regurgitant area. */
export interface ValveStat { peakGradient: number; meanGradient: number; forwardMl: number; regurgMl: number; openMs: number; regurgPeakGradient: number }
export interface BeatRecord { p: Record<string, NodeStat>; v: Record<string, NodeStat>; valves: Record<string, ValveStat> }

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
  constructor(private readonly eng: Engine, private readonly T: number, valves: readonly string[] = []) {
    const NN = (this.NN = eng.nodes.length);
    const arr = () => new Float64Array(NN);
    this.pMin = arr(); this.pMax = arr(); this.pSum = arr(); this.pEnd = arr(); this.vMin = arr(); this.vMax = arr(); this.vSum = arr(); this.vEnd = arr();
    this.valves = valves.map((name) => ({ name, el: eng.element<Element & Gated>(name), dMax: 0, dSum: 0, dT: 0, rMax: 0 }));
    this.tPrev = eng.t; this.boundary = eng.t + T;
    this.reset();
    this.off = eng.onSample((s) => this.sample(s));
  }
  private reset() {
    this.pMin.fill(Infinity); this.pMax.fill(-Infinity); this.pSum.fill(0); this.vMin.fill(Infinity); this.vMax.fill(-Infinity); this.vSum.fill(0); this.sumT = 0;
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
    for (const g of this.valves) {
      const d = P[g.el.from] - P[g.el.to];
      if (d > 0 && g.el.params.area) { if (d > g.dMax) g.dMax = d; g.dSum += d * h; g.dT += h; }
      else if (d < 0 && g.el.params.reg && -d > g.rMax) g.rMax = -d;
    }
  }
  /** The beat in progress (the last beat after `periodic()`), by node name and valve name. */
  beat(): BeatRecord {
    const p: Record<string, NodeStat> = {}, v: Record<string, NodeStat> = {}, valves: Record<string, ValveStat> = {};
    const stat = (i: NodeId, lo: Float64Array, hi: Float64Array, sum: Float64Array, end: Float64Array): NodeStat => ({ min: lo[i], max: hi[i], mean: sum[i] / this.sumT, end: end[i] });
    this.eng.nodes.forEach((n, i) => { p[n.name] = stat(i, this.pMin, this.pMax, this.pSum, this.pEnd); v[n.name] = stat(i, this.vMin, this.vMax, this.vSum, this.vEnd); });
    const fv = this.eng.flowVolumes();
    for (const g of this.valves) valves[g.name] = { peakGradient: g.dMax, meanGradient: g.dT ? g.dSum / g.dT : 0, forwardMl: fv.fwd[g.name], regurgMl: fv.bwd[g.name], openMs: g.dT * 1000, regurgPeakGradient: g.rMax };
    return { p, v, valves };
  }
  dispose() { this.off(); }
}
