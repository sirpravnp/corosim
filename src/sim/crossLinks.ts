import { decodePatient, encodePatient } from "./llm";
import type { HeartSpec, PatientSpec } from "./patient";
import type { Scenario } from "./scenario";
import { defaults, LESIONS, LesionDef, lesionHash, patientFromLesionHash } from "./structural";

/**
 * "Open this patient in…" links between the pages (task P14). DOM-free: each page hands in the patient it shows and the path
 * to the site root, and gets back the hrefs for its link row.
 *
 * What each page can take in its URL hash:
 *   sim, cath   `#s=<encodePatient>`: the whole PatientSpec (coronary tree, rhythm, drugs, and the structural heart).
 *   structural  `#lesion=<id>&<slider>=<value>`: a library lesion with its sliders. Only a heart that is a library lesion
 *               can be carried (see `lesionForHeart`); coronary and other sections are dropped, as that page has no use for them.
 *   ekg         `#p=<preset id>`: no patient input; the closest preset is chosen (`ekgPresetFor`).
 *   echo        `#<view id>`: a view atlas with no patient model, so it is linked to, never from, and carries nothing.
 */
export type PageId = "sim" | "cath" | "structural" | "echo" | "ekg";

export interface CrossLink {
  page: PageId;
  label: string;
  href: string;
  /** Tooltip: what is carried over and what is not. */
  note: string;
  /** True when the destination shows this patient; false for a preset standing in for it or a plain link to the page. */
  carries: boolean;
}

/** The PatientSpec fields that are not part of a Scenario (src/sim/patient.ts); a page that only holds a Scenario keeps them aside. */
const EXTRA = ["kind", "heart", "pericardium", "fluids", "ventilation", "devices"] as const;

/** A scenario plus the structural sections of the spec the page was opened with (the simulator and cath lab keep the two apart). */
export function joinPatient(scenario: Scenario, shared?: PatientSpec | null): PatientSpec {
  const out: PatientSpec = { ...scenario };
  if (shared) for (const k of EXTRA) if (shared[k] !== undefined) (out as Record<string, unknown>)[k] = shared[k];
  return out;
}

/** The patient a page's hash opens, or null when the hash carries none (library cases, presets, echo views, damaged links). */
export function patientFromHash(page: PageId, hash: string): PatientSpec | null {
  if (page === "sim" || page === "cath") {
    const s = hash.match(/^#s=([\w-]+)/)?.[1];
    if (!s) return null;
    try { return decodePatient(s); } catch { return null; }
  }
  if (page === "structural") return /^#lesion=/.test(hash) ? patientFromLesionHash(hash) : null;
  return null;
}

// ---------------------------------------------------------------- heart to lesion
function flatten(o: unknown, path: string, out: Record<string, number>) {
  if (typeof o === "number") out[path] = o;
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flatten(v, path ? `${path}.${k}` : k, out);
}
/** Sum of relative differences between two hearts' numeric fields; a field one side lacks counts as 0 there. 0 = identical. */
function heartDistance(a: HeartSpec, b: HeartSpec): number {
  const fa: Record<string, number> = {}, fb: Record<string, number> = {};
  flatten(a, "", fa); flatten(b, "", fb);
  let d = 0;
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    const x = fa[k] ?? 0, y = fb[k] ?? 0;
    d += Math.abs(x - y) / (Math.abs(x) + Math.abs(y) + 1e-6);
  }
  return d;
}
const gridOf = (p: LesionDef["params"][number]) => {
  const n = Math.round((p.max - p.min) / p.step), out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(+(p.min + i * p.step).toFixed(6));
  return out;
};
const heartOf = (d: LesionDef, v: Record<string, number>): HeartSpec => { const { patient: _p, hr: _h, ...heart } = d.build(v); return heart; };

/** How close a heart must be to a library lesion (summed relative difference over its fields) to count as that lesion. */
export const LESION_MATCH_TOLERANCE = 0.02;

/**
 * The library lesion, and slider values, whose heart is this patient's, or null. A lesion's sliders each set their own fields,
 * so each is fitted alone over its grid (the others at default) and the result is accepted only if the whole heart then matches
 * within LESION_MATCH_TOLERANCE. The patient's `kind` must equal the lesion's: an adult with a VSD is not the neonatal VSD lesson.
 */
export function lesionForHeart(patient: PatientSpec): { id: LesionDef["id"]; values: Record<string, number>; hash: string } | null {
  const heart = patient.heart ?? {}, kind = patient.kind ?? "adult";
  let best: { d: LesionDef; values: Record<string, number>; dist: number } | null = null;
  for (const d of LESIONS) {
    if (d.patient !== kind) continue;
    const values = defaults(d);
    for (const p of d.params) {
      let bv = values[p.key], bd = Infinity;
      for (const x of gridOf(p)) { const dist = heartDistance(heartOf(d, { ...values, [p.key]: x }), heart); if (dist < bd - 1e-12) { bd = dist; bv = x; } }
      values[p.key] = bv;
    }
    const dist = heartDistance(heartOf(d, values), heart);
    if (!best || dist < best.dist - 1e-12) best = { d, values, dist };
  }
  if (!best || best.dist > LESION_MATCH_TOLERANCE) return null;
  return { id: best.d.id, values: best.values, hash: lesionHash(best.d.id, best.values) };
}

// ---------------------------------------------------------------- patient to EKG preset
/** Library presets (src/ekg/presets.ts) the links choose among; a test checks every id exists. */
export const EKG_PRESET_LABEL: Record<string, string> = {
  "stemi-anterior": "Anterior STEMI", "stemi-inferior": "Inferior STEMI", "stemi-lateral": "High lateral STEMI", "stemi-posterior": "Posterior STEMI (circumflex)",
  af: "Atrial fibrillation", lbbb: "Left bundle branch block", rbbb: "Right bundle branch block", nsr: "Normal sinus rhythm",
};
/** The territory an occluded artery supplies, as a preset. */
function presetForArtery(a: string): string | null {
  if (/^(LAD|LM|D\d|RAMUS)/.test(a)) return /^D\d/.test(a) ? "stemi-lateral" : "stemi-anterior";
  if (/^(LCX|OM)/.test(a)) return "stemi-posterior";
  if (/^(RCA|PDA|PLV|AM)/.test(a)) return "stemi-inferior";
  return null;
}
/** The EKG preset closest to the patient: an occluded artery's STEMI first, then the rhythm or bundle branch block, else normal sinus. */
export function ekgPresetFor(patient: PatientSpec): string {
  for (const l of patient.lesions ?? []) if (l.occluded) { const p = presetForArtery(String(l.artery).toUpperCase()); if (p) return p; }
  const pt = patient.patient;
  if (pt?.rhythm === "af") return "af";
  if (pt?.bbb === "lbbb") return "lbbb";
  if (pt?.bbb === "rbbb") return "rbbb";
  return "nsr";
}

// ---------------------------------------------------------------- the link rows
/**
 * The links page `from` offers for `patient`, in a fixed order. `root` is the path from that page to the site root ("../").
 * Echo and EKG have no patient, so offer none. Structural appears only when the heart is a library lesion; the EKG link is a
 * preset and the echo link a plain page link, labelled as such (`carries: false`).
 */
export function crossLinks(from: PageId, patient: PatientSpec, root: string): CrossLink[] {
  const out: CrossLink[] = [];
  if (from === "echo" || from === "ekg") return out;
  const s = encodePatient(patient);
  if (from !== "sim") out.push({ page: "sim", label: "Open in simulator", href: `${root}sim/#s=${s}`, note: "The same patient, including any structural heart.", carries: true });
  if (from !== "cath") {
    const note = patient.kind === "neonate" ? "The same patient; the heart-cath tabs show it (a newborn has no coronary angiogram)." : "The same patient: angiogram, pressure wire and heart-cath tabs.";
    out.push({ page: "cath", label: "Open in cath lab", href: `${root}cath/#s=${s}`, note, carries: true });
  }
  if (from !== "structural") {
    const fit = patient.heart ? lesionForHeart(patient) : null; // a patient with no heart section has nothing for that page to show
    if (fit) out.push({ page: "structural", label: "Open in structural", href: `${root}structural/${fit.hash}`, note: "The matching library lesion with its sliders; coronary and other sections are not carried.", carries: true });
    const p = ekgPresetFor(patient);
    out.push({ page: "ekg", label: "Open in EKG", href: `${root}ekg/#p=${p}`, note: `The EKG page takes no patient; this is its closest preset: ${EKG_PRESET_LABEL[p]}.`, carries: false });
  }
  out.push({ page: "echo", label: "Echo atlas", href: `${root}echo/`, note: "The echo page is a view atlas with no patient model; this opens it without a patient.", carries: false });
  return out;
}
