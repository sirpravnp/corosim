import type { Option, Outcome, ShockOrder } from "./engine";
import { CaseSpec, condText, condsText, parseConds, validateCase } from "./spec";

/**
 * A case as a plain text document, to write offline and upload, or to download from the builder and edit. It is read by rules, not by a model:
 * the headings and `- key: value` lines below are the whole format, and anything it cannot read is reported with its line number.
 * `caseToMarkdown` and `parseCaseMarkdown` are inverses.
 *
 *   # Title
 *   - id: anterior-stemi            - difficulty: easy | medium | hard      - complaint: Chest pain
 *   - devices: ECMO, Impella        - summary: one line                     - time limit: 15:00
 *   - points: survive 30, stable 25, harm 20                                - skip harms: beta blocker, diuretic
 *   ## Card                (Presents:, History:, Info: and bullets)
 *   ## Starting patient    (a ```json block: the patient the case opens with)
 *   ## Opening             (- rhythm: vf-coarse, - cpr: on, - drug: epinephrine 1)
 *   ## Required steps      (- flag: what the learner should do)
 *   ## Stable while        (- map >= 60)
 *   ## Harms               (- tag: label | condition; condition)
 *   ## Time points         (### id, then - at, when, for, requires, forbids, repeat, branch, news, patch, flags, order, cpr, shock, end, question)
 */

export const TEMPLATE_NOTE = "Fill in the blanks; delete any line you do not need.";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** `0:05`, `90s`, `1m30s` or a bare number of seconds. */
export function parseDuration(raw: string): number | undefined {
  const s = raw.trim();
  let m = s.match(/^(\d+):(\d{1,2})$/); if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(?:(\d+)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s?)?$/); if (m && (m[1] || m[2])) return +(m[1] ?? 0) * 60 + +(m[2] ?? 0);
  return undefined;
}
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const yes = (s: string) => /^(yes|true|on|y)$/i.test(s.trim());

// ---------------------------------------------------------------- writing

function outcomeLines(o: Outcome | undefined, pad: string): string[] {
  if (!o) return [];
  const out: string[] = [];
  for (const r of o.reveal ?? []) out.push(`${pad}- news: ${r}`);
  if (o.patch) out.push(`${pad}- patch: ${JSON.stringify(o.patch)}`);
  if (o.flags?.length) out.push(`${pad}- flags: ${o.flags.join(", ")}`);
  if (o.order) out.push(`${pad}- order: ${o.order}`);
  if (o.cpr !== undefined) out.push(`${pad}- cpr: ${o.cpr ? "on" : "off"}`);
  if (o.shock) out.push(`${pad}- shock: ${JSON.stringify(o.shock)}`);
  if (o.end) out.push(`${pad}- end: ${o.end}`);
  return out;
}

export function caseToMarkdown(s: CaseSpec): string {
  const L: string[] = [`# ${s.title}`, ""];
  L.push(`- id: ${s.id}`, `- difficulty: ${s.tier}`);
  if (s.complaint) L.push(`- complaint: ${s.complaint}`);
  if (s.devices?.length) L.push(`- devices: ${s.devices.join(", ")}`);
  L.push(`- summary: ${s.blurb}`, `- time limit: ${clock(s.limitS)}`, `- points: survive ${s.points.survive}, stable ${s.points.stable}, harm ${s.points.harm}`);
  if (s.skipHarms?.length) L.push(`- skip harms: ${s.skipHarms.join(", ")}`);
  L.push("", "## Card", "", `Presents: ${s.card.presents}`, `History: ${s.card.pmh}`);
  if (s.card.info?.length) { L.push("Info:"); for (const i of s.card.info) L.push(`- ${i}`); }
  L.push("", "## Starting patient", "", "```json", JSON.stringify(s.start ?? {}, null, 2), "```");
  const op = s.opening;
  if (op && (op.rhythm || op.cpr || op.drugs?.length)) {
    L.push("", "## Opening", "");
    if (op.rhythm) L.push(`- rhythm: ${op.rhythm}`);
    if (op.cpr) L.push("- cpr: on");
    for (const d of op.drugs ?? []) L.push(`- drug: ${d.drug} ${d.mg}`);
  }
  if (s.musts?.length) { L.push("", "## Required steps", ""); for (const m of s.musts) L.push(`- ${m.flag}: ${m.label}`); }
  if (s.stable?.length) { L.push("", "## Stable while", ""); for (const c of s.stable) L.push(`- ${condText(c)}`); }
  if (s.harms?.length) { L.push("", "## Harms", ""); for (const h of s.harms) L.push(`- ${h.tag}: ${h.label} | ${condsText(h.when)}`); }
  L.push("", "## Time points");
  for (const c of s.checkpoints) {
    L.push("", `### ${c.id}`, "");
    if (c.atS !== undefined) L.push(`- at: ${clock(c.atS)}`);
    if (c.when?.length) L.push(`- when: ${condsText(c.when)}`);
    if (c.forS) L.push(`- for: ${c.forS}s`);
    if (c.requires?.length) L.push(`- requires: ${c.requires.join(", ")}`);
    if (c.forbids?.length) L.push(`- forbids: ${c.forbids.join(", ")}`);
    if (c.repeatAfterS !== undefined) L.push(`- repeat: ${c.repeatAfterS}s`);
    if (c.branch) L.push("- branch: yes");
    L.push(...outcomeLines(c.outcome, ""));
    if (c.prompt) {
      L.push(`- question: ${c.prompt.text}`);
      for (const o of c.prompt.options) {
        const pts = o.points ?? 0, tag = `${pts >= 0 ? "+" : ""}${pts}${o.correct === true ? " correct" : o.correct === false ? " wrong" : ""}`;
        L.push(`  - [${tag}] ${o.label}`);
        if (o.why) L.push(`    - why: ${o.why}`);
        L.push(...outcomeLines(o.outcome, "    "));
      }
    }
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------- reading

interface Line { n: number; text: string }
type Fail = (n: number, msg: string) => void;

function applyOutcome(o: Outcome, key: string, val: string, n: number, fail: Fail): boolean {
  const json = (): unknown => { try { return JSON.parse(val); } catch { fail(n, `'${key}' needs valid JSON after the colon`); return undefined; } };
  switch (key) {
    case "news": (o.reveal ??= []).push(val); return true;
    case "patch": { const j = json(); if (j) o.patch = j as never; return true; }
    case "flags": o.flags = [...(o.flags ?? []), ...list(val)]; return true;
    case "order": if (val === "pci") o.order = "pci"; else fail(n, "the only order is pci"); return true;
    case "cpr": o.cpr = yes(val); return true;
    case "shock": { const j = json(); if (j) o.shock = j as ShockOrder; return true; }
    case "end": if (val === "success" || val === "fail") o.end = val; else fail(n, "end must be success or fail"); return true;
  }
  return false;
}
const empty = (o: Outcome) => Object.keys(o).length === 0;

/** `errors` are things the format could not read (no case comes back); `warnings` are what a readable case still needs before it can be saved. */
export function parseCaseMarkdown(text: string): { spec?: CaseSpec; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const fail: Fail = (n, msg) => errors.push(n ? `Line ${n}: ${msg}.` : `${msg}.`);
  const lines: Line[] = text.replace(/\r\n?/g, "\n").split("\n").map((t, i) => ({ n: i + 1, text: t }));

  // split into ## sections (the code block in "Starting patient" may contain anything, so fences are tracked)
  const sections: { name: string; at: number; body: Line[] }[] = [{ name: "", at: 1, body: [] }];
  let title = "", fence = false;
  for (const l of lines) {
    if (/^```/.test(l.text.trim())) fence = !fence;
    const h = !fence && l.text.match(/^(#{1,3})\s+(.*)$/);
    if (h && h[1] === "#" ) { if (!title) title = h[2].trim(); else fail(l.n, "there is more than one title ('# ') line"); continue; }
    if (h && h[1] === "##") { sections.push({ name: h[2].trim().toLowerCase(), at: l.n, body: [] }); continue; }
    sections[sections.length - 1].body.push(l);
  }
  const sec = (name: string) => sections.find((s) => s.name === name);
  const bullets = (b: Line[]) => b.filter((l) => l.text.trim()).map((l) => ({ n: l.n, text: l.text.trim().replace(/^-\s+/, ""), raw: l.text }));
  const kv = (s: string) => { const i = s.indexOf(":"); return i < 0 ? undefined : { k: s.slice(0, i).trim().toLowerCase(), v: s.slice(i + 1).trim() }; };

  const spec: Partial<CaseSpec> & { card: CaseSpec["card"]; points: CaseSpec["points"] } = { title, card: { presents: "", pmh: "" }, points: { survive: 30, stable: 25, harm: 20 } } as never;
  spec.limitS = 900;

  // header
  for (const b of bullets(sections[0].body)) {
    const p = kv(b.text); if (!p) { fail(b.n, `cannot read '${b.text}' (use '- key: value')`); continue; }
    switch (p.k) {
      case "id": spec.id = p.v; break;
      case "difficulty": spec.tier = p.v.toLowerCase() as never; break;
      case "complaint": spec.complaint = p.v; break;
      case "devices": spec.devices = list(p.v); break;
      case "summary": spec.blurb = p.v; break;
      case "time limit": { const d = parseDuration(p.v); if (d === undefined) fail(b.n, `cannot read the time limit '${p.v}' (try 15:00)`); else spec.limitS = d; break; }
      case "points": { const o: Record<string, number> = {}; for (const part of list(p.v)) { const m = part.match(/^(survive|stable|harm)\s+(\d+)$/); if (m) o[m[1]] = +m[2]; else fail(b.n, `cannot read points '${part}' (try 'survive 30')`); } spec.points = { ...spec.points, ...o }; break; }
      case "skip harms": spec.skipHarms = list(p.v); break;
      default: fail(b.n, `unknown setting '${p.k}'`);
    }
  }
  if (!title) fail(0, "The document needs a title line starting with '# '");
  if (!spec.id) fail(0, "The header needs '- id: some-short-name'");
  if (!spec.blurb) { spec.blurb = ""; }

  // card
  const card = sec("card");
  if (!card) fail(0, "The document needs a '## Card' section");
  else {
    let into: "info" | "" = "";
    for (const l of card.body) {
      const t = l.text.trim(); if (!t) continue;
      if (/^presents:/i.test(t)) { spec.card.presents = t.replace(/^presents:\s*/i, ""); into = ""; }
      else if (/^history:/i.test(t)) { spec.card.pmh = t.replace(/^history:\s*/i, ""); into = ""; }
      else if (/^info:\s*$/i.test(t)) { into = "info"; spec.card.info = []; }
      else if (into === "info" && t.startsWith("- ")) spec.card.info!.push(t.slice(2).trim());
      else fail(l.n, `cannot read '${t}' in the card (use 'Presents:', 'History:', or 'Info:' with bullets)`);
    }
  }

  // starting patient
  const start = sec("starting patient");
  if (start) {
    const src = start.body.map((l) => l.text).join("\n").replace(/^[\s\S]*?```(?:json)?\s*\n/, "").replace(/\n```[\s\S]*$/, "");
    try { spec.start = src.trim() ? JSON.parse(src) : {}; } catch (e) { fail(start.at, `the starting patient is not valid JSON (${(e as Error).message})`); }
  } else spec.start = {};

  // opening
  const opening = sec("opening");
  if (opening) {
    const op: NonNullable<CaseSpec["opening"]> = {};
    for (const b of bullets(opening.body)) {
      const p = kv(b.text); if (!p) { fail(b.n, `cannot read '${b.text}'`); continue; }
      if (p.k === "rhythm") op.rhythm = p.v;
      else if (p.k === "cpr") op.cpr = yes(p.v);
      else if (p.k === "drug") { const m = p.v.match(/^(epinephrine|amiodarone|lidocaine)\s+(\d+(?:\.\d+)?)(?:\s*mg)?$/); if (m) (op.drugs ??= []).push({ drug: m[1] as never, mg: +m[2] }); else fail(b.n, "a drug line looks like 'drug: epinephrine 1'"); }
      else fail(b.n, `unknown opening setting '${p.k}'`);
    }
    spec.opening = op;
  }

  const musts = sec("required steps");
  if (musts) spec.musts = bullets(musts.body).flatMap((b) => { const p = kv(b.text); if (!p) { fail(b.n, `cannot read '${b.text}' (use '- flag: what to do')`); return []; } return [{ flag: b.text.slice(0, b.text.indexOf(":")).trim(), label: p.v }]; });

  const stable = sec("stable while");
  if (stable) { const cs = parseConds(bullets(stable.body).map((b) => b.text).join(";")); spec.stable = cs.conds; for (const e of cs.errors) fail(stable.at, e); }

  const harms = sec("harms");
  if (harms) {
    spec.harms = [];
    for (const b of bullets(harms.body)) {
      const m = b.text.match(/^([^:]+):\s*(.*?)\s*\|\s*(.*)$/);
      if (!m) { fail(b.n, "a harm looks like '- tag: label | condition; condition'"); continue; }
      const c = parseConds(m[3]); for (const e of c.errors) fail(b.n, e);
      spec.harms.push({ tag: m[1].trim(), label: m[2].trim(), when: c.conds });
    }
  }

  // time points
  const tp = sec("time points");
  spec.checkpoints = [];
  if (!tp) fail(0, "The document needs a '## Time points' section");
  else {
    type CP = CaseSpec["checkpoints"][number];
    let cur: CP | undefined, outc: Outcome = {}, opt: Option | undefined, optOut: Outcome = {};
    const closeOpt = () => { if (opt) { if (!empty(optOut)) opt.outcome = optOut; } opt = undefined; optOut = {}; };
    const closeCp = () => { closeOpt(); if (cur && !cur.prompt && !empty(outc)) cur.outcome = outc; cur = undefined; outc = {}; };
    for (const l of tp.body) {
      const t = l.text;
      if (!t.trim()) continue;
      const h = t.match(/^###\s+(.+)$/);
      if (h) { closeCp(); cur = { id: h[1].trim() }; spec.checkpoints.push(cur); continue; }
      const m = t.match(/^(\s*)-\s+(.*)$/);
      if (!m) { fail(l.n, `cannot read '${t.trim()}'`); continue; }
      if (!cur) { fail(l.n, "a time point's settings must come after a '### id' heading"); continue; }
      const depth = Math.floor(m[1].length / 2), body = m[2];
      if (depth === 0) {
        const p = kv(body); if (!p) { fail(l.n, `cannot read '${body}'`); continue; }
        if (applyOutcome(outc, p.k, p.v, l.n, fail)) continue;
        switch (p.k) {
          case "at": { const d = parseDuration(p.v); if (d === undefined) fail(l.n, `cannot read the time '${p.v}' (try 0:05)`); else cur.atS = d; break; }
          case "when": { const c = parseConds(p.v); cur.when = c.conds; for (const e of c.errors) fail(l.n, e); break; }
          case "for": { const d = parseDuration(p.v); if (d === undefined) fail(l.n, `cannot read '${p.v}' (try 20s)`); else cur.forS = d; break; }
          case "requires": cur.requires = list(p.v); break;
          case "forbids": cur.forbids = list(p.v); break;
          case "repeat": { const d = parseDuration(p.v); if (d === undefined) fail(l.n, `cannot read '${p.v}' (try 40s)`); else cur.repeatAfterS = d; break; }
          case "branch": cur.branch = yes(p.v); break;
          case "question": cur.prompt = { text: p.v, options: [] }; closeOpt(); break;
          default: fail(l.n, `unknown time point setting '${p.k}'`);
        }
      } else if (depth === 1) {
        const o = body.match(/^\[([+-]?\d+)(?:\s+(correct|wrong))?\]\s+(.*)$/);
        if (!o || !cur.prompt) { fail(l.n, cur.prompt ? "an option looks like '- [+10 correct] text'" : "options must come after a '- question:' line"); continue; }
        closeOpt();
        opt = { label: o[3].trim(), points: +o[1], ...(o[2] ? { correct: o[2] === "correct" } : {}) };
        cur.prompt.options.push(opt);
      } else {
        if (!opt) { fail(l.n, "this line belongs under an option"); continue; }
        const p = kv(body); if (!p) { fail(l.n, `cannot read '${body}'`); continue; }
        if (p.k === "why") opt.why = p.v;
        else if (!applyOutcome(optOut, p.k, p.v, l.n, fail)) fail(l.n, `unknown option setting '${p.k}'`);
      }
    }
    closeCp();
  }

  if (errors.length) return { errors, warnings: [] };
  // Read cleanly: the case opens in the builder either way; what the checks find is for the author to fix before saving.
  return { spec: spec as CaseSpec, errors, warnings: validateCase(spec as CaseSpec) };
}
