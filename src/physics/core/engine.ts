import { SOLVER } from "../../config/structural";
import type { Ctx, Element, Engine, HeartEvent, NodeDef, NodeId, NodeModel, Rates, Sample } from "./types";

/** Tolerance on event times, s: an event this close ahead of the clock counts as due, and a split shorter than this is not made. */
const T_EPS = 1e-9;
/** RK4 weights of the four stage derivatives. */
const RK_W = [1 / 6, 1 / 3, 1 / 3, 1 / 6];

export interface EngineOptions {
  /** Default PR for `periodic()`: seconds from the atrial event to the ventricular event, for beat period T. Without it (and without `pr` in the call) `periodic()` schedules no atrial events. */
  defaultPr?: (T: number) => number;
  /** Nodes (by name) whose beat-mean pressure and beat-mean volume decide `periodic()` convergence. Default: every node's pressure. */
  converge?: { pressure: readonly string[]; volume: readonly string[] };
}

/**
 * Engine over a graph of nodes and elements. The state vector y is [node volumes | element states]; the integrator is fixed-step
 * classical RK4 over all of it. Each derivative evaluation runs field → pressure → flow (types.ts). Events are queued by time and
 * delivered at the start of the step that reaches them; a step never crosses an event: it is cut at the event time instead.
 * Preallocated Float64Arrays throughout; the inner loop allocates nothing.
 */
export function createEngine(nodes: readonly NodeDef[], elements: readonly Element[], options: EngineOptions = {}): Engine {
  return new CoreEngine(nodes, elements, options);
}

class CoreEngine implements Engine {
  t = 0;
  private readonly NN: number;
  private readonly N: number;
  private readonly models: NodeModel[];
  private readonly all: Element[];
  private readonly fieldEls: Element[];
  private readonly seriesEls: Element[];
  private readonly flowEls: Element[];
  private readonly eventEls: Element[];
  private readonly minima: [number, number][] = [];
  private readonly byName = new Map<string, Element>();
  private readonly nodeIdx = new Map<string, NodeId>();
  private readonly y: Float64Array; private readonly X: Float64Array; private readonly k: Float64Array[];
  private readonly P: Float64Array; private readonly Pext: Float64Array; private readonly Vshift: Float64Array;
  private readonly ctx: { t: number; V: Float64Array; P: Float64Array; Pext: Float64Array; Vshift: Float64Array; y: Float64Array };
  private readonly elQ: Float64Array; private readonly fwd: Float64Array; private readonly bwd: Float64Array;
  private readonly sink: Sink;
  private readonly dP: Float64Array;
  private readonly pending: HeartEvent[] = [];
  private readonly callbacks: ((s: Sample) => void)[] = [];
  private readonly view: SampleView;
  private h = 0;
  private readonly Vview: Float64Array;
  /** Beat accumulators of periodic(): time-weighted sums of every node's pressure and volume. */
  private accP: Float64Array | null = null; private accV: Float64Array | null = null; private accT = 0;

  constructor(readonly nodes: readonly NodeDef[], readonly elements: readonly Element[], private readonly opts: EngineOptions) {
    const NN = (this.NN = nodes.length);
    this.models = nodes.map((n) => n.model);
    this.all = [...new Set<Element>([...this.models, ...elements])];
    nodes.forEach((n, i) => this.nodeIdx.set(n.name, i));
    // state registry: node volumes first, then each element's declared states, bound to consecutive indices
    const start: number[] = nodes.map((n) => n.start);
    for (const el of this.all) {
      if (el.states?.length) {
        el.bind?.(start.length);
        for (const s of el.states) { if (s.min !== undefined) this.minima.push([start.length, s.min]); start.push(s.start); }
      }
    }
    const N = (this.N = start.length);
    this.y = Float64Array.from(start); this.X = new Float64Array(N); this.k = [0, 1, 2, 3].map(() => new Float64Array(N));
    this.P = new Float64Array(NN); this.Pext = new Float64Array(NN); this.Vshift = new Float64Array(NN);
    this.ctx = { t: 0, V: this.X.subarray(0, NN), P: this.P, Pext: this.Pext, Vshift: this.Vshift, y: this.X };
    this.fieldEls = this.all.filter((e) => e.field); this.seriesEls = this.all.filter((e) => e.series); this.flowEls = this.all.filter((e) => e.flow); this.eventEls = this.all.filter((e) => e.onEvent);
    for (const el of this.all) if (!this.byName.has(el.name)) this.byName.set(el.name, el);
    for (const el of elements) this.byName.set(el.name, el);
    this.elQ = new Float64Array(this.flowEls.length); this.fwd = new Float64Array(this.flowEls.length); this.bwd = new Float64Array(this.flowEls.length);
    this.dP = new Float64Array(NN);
    this.sink = new Sink(this.Pext, this.Vshift, this.elQ, this.dP);
    this.Vview = this.y.subarray(0, NN);
    this.view = new SampleView(this);
    this.refresh();
    for (const el of this.all) el.attach?.(this);
  }

  node(name: string): NodeId {
    const i = this.nodeIdx.get(name);
    if (i === undefined) throw new Error(`No node ${name}`);
    return i;
  }
  element<E extends Element = Element>(name: string): E {
    const e = this.byName.get(name);
    if (!e) throw new Error(`No element ${name}`);
    return e as E;
  }

  schedule(ev: HeartEvent) {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].t > ev.t) i--;
    this.pending.splice(i, 0, ev);
  }
  private deliverDue() {
    while (this.pending.length && this.pending[0].t <= this.t + T_EPS) {
      const ev = this.pending.shift()!;
      for (const el of this.eventEls) el.onEvent!(ev);
    }
  }

  step(dt: number) { this.advance(dt); }

  /** Advance by `len` seconds, cut at every pending event so none is stepped across. */
  private advance(len: number) {
    let rem = len;
    this.deliverDue();
    while (rem > 1e-12) {
      let h = rem;
      const ahead = this.pending.length ? this.pending[0].t - this.t : Infinity;
      if (ahead > T_EPS && ahead < rem - T_EPS) h = ahead;
      this.rk4(h); rem -= h;
      this.refresh();
      if (this.accP) {
        for (let i = 0; i < this.NN; i++) { this.accP[i] += this.P[i] * h; this.accV![i] += this.y[i] * h; }
        this.accT += h;
      }
      for (let c = 0; c < this.callbacks.length; c++) this.callbacks[c](this.view);
      this.deliverDue();
    }
  }

  /** One derivative evaluation at state X: phases 1 (field), 2 (pressure), 3 (flow). `w` is the RK4 weight with which the step accumulates flow volumes (0 = do not). */
  private deriv(t: number, out: Float64Array, w: number) {
    const { NN, ctx, Pext, Vshift, P, X, sink } = this;
    ctx.t = t; Pext.fill(0); Vshift.fill(0); out.fill(0); sink.out = out;
    for (let i = 0; i < this.fieldEls.length; i++) this.fieldEls[i].field!(ctx as Ctx, sink);
    for (let i = 0; i < NN; i++) P[i] = this.models[i].pressure(X[i] + Vshift[i], t) + Pext[i];
    this.applySeries();
    this.elQ.fill(0);
    for (let i = 0; i < this.flowEls.length; i++) { sink.cur = i; this.flowEls[i].flow!(ctx as Ctx, sink); }
    if (w) {
      const wh = w * this.h;
      for (let i = 0; i < this.elQ.length; i++) { const q = this.elQ[i]; if (q > 0) this.fwd[i] += wh * q; else this.bwd[i] -= wh * q; }
    }
  }

  /** Classical RK4 over the whole state vector. */
  private rk4(h: number) {
    const { y, X, k, N, t } = this;
    this.h = h;
    X.set(y); this.deriv(t, k[0], RK_W[0]);
    for (let i = 0; i < N; i++) X[i] = y[i] + 0.5 * h * k[0][i];
    this.deriv(t + h / 2, k[1], RK_W[1]);
    for (let i = 0; i < N; i++) X[i] = y[i] + 0.5 * h * k[1][i];
    this.deriv(t + h / 2, k[2], RK_W[2]);
    for (let i = 0; i < N; i++) X[i] = y[i] + h * k[2][i];
    this.deriv(t + h, k[3], RK_W[3]);
    for (let i = 0; i < N; i++) y[i] += (h / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
    for (let i = 0; i < this.minima.length; i++) { const [j, lo] = this.minima[i]; if (y[j] < lo) y[j] = lo; }
    this.t = t + h;
  }

  /** Pressures (and fields) at the current state and time, without accumulating flow. */
  private refresh() {
    const { NN, ctx, Pext, Vshift, P, X, sink } = this;
    X.set(this.y); ctx.t = this.t; Pext.fill(0); Vshift.fill(0); sink.out = this.k[0];
    for (let i = 0; i < this.fieldEls.length; i++) this.fieldEls[i].field!(ctx as Ctx, sink);
    for (let i = 0; i < NN; i++) P[i] = this.models[i].pressure(X[i] + Vshift[i], this.t) + Pext[i];
    this.applySeries();
  }
  /** Phase 2b: series elements read the pressures of phase 2, then their additions are applied together. */
  private applySeries() {
    const els = this.seriesEls;
    if (!els.length) return;
    const { ctx, sink, dP, P } = this;
    dP.fill(0);
    for (let i = 0; i < els.length; i++) els[i].series!(ctx as Ctx, sink);
    for (let i = 0; i < P.length; i++) P[i] += dP[i];
  }
  /** Flows at the current instant into elQ (a full evaluation that accumulates nothing). */
  private evalFlows() { this.X.set(this.y); this.deriv(this.t, this.k[0], 0); }

  onSample(cb: (s: Sample) => void) {
    this.callbacks.push(cb);
    return () => { const i = this.callbacks.indexOf(cb); if (i >= 0) this.callbacks.splice(i, 1); };
  }

  flowVolumes() {
    const fwd: Record<string, number> = {}, bwd: Record<string, number> = {};
    this.flowEls.forEach((e, i) => { fwd[e.name] = this.fwd[i]; bwd[e.name] = this.bwd[i]; });
    return { fwd, bwd };
  }
  resetFlowVolumes() { this.fwd.fill(0); this.bwd.fill(0); }

  // Live values of one instant, for the view handed to `onSample` callbacks (reused: copy what you keep) and for sample().
  /** @internal */ flowsByName(into: Record<string, number>) {
    this.evalFlows();
    this.flowEls.forEach((e, i) => (into[e.name] = this.elQ[i]));
    return into;
  }
  /** @internal */ tapsByName(): Record<string, Record<string, number>> {
    this.evalFlows();
    const out: Record<string, Record<string, number>> = {};
    for (const el of this.all) if (el.taps) out[el.name] = el.taps(this.ctx as Ctx);
    return out;
  }
  /** @internal */ arrays() { return { P: this.P, V: this.Vview, Pext: this.Pext }; }

  sample(): Sample {
    const { P, V, Pext } = this.arrays();
    return { t: this.t, P: P.slice(), V: V.slice(), Pext: Pext.slice(), q: this.flowsByName({}), taps: this.tapsByName() };
  }

  periodic(hr: number, opts: { maxBeats?: number; minBeats?: number; tol?: number; pr?: number } = {}) {
    const it = this.periodicSteps(hr, opts);
    for (;;) { const r = it.next(); if (r.done) return r.value; }
  }

  /** `periodic()` one beat at a time: yields after each beat so a caller can give the thread back between beats; returns the same result. */
  *periodicSteps(hr: number, opts: { maxBeats?: number; minBeats?: number; tol?: number; pr?: number } = {}): Generator<void, { beats: number; converged: boolean }> {
    const T = 60 / hr, nSteps = Math.max(50, Math.round(T / SOLVER.dt)), dt = T / nSteps;
    const maxBeats = opts.maxBeats ?? SOLVER.maxBeats, minBeats = opts.minBeats ?? SOLVER.minBeats, tol = opts.tol ?? SOLVER.tol;
    const conv = this.opts.converge, pIdx = (conv ? conv.pressure : this.nodes.map((n) => n.name)).map((n) => this.node(n)), vIdx = (conv?.volume ?? []).map((n) => this.node(n));
    const pr = opts.pr ?? this.opts.defaultPr?.(T);
    this.accP = new Float64Array(this.NN); this.accV = new Float64Array(this.NN);
    let converged = false, beats = 0, prev: number[] | null = null, stable = 0;
    try {
      for (; beats < maxBeats; beats++) {
        this.resetFlowVolumes(); this.accP.fill(0); this.accV.fill(0); this.accT = 0;
        const tb = this.t;
        this.schedule({ kind: "ventricular", t: tb });
        if (pr !== undefined && T - pr >= 0) this.schedule({ kind: "atrial", t: tb + T - pr });
        for (let s = 0; s < nSteps; s++) this.advance(dt);
        const sig = [...pIdx.map((i) => this.accP![i] / this.accT), ...vIdx.map((i) => this.accV![i] / this.accT)];
        if (prev && sig.every((x, i) => Math.abs(x - prev![i]) <= tol * Math.max(1, Math.abs(x)))) stable++; else stable = 0;
        prev = sig;
        if (beats + 1 >= minBeats && stable >= 3) { converged = true; beats++; break; }
        yield;
      }
    } finally { this.accP = null; this.accV = null; }
    return { beats, converged };
  }
}

/** Where elements write during a derivative evaluation. */
class Sink implements Rates {
  out!: Float64Array; cur = 0;
  constructor(private readonly Pext: Float64Array, private readonly Vshift: Float64Array, private readonly elQ: Float64Array, private readonly dP: Float64Array) {}
  addPressure(node: NodeId, p: number) { this.dP[node] += p; }
  addExternal(node: NodeId, p: number) { this.Pext[node] += p; }
  shiftVolume(node: NodeId, dv: number) { this.Vshift[node] += dv; }
  flow(from: NodeId, to: NodeId, q: number) {
    if (to >= 0) this.out[to] += q;
    if (from >= 0) this.out[from] -= q;
    this.elQ[this.cur] += q;
  }
  rate(index: number, value: number) { this.out[index] = value; }
}

/** The instant after a step, handed to `onSample` callbacks; flows and taps are computed only if read. */
class SampleView implements Sample {
  private qRec: Record<string, number> = {};
  constructor(private readonly e: CoreEngine) {}
  get t() { return this.e.t; }
  get P() { return this.e.arrays().P; }
  get V() { return this.e.arrays().V; }
  get Pext() { return this.e.arrays().Pext; }
  get q() { return this.e.flowsByName(this.qRec); }
  get taps() { return this.e.tapsByName(); }
}
