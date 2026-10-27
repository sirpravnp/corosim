import type { Simulation } from "../sim/simulation";
import type { PatientSpec } from "../sim/patient";
import type { Vitals } from "../sim/narrate";
import { currentPatient } from "./hemo";

/** The monitor reading the narration phrases, from a running Simulation (10 s rolling vitals, rhythm, infarct). Reads only; no time passes. */
export function vitalsOf(sim: Simulation): Vitals {
  const st = sim.state(), r = st.rolling10s, rh = st.rhythm;
  const cur = (rh as { arrhythmia?: { current?: { label: string; rate?: number } | null } }).arrhythmia?.current ?? null;
  const rhythm = cur ? cur.label : String(rh.label).toLowerCase() === "sinus" ? "sinus rhythm" : String(rh.label);
  const noOutput = /fibrillation|asystole/i.test(rhythm) && !/atrial/i.test(rhythm);
  const lib = (rh as { ventricularRate?: number }).ventricularRate;
  return {
    rhythm, noOutput,
    hr: cur?.rate ?? (typeof lib === "number" && lib > 0 ? lib : r.hr), sbp: r.sbp, dbp: r.dbp, map: r.map,
    circulation: st.circulationState as Vitals["circulation"],
    infarct: st.ventricle.lvInfarctFraction, ischemicMass: st.ischemicMassFraction, ef: st.ventricle.ejectionFraction,
  };
}

/** The patient as the tools remember it, with a snapshot to diff against later. */
export function snapshot(sim: Simulation): { spec: PatientSpec; vitals: Vitals } {
  return { spec: JSON.parse(JSON.stringify(currentPatient(sim))) as PatientSpec, vitals: vitalsOf(sim) };
}
