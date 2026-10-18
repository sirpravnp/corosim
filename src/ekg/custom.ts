import { LEADS, LEAD_AXES, Vec3, WAVES } from "../config/ecg";
import { LesionSpec } from "../sim/scenario";
import { EkgSpec, Morph, RhythmSpec, VM, VMorph } from "./engine";
import { EkgPreset, PRESET_BY_ID, findPreset } from "./presets";

/**
 * Tracings that are not in the library, described in clinical terms (a rhythm, its rate and conduction, and what the
 * complexes look like by territory) and built on the same engine. This is what an AI fills in when a learner asks for
 * "sinus at 110 with LBBB and an inferior STEMI" or "AF with WPW": the knobs are the words a reader would use, not
 * dipole vectors, and anything out of range is clamped and reported back.
 */
export type Territory = "anterior" | "septal" | "lateral" | "high-lateral" | "inferior" | "posterior" | "diffuse" | "right";
export const TERRITORIES: Territory[] = ["anterior", "septal", "lateral", "high-lateral", "inferior", "posterior", "diffuse", "right"];

/** Which way each wall faces (ECG frame: x left, y feet, z anterior). [assumed, chosen for the classic lead groups] */
const FACING: Record<Territory, Vec3> = {
  anterior: [0.15, -0.1, 1], // V2–V4
  septal: [-0.45, 0, 0.9], // V1–V2
  lateral: [0.95, -0.15, 0.2], // I, V5–V6
  "high-lateral": [0.75, -0.65, 0], // I, aVL
  inferior: [-0.1, 1, 0], // II, III, aVF
  posterior: [0.15, 0, -1], // V7–V9; mirror image in V1–V3
  diffuse: [0.45, 0.6, 0.45], // most leads at once, aVR the exception (pericarditis-like)
  right: [-0.85, 0.35, 0.3], // III, aVR, V1 (right ventricle)
};
const unit = (v: Vec3): Vec3 => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const proj = (v: Vec3, l: (typeof LEADS)[number] | "V8") => { const a = LEAD_AXES[l]; return a[0] * v[0] + a[1] * v[1] + a[2] * v[2]; };
/** The lead that faces a wall most directly (posterior counts V8). */
function facingLead(t: Territory) {
  const d = unit(FACING[t]), leads = t === "posterior" ? (["V8"] as const) : LEADS;
  let best: (typeof LEADS)[number] | "V8" = leads[0], bp = -Infinity;
  for (const l of leads) { const p = proj(d, l); if (p > bp) { bp = p; best = l; } }
  return { dir: d, lead: best, gain: bp };
}
/** A vector toward a wall sized so the lead facing it reads `mm` (positive = toward that wall). */
function toward(t: Territory, mm: number): Vec3 { const f = facingLead(t); return scale(f.dir, mm / 10 / f.gain); }

export interface CustomEkg {
  name?: string;
  /** Start from a library preset and change it. */
  base?: string;
  summary?: string;
  teachingPoints?: string[];
  rhythm?: {
    kind?: "sinus" | "af" | "flutter" | "svt" | "junctional" | "mat" | "vt" | "idioventricular" | "paced" | "torsades" | "vf" | "asystole";
    rate?: number; // bpm (ventricular, or sinus for sinus rhythms)
    prMs?: number;
    av?: "normal" | "first" | "wenckebach" | "mobitz2" | "2:1" | "complete";
    dropEvery?: number; // P waves per group in Wenckebach / Mobitz II
    escape?: "junctional" | "ventricular";
    escapeRate?: number;
    pvcEvery?: number; // a PVC after every Nth beat (1 = bigeminy, 2 = trigeminy)
    pvcOrigin?: "rvot" | "lv";
    atrialRate?: number; // flutter rate, or dissociated sinus rate under VT / pacing / asystole
    flutterRatio?: 2 | 3 | 4 | "variable";
    irregularity?: number; // AF: 0..0.6
    vtMorphology?: "rbbb" | "lbbb";
    polymorphic?: boolean;
    vfAmplitude?: "coarse" | "fine";
    sinusArrhythmia?: boolean;
    alternans?: boolean;
  };
  morph?: {
    bbb?: "none" | "rbbb" | "lbbb";
    axisDeg?: number; // target frontal QRS axis
    qrsWidthMs?: number;
    qrsVoltage?: number; // × normal (0.4 low voltage, 2 LVH)
    pAmplitude?: number; // × normal (0 = none)
    pWide?: boolean; // broad P (left atrial enlargement)
    tAmplitude?: number; // × normal
    peakedT?: boolean;
    qtMultiplier?: number; // repolarization time × (1.5 = long QT)
    st?: { territory: Territory; mm: number; shape?: "plateau" | "upsloping" | "coved" }[]; // +elevation / −depression in the facing lead
    tInversion?: { territory: Territory; mm: number }[]; // depth of the inverted T in the facing lead
    qWaves?: Territory[];
    deltaWave?: boolean;
    osbornMm?: number;
    uWaveMm?: number;
    prDepressionMm?: number;
    tremor?: boolean;
  };
  /** Real coronary lesions, run through the simulator's coronary model for the ST vector. */
  lesions?: LesionSpec[];
  exertion?: boolean;
}

const clamp = (x: unknown, lo: number, hi: number, name: string, warn: string[], def?: number): number | undefined => {
  if (x === undefined || x === null) return def;
  const v = Number(x);
  if (!Number.isFinite(v)) { warn.push(`${name} ignored: not a number.`); return def; }
  if (v < lo || v > hi) { warn.push(`${name} ${v} clamped to ${Math.min(hi, Math.max(lo, v))}.`); return Math.min(hi, Math.max(lo, v)); }
  return v;
};
const BASE_AXIS = 54; // the normal heart's measured frontal axis

/** Build a preset-like tracing from a description. Returns what was built and anything that was changed or ignored. */
export function buildCustom(c: CustomEkg): { preset: EkgPreset; warnings: string[] } {
  const warn: string[] = [];
  const base = c.base ? findPreset(c.base) : undefined;
  if (c.base && !base) warn.push(`base "${c.base}" is not a preset; started from normal sinus rhythm.`);
  const from = base ?? PRESET_BY_ID.nsr;
  let rhythm: RhythmSpec = from.spec.rhythm;
  const morph: Morph = { ...(from.spec.morph ?? {}), comps: [...(from.spec.morph?.comps ?? [])] };
  let tremor = from.spec.tremor;

  // ---- rhythm
  const r = c.rhythm ?? {};
  const rate = (def: number, lo = 15, hi = 300) => clamp(r.rate, lo, hi, "rate", warn, def)!;
  const prS = clamp(r.prMs, 60, 500, "prMs", warn);
  if (r.kind || !base) {
    const kind = r.kind ?? "sinus";
    const vtVm: VMorph = r.vtMorphology === "lbbb" ? VM.rvot : VM.vtLv;
    switch (kind) {
      case "sinus": {
        const av = r.av ?? "normal";
        rhythm = {
          kind: "sinus", rate: rate(75), pr: prS !== undefined ? prS / 1000 : av === "first" ? 0.28 : undefined,
          av: av === "first" ? "normal" : av, cycle: clamp(r.dropEvery, 2, 8, "dropEvery", warn),
          escape: av === "complete" ? { rate: clamp(r.escapeRate, 15, 70, "escapeRate", warn, r.escape === "ventricular" ? 32 : 42)!, vm: r.escape === "ventricular" ? VM.escape : undefined } : undefined,
          ectopy: r.pvcEvery ? { every: clamp(r.pvcEvery, 1, 10, "pvcEvery", warn)!, vm: r.pvcOrigin === "lv" ? VM.vtLv : VM.rvot } : undefined,
          resp: r.sinusArrhythmia ? 0.18 : undefined, alternans: r.alternans ? 0.3 : undefined,
        };
        break;
      }
      case "af": rhythm = { kind: "af", rate: rate(90), irregularity: clamp(r.irregularity, 0, 0.6, "irregularity", warn) }; break;
      case "flutter": {
        const ratio = r.flutterRatio === "variable" ? "variable" : clamp(r.flutterRatio, 1, 8, "flutterRatio", warn, 2)!;
        rhythm = { kind: "flutter", atrial: clamp(r.atrialRate, 220, 350, "atrialRate", warn, 300), ratio: ratio === "variable" ? ratio : Math.round(ratio) };
        if (r.rate !== undefined) warn.push("rate ignored for flutter: the ventricular rate is atrialRate ÷ flutterRatio.");
        break;
      }
      case "svt": rhythm = { kind: "svt", rate: rate(180, 120, 280) }; break;
      case "junctional": rhythm = { kind: "junctional", rate: rate(50, 25, 150) }; break;
      case "mat": rhythm = { kind: "mat", rate: rate(112, 60, 180) }; break;
      case "vt": rhythm = { kind: "ventricular", rate: rate(170, 100, 300), vm: vtVm, poly: r.polymorphic, atrial: r.polymorphic ? undefined : clamp(r.atrialRate, 30, 150, "atrialRate", warn, 80) }; break;
      case "idioventricular": rhythm = { kind: "ventricular", rate: rate(70, 20, 120), vm: r.vtMorphology === "rbbb" ? VM.vtLv : VM.rvot, atrial: clamp(r.atrialRate, 30, 150, "atrialRate", warn, 64) }; break;
      case "paced": rhythm = { kind: "ventricular", rate: rate(70, 30, 180), vm: VM.paced, paced: true, atrial: clamp(r.atrialRate, 30, 150, "atrialRate", warn, 64) }; break;
      case "torsades": rhythm = { kind: "torsades", rate: rate(230, 150, 300) }; if (morph.qt === undefined) morph.qt = 1.5; break;
      case "vf": rhythm = { kind: "vf", mv: r.vfAmplitude === "fine" ? 0.14 : 0.55 }; break;
      case "asystole": rhythm = { kind: "asystole", atrial: clamp(r.atrialRate, 0, 120, "atrialRate", warn) || undefined }; break;
      default: warn.push(`rhythm kind "${kind as string}" unknown; used sinus.`); rhythm = { kind: "sinus", rate: rate(75) };
    }
  } else {
    // a base preset with only some numbers changed
    if (r.rate !== undefined && "rate" in rhythm) rhythm = { ...rhythm, rate: rate((rhythm as { rate: number }).rate) } as RhythmSpec;
    if (prS !== undefined && rhythm.kind === "sinus") rhythm = { ...rhythm, pr: prS / 1000 };
    if (r.pvcEvery && rhythm.kind === "sinus") rhythm = { ...rhythm, ectopy: { every: Math.max(1, Math.round(r.pvcEvery)), vm: r.pvcOrigin === "lv" ? VM.vtLv : VM.rvot } };
  }

  // ---- morphology
  const m = c.morph ?? {};
  if (m.bbb) morph.bbb = m.bbb;
  if (m.axisDeg !== undefined) { const a = clamp(m.axisDeg, -180, 180, "axisDeg", warn)!; morph.axisShift = a - BASE_AXIS; }
  if (m.qrsWidthMs !== undefined) morph.qrsWide = clamp(m.qrsWidthMs, 60, 260, "qrsWidthMs", warn)! / 90;
  if (m.qrsVoltage !== undefined) morph.qrs = clamp(m.qrsVoltage, 0.2, 3, "qrsVoltage", warn);
  if (m.pAmplitude !== undefined) morph.p = clamp(m.pAmplitude, 0, 3, "pAmplitude", warn);
  if (m.pWide) morph.pWide = 1.5;
  if (m.tAmplitude !== undefined) morph.t = clamp(m.tAmplitude, -2, 4, "tAmplitude", warn);
  if (m.peakedT) { morph.t = morph.t ?? 2.3; morph.tNarrow = 0.5; }
  if (m.qtMultiplier !== undefined) morph.qt = clamp(m.qtMultiplier, 0.6, 2, "qtMultiplier", warn);
  const terr = (t: string): t is Territory => { const ok = (TERRITORIES as string[]).includes(t); if (!ok) warn.push(`territory "${t}" unknown; use ${TERRITORIES.join(", ")}.`); return ok; };
  for (const s of m.st ?? []) {
    if (!terr(s.territory)) continue;
    const mm = clamp(s.mm, -8, 12, `st ${s.territory}`, warn, 0)!;
    morph.comps!.push({ k: "st", v: toward(s.territory, s.shape === "upsloping" || s.shape === "coved" ? mm * 1.35 : mm), shape: s.shape === "upsloping" || s.shape === "coved" ? "jpoint" : "plateau" });
  }
  let tVec: Vec3 = morph.tVec ?? WAVES.T.v;
  for (const ti of m.tInversion ?? []) {
    if (!terr(ti.territory)) continue;
    const f = facingLead(ti.territory), depth = clamp(Math.abs(ti.mm), 0, 15, `tInversion ${ti.territory}`, warn, 3)! / 10;
    const k = (depth + proj(tVec, f.lead)) / f.gain; // takes away the normal T there, then inverts it
    tVec = [tVec[0] - f.dir[0] * k, tVec[1] - f.dir[1] * k, tVec[2] - f.dir[2] * k];
  }
  if (m.tInversion?.length) morph.tVec = tVec;
  for (const q of m.qWaves ?? []) {
    if (!terr(q)) continue;
    const d = unit(FACING[q]);
    morph.comps!.push({ k: "wave", v: scale(d, -0.35), t: -0.03, w: 0.012 }, { k: "wave", v: scale(d, -0.3), t: 0, w: 0.013 });
  }
  if (m.deltaWave) {
    morph.comps!.push({ k: "wave", v: [0.36, 0.3, -0.06], t: -0.05, w: 0.019 });
    morph.qrsWide = Math.max(morph.qrsWide ?? 1, 1.1);
    if (rhythm.kind === "sinus" && prS === undefined) rhythm = { ...rhythm, pr: 0.1 };
  }
  if (m.osbornMm) morph.comps!.push({ k: "wave", v: toward("diffuse", clamp(m.osbornMm, 0, 8, "osbornMm", warn)!), t: 0.052, w: 0.013 });
  if (m.uWaveMm) morph.comps!.push({ k: "wave", v: toward("anterior", clamp(m.uWaveMm, 0, 4, "uWaveMm", warn)!), t: 0.17, w: 0.045, anchor: "T" });
  if (m.prDepressionMm) morph.comps!.push({ k: "pr", v: toward("inferior", -clamp(Math.abs(m.prDepressionMm), 0, 3, "prDepressionMm", warn)!) });
  if (m.tremor) tremor = 0.03;
  if (!morph.comps!.length) delete morph.comps;

  const spec: EkgSpec = { rhythm, morph, tremor };
  const lesions = c.lesions?.length ? c.lesions : undefined;
  const coronary = lesions ? { scenario: { lesions, exertion: c.exertion } } : base?.coronary;
  const name = (c.name ?? "").trim().slice(0, 80) || (base ? `${base.name} (modified)` : "Custom tracing");
  return {
    preset: {
      id: "custom", name, category: base?.category ?? "Sinus", spec, coronary,
      summary: (c.summary ?? "").slice(0, 300) || "Built on request from a description; not one of the library's presets.",
      features: base ? base.features : [],
      pearls: (c.teachingPoints ?? []).slice(0, 6).map((x) => String(x).slice(0, 300)),
      mimics: base?.mimics, leads: base?.leads,
    },
    warnings: warn,
  };
}

/** URL-safe base64 of a description, for /ekg/#c= links. */
export function encodeCustom(c: CustomEkg): string {
  const json = JSON.stringify(c);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(json, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeCustom(s: string): CustomEkg {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const json = typeof Buffer !== "undefined" ? Buffer.from(b64, "base64").toString("utf8") : decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json) as CustomEkg;
}
