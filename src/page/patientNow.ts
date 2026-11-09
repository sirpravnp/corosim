// The patient as the order system reads it: one snapshot of the numbers a result is computed from. DOM-free, so it can be tested.
import { estimateRespRate, bodyTempC } from "../sim/bedside";
import type { PatientNow } from "../cases/orders";

/** What the page gathers from the simulation. Any field may be NaN or missing (no beats yet, no live source). */
export interface PatientSource {
  vitals: { hr: number; sbp: number; dbp: number; map: number } | null;
  fallbackMap: number; fallbackHr: number;
  spo2: number; lactate: number; urineMlPerMin: number;
  lvIschemia: number; rvIschemia: number; congestion: number;
  arrest: PatientNow["arrest"]; rhythmLabel: string;
  respRateBase: number; tempOverrideC?: number;
  co?: number; lvEf?: number; lowFlowMin?: number; caseMin?: number; ageY?: number;
  /** Plasma free hemoglobin now, mg/dL (`Simulation.plasmaFreeHb()`); the hemolysis lab and the urine-color item read it. */
  pfHbMgDl?: number;
}

/** Minutes the case has spent with MAP below 65 mmHg. The page feeds it each frame; reset on start and quit. */
export const lowFlow = { min: 0 };
export function resetLowFlow(): void { lowFlow.min = 0; }
export function accrueLowFlow(dtS: number, map: number): void {
  if (Number.isFinite(dtS) && dtS > 0 && Number.isFinite(map) && map < 65) lowFlow.min += dtS / 60;
}

const fin = (x: number | undefined, d: number) => (x !== undefined && Number.isFinite(x) ? x : d);

export function buildPatientNow(s: PatientSource): PatientNow {
  const v = s.vitals;
  const map = fin(v?.map, fin(s.fallbackMap, 0));
  const inp = {
    respRateBase: fin(s.respRateBase, 15), map, spo2: fin(s.spo2, 1), lactate: fin(s.lactate, 0),
    congestion: fin(s.congestion, 0), arrest: s.arrest, tempOverrideC: s.tempOverrideC,
  };
  return {
    ...inp,
    hr: fin(v?.hr, fin(s.fallbackHr, 0)), sbp: fin(v?.sbp, map), dbp: fin(v?.dbp, map),
    urineMlHr: fin(s.urineMlPerMin, 0) * 60,
    lvIschemia: fin(s.lvIschemia, 0), rvIschemia: fin(s.rvIschemia, 0), rhythmLabel: s.rhythmLabel,
    tempC: bodyTempC(inp), respRate: estimateRespRate(inp),
    co: fin(s.co, NaN), lvEf: fin(s.lvEf, NaN), lowFlowMin: fin(s.lowFlowMin, 0), caseMin: fin(s.caseMin, 0), ageY: fin(s.ageY, 65),
    ...(s.pfHbMgDl !== undefined && Number.isFinite(s.pfHbMgDl) ? { pfHbMgDl: s.pfHbMgDl } : {}), // absent stays absent: the items then read a baseline and say it is an estimate
  };
}
