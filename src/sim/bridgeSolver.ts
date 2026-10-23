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
}
export interface SolveResult {
  report: StructuralReport;
  /** ml added (+) or removed (-) by the calibration. */
  volume: number;
  /** Structural mean aortic pressure minus the target, mmHg. */
  calibrationError: number;
  /** analyze() calls made (1 to 1 + maxCalibrationIterations). */
  analyzeCalls: number;
}
/** Spec in, calibrated report out. Synchronous solvers return the result; asynchronous ones a promise of it. */
export interface BridgeSolver { solve(req: SolveRequest): SolveResult | Promise<SolveResult>; }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Calibrate the volume to the target MAP: first step from an assumed slope (BRIDGE.mapPerMl), then secant, at most
 * `maxCalibrationIterations` extra analyze calls, stop within `mapToleranceMmHg`; the volume stays in `volumeRangeMl`.
 */
export function solveBridge(req: SolveRequest): SolveResult {
  const [lo, hi] = BRIDGE.volumeRangeMl, target = req.targetMap;
  let calls = 0;
  const run = (v: number) => { calls++; return analyze({ ...req.base, volumeMl: (req.base.volumeMl ?? 0) + v }, { waveform: true }); };
  let v = clamp(req.volume, lo, hi), r = run(v), f = r.pressure.AO.mean - target;
  let best = { r, f, v };
  let vPrev = NaN, fPrev = NaN;
  for (let i = 0; i < BRIDGE.maxCalibrationIterations && Math.abs(best.f) > BRIDGE.mapToleranceMmHg; i++) {
    const slope = Number.isFinite(vPrev) && Math.abs(f - fPrev) > 1e-9 && (f - fPrev) / (v - vPrev) > 0 ? (f - fPrev) / (v - vPrev) : BRIDGE.mapPerMl;
    const next = clamp(v - f / slope, lo, hi);
    if (Math.abs(next - v) < 0.5) break; // converged, or the clamp binds
    vPrev = v; fPrev = f; v = next; r = run(v); f = r.pressure.AO.mean - target;
    if (Math.abs(f) < Math.abs(best.f)) best = { r, f, v };
  }
  return { report: best.r, volume: best.v, calibrationError: best.f, analyzeCalls: calls };
}

/** Today's behaviour: solve on the calling thread (Node, tests, and the fallback when no worker can be made). */
export const syncSolver: BridgeSolver = { solve: solveBridge };
