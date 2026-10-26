/**
 * Contracts of the hemodynamic core (docs/HEMODYNAMICS_CORE.md §3). Types only: no behaviour lives here.
 *
 * The core is a graph of nodes (blood-holding compartments) and elements. The engine owns one state vector: a volume for
 * every node, plus whatever states elements declare (inertial flows, pump flows, balloon volume, interstitial water...).
 * Each derivative evaluation runs the same four phases, in order:
 *
 *   1. field     elements that read volumes and write an external pressure on nodes (pericardium, thorax), or shift a
 *                node's effective volume (an IABP balloon occupying the aorta, the septum bowing into one ventricle)
 *   2. pressure  every node's pressure from its effective volume and the time, plus its external pressure
 *   2b. series   elements that sit in series with a node's compliance (a characteristic impedance Zc between a valve and an
 *                artery) add the pressure drop they carry to the node's pressure, so the node reads as the proximal pressure
 *   3. flow      elements that move blood between nodes (or in and out of the circulation) and set their own state rates
 *   4. (engine)  node volume rates are the sum of what phase 3 added
 *
 * Beats are events, not a fixed period: the rhythm model's beats start atrial and ventricular activation, so a PVC, a
 * blocked P wave or atrial fibrillation reach the chambers as they happen.
 *
 * Units throughout: mmHg, ml, ml/s, seconds.
 */

/** Index of a node in the engine's node table. */
export type NodeId = number;

/**
 * Where a node sits, for external pressures. A field writes to every node in its group, so the pericardium only needs to
 * know "pericardial", not which chambers exist.
 */
export type ExternalGroup = "pericardial" | "thoracic" | "abdominal" | "none";

export interface NodeDef {
  name: string;
  /** Element that computes this node's pressure (a chamber or a compliance). */
  model: NodeModel;
  group: ExternalGroup;
  /** ml, the volume the run starts from. */
  start: number;
}

/** Read-only view of the state during one derivative evaluation. */
export interface Ctx {
  t: number;
  /** Node volumes, ml, indexed by NodeId. */
  readonly V: Float64Array;
  /** Node pressures, mmHg (filled in phase 2; valid in phase 3). */
  readonly P: Float64Array;
  /** External pressure on each node, mmHg (filled in phase 1; read in phase 2). */
  readonly Pext: Float64Array;
  /** Volume added to each node's own for its pressure law, ml (filled in phase 1). Blood volume itself is unchanged. */
  readonly Vshift: Float64Array;
  /** The whole state vector; an element reads its own states at the offsets it was bound to. */
  readonly y: Float64Array;
}

/** Where an element writes during phase 1 and 3. */
export interface Rates {
  /** Add an external pressure (mmHg) to a node. Phase 1 only. */
  addExternal(node: NodeId, p: number): void;
  /** Add to a node's pressure, mmHg. Phase 2b (`series`) only; every flow and every output sees the sum. */
  addPressure(node: NodeId, p: number): void;
  /** Add to the volume a node's pressure law sees, ml. Phase 1 only. */
  shiftVolume(node: NodeId, dv: number): void;
  /** Move `q` ml/s from one node to another; `from` or `to` may be OUTSIDE for flow in or out of the circulation. */
  flow(from: NodeId, to: NodeId, q: number): void;
  /** d/dt of one of the element's own states (absolute index into y). */
  rate(index: number, value: number): void;
}

/** A sink or source outside the circulation (infusions, bleeding, urine, the interstitium before it has its own state). */
export const OUTSIDE: NodeId = -1;

export interface StateDecl {
  name: string;
  start: number;
  /** Lower bound the integrator clamps to (e.g. a volume that cannot go negative). */
  min?: number;
}

/** Events from the rhythm model. `strength` scales activation (a PVC contracts weakly, a potentiated beat strongly). */
export type HeartEvent =
  | { kind: "atrial"; t: number; strength?: number }
  | { kind: "ventricular"; t: number; strength?: number; pvc?: boolean };

/** Anything the engine runs. All methods are optional; an element implements the phases it takes part in. */
export interface Element {
  readonly name: string;
  /** States this element owns; the engine binds them to consecutive indices starting at `offset`. */
  readonly states?: readonly StateDecl[];
  bind?(offset: number): void;
  /** Called once when the engine is built, with the engine, for elements that watch it (a device console, a timing detector). */
  attach?(engine: Engine): void;
  /** Phase 1: write external pressures and volume shifts from the volumes. */
  field?(ctx: Ctx, out: Rates): void;
  /**
   * Phase 2b: after every node's pressure is known, add series pressure drops with `out.addPressure`. All series elements read the
   * pressures as phase 2 left them (not each other's additions) and their additions are applied together afterwards, so the order
   * of elements does not matter. An element that caches a flow here may use it in `flow()` of the same evaluation.
   */
  series?(ctx: Ctx, out: Rates): void;
  /** Phase 3: flows between nodes and rates of own states. */
  flow?(ctx: Ctx, out: Rates): void;
  /** A beat happened (or a scheduled one is due). */
  onEvent?(ev: HeartEvent): void;
  /** Named live values for outputs and consoles (device flow, motor current, pericardial pressure...). */
  taps?(ctx: Ctx): Record<string, number>;
}

/** An element that gives a node its pressure (phase 2). */
export interface NodeModel extends Element {
  /** Transmural pressure from the node's effective volume (own + shift) at time t; the engine adds the external pressure. */
  pressure(volume: number, t: number): number;
  /**
   * Volume (ml) at which the node, at rest (no activation, no shift, no external pressure), sits at transmural pressure `p` (mmHg): the
   * inverse of its passive law. `restVolume(0)` is its unstressed volume. Used for the stop-flow equilibrium (core/vessels.ts); absent on
   * a model with no passive law.
   */
  restVolume?(p: number): number;
}

/**
 * Parameters change while the engine runs (a drug, a slider, the baroreflex). Each element keeps a plain parameter object;
 * the engine applies patches between steps, never during one, so a step sees one consistent set.
 */
export interface Tunable<P extends object> {
  readonly params: Readonly<P>;
  set(patch: Partial<P>): void;
}

/** The engine as callers see it. */
export interface Engine {
  readonly nodes: readonly NodeDef[];
  readonly elements: readonly Element[];
  readonly t: number;
  node(name: string): NodeId;
  element<E extends Element = Element>(name: string): E;
  /** Queue an event; it is delivered when the clock reaches its time. */
  schedule(ev: HeartEvent): void;
  /** Advance the clock by dt seconds (live play). */
  step(dt: number): void;
  /**
   * Run with regular beats at `hr` until the beat-to-beat change is below tolerance (steady-state reports). Every beat
   * schedules a ventricular event and, if a PR is known, an atrial event `pr` seconds (atrial event to ventricular event)
   * before the next one. `pr` defaults to the engine's `defaultPr(T)` option; with neither, no atrial events are scheduled.
   * Returns the number of beats and whether it settled.
   */
  periodic(hr: number, opts?: { maxBeats?: number; minBeats?: number; tol?: number; pr?: number }): { beats: number; converged: boolean };
  /** `periodic()` one beat at a time: yields after each beat; returns the same result. */
  periodicSteps(hr: number, opts?: { maxBeats?: number; minBeats?: number; tol?: number; pr?: number }): Generator<void, { beats: number; converged: boolean }>;
  /**
   * Volume (ml) that has flowed forward (positive) and backward through each flow element since the last reset, integrated
   * with the RK4 weights (the exact integral of the scheme, not a sum of samples). A single-edge element reports its edge;
   * one that moves blood along several paths reports the sum of its flows. `periodic()` resets it at every beat, so
   * afterwards it holds the last beat.
   */
  flowVolumes(): { fwd: Record<string, number>; bwd: Record<string, number> };
  resetFlowVolumes(): void;
  /** Snapshot of the instant: pressures, volumes, every edge's flow and every element's taps. */
  sample(): Sample;
  /** Called after every step with the new instant (recorders, beat accumulators, trace buffers). */
  onSample(cb: (s: Sample) => void): () => void;
}

export interface Sample {
  t: number;
  P: Readonly<Float64Array>;
  V: Readonly<Float64Array>;
  Pext: Readonly<Float64Array>;
  /** Net flow through each flow element, ml/s, by element name (positive in its declared direction). */
  q: Readonly<Record<string, number>>;
  taps: Readonly<Record<string, Record<string, number>>>;
}
