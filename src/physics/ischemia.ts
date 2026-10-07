import { ISCHEMIA } from "../config/ecg";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Target severity (0..1) from supply/demand: 0 while supply meets demand, 1 at fullAtSupplyDemand. */
export function severityTarget(supply: number, demand: number): number {
  const ratio = supply / demand;
  return clamp01((1 - ratio) / (1 - ISCHEMIA.fullAtSupplyDemand));
}

/** Severity rises linearly (full in riseSeconds) and recovers exponentially (τ). */
export function stepSeverity(current: number, target: number, dt: number): number {
  if (target > current) return Math.min(target, current + dt / ISCHEMIA.riseSeconds);
  return target + (current - target) * Math.exp(-dt / ISCHEMIA.recoveryTau);
}
