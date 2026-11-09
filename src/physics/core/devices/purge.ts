import { COROPUMP_PURGE, type PurgeLine, type PurgeSolution } from "../../../config/devices";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

export type PurgeAlarm = "PURGE PRESSURE HIGH" | "PURGE FLOW LOW";

export interface PurgeInput {
  solution: PurgeSolution | string;
  heparinUml: number;
  line: PurgeLine | string;
  thrombus: number;
  running: boolean;
}

/** Purge line resistance and flow. Pure function; units: pressure mmHg, flow ml/hr. */
export function purgeState(input: PurgeInput, warnings: string[] = []): { flowMlHr: number; pressureMmHg: number; alarms: PurgeAlarm[] } {
  if (!input.running) return { flowMlHr: 0, pressureMmHg: 0, alarms: [] };
  const C = COROPUMP_PURGE;
  let solution: PurgeSolution = "dextrose-heparin";
  if (input.solution === "dextrose-heparin" || input.solution === "bicarbonate") solution = input.solution;
  else warnings.push(`unknown purge solution ${JSON.stringify(input.solution)}; using dextrose-heparin`);
  let line: PurgeLine = "clear";
  if (input.line === "clear" || input.line === "kinked" || input.line === "blocked") line = input.line;
  else warnings.push(`unknown purge line ${JSON.stringify(input.line)}; using clear`);
  const thrombus = clamp(Number.isFinite(input.thrombus) ? input.thrombus : 0, 0, 1);
  const lineMult = C.lineMult[line];
  const solutionMult = C.solutionMult[solution];
  const m = lineMult * (1 + 3 * thrombus * thrombus) * solutionMult;
  const pressureMmHg = Math.min(C.pressureBase * m, C.pressureCap);
  const flowMlHr = C.flowBase * (1 - smoothstep(C.flowFallLo, C.flowFallHi, pressureMmHg));
  const alarms: PurgeAlarm[] = [];
  if (pressureMmHg > C.alarmPressureHigh) alarms.push("PURGE PRESSURE HIGH");
  if (flowMlHr < C.alarmFlowLow) alarms.push("PURGE FLOW LOW");
  return { flowMlHr, pressureMmHg, alarms };
}
