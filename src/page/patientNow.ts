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
  };
}
