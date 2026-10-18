import { Simulation } from "./simulation";
import { V3 } from "../anatomy/curve";
import { diameterAt } from "../anatomy/tree";
import { MMHG } from "../config/anatomy";
import { ANGIO, AHA_SEGMENTS, AhaSegment, SEGMENT_SUPPLY, Territory, WALL_MOTION, WIRE } from "../config/cath";
import type { NetResult, SegResult } from "../physics/network";

/**
 * What a cath lab reads off a patient, as pure functions of a `Simulation`: the angiogram (vessels, diameters, and when the
 * contrast front reaches each point), the pressure wire (Pd/Pa along a vessel at rest and at adenosine hyperemia, FFR) and the
 * echo's wall motion by AHA segment. No DOM and no drawing; the page, the tests and (later) the MCP tools all call these.
 */

/** Piecewise-linear lookup of `ys` at `x` (xs ascending), clamped at both ends. */
export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const w = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] * (1 - w) + ys[hi] * w;
}

// ------------------------------------------------------------------------------------------------ angiogram

export interface AngioSegment {
  id: string; name: string; group: "LAD" | "LCx" | "RCA"; parent: string | null;
  attach: number; // fraction along the parent where this branch leaves
  length: number; // mm
  samples: V3[]; // patient-frame centreline, `ANGIO.samples + 1` points of equal arc length
  diameterMm: number[]; // lumen diameter at each sample
  velocity: number[]; // m/s at each sample, at the current (resting or exertion) flow
  /** Seconds after injection at which the contrast front reaches each sample. Infinity beyond an occlusion. */
  arrival: number[];
  blockedFrom: number | null; // mm along the vessel where an occlusion stops the dye
}
export interface AngioModel {
  segments: AngioSegment[];
  byId: Record<string, AngioSegment>;
  centre: V3; // middle of the tree, what the C-arm centres on
  dominance: string;
}

/** Contrast front: at each sample of each vessel, how long after injection the dye arrives, moving at the solved blood velocity. */
export function angioModel(sim: Simulation): AngioModel {
  const NS = ANGIO.samples, net = sim.analysis.cond;
  const segments: AngioSegment[] = [], byId: Record<string, AngioSegment> = {};
  for (const sg of sim.tree.segments) { // parents come before their children
    const r = net.seg[sg.id];
    const samples = sg.samples.length === NS + 1 ? sg.samples : Array.from({ length: NS + 1 }, (_, i) => sg.curve.at(i / NS));
    const s = (i: number) => (i / NS) * sg.length;
    const diameterMm = samples.map((_, i) => interp(r.s, r.d, s(i)) * 1e3);
    const velocity = samples.map((_, i) => interp(r.s, r.v, s(i)));
    const arrival = new Array<number>(NS + 1);
    let T = 0;
    if (sg.parent) { const pa = byId[sg.parent]; T = pa.arrival[Math.round(sg.attach * NS)]; }
    arrival[0] = T;
    for (let i = 1; i <= NS; i++) {
      if (!Number.isFinite(T) || (r.blockedFrom !== null && s(i) >= r.blockedFrom)) { T = Infinity; arrival[i] = T; continue; }
      T += sg.length / NS / 1000 / Math.max(ANGIO.minVelocity, velocity[i]);
      arrival[i] = T;
    }
    const a: AngioSegment = { id: sg.id, name: sg.name, group: sg.group, parent: sg.parent, attach: sg.attach, length: sg.length, samples, diameterMm, velocity, arrival, blockedFrom: r.blockedFrom };
    segments.push(a); byId[sg.id] = a;
  }
  const centre: V3 = [0, 0, 0];
  let n = 0;
  for (const a of segments) for (const p of a.samples) { centre[0] += p[0]; centre[1] += p[1]; centre[2] += p[2]; n++; }
  return { segments, byId, centre: [centre[0] / n, centre[1] / n, centre[2] / n], dominance: sim.tree.variant.dominance };
}

export interface Timi {
  artery: string;
  grade: 0 | 1 | 2 | 3;
  /** Frames (at 30 fps) for the dye to run from the injection to the end of the vessel; null when it never gets there. */
  frames: number | null;
  /** Where an occlusion stops the dye, mm from the vessel's start. */
  blockedAt: number | null;
}

/** TIMI flow in one vessel from the contrast model (an `AngioModel` can be passed in to avoid rebuilding it). */
export function timi(sim: Simulation, artery: string, model: AngioModel = angioModel(sim)): Timi {
  const a = model.byId[artery];
  if (!a) throw new Error(`No vessel ${artery} in this patient.`);
  const end = a.arrival[a.arrival.length - 1];
  const frames = Number.isFinite(end) ? Math.round(end * ANGIO.fps) : null;
  const grade = a.blockedFrom !== null || frames === null ? 0 : frames > ANGIO.trickleFrames ? 1 : frames > ANGIO.slowFrames ? 2 : 3;
  return { artery, grade, frames, blockedAt: a.blockedFrom };
}

/**
 * TIMI flow beyond a lesion: the worst of the vessel itself and every branch that leaves it past the lesion (for a left main
 * lesion, the LAD and the circumflex). `from` is the lesion's position in mm along the vessel.
 */
export function timiBeyond(sim: Simulation, artery: string, from: number, model: AngioModel = angioModel(sim)): Timi {
  let worst = timi(sim, artery, model);
  const walk = (id: string) => {
    for (const c of model.segments) {
      if (c.parent !== id) continue;
      if (id === artery && c.attach * model.byId[id].length < from) continue; // left the vessel before the lesion
      const t = timi(sim, c.id, model);
      if (t.grade < worst.grade || (t.grade === worst.grade && (t.frames ?? Infinity) > (worst.frames ?? Infinity))) worst = { ...t, artery };
      walk(c.id);
    }
  };
  walk(artery);
  return worst;
}

// ------------------------------------------------------------------------------------------------ pressure wire

export interface WirePoint {
  s: number; // mm from the vessel's start
  diameterMm: number;
  /** Pd/Pa at that point, at rest and at adenosine hyperemia. */
  restRatio: number; hyperRatio: number;
  restMmHg: number; hyperMmHg: number;
  /** True when the wire has been dragged past an occlusion, which it cannot cross (it stops at the occlusion). */
  stopped: boolean;
}
export interface WireModel {
  artery: string;
  length: number; // mm
  s: number[]; // mm along the vessel, one entry per profile point
  diameterMm: number[];
  restRatio: number[]; hyperRatio: number[]; // Pd/Pa along the vessel
  paRestMmHg: number; paHyperMmHg: number;
  occluded: boolean; blockedFrom: number | null;
  lesionAt: number | null; // mm, centre of the vessel's lesion
  /**
   * Fractional flow reserve: for a vessel with a lesion, the hyperemic pressure ratio just beyond it (the same number as
   * `sim.state().ffr`); for a clean vessel, the ratio at its far end. Null when the vessel is occluded.
   */
  ffr: number | null;
  /** Pd/Pa at the far end of the vessel at hyperemia (the end of a pullback). */
  distalRatio: number | null;
  /** The wire at `position` (0 ostium .. 1 distal), or at `{ mm }` along the vessel. */
  at(position: number | { mm: number }): WirePoint;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function wireModel(sim: Simulation, artery: string): WireModel {
  const sg = sim.tree.byId[artery];
  if (!sg) throw new Error(`No vessel ${artery} in this patient.`);
  const rest: NetResult = sim.analysis.cond, hyp: NetResult = sim.analysis.hyper;
  const rr: SegResult = rest.seg[artery], hr: SegResult = hyp.seg[artery];
  const blockedFrom = rr.blockedFrom;
  const li = sim.n.lesions.findIndex((l) => l.segId === artery && !l.occluded);
  const lesion = sim.n.lesions.find((l) => l.segId === artery);
  const lesionAt = lesion ? clamp(lesion.pos * sg.length, 7, sg.length - 7) : null;
  const restRatio = rr.P.map((p) => p / rest.pa), hyperRatio = hr.P.map((p) => p / hyp.pa);
  const last = hyperRatio.length - 1;
  const distal = blockedFrom !== null ? null : hyperRatio[last];
  const paRest = rest.pa / MMHG, paHyper = hyp.pa / MMHG;
  const at = (position: number | { mm: number }): WirePoint => {
    const mm = typeof position === "number" ? position * sg.length : position.mm;
    const limit = blockedFrom === null ? sg.length : blockedFrom - 0.5;
    const s = clamp(mm, 0, limit);
    const restR = interp(rr.s, restRatio, s), hypR = interp(hr.s, hyperRatio, s);
    return { s, diameterMm: interp(rr.s, rr.d, s) * 1e3, restRatio: restR, hyperRatio: hypR, restMmHg: restR * paRest, hyperMmHg: hypR * paHyper, stopped: mm > limit };
  };
  return {
    artery, length: sg.length, s: rr.s, diameterMm: rr.d.map((d) => d * 1e3), restRatio, hyperRatio,
    paRestMmHg: paRest, paHyperMmHg: paHyper, occluded: blockedFrom !== null, blockedFrom, lesionAt,
    ffr: blockedFrom !== null ? null : li >= 0 ? sim.analysis.ffr[li] : distal, distalRatio: distal, at,
  };
}

/** Whether an FFR calls for treatment, with the grey zone named as such. */
export function ffrCall(ffr: number): "flow-limiting" | "grey zone" | "not flow-limiting" {
  return ffr <= WIRE.grayZone[0] ? "flow-limiting" : ffr <= WIRE.ffrCutoff ? "grey zone" : "not flow-limiting";
}

// ------------------------------------------------------------------------------------------------ echo

export type WallMotion = "normal" | "hypokinetic" | "akinetic" | "dyskinetic";
export interface EchoSegment {
  index: number; // 0..16, the AHA order of `AHA_SEGMENTS`
  name: AhaSegment;
  territory: Territory; // the artery that supplies most of it
  /** Ischemia or scar in the muscle there, 0..1 (the larger of the two). */
  severity: number;
  motion: WallMotion;
  score: 1 | 2 | 3 | 4; // normal, hypo-, a-, dyskinetic
}
export interface EchoModel {
  segments: EchoSegment[];
  /** Mean wall-motion score over the 17 segments: 1 is normal, higher is worse. */
  scoreIndex: number;
  ejectionFraction: number;
  heartRate: number | null;
  territorySeverity: Record<Territory, number>;
}

const territoryOf = (segId: string, group: string): Territory | null =>
  /^(PDA|PLV)_/.test(segId) ? "PD" : group === "LAD" ? "LAD" : group === "LCx" ? "LCX" : null; // the rest of the RCA feeds the right ventricle

/** Wall motion by AHA segment from the live ischemia and scar of the beds each artery feeds. */
export function echoModel(sim: Simulation): EchoModel {
  const sum: Record<Territory, number> = { LAD: 0, LCX: 0, PD: 0 }, mass: Record<Territory, number> = { LAD: 0, LCX: 0, PD: 0 };
  for (const t of sim.analysis.cond.terminals) {
    const k = territoryOf(t.segId, t.group);
    if (!k) continue;
    sum[k] += t.mass * Math.max(sim.sev[t.key] ?? 0, sim.scar[t.key] ?? 0); mass[k] += t.mass;
  }
  const territorySeverity = { LAD: sum.LAD / (mass.LAD || 1), LCX: sum.LCX / (mass.LCX || 1), PD: sum.PD / (mass.PD || 1) };
  const scarred = sim.clinicalMinutes >= WALL_MOTION.dyskineticAfterMin;
  const segments = AHA_SEGMENTS.map((name, index): EchoSegment => {
    const w = SEGMENT_SUPPLY[name];
    let severity = 0, best: Territory = "LAD", top = -1;
    for (const k of Object.keys(w) as Territory[]) { severity += (w[k] ?? 0) * territorySeverity[k]; if ((w[k] ?? 0) > top) { top = w[k] ?? 0; best = k; } }
    const motion: WallMotion = severity >= WALL_MOTION.dyskineticScar && scarred ? "dyskinetic" : severity >= WALL_MOTION.akineticAt ? "akinetic" : severity >= WALL_MOTION.hypokineticAt ? "hypokinetic" : "normal";
    return { index, name, territory: best, severity, motion, score: (["normal", "hypokinetic", "akinetic", "dyskinetic"].indexOf(motion) + 1) as 1 | 2 | 3 | 4 };
  });
  const st = sim.state();
  return {
    segments, scoreIndex: segments.reduce((a, s) => a + s.score, 0) / segments.length,
    ejectionFraction: st.ventricle.ejectionFraction, heartRate: st.rolling10s.hr, territorySeverity,
  };
}

// ------------------------------------------------------------------------------------------------ report

export interface CathFinding {
  artery: string; position: number; occluded: boolean;
  diameterStenosisPct: number; // by quantitative angiography: the narrowest lumen against the vessel's reference
  referenceMm: number; minimumMm: number;
  timi: Timi;
  ffr: number | null; ffrCall: ReturnType<typeof ffrCall> | null;
  restPdPa: number | null; // Pd/Pa at rest at the end of the vessel
}
export interface CathReport {
  dominance: string;
  findings: CathFinding[];
  flow: Timi[]; // the main arteries
  echo: { ejectionFraction: number; scoreIndex: number; abnormal: { name: string; motion: WallMotion; territory: Territory }[] };
  nextSteps: string[];
}

/** The structured findings a cath report prints (and an AI is handed): per lesion, per artery flow, and the echo. */
export function cathReport(sim: Simulation): CathReport {
  const model = angioModel(sim), echo = echoModel(sim);
  const findings: CathFinding[] = sim.n.lesionSpecs.map((l) => {
    const w = wireModel(sim, l.artery), flow = timiBeyond(sim, l.artery, w.lesionAt ?? 0, model);
    const min = l.occluded ? 0 : Math.min(...w.diameterMm);
    const reference = diameterAt(sim.tree, sim.tree.byId[l.artery], w.lesionAt ?? 0) * 1e3;
    return {
      artery: l.artery, position: l.position, occluded: !!l.occluded,
      diameterStenosisPct: Math.round(100 * (l.occluded ? 1 : l.stenosis)), referenceMm: +reference.toFixed(2), minimumMm: +min.toFixed(2),
      timi: flow, ffr: w.ffr === null ? null : +w.ffr.toFixed(2), ffrCall: w.ffr === null ? null : ffrCall(w.ffr),
      restPdPa: w.occluded ? null : +w.restRatio[w.restRatio.length - 1].toFixed(2),
    };
  });
  const main = ["LM", "LAD", "LCX", "RCA"].filter((id) => model.byId[id]);
  return {
    dominance: model.dominance, findings, flow: main.map((id) => timi(sim, id, model)),
    echo: {
      ejectionFraction: echo.ejectionFraction, scoreIndex: +echo.scoreIndex.toFixed(2),
      abnormal: echo.segments.filter((s) => s.motion !== "normal").map((s) => ({ name: s.name, motion: s.motion, territory: s.territory })),
    },
    nextSteps: sim.assessment().steps.map((s) => s.text),
  };
}
