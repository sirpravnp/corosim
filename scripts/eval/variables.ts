// The variable registry of the evaluation: every quantity a panel (or the MCP tools) shows, each with ONE canonical source, a unit and
// the panel it belongs to. Specs (scripts/eval/spec/*.csv) refer to variables by `id`; the runner reads every one at every checkpoint.
// Where two panels show the same quantity from different code paths, only the canonical one is registered here and the pair is listed in
// CROSS_CHECKS, so "do the panels agree?" is its own test rather than a silent choice.
import type { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import { cathReport } from "../../src/sim/cath";

export interface Ctx { s: Simulation; src: LiveSource; st: any; ecg: any; hemo: any; fl: any; drugs: any; cor: any; met: any; sat: any; num: any; dev: any; cath: any; win: number }
export type Value = number | string | boolean | null;
export interface Variable { id: string; panel: string; unit: string; kind: "num" | "bool" | "str"; get: (c: Ctx) => Value }

const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const v: Variable[] = [];
const add = (panel: string, id: string, unit: string, get: (c: Ctx) => unknown, kind: Variable["kind"] = "num") =>
  v.push({ id, panel, unit, kind, get: (c) => { try { const x = get(c); return kind === "num" ? n(x) : (x as Value) ?? null; } catch { return null; } } });

// ---- Monitor / vitals (LiveSource.vitals: the one snapshot the Monitor and Hemodynamics panels share)
const vit = (c: Ctx) => c.src.vitals();
add("Monitor", "hr", "bpm", (c) => vit(c).hr);
add("Monitor", "sbp", "mmHg", (c) => vit(c).sbp); add("Monitor", "dbp", "mmHg", (c) => vit(c).dbp); add("Monitor", "map", "mmHg", (c) => vit(c).map);
add("Monitor", "co", "L/min", (c) => vit(c).co); add("Monitor", "ci", "L/min/m2", (c) => vit(c).ci); add("Monitor", "sv", "ml", (c) => vit(c).sv);
add("Monitor", "lvEf", "fraction", (c) => vit(c).lvEf); add("Monitor", "rvEf", "fraction", (c) => vit(c).rvEf);
// The same quantities computed a second way elsewhere in the app. Registered under their own names so a disagreement is a labelled finding.
// lvEfEstimate: aortic-valve stroke volume / LV EDV of every beat, smoothed (ischemia panel, MCP state, explain, cath echo). See docs/EVALUATION.md.
add("Monitor", "lvEfEstimate", "fraction", (c) => c.st.ventricle.ejectionFraction);
add("Monitor", "hrRolling", "bpm", (c) => c.st.rolling10s.hr); add("Monitor", "svAortic", "ml", (c) => c.s.rolling(c.win).sv);
add("Monitor", "status", "", (c) => c.st.circulationState, "str");
add("Monitor", "rhythm", "", (c) => c.st.rhythm.label, "str");
add("Monitor", "ventRate", "bpm", (c) => c.st.rhythm.ventricularRate ?? c.st.rhythm.sinusRate);
add("Monitor", "avBlockDegree", "0-3", (c) => c.st.rhythm.avBlock);
add("Monitor", "pulsePressure", "mmHg", (c) => vit(c).sbp - vit(c).dbp);
// ---- Hemodynamics / catheter
add("Hemodynamics", "cvp", "mmHg", (c) => c.num.cvp); add("Hemodynamics", "paSys", "mmHg", (c) => c.num.pa.systolic);
add("Hemodynamics", "paDia", "mmHg", (c) => c.num.pa.diastolic); add("Hemodynamics", "paMean", "mmHg", (c) => c.num.pa.mean);
add("Hemodynamics", "pcwp", "mmHg", (c) => c.num.pcwp); add("Hemodynamics", "lvedp", "mmHg", (c) => c.num.lvedp); add("Hemodynamics", "rvedp", "mmHg", (c) => c.num.rvedp);
add("Hemodynamics", "svr", "WU", (c) => c.num.svr); add("Hemodynamics", "pvr", "WU", (c) => c.num.pvr); add("Hemodynamics", "qpQs", "ratio", (c) => c.num.qpQs);
add("Hemodynamics", "lvEdv", "ml", (c) => c.hemo?.lvEdv); add("Hemodynamics", "lvEsv", "ml", (c) => c.hemo?.lvEsv);
add("Hemodynamics", "msfp", "mmHg", (c) => c.hemo?.filling.msfp); add("Hemodynamics", "stressedVolume", "ml", (c) => c.hemo?.filling.stressed);
add("Hemodynamics", "unstressedVolume", "ml", (c) => c.hemo?.filling.unstressed);
add("Hemodynamics", "coronaryPerfusionPressure", "mmHg", (c) => c.st.coronaryPerfusionPressure);
// ---- Oxygen
add("Oxygen", "spo2", "fraction", (c) => c.sat.spo2); add("Oxygen", "svo2", "fraction", (c) => c.sat.svo2);
add("Oxygen", "preductalSat", "fraction", (c) => c.sat.preductal); add("Oxygen", "postductalSat", "fraction", (c) => c.sat.postductal);
add("Oxygen", "do2", "ml/min", (c) => c.sat.do2); add("Oxygen", "vo2", "ml/min", (c) => c.sat.vo2);
add("Oxygen", "o2Extraction", "fraction", (c) => c.sat.vo2 / c.sat.do2); add("Oxygen", "lactate", "mmol/L", (c) => c.sat.lactate);
// ---- Ischemia, infarct, coronary supply
add("Coronary", "ischemicMassFraction", "fraction", (c) => c.st.ischemicMassFraction);
add("Coronary", "lvIschemia", "fraction", (c) => c.st.ventricle.lvIschemia); add("Coronary", "rvIschemia", "fraction", (c) => c.st.ventricle.rvIschemia);
add("Coronary", "lvInfarctFraction", "fraction", (c) => c.st.ventricle.lvInfarctFraction);
add("Coronary", "pulmonaryCongestion", "0-1", (c) => c.st.ventricle.pulmonaryCongestion);
add("Coronary", "ischemiaPattern", "", (c) => c.ecg.ischemia, "str");
add("Coronary", "endoSupplyIndex", "ratio", (c) => c.cor?.endoIndex); add("Coronary", "epiSupplyIndex", "ratio", (c) => c.cor?.epiIndex);
add("Coronary", "transmuralRatio", "ratio", (c) => c.cor?.transmural); add("Coronary", "dpti", "mmHg·s", (c) => c.cor?.dpti); add("Coronary", "tti", "mmHg·s", (c) => c.cor?.tti);
add("Coronary", "viabilityRatio", "ratio", (c) => c.cor?.viability); add("Coronary", "diastolicFraction", "fraction", (c) => c.cor?.diastolicFraction);
add("Coronary", "lesionFfr", "ratio", (c) => c.st.ffr[0]?.ffr);
// ---- ECG (ST in mm at J+60 ms, per lead, plus the reader's summary)
for (const l of ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"]) add("ECG", `st.${l}`, "mm", (c) => c.ecg.stMm[l]);
add("ECG", "stemiCriteria", "", (c) => c.ecg.meetsStemiCriteria, "bool");
add("ECG", "nLeadsElevated", "count", (c) => c.ecg.stElevation.length); add("ECG", "nLeadsDepressed", "count", (c) => c.ecg.stDepression.length);
add("ECG", "qrs", "", (c) => c.ecg.qrs, "str"); add("ECG", "prMs", "ms", (c) => c.ecg.prMs); add("ECG", "pvcsPer10s", "count", (c) => c.ecg.pvcsLast10s);
// ---- Rhythm, ectopy, arrhythmia
add("Rhythm", "pvcSeverity", "0-1", (c) => c.st.rhythm.pvcSeverity);
add("Rhythm", "pvcExpectedPerBeat", "prob", (c) => c.st.rhythm.ectopy?.expectedPerBeat);
add("Rhythm", "currentArrhythmia", "", (c) => c.st.rhythm.arrhythmia?.current?.label ?? "none", "str");
for (const k of ["nsvt", "mono", "poly", "vf", "aivr"]) add("Rhythm", `episodes.${k}`, "count", (c) => c.st.rhythm.arrhythmia?.counts[k]);
for (const k of ["ischemia", "reperfusion", "scar", "aivr"]) add("Rhythm", `hazardPerHour.${k}`, "1/h", (c) => c.st.rhythm.arrhythmia?.hazardPerHour[k]);
// ---- Arrest and survival
add("Arrest", "arrestStatus", "", (c) => c.st.arrest?.status, "str"); add("Arrest", "arrestRhythmClass", "", (c) => c.st.arrest?.rhythmClass, "str");
add("Arrest", "noFlowS", "s", (c) => c.st.arrest?.noFlowS); add("Arrest", "arrestInjury", "0-1", (c) => c.st.arrest?.injury);
add("Arrest", "cprOutput", "fraction", (c) => c.st.arrest?.cpr.output); add("Arrest", "dead", "", (c) => c.st.dead, "bool"); add("Arrest", "deathCause", "", (c) => c.st.deathCause ?? "", "str");
add("Arrest", "criticalTimeHeld", "", (c) => c.st.criticalTime, "bool");
// ---- Clocks and treatment
add("Treatment", "simSeconds", "s", (c) => c.st.timeS); add("Treatment", "clinicalMinutes", "min", (c) => c.st.clinicalMinutes);
add("Treatment", "ischemicMinutes", "min", (c) => c.st.treatment.ischemicMinutes);
add("Treatment", "stented", "", (c) => c.st.treatment.stent, "bool"); add("Treatment", "lysisSucceeded", "", (c) => c.st.treatment.lysis === null ? null : c.st.treatment.lysis, "bool"); add("Treatment", "grafted", "", (c) => c.st.treatment.grafted, "bool");
// ---- Fluids and lungs
for (const [k, u] of [["blood", "ml"], ["plasma", "ml"], ["hematocrit", "fraction"], ["hb", "g/dL"], ["interstitial", "ml"], ["plasmaProtein", "g/dL"], ["oncoticPlasma", "mmHg"], ["capillaryPressure", "mmHg"], ["urineRate", "ml/min"], ["lungWater", "ml"], ["lungWaterIndex", "ml/kg"], ["lungCapillaryPressure", "mmHg"], ["lungSatDrop", "fraction"], ["hemorrhage", "ml/min"]] as const)
  add("Fluids", `fluid.${k}`, u, (c) => c.fl?.[k]);
// ---- Drugs (effect-site level 0..1 of a full dose)
for (const k of ["norepinephrine", "epinephrine", "dobutamine", "milrinone", "vasopressin", "phenylephrine", "nitroglycerin", "nitroprusside", "betaBlocker", "furosemide", "diltiazem"]) add("Drugs", `drug.${k}`, "0-1", (c) => c.drugs?.level[k]);
// ---- Devices (present only when a device is in)
add("Devices", "deviceFlow", "L/min", (c) => c.st.support.deviceFlowLpm);
add("Devices", "impella.flow", "L/min", (c) => c.dev?.impella?.flowLpm); add("Devices", "impella.motorCurrent", "mA", (c) => c.dev?.impella?.motorCurrentMa);
add("Devices", "impella.placement", "mmHg", (c) => c.dev?.impella?.placementMmHg); add("Devices", "impella.suctionLevel", "0-1", (c) => c.dev?.impella?.suctionLevel);
add("Devices", "iabp.coronaryAugmentation", "mmHg", (c) => c.dev?.iabp?.coronaryAugmentationMmHg); add("Devices", "iabp.peakDiastolic", "mmHg", (c) => c.dev?.iabp?.peakDiastolicMmHg);
// ---- Autonomic and variability (rolling window)
add("Autonomic", "sbpSd", "mmHg", (c) => c.met.sbp.sd); add("Autonomic", "mapSd", "mmHg", (c) => c.met.map.sd); add("Autonomic", "strokeVolumeCv", "%", (c) => c.met.strokeVolume.cv);
add("Autonomic", "sdnn", "ms", (c) => c.met.hrv?.sdnnMs); add("Autonomic", "rmssd", "ms", (c) => c.met.hrv?.rmssdMs); add("Autonomic", "pnn50", "%", (c) => c.met.hrv?.pnn50);
add("Autonomic", "baroreflexSensitivity", "ms/mmHg", (c) => c.met.baroreflexSensitivity.msPerMmHg); add("Autonomic", "rsaPeakToTrough", "ms", (c) => c.met.respiratorySinusArrhythmia.peakToTroughMs);
// ---- Cath lab (first lesion; sim/cath.ts)
add("Cath lab", "cath.diameterStenosisPct", "%", (c) => c.cath.findings[0]?.diameterStenosisPct);
add("Cath lab", "cath.timiGrade", "0-3", (c) => c.cath.findings[0]?.timi.grade); add("Cath lab", "cath.timiFrames", "frames", (c) => c.cath.findings[0]?.timi.frames);
add("Cath lab", "cath.restPdPa", "ratio", (c) => c.cath.findings[0]?.restPdPa); add("Cath lab", "cath.ffrCall", "", (c) => c.cath.findings[0]?.ffrCall, "str");
add("Cath lab", "echo.ef", "fraction", (c) => c.cath.echo.ejectionFraction); add("Cath lab", "echo.wallMotionScoreIndex", "", (c) => c.cath.echo.scoreIndex);
add("Cath lab", "echo.abnormalSegments", "count", (c) => c.cath.echo.abnormal.length);

export const VARIABLES: readonly Variable[] = v;

/** Pairs of variables that two panels compute separately and that must agree (tolerance in the variable's unit). */
export const CROSS_CHECKS: { a: string; b: string; tol: number; why: string; unlessDevice?: boolean }[] = [
  { a: "lvEf", b: "lvEfEstimate", tol: 0.06, why: "Monitor EF (LV chamber volumes) vs state EF (aortic stroke volume, smoothed); differ in a pump's presence and in fast transients", unlessDevice: true },
  { a: "lvEfEstimate", b: "echo.ef", tol: 0.02, why: "state EF vs cath-lab echo EF (same source; rounding only)" },
  { a: "hr", b: "hrRolling", tol: 4, why: "Monitor HR vs state HR (different windows)" },
  { a: "sv", b: "svAortic", tol: 6, why: "Monitor SV (output / rate, includes pump flow) vs aortic-valve stroke volume", unlessDevice: true },
];

export function context(s: Simulation, src: LiveSource, win = 20): Ctx {
  const safe = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };
  const dev = safe(() => s.devices());
  return {
    s, src, win, st: s.state(), ecg: s.ecg(), hemo: safe(() => s.hemo(win)), fl: safe(() => s.fluids()), drugs: safe(() => s.drugState()), cor: safe(() => s.coronarySupply()),
    met: s.metrics(win), sat: src.saturations(), num: src.numbers(), dev, cath: safe(() => cathReport(s)) ?? { findings: [], echo: { abnormal: [] } },
  };
}
export const snapshot = (c: Ctx): Record<string, Value> => Object.fromEntries(VARIABLES.map((x) => [x.id, x.get(c)]));
