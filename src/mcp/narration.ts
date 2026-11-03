import type { Simulation } from "../sim/simulation";
import type { PatientSpec } from "../sim/patient";
import { lowerFirst, arrestWords, type Vitals } from "../sim/narrate";
import { CAUSE_WHY } from "../sim/explain";
import { currentPatient } from "./hemo";

/** The monitor reading the narration phrases, from a running Simulation (10 s rolling vitals, rhythm, infarct). Reads only; no time passes. */
export function vitalsOf(sim: Simulation): Vitals {
  const st = sim.state(), r = st.rolling10s, rh = st.rhythm;
  const cur = (rh as { arrhythmia?: { current?: { label: string; rate?: number; cause?: keyof typeof CAUSE_WHY } | null } }).arrhythmia?.current ?? null;
  const rhythm = cur ? cur.label : String(rh.label).toLowerCase() === "sinus" ? "sinus rhythm" : lowerFirst(String(rh.label));
  const noOutput = /fibrillation|asystole/i.test(rhythm) && !/atrial/i.test(rhythm);
  const lib = (rh as { ventricularRate?: number }).ventricularRate;
  return {
    rhythm, noOutput, ...(cur?.cause && CAUSE_WHY[cur.cause] ? { rhythmWhy: CAUSE_WHY[cur.cause] } : {}),
    hr: cur?.rate ?? (typeof lib === "number" && lib > 0 ? lib : r.hr), sbp: r.sbp, dbp: r.dbp, map: r.map,
    circulation: st.circulationState as Vitals["circulation"],
    infarct: st.ventricle.lvInfarctFraction, ischemicMass: st.ischemicMassFraction, ef: st.ventricle.ejectionFraction,
    ...(arrestWords(st.arrest) ? { arrest: arrestWords(st.arrest)! } : {}),
    treated: [...(st.treatment.stent ? ["stenting"] : []), ...(st.treatment.lysis === true ? ["fibrinolysis"] : []), ...(st.treatment.grafted ? ["bypass grafting"] : [])],
  };
}

/** The patient as the tools remember it, with a snapshot to diff against later. */
export function snapshot(sim: Simulation): { spec: PatientSpec; vitals: Vitals } {
  return { spec: JSON.parse(JSON.stringify(currentPatient(sim))) as PatientSpec, vitals: vitalsOf(sim) };
}
