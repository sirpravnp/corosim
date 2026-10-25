import { analyze } from "../physics/structural";
import type { StructuralReport, StructuralSpec } from "../physics/structural";
import { BRIDGE } from "../config/bridge";

/**
 * The bridge's engine work, split from `BridgeSource` (task P2b) so it can run in a Web Worker. Both types are plain
 * objects and arrays, safe to structured-clone.
 */
export interface SolveRequest {
  /** The structural spec before calibration; `volumeMl` is the patient's own volume, the calibrated volume is added to it. */
  base: StructuralSpec;
  /** Calibrated volume of the previous solve, ml: where the secant search starts. */
  volume: number;
  /** The monitor's MAP to match, mmHg. */
  targetMap: number;
  /** The monitor's native cardiac output (device flow excluded) to match, L/min. Absent or not positive: MAP only. */
  targetCo?: number;
  /** Multipliers of the previous solve (svrScale, lvEes): where the cardiac-output search starts. Default 1, 1. */
  warm?: { svr: number; ees: number };
  /** Solve `base` as given, once: no volume, resistance or elastance calibration (the patient is not tied to the monitor). */
  standalone?: boolean;
}
export interface SolveResult {
  report: StructuralReport;
  /** ml added (+) or removed (-) by the calibration. */
  volume: number;
  /** Structural mean aortic pressure minus the target, mmHg. */
  calibrationError: number;
  /** Structural systemic flow minus the target, L/min (NaN with no target). */
  coError: number;
  /** The multipliers the cardiac-output calibration put on `base.svrScale` and `base.lvEes`. */
  svrMul: number; eesMul: number;
  /** analyze() calls made. */
  analyzeCalls: number;
}
/** Spec in, calibrated report out. Synchronous solvers return the result; asynchronous ones a promise of it. */
export interface BridgeSolver { solve(req: SolveRequest): SolveResult | Promise<SolveResult>; }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Calibrate to the monitor's MAP and cardiac output in two phases.
 *
 * Phase 1 (volume, MAP): the volume is adjusted to the target MAP with the spec as given (first step from an assumed
 * slope, then secant, at most `maxCalibrationIterations` extra analyze calls, within `mapToleranceMmHg`; the volume stays
 * in `volumeRangeMl`). This sets the filling of the circulation, as venoconstriction and fluids do, and is what the bridge
 * has always done.
 *
 * Phase 2 (resistance and contractility, MAP and CO): with the volume fixed, `svrScale` and `lvEes` are multiplied by
 * (svr, ees) until the structural MAP and systemic flow both match the monitor. svr is updated in proportion
 * ((target MAP - RAP) / (MAP - RAP): the resistance the monitor's own MAP and CO imply, which is not the ACS model's
 * open-loop `circ.svr` because its MAP is baroreflex-buffered); ees by a secant on the flow error. At most
 * `maxCoIterations` extra analyze calls, within `coToleranceFrac` of the target flow and `mapToleranceMmHg`.
 */
export function solveBridge(req: SolveRequest): SolveResult {
  if (req.standalone) return { report: analyze(req.base, { waveform: true }), volume: 0, calibrationError: NaN, coError: NaN, svrMul: 1, eesMul: 1, analyzeCalls: 1 };
  const [lo, hi] = BRIDGE.volumeRangeMl, target = req.targetMap;
  let calls = 0;
  const run = (v: number, svr = 1, ees = 1, waveform = true) => {
    calls++;
    const b = req.base;
    return analyze({ ...b, volumeMl: (b.volumeMl ?? 0) + v, svrScale: (b.svrScale ?? 1) * svr, lvEes: (b.lvEes ?? 1) * ees }, { waveform });
  };
  const tco = req.targetCo, hasCo = tco !== undefined && tco > 0;
  const [sLo, sHi] = BRIDGE.svrMulRange, [eLo, eHi] = BRIDGE.eesMulRange;
  const score = (m: number, c: number) => Math.max(Math.abs(m) / BRIDGE.mapToleranceMmHg, hasCo ? Math.abs(c) / (BRIDGE.coToleranceFrac * tco!) : 0);
  if (hasCo && req.warm) { // a re-solve of a patient that has hardly moved: the previous calibration may still hold
    const v0 = clamp(req.volume, lo, hi), s0 = clamp(req.warm.svr, sLo, sHi), e0 = clamp(req.warm.ees, eLo, eHi), w = run(v0, s0, e0);
    const m = w.pressure.AO.mean - target, c = w.qs - tco!;
    if (score(m, c) <= 1) return { report: w, volume: v0, calibrationError: m, coError: c, svrMul: s0, eesMul: e0, analyzeCalls: calls };
  }
  const tol1 = hasCo ? BRIDGE.volumeToleranceMmHg : BRIDGE.mapToleranceMmHg; // the volume only sets the filling when phase 2 follows
  let v = clamp(req.volume, lo, hi), r = run(v), f = r.pressure.AO.mean - target;
  let best = { r, f, v };
  let vPrev = NaN, fPrev = NaN;
  for (let i = 0; i < BRIDGE.maxCalibrationIterations && Math.abs(best.f) > tol1; i++) {
    const slope = Number.isFinite(vPrev) && Math.abs(f - fPrev) > 1e-9 && (f - fPrev) / (v - vPrev) > 0 ? (f - fPrev) / (v - vPrev) : BRIDGE.mapPerMl;
    const next = clamp(v - f / slope, lo, hi);
    if (Math.abs(next - v) < 0.5) break; // converged, or the clamp binds
    vPrev = v; fPrev = f; v = next; r = run(v); f = r.pressure.AO.mean - target;
    if (Math.abs(f) < Math.abs(best.f)) best = { r, f, v };
  }
  v = best.v;
  if (!hasCo) return { report: best.r, volume: v, calibrationError: best.f, coError: NaN, svrMul: 1, eesMul: 1, analyzeCalls: calls };

  // Phase 2.
  let svr = clamp(req.warm?.svr ?? 1, sLo, sHi), ees = clamp(req.warm?.ees ?? 1, eLo, eHi);
  let cur = run(v, svr, ees), mapErr = cur.pressure.AO.mean - target, coErr = cur.qs - tco;
  let top = { r: cur, mapErr, coErr, svr, ees };
  let eesPrev = NaN, coPrev = NaN;
  for (let i = 0; i < BRIDGE.maxCoIterations && score(top.mapErr, top.coErr) > 1; i++) {
    // flow: secant on ees (d flow / d ees is positive); first step from an assumed slope (a fraction of the flow per unit ees)
    const slope = Number.isFinite(eesPrev) && Math.abs(ees - eesPrev) > 1e-6 && (coErr - coPrev) / (ees - eesPrev) > 0.05 * tco! ? (coErr - coPrev) / (ees - eesPrev) : BRIDGE.coPerEes * tco!;
    const nEes = clamp(ees - coErr / slope, eLo, eHi);
    // pressure: in proportion, over the pressure above the right atrium (resistance = (MAP - RAP) / flow)
    const ra = cur.pressure.RA.mean, nSvr = clamp(svr * (target - ra) / Math.max(1, cur.pressure.AO.mean - ra), sLo, sHi);
    if (Math.abs(nEes - ees) < 1e-3 && Math.abs(nSvr - svr) < 1e-3) break; // converged, or the clamps bind
    eesPrev = ees; coPrev = coErr; ees = nEes; svr = nSvr;
    cur = run(v, svr, ees); mapErr = cur.pressure.AO.mean - target; coErr = cur.qs - tco;
    if (score(mapErr, coErr) < score(top.mapErr, top.coErr)) top = { r: cur, mapErr, coErr, svr, ees };
  }
  return { report: top.r, volume: v, calibrationError: top.mapErr, coError: top.coErr, svrMul: top.svr, eesMul: top.ees, analyzeCalls: calls };
}

/** Today's behaviour: solve on the calling thread (Node, tests, and the fallback when no worker can be made). */
export const syncSolver: BridgeSolver = { solve: solveBridge };
