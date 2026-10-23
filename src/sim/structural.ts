import { analyze, StructuralReport, StructuralSpec } from "../physics/structural";
import type { PatientSpec } from "./patient";
import { GORLIN, GRADE, ORIFICE_EPS, PATIENTS, PatientKind } from "../config/structural";

/**
 * What the structural page and the MCP tools read: a named lesion with sliders, the spec it builds, the engine's report, and
 * the graded findings a cardiologist would write (valve area and grade, regurgitant fraction, shunt, murmur). DOM-free.
 * Grades are adult criteria; the engine has no reflexes, so pressures and flows show the lesion's raw effect.
 */
export type LesionId = "normal" | "as" | "ar" | "ms" | "mr" | "ts" | "tr" | "ps" | "pr" | "pda" | "asd" | "vsd" | "tof" | "pa-vsd" | "pa-ivs" | "tri-atresia" | "ebstein";
export interface LesionParam { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string }
export interface LesionDef {
  id: LesionId; label: string; group: "valve" | "congenital"; patient: PatientKind;
  params: LesionParam[]; teach: string;
  build(v: Record<string, number>): StructuralSpec;
}

const sev = (default_ = 0.6): LesionParam => ({ key: "severity", label: "Severity", min: 0, max: 1, step: 0.05, default: default_ });
const pvri = (d: number): LesionParam => ({ key: "pvri", label: "Pulmonary resistance", min: 1, max: 30, step: 0.5, default: d, unit: "WU·m²" });
const A = (k: PatientKind) => PATIENTS[k].valveAreas;
const duct = (d: number): LesionParam => ({ key: "duct", label: "Ductus arteriosus", min: 0, max: 6, step: 0.5, default: d, unit: "mm" });
const bt = (d: number): LesionParam => ({ key: "bt", label: "BT shunt", min: 0, max: 5, step: 0.5, default: d, unit: "mm" });
const withBt = (v: Record<string, number>): Pick<StructuralSpec, "bt"> => (v.bt > 0 ? { bt: { diameterMm: v.bt } } : {});
const withDuct = (v: Record<string, number>): Pick<StructuralSpec, "pda"> => (v.duct > 0 ? { pda: { diameterMm: v.duct } } : {});

export const LESIONS: LesionDef[] = [
  { id: "normal", label: "Normal heart", group: "valve", patient: "adult", params: [], teach: "Resting adult: 72 bpm, stroke volume 70 ml, mean arterial pressure 90.", build: () => ({}) },
  { id: "as", label: "Aortic stenosis", group: "valve", patient: "adult", params: [sev(0.95)], teach: "Pressure overload: the gradient across the valve grows as its area falls, so the left ventricle must generate a pressure well above the aorta's. (Wall thickening and the late rise in wedge pressure are not modelled.)", build: (v) => ({ valves: { av: { open: 1 - 0.85 * v.severity } } }) },
  { id: "ar", label: "Aortic regurgitation", group: "valve", patient: "adult", params: [sev(0.6)], teach: "Volume overload: wide pulse pressure, low diastolic pressure and a large total stroke volume, part of which leaks back. Without the chronic dilation that compensates, the forward output falls.", build: (v) => ({ valves: { av: { reg: v.severity * 0.16 * A("adult").av } } }) },
  { id: "ms", label: "Mitral stenosis", group: "valve", patient: "adult", params: [sev(0.95)], teach: "Left atrial pressure rises to push blood across the valve and the pulmonary artery pressure follows; at severe grades the output falls. (This model has no reflexes, so the body's pressure falls with it.)", build: (v) => ({ valves: { mv: { open: 1 - 0.85 * v.severity } } }) },
  { id: "mr", label: "Mitral regurgitation", group: "valve", patient: "adult", params: [sev(0.6)], teach: "Part of each stroke goes backward into the left atrium; the forward stroke volume falls and the atrium takes a large v wave.", build: (v) => ({ valves: { mv: { reg: v.severity * 0.12 * A("adult").mv } } }) },
  { id: "ts", label: "Tricuspid stenosis", group: "valve", patient: "adult", params: [sev(0.75)], teach: "Right atrial pressure rises; the caval veins back up.", build: (v) => ({ valves: { tv: { open: 1 - 0.85 * v.severity } } }) },
  { id: "tr", label: "Tricuspid regurgitation", group: "valve", patient: "adult", params: [sev(0.8)], teach: "The right atrium takes part of each right ventricular stroke; the atrial pressure carries a large v wave.", build: (v) => ({ valves: { tv: { reg: v.severity * 0.14 * A("adult").tv } } }) },
  { id: "ps", label: "Pulmonary stenosis", group: "valve", patient: "adult", params: [sev(0.8)], teach: "The right ventricle works against a fixed gradient; its pressure rises while the pulmonary artery's does not.", build: (v) => ({ valves: { pv: { open: 1 - 0.9 * v.severity } } }) },
  { id: "pr", label: "Pulmonary regurgitation", group: "valve", patient: "adult", params: [sev(0.6)], teach: "Diastolic backflow into the right ventricle; tolerated for years unless pulmonary resistance is high.", build: (v) => ({ valves: { pv: { reg: v.severity * 0.25 * A("adult").pv } } }) },
  { id: "pda", label: "Patent ductus arteriosus", group: "congenital", patient: "neonate", params: [{ key: "diameter", label: "Duct diameter", min: 1, max: 8, step: 0.5, default: 4, unit: "mm" }, pvri(2)], teach: "Aorta-to-pulmonary shunt that grows as pulmonary resistance falls: pulmonary overcirculation, diastolic run-off and a volume-loaded left heart. With very high resistance it reverses.", build: (v) => ({ patient: "neonate", pvri: v.pvri, pda: { diameterMm: v.diameter } }) },
  { id: "asd", label: "Atrial septal defect", group: "congenital", patient: "adult", params: [{ key: "diameter", label: "Defect diameter", min: 2, max: 25, step: 1, default: 12, unit: "mm" }], teach: "Left-to-right shunt at the atria: the right heart and lungs carry extra volume.", build: (v) => ({ asd: { diameterMm: v.diameter } }) },
  { id: "vsd", label: "Ventricular septal defect", group: "congenital", patient: "neonate", params: [{ key: "diameter", label: "Defect diameter", min: 1, max: 12, step: 0.5, default: 5, unit: "mm" }, pvri(2)], teach: "Left-to-right shunt in systole: pulmonary overcirculation and a volume-loaded left heart; large defects equalize ventricular pressures.", build: (v) => ({ patient: "neonate", pvri: v.pvri, vsd: { diameterMm: v.diameter } }) },
  { id: "tof", label: "Tetralogy of Fallot", group: "congenital", patient: "neonate", params: [{ key: "obstruction", label: "RVOT obstruction", min: 0, max: 1, step: 0.05, default: 0.95 }, { key: "spasm", label: "Infundibular spasm", min: 0, max: 1, step: 0.05, default: 0 }, { key: "vsd", label: "VSD diameter", min: 4, max: 12, step: 0.5, default: 8, unit: "mm" }, { key: "svr", label: "Systemic resistance", min: 0.4, max: 2, step: 0.05, default: 1, unit: "×" }, pvri(5)],
    teach: "Large VSD, right ventricular outflow obstruction, an overriding aorta and a thick right ventricle. The shunt across the VSD follows the outflow resistance against the systemic resistance, so a spell (tighter outflow, lower systemic resistance) deepens the cyanosis and a pressor or knees-to-chest eases it.",
    build: (v) => ({ patient: "neonate", pvri: v.pvri, svrScale: v.svr, tof: { vsdMm: v.vsd, rvotFrac: 1 - 0.9 * v.obstruction, spasm: v.spasm } }) },
  { id: "pa-vsd", label: "Pulmonary atresia with VSD", group: "congenital", patient: "neonate", params: [duct(3), bt(0), { key: "vsd", label: "VSD diameter", min: 4, max: 12, step: 0.5, default: 8, unit: "mm" }, pvri(6)], teach: "Tetralogy at its extreme: no forward flow through the pulmonary valve, so the lungs depend on the duct, a shunt or collaterals. Closing the duct drops the saturation.", build: (v) => ({ patient: "neonate", pvri: v.pvri, tof: { vsdMm: v.vsd, rvotFrac: 0 }, ...withDuct(v), ...withBt(v) }) },
  { id: "pa-ivs", label: "Pulmonary atresia, intact septum", group: "congenital", patient: "neonate", params: [duct(2.5), bt(0), { key: "rv", label: "RV size", min: 0.4, max: 1, step: 0.05, default: 0.6, unit: "× normal" }, { key: "asd", label: "Atrial defect", min: 1, max: 10, step: 0.5, default: 4, unit: "mm" }, pvri(6)], teach: "The right ventricle cannot empty forward, so the right atrium empties across the atrial defect and the lungs fill only through the duct.", build: (v) => ({ patient: "neonate", pvri: v.pvri, valves: { pv: { open: 0 }, tv: { reg: 0.06 * A("neonate").tv } }, rvSize: v.rv, rvContractility: 1.5, asd: { diameterMm: v.asd }, ...withDuct(v), ...withBt(v) }) },
  { id: "tri-atresia", label: "Tricuspid atresia", group: "congenital", patient: "neonate", params: [{ key: "vsd", label: "VSD diameter", min: 0, max: 8, step: 0.5, default: 3, unit: "mm" }, { key: "ps", label: "Pulmonary stenosis", min: 0, max: 1, step: 0.05, default: 0.3 }, { key: "asd", label: "Atrial defect", min: 2, max: 10, step: 0.5, default: 6, unit: "mm" }, duct(0), pvri(3)],
    teach: "No right atrioventricular connection: all systemic venous blood crosses the atrial defect, mixes with pulmonary venous blood, and the left ventricle supplies both circulations. Lung flow depends on the VSD and the pulmonary valve (too little is cyanosis, too much is heart failure).",
    build: (v) => ({ patient: "neonate", pvri: v.pvri, valves: { tv: { open: 0 }, pv: { open: 1 - 0.9 * v.ps } }, asd: { diameterMm: v.asd }, ...(v.vsd > 0 ? { vsd: { diameterMm: v.vsd } } : {}), ...withDuct(v) }) },
  { id: "ebstein", label: "Ebstein anomaly", group: "congenital", patient: "neonate", params: [sev(0.7), { key: "pfo", label: "Atrial defect", min: 0, max: 8, step: 0.5, default: 4, unit: "mm" }, duct(2.5), pvri(8)],
    teach: "The tricuspid leaflet sits low, leaving part of the right ventricle as a thin 'atrialized' extension of the atrium. The right atrium is huge, the functional ventricle small, tricuspid regurgitation severe, and blood crosses the atrial defect right to left. In the newborn the high pulmonary resistance can make the valve functionally atretic; the saturation improves as the resistance falls.",
    build: (v) => ({ patient: "neonate", pvri: v.pvri, rvSize: 1 - 0.6 * v.severity, raSize: 1 + 2 * v.severity, valves: { tv: { reg: 0.5 * v.severity * A("neonate").tv } }, ...(v.pfo > 0 ? { asd: { diameterMm: v.pfo } } : {}), ...withDuct(v) }) },
];
/** By id. No prototype, so "constructor" or "toString" are not lessons. */
export const LESION_BY_ID: Record<string, LesionDef | undefined> = Object.assign(Object.create(null), Object.fromEntries(LESIONS.map((l) => [l.id, l])));
export const defaults = (l: LesionDef): Record<string, number> => Object.fromEntries(l.params.map((p) => [p.key, p.default]));

export type Grade = "none" | "mild" | "moderate" | "severe";
export type StenosisGrade = Grade | "atretic";
export interface ValveFinding {
  valve: string; label: string;
  stenosis: StenosisGrade; regurgitation: Grade; grade: StenosisGrade; // grade: the worse of the two
  gorlinArea: number | null; areaFraction: number | null; // of this patient's normal valve
  meanGradient: number; regurgFraction: number | null; regurgMl: number; regurgPeakGradient: number;
}
export interface StructuralFindings {
  lesion: LesionId; values: Record<string, number>; spec: StructuralSpec; report: StructuralReport;
  valves: ValveFinding[]; murmur: string; headline: string; notes: string[];
}

const VALVE_LABEL: Record<string, string> = { AV: "Aortic", MV: "Mitral", TV: "Tricuspid", PVL: "Pulmonary" };
const VALVE_SPEC: Record<string, "av" | "mv" | "tv" | "pv"> = { AV: "av", MV: "mv", TV: "tv", PVL: "pv" };
const ORDER: StenosisGrade[] = ["none", "mild", "moderate", "severe", "atretic"];
const worse = (a: StenosisGrade, b: StenosisGrade): StenosisGrade => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/**
 * Gorlin area recovered from the report: mean flow while open over 44.3·√(mean gradient). The engine smooths the orifice law at
 * tiny gradients (ORIFICE_EPS), so the same smoothing is applied here; otherwise a low-flow valve would read as narrowed.
 */
export function gorlinArea(f: number, openMs: number, meanGradient: number): number | null {
  return openMs > 0 && meanGradient > 0 ? f / (openMs / 1000) / ((GORLIN * meanGradient) / Math.sqrt(meanGradient + ORIFICE_EPS)) : null;
}

function gradeValve(id: string, spec: StructuralSpec, r: StructuralReport): ValveFinding {
  const v = r.valves[id], k = VALVE_SPEC[id], patient = PATIENTS[spec.patient ?? "adult"];
  // an overriding aorta leaves the left ventricle only its share of the valve
  const normal = patient.valveAreas[k] * (id === "AV" && spec.tof ? 1 - (spec.tof.override ?? 0.5) : 1);
  const lesion = spec.valves?.[k];
  const atretic = lesion?.open === 0 || (id === "PVL" && spec.tof?.rvotFrac === 0);
  const area = gorlinArea(v.forwardMl, v.openMs, v.meanGradient), fraction = area === null ? null : area / normal;

  // stenosis: by the valve's area as a fraction of this patient's normal (adult cm² cut-offs, scaled), and for the aortic valve by mean gradient too
  const B = GRADE.areaFraction[k];
  let stenosis: StenosisGrade = "none";
  if (atretic) stenosis = "atretic";
  else if (fraction !== null) stenosis = fraction <= B.severe ? "severe" : fraction <= B.moderate ? "moderate" : fraction <= B.mild ? "mild" : "none";
  if (id === "AV" && (spec.patient ?? "adult") === "adult" && !atretic)
    stenosis = worse(stenosis, v.meanGradient >= GRADE.asMeanGradient.severe ? "severe" : v.meanGradient >= GRADE.asMeanGradient.moderate ? "moderate" : "none");

  // regurgitation: by regurgitant fraction and by the leak's orifice area relative to the valve (both inputs are known to the model)
  const rf = v.forwardMl > 1e-6 ? v.regurgMl / v.forwardMl : null, eroa = (lesion?.reg ?? 0) / normal, E = GRADE.eroaFraction[k];
  const byRf: Grade = rf === null ? "none" : rf >= GRADE.regFraction.severe ? "severe" : rf >= GRADE.regFraction.moderate ? "moderate" : rf >= 0.05 ? "mild" : "none";
  const byEroa: Grade = eroa >= E.severe ? "severe" : eroa >= E.moderate ? "moderate" : eroa > 0.005 ? "mild" : "none";
  const regurgitation = worse(byRf, byEroa) as Grade;

  return {
    valve: id, label: VALVE_LABEL[id], stenosis, regurgitation, grade: worse(stenosis, regurgitation), gorlinArea: area, areaFraction: fraction,
    meanGradient: v.meanGradient, regurgFraction: rf, regurgMl: v.regurgMl, regurgPeakGradient: v.regurgPeakGradient,
  };
}

const MURMUR: Record<LesionId, string> = {
  normal: "No murmur.",
  as: "Crescendo-decrescendo systolic ejection murmur at the right upper sternal border, radiating to the carotids; softer S2, a late-peaking murmur in severe disease.",
  ar: "Early diastolic decrescendo murmur at the left sternal border, bounding pulses and a wide pulse pressure.",
  ms: "Opening snap then low-pitched mid-diastolic rumble at the apex, with presystolic accentuation in sinus rhythm.",
  mr: "Holosystolic murmur at the apex radiating to the axilla.",
  ts: "Diastolic rumble at the left lower sternal border, louder with inspiration.",
  tr: "Holosystolic murmur at the left lower sternal border, louder with inspiration, with a prominent jugular v wave.",
  ps: "Systolic ejection murmur at the left upper sternal border with an ejection click; a soft P2.",
  pr: "Early diastolic decrescendo murmur at the left upper sternal border (Graham Steell if pulmonary hypertension).",
  pda: "Systolic murmur at the left infraclavicular area while pulmonary resistance is high, becoming the continuous 'machinery' murmur as it falls; bounding pulses.",
  asd: "Soft systolic flow murmur at the left upper sternal border and a fixed split S2.",
  vsd: "Harsh holosystolic murmur at the left lower sternal border; louder when small and restrictive, quiet when large and pressure-equalizing.",
  tof: "Harsh systolic ejection murmur at the left upper sternal border from the outflow obstruction (it shortens as a spell deepens), single loud S2, and cyanosis.",
  "pa-vsd": "Single S2, no outflow murmur; a continuous murmur from the duct or collaterals; cyanosis that deepens as the duct closes.",
  "pa-ivs": "Single S2, a tricuspid regurgitation murmur at the left lower sternal border, a continuous murmur from the duct; cyanosis that deepens as the duct closes.",
  "tri-atresia": "Single S2; a systolic murmur from the VSD if present; cyanosis; left-axis deviation on the ECG.",
  ebstein: "Soft systolic murmur of tricuspid regurgitation, multiple clicks, a widely split S1 and S2; cyanosis in the newborn that improves as the pulmonary resistance falls.",
};

/** Every valve of a report, graded for stenosis and regurgitation. */
export const gradeValves = (spec: StructuralSpec, report: StructuralReport): ValveFinding[] => ["AV", "MV", "TV", "PVL"].map((id) => gradeValve(id, spec, report));

const NOTES = [
  "The arch has no inertance here: a duct feeding the lower body also pushes some blood into the arch, so the upper-body saturation in pulmonary hypertension of the newborn reads about 91% (clinically nearer 98%).",
  "Instantaneous peak gradients across normal valves are about twice the clinical Doppler values (no inertance); grades use the mean gradient and the Gorlin area.",
  "No reflexes: pressure does not defend itself, so shunts and regurgitation show their raw effect on systemic pressure.",
  "Grades use adult cut-offs scaled to each patient's own valve size; pediatric z-scores are not modelled.",
];

export function assess(lesion: LesionId, values: Record<string, number> = {}, opts: { waveform?: boolean } = {}): StructuralFindings {
  const def = LESION_BY_ID[lesion];
  if (!def) throw new Error(`Unknown lesion ${lesion}`);
  const v = { ...defaults(def) };
  for (const p of def.params) { const x = values[p.key]; if (x !== undefined && Number.isFinite(x)) v[p.key] = Math.min(p.max, Math.max(p.min, x)); }
  const spec = def.build(v), report = analyze(spec, opts);
  const valves = gradeValves(spec, report);
  const r = report, bits: string[] = [];
  bits.push(`${def.label}: aortic ${r.pressure.AO.max.toFixed(0)}/${r.pressure.AO.min.toFixed(0)} mmHg, saturation ${(r.preductalSat * 100).toFixed(0)}%`);
  if (Math.abs(r.qpQs - 1) > 0.1) bits.push(`Qp:Qs ${r.qpQs.toFixed(2)}`);
  if (r.postductalSat < r.preductalSat - 0.03) bits.push(`lower body bluer (${(r.postductalSat * 100).toFixed(0)}% vs ${(r.preductalSat * 100).toFixed(0)}%)`);
  return { lesion, values: v, spec, report, valves, murmur: MURMUR[lesion], headline: bits.join(", "), notes: NOTES };
}

/**
 * `#lesion=tof&spasm=0.8` to a lesson and its slider values: unknown lessons fall back to the normal heart, unknown or empty or
 * non-numeric values are ignored, the rest are clamped to the slider and snapped to its step.
 */
export function parseLesionHash(hash: string): { id: LesionId; values: Record<string, number> } {
  const q = new URLSearchParams(hash.replace(/^#/, "")), asked = q.get("lesion") ?? "", d = LESION_BY_ID[asked] ?? LESIONS[0], values: Record<string, number> = {};
  for (const p of d.params) {
    const raw = q.get(p.key), x = raw === null || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(x)) values[p.key] = Math.min(p.max, Math.max(p.min, Math.round((x - p.min) / p.step) * p.step + p.min));
  }
  return { id: d.id, values };
}
/**
 * A structural-page `#lesion=...` hash as a PatientSpec: `kind` from the lesion's patient, `heart` from `def.build(values)` (slider
 * values at their defaults unless the hash sets them) without the `patient` and `hr` fields, which the spec carries elsewhere.
 */
export function patientFromLesionHash(hash: string): PatientSpec {
  const { id, values } = parseLesionHash(hash), d = LESION_BY_ID[id]!;
  const { patient: _p, hr: _h, ...heart } = d.build({ ...defaults(d), ...values });
  return { kind: d.patient, heart };
}
/** The hash that opens `id` with `values`, leaving out sliders at their defaults. */
export function lesionHash(id: LesionId, values: Record<string, number>): string {
  const d = LESION_BY_ID[id]!;
  return `#${[`lesion=${id}`, ...d.params.filter((p) => values[p.key] !== undefined && values[p.key] !== p.default).map((p) => `${p.key}=${+values[p.key].toFixed(4)}`)].join("&")}`;
}
