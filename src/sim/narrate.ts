import type { PatientSpec } from "./patient";
import { FIELDS } from "./registry";
import { libraryRhythm } from "../physics/rhythmSource";
import { PATIENTS } from "../config/structural";
import { STENOSIS_SPAN, REGURG_AREA_FRAC } from "../config/valves";

/**
 * Narration (SIMULATOR_PLAN D2): plain sentences about the patient, so a chat reads like someone building the case on the website.
 *
 * Two parts, both deterministic and free of the simulation's random state:
 *
 *  - `features(spec)` turns a PatientSpec into named clinical phrases ("lesion:LAD" -> "a proximal LAD occlusion"). `describeSpec` joins
 *    them; `diffSpecs` compares two feature maps, so a change between two patients reads the same way as the patient itself. Fields of
 *    the spec registry (src/sim/registry.ts) that no feature covers still get a generic phrase from their path and values, so a field
 *    added to the registry is narrated without touching this file (tests/narrate.test.ts checks every field).
 *  - `Vitals` is the monitor reading (`vitalsOf(sim)` in src/mcp/narration.ts reads it from a Simulation); `vitalsNow` and `vitalsChange`
 *    phrase it: rhythm and rate, pressure, the circulation state, ischemia and infarct.
 */

// ---------------------------------------------------------------- small helpers
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
export function getPath(o: unknown, path: string): unknown {
  let cur = o;
  for (const p of path.split(".")) { if (!isObj(cur)) return undefined; cur = cur[p]; }
  return cur;
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const VALVE_NAME: Record<string, string> = { av: "aortic", mv: "mitral", tv: "tricuspid", pv: "pulmonary" };

// ---------------------------------------------------------------- features
export interface Feature { text: string; why?: string }
export type Features = Map<string, Feature>;

function lesionText(l: Obj): string {
  const artery = String(l.artery ?? "").trim(), name = artery.length <= 6 ? artery.toUpperCase() : artery;
  const pos = num(l.position) ?? 0.15, loc = pos < 0.34 ? "proximal" : pos < 0.67 ? "mid" : "distal";
  if (l.occluded === true) return `a ${loc} ${name} occlusion`;
  const s = num(l.stenosis) ?? 0.7;
  return `a ${pct(s)} ${loc} ${name} stenosis`;
}

function gradeOf(x: number) { return x < 0.15 ? "none" : x < 0.4 ? "mild" : x < 0.7 ? "moderate" : "severe"; }

/** A valve in words: a prosthesis (size, kind, leak, obstruction) or the native lesions graded from opening and regurgitant orifice. */
export function valveWords(key: string, v: Obj): string | null {
  const name = VALVE_NAME[key] ?? key, p = isObj(v.prosthesis) ? v.prosthesis : null;
  if (p) {
    const kind = String(p.kind), size = num(p.sizeMm), leak = num(p.leak) ?? 0, obs = num(p.obstruction) ?? 0;
    let t = `${size ? `a ${r1(size)} mm ` : "a "}${p.inRing ? "valve-in-valve " : ""}${kind} ${name} valve`;
    const bad: string[] = [];
    if (leak > 0.05) bad.push(`a paravalvular leak of ${r1(leak)} cm²`);
    if (obs > 0.1) bad.push(`${pct(obs)} of the orifice obstructed`);
    if (bad.length) t += ` with ${bad.join(" and ")}`;
    return t;
  }
  const area = (PATIENTS.adult.valveAreas as Record<string, number>)[key] ?? 1;
  const open = num(v.open), reg = num(v.reg);
  const st = open === undefined ? 0 : (1 - open) / (STENOSIS_SPAN as Record<string, number>)[key];
  const rg = reg === undefined ? 0 : reg / ((REGURG_AREA_FRAC as Record<string, number>)[key] * area);
  const bits: string[] = [];
  if (gradeOf(st) !== "none") bits.push(`${gradeOf(st)} ${name} stenosis`);
  if (gradeOf(rg) !== "none") bits.push(`${gradeOf(rg)} ${name} regurgitation`);
  return bits.length ? bits.join(" with ") : null;
}

function atls(loss: number) { return loss < 0.15 ? "I" : loss < 0.3 ? "II" : loss < 0.4 ? "III" : "IV"; }

const DOSE: [string, string, string][] = [
  ["support.norepinephrine", "norepinephrine", "vasoconstriction raises the pressure"],
  ["support.dobutamine", "dobutamine", "more contractility and a faster rate"],
  ["support.nitroglycerin", "nitroglycerin", "venodilation lowers preload and relieves ischemia but can drop the pressure"],
  ["support.epinephrine", "epinephrine", "more rate, contractility and vasoconstriction"],
  ["support.milrinone", "milrinone", "inotropy with vasodilation"],
  ["support.vasopressin", "vasopressin", "vasoconstriction without a faster rate"],
  ["support.nitroprusside", "nitroprusside", "arterial vasodilation lowers afterload and the pressure"],
  ["support.furosemide", "furosemide", "diuresis lowers the filling pressures"],
];

/** The patient as a map of named clinical phrases. Only what is abnormal or supported appears. */
export function features(spec: PatientSpec): Features {
  const f: Features = new Map(), s = spec as unknown as Obj;
  const put = (k: string, text: string, why?: string) => { f.set(k, { text, ...(why ? { why } : {}) }); };

  const lesions = Array.isArray(s.lesions) ? (s.lesions as Obj[]) : [];
  for (const l of lesions) {
    const key = `lesion:${String(l.artery).toUpperCase()}`;
    put(key, lesionText(l), l.occluded === true ? "the muscle downstream loses its blood supply and becomes ischemic" : (num(l.stenosis) ?? 0.7) >= 0.7 ? "a flow-limiting narrowing: ischemia shows with exertion or a low pressure" : undefined);
  }
  const an = getPath(s, "anatomy");
  if (isObj(an)) {
    if (an.dominance === "left") put("anatomy:dominance", "a left-dominant coronary circulation");
    else if (an.dominance === "co") put("anatomy:dominance", "a co-dominant coronary circulation");
    if (an.lm === "trifurcation") put("anatomy:lm", "a trifurcating left main (ramus intermedius)");
    else if (an.lm === "absent") put("anatomy:lm", "no left main (separate LAD and circumflex ostia)");
    if (an.saNodeFrom === "LCx") put("anatomy:san", "an SA-node artery from the circumflex");
    if (an.conusOstium === "separate") put("anatomy:conus", "a separate conus ostium");
    if (an.ladCourse === "short" || an.ladCourse === "wrap") put("anatomy:lad", an.ladCourse === "short" ? "a short LAD" : "a wraparound LAD");
  }
  if (s.exertion === true) put("exertion", "exerting", "oxygen demand doubles");

  const rh = getPath(s, "patient.rhythm");
  if (typeof rh === "string" && rh !== "sinus" && rh !== "nsr") put("rhythm", `a baseline rhythm of ${rhythmName(rh)}`);
  const bbb = getPath(s, "patient.bbb");
  if (bbb === "rbbb" || bbb === "lbbb") put("bbb", `${bbb === "rbbb" ? "right" : "left"} bundle branch block`);

  const loss = num(s.bloodLoss);
  if (loss !== undefined && loss > 0.005) put("bloodLoss", `${pct(loss)} blood loss (ATLS class ${atls(loss)})`, "less preload, so the stroke volume falls and the baroreflex speeds the heart");
  else if (loss !== undefined && loss < -0.005) put("bloodLoss", `volume overload (${pct(-loss)} above normal blood volume)`, "more preload and congestion");
  const hem = num(getPath(s, "fluids.hemorrhageMlMin"));
  if (hem && hem > 0) put("hemorrhage", `active hemorrhage at ${r1(hem)} ml/min`, "the volume keeps falling");
  const k = num(getPath(s, "electrolytes.potassium")), mg = num(getPath(s, "electrolytes.magnesium"));
  if (k !== undefined && k < 3.5) put("potassium", `hypokalemia (K ${r1(k)} mmol/l)`, "raises the VT/VF hazard and the ectopy");
  else if (k !== undefined && k > 5.5) put("potassium", `hyperkalemia (K ${r1(k)} mmol/l)`, "raises the VT/VF hazard and the ectopy");
  if (mg !== undefined && mg < 0.7) put("magnesium", `hypomagnesemia (Mg ${r1(mg)} mmol/l)`, "raises the VT/VF hazard and the ectopy");

  const bb = num(getPath(s, "drugs.betaBlocker")), at = num(getPath(s, "drugs.atropine")), vp = num(getPath(s, "drugs.vasopressor"));
  if (bb && bb > 0.02) put("betaBlocker", `a beta blocker (${pct(bb)} of the beta effect blocked)`, "a slower rate and weaker contraction");
  if ((at && at > 0.02) || getPath(s, "support.atropine") === true) put("atropine", "atropine on board", "the vagal brake on the sinus node is lifted");
  if (vp && vp > 0.05) put("vasopressor", `an alpha-agonist (${pct(vp)})`, "arterial vasoconstriction raises the pressure");
  else if (vp && vp < -0.05) put("vasopressor", `a vasodilator (${pct(-vp)})`, "arterial vasodilation lowers the pressure");
  for (const [path, name, why] of DOSE) { const d = num(getPath(s, path)); if (d && d > 0.02) put(path, `${name} (${pct(d)} of a full dose)`, why); }
  const fl = num(getPath(s, "support.fluids"));
  if (fl && fl > 0.02) put("support.fluids", `${r1(fl)} l of IV fluid`, "more preload");
  if (getPath(s, "support.pacing") === true) put("pacing", `pacing at ${Math.round(num(getPath(s, "support.paceRate")) ?? 70)}/min`, "a ventricular rate that no longer depends on the sinus node");

  // devices (a boolean in `support` means the defaults)
  const iabp = getPath(s, "devices.iabp"), imp = getPath(s, "devices.impella"), ecmo = num(getPath(s, "devices.ecmo.flowLpm"));
  if (isObj(iabp) || getPath(s, "support.iabp") === true) put("iabp", `an intra-aortic balloon pump (1:${num(getPath(s, "devices.iabp.ratio")) ?? 1})`, "diastolic augmentation and systolic unloading");
  if (isObj(imp) || getPath(s, "support.impella") === true) put("impella", `an Impella ${getPath(s, "devices.impella.model") ?? "CP"} at P${num(getPath(s, "devices.impella.level")) ?? 6}`, "unloads the left ventricle and pumps forward");
  if (isObj(getPath(s, "devices.impellaRp")) && (num(getPath(s, "devices.impellaRp.level")) ?? 0) > 0) put("impellaRp", `an Impella RP at P${getPath(s, "devices.impellaRp.level")}`, "supports the right ventricle");
  if (ecmo && ecmo > 0) put("ecmo", `ECMO at ${r1(ecmo)} l/min`, "it carries part of the output but raises the afterload on the left ventricle");
  if (getPath(s, "ventilation.mode") === "positive") put("ventilation", `positive-pressure ventilation (PEEP ${num(getPath(s, "ventilation.peep")) ?? 5})`, "intrathoracic pressure lowers venous return");

  // structural heart
  const valves = getPath(s, "heart.valves");
  if (isObj(valves)) for (const key of ["av", "mv", "tv", "pv"]) {
    const v = valves[key];
    if (isObj(v)) { const t = valveWords(key, v); if (t) put(`valve:${key}`, t); }
  }
  for (const [k2, label] of [["pda", "a patent ductus"], ["asd", "an atrial septal defect"], ["vsd", "a ventricular septal defect"], ["bt", "a Blalock-Taussig shunt"]] as const) {
    const d = getPath(s, `heart.${k2}`);
    if (isObj(d)) { const mm = num(d.diameterMm); put(`shunt:${k2}`, mm ? `${label} (${r1(mm)} mm)` : label, "blood crosses between the circulations"); }
  }
  if (isObj(getPath(s, "heart.tof"))) put("shunt:tof", "tetralogy of Fallot");
  const pvri = num(getPath(s, "heart.pvri")); if (pvri !== undefined && pvri > 4) put("pvri", `raised pulmonary vascular resistance (${r1(pvri)} Wood units·m²)`, "pressure load on the right ventricle");
  const svr = num(getPath(s, "heart.svrScale")); if (svr !== undefined && Math.abs(svr - 1) > 0.15) put("svr", `${svr > 1 ? "raised" : "lowered"} systemic vascular resistance (x${r1(svr)})`);
  for (const c of ["lv", "la", "rv", "ra"]) {
    const z = num(getPath(s, `heart.${c}Size`));
    if (z !== undefined && Math.abs(z - 1) > 0.15) put(`size:${c}`, `${z > 1 ? "a dilated" : "a small"} ${({ lv: "left ventricle", la: "left atrium", rv: "right ventricle", ra: "right atrium" } as Obj)[c]} (x${r1(z)})`);
  }
  for (const c of ["lv", "rv"]) {
    const e = num(getPath(s, `heart.${c}Ees`));
    if (e !== undefined && e < 0.85) put(`ees:${c}`, `a ${c === "lv" ? "left" : "right"} ventricle with ${pct(e)} of normal contractility`, "less force per beat");
  }

  // pericardium
  const eff = num(getPath(s, "pericardium.effusionMl")), rate = num(getPath(s, "pericardium.effusionRateMlMin")), stiff = num(getPath(s, "pericardium.stiffness"));
  if (eff && eff > 0 || rate && rate > 0) put("effusion", `a ${Math.round(eff ?? 0)} ml pericardial effusion${rate && rate > 0 ? ` filling at ${r1(rate)} ml/min` : ""}`, (eff ?? 0) >= 250 || (rate ?? 0) > 0 ? "fluid in the sac limits filling: tamponade physiology" : "a small effusion rarely limits filling");
  if (stiff !== undefined && stiff > 1.5) put("pericardial:stiffness", "a stiff, constrictive pericardium", "the ventricles cannot expand to fill");
  if (getPath(s, "pericardium.open") === true) put("pericardial:open", "an opened pericardium (after cardiac surgery)");
  if (s.septum === true) put("septum", "septal interdependence switched on", "a failing right ventricle bows the septum into the left");

  return f;
}

export const rhythmName = (id: string) => (id === "sinus" || id === "nsr" ? "sinus rhythm" : id === "af" ? "atrial fibrillation" : libraryRhythm(id)?.name ?? id);

/** "a proximal LAD occlusion, severe aortic stenosis and norepinephrine (40% of a full dose)". */
export function joinList(xs: string[]): string { return xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`; }

export function describeSpec(spec: PatientSpec): string {
  const f = features(spec);
  return f.size ? `with ${joinList([...f.values()].map((x) => x.text))}` : "with no abnormality set (a typical resting adult)";
}

// ---------------------------------------------------------------- diff
const SKIP_GENERIC = new Set(["seed"]);
function describeValue(v: unknown): string {
  if (v === undefined || v === null) return "default";
  if (typeof v === "number") return r1(v);
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * What changed between two patients, as phrases: the clinical ones for the main states (lesion, rhythm, valves, devices, pericardium,
 * bleeding, electrolytes, drugs) and a generic "path from -> to" for any other field of the spec registry.
 */
export function diffSpecs(before: PatientSpec, after: PatientSpec): string[] {
  const fb = features(before), fa = features(after), out: string[] = [], changed: string[] = [];
  for (const [k, a] of fa) {
    const b = fb.get(k);
    if (!b) { out.push(a.why ? `${a.text} (${a.why})` : a.text); changed.push(k); }
    else if (b.text !== a.text) { out.push(`${a.text} (was ${b.text})`); changed.push(k); }
  }
  for (const [k, b] of fb) if (!fa.has(k)) { out.push(removedText(k, b.text)); changed.push(k); }
  // a registry field that no changed feature phrased (a feature-less field, or a detail such as the IABP timing): generic phrase from its path
  for (const fld of FIELDS) {
    if (fld.target !== "patient" || SKIP_GENERIC.has(fld.path)) continue;
    const x = getPath(before, fld.path), y = getPath(after, fld.path);
    if (!same(x, y) && !changed.some((k) => featureOwns(k, fld.path))) out.push(`${fld.path} ${describeValue(x)} -> ${describeValue(y)}`);
  }
  return out;
}

function removedText(key: string, text: string): string {
  if (key === "bloodLoss" || key === "hemorrhage") return `the ${text.replace(/^(a|an) /, "")} is over`;
  if (key.startsWith("lesion:")) return `${text} is gone`;
  return `${text} stopped`;
}

/** Paths (or prefixes ending in ".") that each feature phrases; a changed field under one of them is not narrated a second time. */
const OWNS: Record<string, string[]> = {
  lesion: ["lesions"], anatomy: ["anatomy."], exertion: ["exertion"], rhythm: ["patient.rhythm"], bbb: ["patient.bbb"], bloodLoss: ["bloodLoss"],
  hemorrhage: ["fluids.hemorrhageMlMin"], potassium: ["electrolytes.potassium"], magnesium: ["electrolytes.magnesium"], betaBlocker: ["drugs.betaBlocker"],
  atropine: ["drugs.atropine", "support.atropine"], vasopressor: ["drugs.vasopressor"], pacing: ["support.pacing", "support.paceRate"],
  iabp: ["support.iabp", "devices.iabp."], impella: ["support.impella", "devices.impella."], impellaRp: ["devices.impellaRp."], ecmo: ["devices.ecmo."],
  ventilation: ["ventilation.mode", "ventilation.peep"], effusion: ["pericardium.effusionMl", "pericardium.effusionRateMlMin"], septum: ["septum"],
  pvri: ["heart.pvri"], svr: ["heart.svrScale"],
};
function featureOwns(key: string, path: string): boolean {
  const [kind, id] = key.split(":");
  const list = kind === "valve" ? [`heart.valves.${id}.`] : kind === "shunt" ? [`heart.${id}`] : kind === "size" ? [`heart.${id}Size`] : kind === "ees" ? [`heart.${id}Ees`] : kind === "pericardial" ? [`pericardium.${id}`] : key.startsWith("support.") ? [key] : OWNS[kind] ?? [key];
  return list.some((o) => (o.endsWith(".") ? path.startsWith(o) : path === o));
}

// ---------------------------------------------------------------- vitals
export interface Vitals {
  /** The rhythm in words ("sinus", "ventricular tachycardia", "ventricular fibrillation"). */
  rhythm: string;
  hr: number | null; sbp: number | null; dbp: number | null; map: number | null;
  circulation: "stable" | "hypotension" | "shock";
  /** Fraction of the left ventricle infarcted, and of the myocardium at risk (ischemic). */
  infarct: number; ischemicMass: number;
  ef: number | null;
  /** Library or arrhythmia id that has no output (VF, asystole). */
  noOutput: boolean;
}

const NO_OUTPUT = /fibrillation|asystole/i;
const isNoOutput = (rhythm: string) => NO_OUTPUT.test(rhythm) && !/atrial/i.test(rhythm);

/** "in ventricular tachycardia at 168/min, BP 92/58 (MAP 69)". */
export function vitalsNow(v: Vitals): string {
  const rate = v.hr !== null && !v.noOutput ? ` at ${v.hr}/min` : "";
  const parts: string[] = [`now in ${v.rhythm}${rate}`];
  if (v.noOutput) parts.push("with no cardiac output (an arrest rhythm)");
  else if (v.map !== null) parts.push(`BP ${v.sbp}/${v.dbp} (MAP ${v.map})`);
  if (!v.noOutput && v.circulation !== "stable") parts.push(v.circulation === "shock" ? "in shock" : "hypotensive");
  const heart: string[] = [];
  if (v.ischemicMass >= 0.02) heart.push(`about ${pct(v.ischemicMass)} of the myocardium ischemic`);
  if (v.infarct >= 0.01) heart.push(`${pct(v.infarct)} of the left ventricle infarcted`);
  if (v.ef !== null && (v.infarct >= 0.01 || v.ischemicMass >= 0.02 || v.ef < 0.5)) heart.push(`EF ${pct(v.ef)}`);
  return parts.join(", ") + (heart.length ? `; ${heart.join(", ")}` : "");
}

/** What the monitor did: "HR 72 -> 168, MAP 88 -> 62, sinus rhythm -> ventricular tachycardia"; empty when nothing moved. */
export function vitalsChange(b: Vitals, a: Vitals): string {
  const bits: string[] = [];
  if (b.rhythm !== a.rhythm) bits.push(`rhythm ${b.rhythm} -> ${a.rhythm}`);
  const mv = (name: string, x: number | null, y: number | null, tol: number) => { if (x !== null && y !== null && Math.abs(x - y) >= tol) bits.push(`${name} ${x} -> ${y}`); };
  if (!a.noOutput && !b.noOutput) { mv("HR", b.hr, a.hr, 5); mv("MAP", b.map, a.map, 5); }
  else if (a.noOutput !== b.noOutput) bits.push(a.noOutput ? "the output stopped" : "output returned");
  if (a.infarct - b.infarct >= 0.01) bits.push(`infarct ${pct(b.infarct)} -> ${pct(a.infarct)} of the left ventricle`);
  else if (b.infarct - a.infarct >= 0.01) bits.push(`infarct ${pct(b.infarct)} -> ${pct(a.infarct)}`);
  return bits.join(", ");
}

// ---------------------------------------------------------------- the sentences the tools return
/** `corosim_describe_case` and the first sentence of `corosim_set_scenario`: the patient and where it stands. */
export function narrateCase(spec: PatientSpec, v: Vitals): string {
  return `A patient ${describeSpec(spec)}, ${vitalsNow(v)}.`;
}

/** A new patient was built. */
export function narrateNewPatient(spec: PatientSpec, v: Vitals, warmupS: number): string {
  return `New patient ${describeSpec(spec)}${warmupS > 0 ? ` (settled for ${Math.round(warmupS)} s)` : ""}: ${vitalsNow(v)}.`;
}

/** A change to the running patient (`corosim_adjust`) and the response to it. */
export function narrateChange(before: PatientSpec, after: PatientSpec, vb: Vitals, va: Vitals, ranS: number): string {
  const d = diffSpecs(before, after);
  const head = d.length ? `${cap(joinList(d))}.` : "Nothing in the patient changed.";
  const moved = vitalsChange(vb, va);
  const tail = `${ranS > 0 ? `After ${Math.round(ranS)} s: ` : "Now: "}${vitalsNow(va).replace(/^now /, "")}${moved ? ` (${moved})` : ""}.`;
  return `${head} ${tail}`;
}

/** Time passed with nothing changed (`corosim_run`). */
export function narrateRun(vb: Vitals, va: Vitals, ranS: number): string {
  const moved = vitalsChange(vb, va);
  return `Ran ${Math.round(ranS)} s: ${vitalsNow(va).replace(/^now /, "")}${moved ? ` (${moved})` : " (little changed)"}.`;
}

/** A revascularization (`corosim_treat`): the order, the delay it cost, and the patient afterwards. */
export function narrateTreat(o: { procedure: string; delayMinutes: number; result: string; lvInfarctBefore: number; lvInfarctAtArrival: number }, vb: Vitals, va: Vitals): string {
  const grew = o.lvInfarctAtArrival - o.lvInfarctBefore >= 0.005 ? `; the infarct grew from ${pct(o.lvInfarctBefore)} to ${pct(o.lvInfarctAtArrival)} of the left ventricle during the ${o.delayMinutes}-minute wait` : `; ${o.delayMinutes} minutes passed before it was done`;
  const moved = vitalsChange(vb, va);
  return `${o.procedure}: ${o.result.replace(/\.$/, "")}${grew}. Now: ${vitalsNow(va).replace(/^now /, "")}${moved ? ` (${moved})` : ""}.`;
}

/** A valve procedure (`corosim_valve`): what the procedure did, or why it did nothing. */
export function narrateValve(done: boolean, changes: string[], warnings: string[], vb: Vitals, va: Vitals): string {
  if (!done) return `No valve was changed${warnings.length ? `: ${warnings[0].replace(/\.$/, "")}` : ""}. The patient is ${vitalsNow(va)}.`;
  const moved = vitalsChange(vb, va);
  return `${cap(joinList(changes))}. Now: ${vitalsNow(va).replace(/^now /, "")}${moved ? ` (${moved})` : ""}.`;
}
