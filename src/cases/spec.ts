import type { Cond, Harm, CaseDef, Checkpoint, Outcome, Probe } from "./engine";
import { normalizePatient } from "../sim/patient";
import { itemById } from "./orders";

/**
 * A case as plain data, so it can be stored, edited in the builder and sent over the wire. It is a `CaseDef` whose conditions are written in a small
 * language instead of code: `map < 62`, `pci`, `rhythm = vf`, `drug betaBlocker > 0.1`. A checkpoint's `when` is a list that must all hold. `compileCase`
 * turns a spec into the `CaseDef` the engine runs; `validateCase` says what is wrong with one before it is saved.
 */
export const NUM_FIELDS = ["map", "hr", "ef", "lvIschemia", "rvIschemia", "congestion", "fluidsL", "shocks", "epiDoses", "amioMg", "lidoDoses"] as const;
export const FLAG_FIELDS = ["cpr", "ecmo", "impella", "iabp", "pci", "pciPending", "dead"] as const;
export const ARREST_STATES = ["none", "arrest", "rosc", "dead"] as const;
export const OPS = ["<", "<=", ">", ">="] as const;
export type NumField = (typeof NUM_FIELDS)[number];
export type FlagField = (typeof FLAG_FIELDS)[number];
export type Op = (typeof OPS)[number];

export type CondSpec =
  | { num: NumField; op: Op; value: number }
  | { is: FlagField; not?: boolean }
  | { rhythm: string; not?: boolean }
  | { arrest: (typeof ARREST_STATES)[number]; not?: boolean }
  | { drug: string; op: Op; value: number }
  | { any: CondSpec[] };

type When<T> = Omit<T, "when"> & { when?: CondSpec[] };
export interface CaseSpec extends Omit<CaseDef, "checkpoints" | "stable" | "harms"> {
  checkpoints: When<Checkpoint>[];
  stable?: CondSpec[];
  harms?: When<Harm>[];
  published?: boolean;
}

const cmp = (a: number, op: Op, b: number) => (op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);

export function compileCond(c: CondSpec): Cond {
  if ("any" in c) { const fs = c.any.map(compileCond); return (p) => fs.some((f) => f(p)); }
  if ("num" in c) return (p) => cmp(p[c.num], c.op, c.value);
  if ("is" in c) return (p) => p[c.is] !== !!c.not;
  if ("rhythm" in c) return (p) => (p.rhythmClass === c.rhythm) !== !!c.not;
  if ("arrest" in c) return (p) => (p.arrest === c.arrest) !== !!c.not;
  return (p) => cmp(p.drugs[c.drug] ?? 0, c.op, c.value);
}
export const compileAll = (cs: CondSpec[] | undefined): Cond | undefined => {
  if (!cs?.length) return undefined;
  const fs = cs.map(compileCond);
  return (p: Probe) => fs.every((f) => f(p));
};

export function compileCase(s: CaseSpec): CaseDef {
  const { checkpoints, stable, harms, published: _p, ...rest } = s;
  void _p;
  return {
    ...rest,
    stable: compileAll(stable),
    checkpoints: checkpoints.map(({ when, ...c }) => ({ ...c, when: compileAll(when) })),
    harms: harms?.map(({ when, ...h }) => ({ ...h, when: compileAll(when) ?? (() => false) })),
  };
}

// ---------------------------------------------------------------- the condition language as text

/** `map < 62`, `pci`, `not pci`, `rhythm = vf`, `rhythm != perfusing`, `arrest = rosc`, `drug betaBlocker > 0.1`, and `a or b` for any-of. */
export function condText(c: CondSpec): string {
  if ("any" in c) return c.any.map(condText).join(" or ");
  if ("num" in c) return `${c.num} ${c.op} ${c.value}`;
  if ("is" in c) return `${c.not ? "not " : ""}${c.is}`;
  if ("rhythm" in c) return `rhythm ${c.not ? "!=" : "="} ${c.rhythm}`;
  if ("arrest" in c) return `arrest ${c.not ? "!=" : "="} ${c.arrest}`;
  return `drug ${c.drug} ${c.op} ${c.value}`;
}
export const condsText = (cs: CondSpec[] | undefined) => (cs ?? []).map(condText).join("; ");

/** One condition from text, or an error message. */
export function parseCond(raw: string): CondSpec | string {
  const s = raw.trim();
  if (!s) return "empty condition";
  if (/\sor\s/.test(s)) {
    const parts = s.split(/\s+or\s+/).map(parseCond);
    const bad = parts.find((x) => typeof x === "string");
    return bad ? (bad as string) : { any: parts as CondSpec[] };
  }
  let m = s.match(/^(\w+)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return (NUM_FIELDS as readonly string[]).includes(m[1]) ? { num: m[1] as NumField, op: m[2] as Op, value: +m[3] } : `unknown measure '${m[1]}' (use ${NUM_FIELDS.join(", ")})`;
  m = s.match(/^drug\s+(\w+)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { drug: m[1], op: m[2] as Op, value: +m[3] };
  m = s.match(/^(rhythm|arrest)\s*(!=|=)\s*(\S+)$/);
  if (m) {
    if (m[1] === "arrest" && !(ARREST_STATES as readonly string[]).includes(m[3])) return `unknown arrest state '${m[3]}' (use ${ARREST_STATES.join(", ")})`;
    return m[1] === "rhythm" ? { rhythm: m[3], ...(m[2] === "!=" ? { not: true } : {}) } : { arrest: m[3] as (typeof ARREST_STATES)[number], ...(m[2] === "!=" ? { not: true } : {}) };
  }
  m = s.match(/^(not\s+)?(\w+)$/);
  if (m && (FLAG_FIELDS as readonly string[]).includes(m[2])) return { is: m[2] as FlagField, ...(m[1] ? { not: true } : {}) };
  return `cannot read '${s}'`;
}
/** A list of conditions separated by `;`. */
export function parseConds(raw: string): { conds: CondSpec[]; errors: string[] } {
  const conds: CondSpec[] = [], errors: string[] = [];
  for (const part of raw.split(";").map((x) => x.trim()).filter(Boolean)) { const r = parseCond(part); if (typeof r === "string") errors.push(r); else conds.push(r); }
  return { conds, errors };
}

// ---------------------------------------------------------------- checking

const ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const isCond = (c: unknown): boolean => {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.any)) return o.any.length > 0 && o.any.every(isCond);
  if ("num" in o) return (NUM_FIELDS as readonly unknown[]).includes(o.num) && (OPS as readonly unknown[]).includes(o.op) && Number.isFinite(o.value);
  if ("is" in o) return (FLAG_FIELDS as readonly unknown[]).includes(o.is);
  if ("rhythm" in o) return typeof o.rhythm === "string" && !!o.rhythm;
  if ("arrest" in o) return (ARREST_STATES as readonly unknown[]).includes(o.arrest);
  if ("drug" in o) return typeof o.drug === "string" && (OPS as readonly unknown[]).includes(o.op) && Number.isFinite(o.value);
  return false;
};

/** A draft may be unfinished; it still needs an id and a title to be listed and found again. */
export function validateDraft(s: CaseSpec): string[] {
  const errs: string[] = [];
  if (typeof s.id !== "string" || !ID.test(s.id)) errs.push("The id must be 2 to 60 lowercase letters, digits or hyphens.");
  if (typeof s.title !== "string" || !s.title.trim()) errs.push("The case needs a title.");
  return errs;
}

/** Everything wrong with a spec, as sentences for the person editing it (an empty list means it can be saved). */
export function validateCase(s: CaseSpec): string[] {
  const errs: string[] = [];
  const need = (ok: unknown, msg: string) => { if (!ok) errs.push(msg); };
  need(typeof s.id === "string" && ID.test(s.id), "The id must be 2 to 60 lowercase letters, digits or hyphens.");
  need(typeof s.title === "string" && s.title.trim(), "The case needs a title.");
  need(["easy", "medium", "hard"].includes(s.tier), "The difficulty must be easy, medium or hard.");
  need(typeof s.blurb === "string", "The case needs a one-line summary.");
  need(s.card && typeof s.card.presents === "string" && s.card.presents.trim(), "The patient card needs a presentation.");
  need(s.card && typeof s.card.pmh === "string", "The patient card needs a history line (it may be short).");
  need(Number.isFinite(s.limitS) && s.limitS >= 30 && s.limitS <= 7200, "The time limit must be between 30 seconds and 2 hours.");
  need(s.points && ["survive", "stable", "harm"].every((k) => Number.isFinite((s.points as Record<string, number>)[k]) && (s.points as Record<string, number>)[k] >= 0), "Points for surviving, staying stable and harm must be numbers of zero or more.");
  need(Array.isArray(s.checkpoints) && s.checkpoints.length > 0, "The case needs at least one time point.");
  const warn = (where: string, p: unknown) => { if (p) for (const w of normalizePatient(p as never).warnings) errs.push(`${where}: ${w}.`); };
  warn("Starting patient", s.start);
  const seen = new Set<string>(), setFlags = new Set<string>(), usedFlags: [string, string][] = [];
  const outcome = (where: string, o: Outcome | undefined) => {
    if (!o) return;
    warn(where, o.patch);
    for (const f of o.flags ?? []) setFlags.add(f);
    if (o.end && o.end !== "success" && o.end !== "fail") errs.push(`${where}: end must be success or fail.`);
    if (o.order && o.order !== "pci") errs.push(`${where}: the only order is pci.`);
    if (o.shock) { need(o.shock.joules > 0, `${where}: a shock needs joules above zero.`); outcome(`${where} (shock works)`, o.shock.onSuccess); outcome(`${where} (shock fails)`, o.shock.onFail); }
  };
  for (const c of s.checkpoints ?? []) {
    const w = `Time point '${c?.id}'`;
    if (!c || typeof c.id !== "string" || !c.id) { errs.push("Every time point needs an id."); continue; }
    if (seen.has(c.id)) errs.push(`${w} appears twice.`); seen.add(c.id);
    need(c.atS !== undefined || c.when?.length || c.requires?.length, `${w} has no trigger: give it a time, a condition or a required flag, or it fires at once.`);
    if (c.atS !== undefined) need(Number.isFinite(c.atS) && c.atS >= 0, `${w}: the time must be zero or more.`);
    for (const x of c.when ?? []) need(isCond(x), `${w}: a condition is not valid.`);
    need(c.prompt || c.outcome, `${w} does nothing: add a question or an outcome.`);
    for (const f of [...(c.requires ?? []), ...(c.forbids ?? [])]) usedFlags.push([w, f]);
    outcome(w, c.outcome);
    if (c.prompt) {
      need(c.prompt.text?.trim(), `${w}: the question needs text.`);
      need(c.prompt.options?.length >= 2, `${w}: a question needs at least two options.`);
      (c.prompt.options ?? []).forEach((o, i) => { need(o.label?.trim(), `${w}: option ${i + 1} needs a label.`); outcome(`${w}, option ${i + 1}`, o.outcome); });
    }
  }
  for (const [w, f] of usedFlags) if (!setFlags.has(f)) errs.push(`${w} depends on flag '${f}', which nothing sets.`);
  for (const m of s.musts ?? []) if (!setFlags.has(m.flag)) errs.push(`Required step '${m.flag}' is never set by any outcome.`);
  for (const m of s.monitor ?? []) need(itemById(m), `The monitor lists '${m}', which is not an orderable item.`);
  for (const x of s.stable ?? []) need(isCond(x), "A 'stable' condition is not valid.");
  for (const h of s.harms ?? []) { need(h.tag && h.label, "A harm needs a tag and a label."); for (const x of h.when ?? []) need(isCond(x), `Harm '${h.tag}': a condition is not valid.`); }
  return errs;
}
