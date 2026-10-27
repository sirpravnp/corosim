import { analyze, resolveValve } from "../physics/structural";
import type { StructuralReport, StructuralSpec, ValveLesion } from "../physics/structural";
import { PATIENTS } from "../config/structural";
import { ANNULOPLASTY, BALLOON, DEFAULT_PROSTHESIS_SIZE, EDGE_TO_EDGE, PROSTHESIS_SIZE, REGURG_AREA_FRAC, STENOSIS_SPAN, VALVE_KEYS } from "../config/valves";
import type { ProsthesisKind, ValveKey } from "../config/valves";
import { gradeValves } from "./structural";
import type { Grade, ValveFinding } from "./structural";
import type { HeartSpec } from "./patient";

/**
 * Several valve lesions at once, prosthetic valves and valve interventions for the adult Simulator (B5, docs/VALVES.md). DOM-free.
 *
 * The engine already treats the four valves independently (each is an orifice with a leak between two chambers), so a combined lesion
 * needs no special coupling: the interaction is the circulation's own. Aortic stenosis raises the left ventricular systolic pressure and
 * so drives more mitral regurgitation through the same leak; mitral regurgitation adds volume the stenotic valve must eject; aortic
 * regurgitation with mitral stenosis shortens left ventricular filling; and so on. This file only builds the combinations and the actions.
 */

export type NativeSeverity = { stenosis?: number; regurgitation?: number };
const unit = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? 0 : Math.min(1, Math.max(0, x)));
const ADULT = PATIENTS.adult;

/** A native valve from a stenosis and a regurgitation severity, both 0..1 (the same scale as the single-lesion sliders). */
export function nativeLesion(valve: ValveKey, d: NativeSeverity): ValveLesion {
  const s = unit(d.stenosis), r = unit(d.regurgitation);
  return { open: 1 - STENOSIS_SPAN[valve] * s, reg: r * REGURG_AREA_FRAC[valve] * ADULT.valveAreas[valve], prosthesis: null };
}
/** `heart.valves` for a set of native lesions at once: `valveSet({ av: { stenosis: 0.9 }, mv: { regurgitation: 0.6 } })`. */
export function valveSet(d: Partial<Record<ValveKey, NativeSeverity>>): NonNullable<HeartSpec["valves"]> {
  return Object.fromEntries(VALVE_KEYS.filter((k) => d[k]).map((k) => [k, nativeLesion(k, d[k]!)]));
}

export type Intervention =
  /** Replace the valve: surgically (a bioprosthesis or mechanical valve, no paravalvular leak unless asked) or by catheter (`transcatheter`). A transcatheter valve placed in a failed bioprosthesis is valve-in-valve. */
  | { type: "replace"; valve: ValveKey; kind: ProsthesisKind; sizeMm?: number; leakCm2?: number }
  /** Transcatheter aortic valve replacement: `replace` of the aortic valve with a transcatheter valve. */
  | { type: "tavr"; sizeMm?: number; leakCm2?: number }
  /** Balloon valvuloplasty of a stenotic native valve (aortic, mitral or pulmonary). `effect` 0..1 scales the result (a calcified or high-score valve responds less). */
  | { type: "balloon"; valve: ValveKey; effect?: number }
  /** Transcatheter edge-to-edge repair (MitraClip, TriClip) of mitral or tricuspid regurgitation with 1 to 4 clips (default 2). */
  | { type: "teer"; valve: ValveKey; clips?: number }
  /** Surgical repair with an annuloplasty ring (mitral or tricuspid regurgitation). */
  | { type: "repair"; valve: ValveKey };

export interface InterventionResult {
  /** The heart with the action done (the patient's `heart` merged with `patch`). */
  heart: HeartSpec;
  /** The part of `heart` the action changed, complete for the valve it touches: pass it to `Simulation.apply({ heart: patch })`. Empty when nothing was done. */
  patch: HeartSpec;
  /** What changed, in words. */
  changes: string[];
  /** Why nothing, or less than asked, was done. */
  warnings: string[];
}

const VALVE_NAME: Record<ValveKey, string> = { av: "aortic", mv: "mitral", tv: "tricuspid", pv: "pulmonary" };
const round = (x: number, d = 2) => +x.toFixed(d);
const merge = (base: unknown, add: unknown): unknown => {
  if (!add || typeof add !== "object" || Array.isArray(add) || !base || typeof base !== "object" || Array.isArray(base)) return add;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(add)) out[k] = v === undefined ? out[k] : merge(out[k], v);
  return out;
};

/**
 * Do `iv` to `heart` (the patient's structural heart; absent valves are normal). Pure: returns the new heart and the patch. The native
 * valve is read as its area (normal area × `open`) and regurgitant orifice (`reg`), the action edits those, and the result is written
 * back with every field of the valve set (so merging the patch cannot leave a stale field behind). Effects and sources: docs/VALVES.md.
 */
export function intervene(heart: HeartSpec, iv: Intervention): InterventionResult {
  const changes: string[] = [], warnings: string[] = [];
  const none = (why: string): InterventionResult => ({ heart, patch: {}, changes, warnings: [...warnings, why] });
  const valve: ValveKey = iv.type === "tavr" ? "av" : iv.valve, name = VALVE_NAME[valve];
  if (!VALVE_KEYS.includes(valve)) return none(`${String(valve)} is not a valve (av, mv, tv, pv)`);
  const cur = heart.valves?.[valve], normal = ADULT.valveAreas[valve];
  const host = cur?.prosthesis ?? null, area = normal * (cur?.open ?? 1), reg = cur?.reg ?? 0;
  let next: ValveLesion;

  if (iv.type === "replace" || iv.type === "tavr") {
    const kind: ProsthesisKind = iv.type === "tavr" ? "transcatheter" : iv.kind, [lo, hi] = PROSTHESIS_SIZE[valve];
    let size = iv.sizeMm ?? DEFAULT_PROSTHESIS_SIZE[kind][valve];
    if (size < lo || size > hi) { warnings.push(`${kind} ${name} valves come in ${lo} to ${hi} mm; ${size} mm changed to ${Math.min(hi, Math.max(lo, size))} mm`); size = Math.min(hi, Math.max(lo, size)); }
    const inRing = kind === "transcatheter" && host?.kind === "bioprosthetic";
    if (kind === "transcatheter" && host?.kind === "mechanical") return none(`a transcatheter valve cannot be placed in a mechanical ${name} valve`);
    next = { open: 1, reg: 0, prosthesis: { kind, sizeMm: size, leak: Math.max(0, iv.leakCm2 ?? 0), obstruction: 0, inRing } };
    changes.push(`${name} valve replaced by a ${size} mm ${kind === "transcatheter" ? (inRing ? "transcatheter valve-in-valve" : "transcatheter") : kind} valve${host ? " (the earlier prosthesis is removed or, for valve-in-valve, kept as the ring)" : ""}`);
    if (reg > 0 && !host) changes.push(`native ${name} regurgitation treated`);
    if (area < normal * 0.9 && !host) changes.push(`native ${name} stenosis relieved to the prosthesis's orifice`);
  } else if (iv.type === "balloon") {
    const b = BALLOON[valve];
    if (!b) return none(`balloon valvuloplasty is not offered for the ${name} valve (aortic, mitral and pulmonary only)`);
    if (host) return none(`balloon valvuloplasty does not treat a ${name} prosthesis`);
    if (area >= b.ceiling) return none(`the ${name} valve is not stenotic enough to dilate (area ${round(area)} cm², a balloon gains to at most ${b.ceiling} cm²)`);
    const effect = unit(iv.effect ?? 1), newArea = Math.max(area, Math.min(area + b.gain * effect, b.ceiling));
    next = { open: newArea / normal, reg: reg + b.leak * effect, prosthesis: null };
    changes.push(`${name} valve dilated: area ${round(area)} to ${round(newArea)} cm²; new regurgitant orifice ${round(b.leak * effect, 3)} cm²`);
  } else if (iv.type === "teer") {
    const t = EDGE_TO_EDGE[valve];
    if (!t) return none(`edge-to-edge repair is for the mitral and tricuspid valves`);
    if (host) return none(`edge-to-edge repair is for a native valve; the ${name} valve is a prosthesis`);
    if (reg <= 0) return none(`the ${name} valve does not leak: nothing to clip`);
    const clips = Math.round(Math.min(t.maxClips, Math.max(1, iv.clips ?? 2))), newArea = Math.min(area, Math.max(t.floor, area - t.areaLoss * clips));
    next = { open: newArea / normal, reg: reg * t.regKeep ** clips, prosthesis: null };
    changes.push(`${clips} clip${clips > 1 ? "s" : ""} on the ${name} valve: regurgitant orifice ${round(reg, 3)} to ${round(next.reg!, 3)} cm², opening ${round(area)} to ${round(newArea)} cm²`);
    if (newArea < 3 && valve === "mv") warnings.push(`mitral opening ${round(newArea)} cm² after ${clips} clips: a mean gradient of 5 mmHg or more (iatrogenic stenosis) is likely`);
  } else if (iv.type === "repair") {
    const r = ANNULOPLASTY[valve];
    if (!r) return none(`annuloplasty repair is for the mitral and tricuspid valves`);
    if (host) return none(`repair is for a native valve; the ${name} valve is a prosthesis`);
    if (reg <= 0) return none(`the ${name} valve does not leak: nothing to repair`);
    next = { open: (area * r.areaKeep) / normal, reg: reg * r.regKeep, prosthesis: null };
    changes.push(`${name} valve repaired with a ring: regurgitant orifice ${round(reg, 3)} to ${round(next.reg!, 3)} cm², opening ${round(area)} to ${round(area * r.areaKeep)} cm²`);
  } else return none("unknown intervention");

  const patch: HeartSpec = { valves: { [valve]: next } };
  return { heart: merge(heart, patch) as HeartSpec, patch, changes, warnings };
}

// ---- findings in words -----------------------------------------------------------------------------------------------

const LABEL: Record<string, string> = { AV: "Aortic", MV: "Mitral", TV: "Tricuspid", PVL: "Pulmonary" };
const SOUND: Record<string, { stenosis: string; regurgitation: string }> = {
  AV: { stenosis: "crescendo-decrescendo systolic ejection murmur at the right upper sternal border radiating to the carotids", regurgitation: "early diastolic decrescendo murmur at the left sternal border with a wide pulse pressure" },
  MV: { stenosis: "opening snap and a low-pitched mid-diastolic rumble at the apex", regurgitation: "holosystolic murmur at the apex radiating to the axilla" },
  TV: { stenosis: "diastolic rumble at the left lower sternal border, louder with inspiration", regurgitation: "holosystolic murmur at the left lower sternal border, louder with inspiration, with a prominent jugular v wave" },
  PVL: { stenosis: "systolic ejection murmur at the left upper sternal border with an ejection click", regurgitation: "early diastolic decrescendo murmur at the left upper sternal border" },
};

/** What the examiner hears across all the valves, one clause per finding; a prosthesis adds its sounds. */
export function murmurOf(valves: ValveFinding[]): string {
  const out: string[] = [];
  for (const v of valves) {
    const p = v.prosthesis;
    if (p) {
      if (p.kind === "mechanical") out.push(p.obstruction > 0.3 ? `${LABEL[v.valve]} mechanical valve: the closing click is muffled (suspect thrombus or pannus)` : `${LABEL[v.valve]} mechanical valve: a crisp metallic closing click`);
      else out.push(`${LABEL[v.valve]} ${p.kind === "transcatheter" ? "transcatheter" : "bioprosthetic"} valve: normal, soft prosthetic closure`);
    }
    if (v.stenosis !== "none") out.push(`${LABEL[v.valve]}: ${SOUND[v.valve].stenosis}`);
    if (v.regurgitation !== "none") out.push(`${LABEL[v.valve]}: ${SOUND[v.valve].regurgitation}`);
  }
  return out.length ? `${out.join("; ")}.` : "No murmur.";
}

/** One line per valve with anything to report: grade, area or EOA, mean gradient, regurgitant volume and fraction. */
export function valveSummary(valves: ValveFinding[]): string[] {
  return valves.flatMap((v) => {
    const p = v.prosthesis, bits: string[] = [];
    if (!p && v.stenosis === "none" && v.regurgitation === "none") return [];
    if (p) bits.push(`${p.sizeMm} mm ${p.inRing ? "valve-in-valve " : ""}${p.kind}: EOA ${p.eoa.toFixed(1)} cm² (${p.eoaIndexed.toFixed(2)} cm²/m²)${p.mismatch !== "none" ? `, ${p.mismatch} patient-prosthesis mismatch` : ""}`);
    if (v.stenosis !== "none" || p) bits.push(`stenosis ${v.stenosis}, mean gradient ${v.meanGradient.toFixed(0)} mmHg${!p && v.gorlinArea ? `, Gorlin area ${v.gorlinArea.toFixed(1)} cm²` : ""}`);
    if (v.regurgitation !== "none" || (p && v.regurgMl > 0.5)) bits.push(`regurgitation ${v.regurgitation === "none" ? "physiological" : v.regurgitation}: ${v.regurgMl.toFixed(0)} ml per beat${v.regurgFraction !== null ? ` (${(v.regurgFraction * 100).toFixed(0)}% of forward)` : ""}`);
    return [`${LABEL[v.valve]}: ${bits.join("; ")}`];
  });
}

export interface HeartAssessment { spec: StructuralSpec; report: StructuralReport; valves: ValveFinding[]; murmur: string; summary: string[]; worst: Grade }
const RANK: Grade[] = ["none", "mild", "moderate", "severe"];

/** Settle a structural heart (any number of valve lesions, prostheses and shunts at once, adult baseline) and grade every valve. */
export function assessHeart(heart: HeartSpec = {}, opts: { waveform?: boolean } = {}): HeartAssessment {
  const spec: StructuralSpec = { ...heart, patient: "adult" }, report = analyze(spec, { waveform: opts.waveform ?? false }), valves = gradeValves(spec, report);
  const worst = valves.reduce<Grade>((a, v) => (RANK.indexOf(v.grade as Grade) > RANK.indexOf(a) ? (v.grade as Grade) : a), "none");
  return { spec, report, valves, murmur: murmurOf(valves), summary: valveSummary(valves), worst };
}
