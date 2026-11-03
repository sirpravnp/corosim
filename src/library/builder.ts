import type { Option, Outcome } from "../cases/engine";
import { CaseSpec, condsText, parseConds, validateCase } from "../cases/spec";
import { caseToMarkdown, parseDuration } from "../cases/markdown";
import { CHANGE_PRESETS, START_PRESETS, Preset, mergePatch } from "./presets";
import { deleteSpec, playUrl, saveSpec, setPreview } from "./api";

/**
 * The case builder: a form over a `CaseSpec`. Every field is bound by a path (`data-p="checkpoints.1.prompt.text"`) and a kind (`data-t`), so typing
 * edits the spec in place without redrawing; adding, removing and moving things redraw. The spec on screen is the same JSON the server stores and the
 * engine runs, so Test plays exactly what Publish would put in front of everyone.
 */
export interface BuilderOptions {
  spec: CaseSpec; isNew: boolean; notes: string[];
  existing: () => string[];
  close: (changed: boolean) => void | Promise<void>;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function blankCase(taken: string[]): CaseSpec {
  let n = 1; while (taken.includes(`new-case-${n}`)) n++;
  return {
    id: `new-case-${n}`, title: "", tier: "easy", blurb: "", complaint: "", devices: [],
    card: { presents: "", pmh: "" }, start: {}, points: { survive: 30, stable: 25, harm: 20 }, limitS: 900,
    checkpoints: [],
  };
}
/** An imported or half-written draft may lack parts the form expects. */
function fill(s: CaseSpec): CaseSpec {
  s.card ??= { presents: "", pmh: "" }; s.start ??= {}; s.checkpoints ??= [];
  s.points = s.points ?? { survive: 30, stable: 25, harm: 20 }; s.limitS ??= 900; s.tier ??= "easy"; s.blurb ??= "";
  return s;
}

type Kind = "text" | "opt" | "num" | "list" | "lines" | "json" | "bool" | "dur" | "conds" | "sel" | "tri" | "musts" | "harms" | "drugs" | "int" | "tri2";
type Obj = Record<string, unknown>;

function getAt(root: unknown, path: string[]): unknown { return path.reduce<unknown>((o, k) => (o as Obj | undefined)?.[k], root); }
function setAt(root: Obj, path: string[], v: unknown) {
  let o = root as Obj;
  for (let i = 0; i < path.length - 1; i++) o = (o[path[i]] ??= /^\d+$/.test(path[i + 1]) ? [] : {}) as Obj;
  const last = path[path.length - 1];
  if (v === undefined) { if (Array.isArray(o)) o.splice(+last, 1); else delete o[last]; } else o[last] = v;
}

export function openBuilder(host: HTMLElement, opt: BuilderOptions) {
  const spec = fill(JSON.parse(JSON.stringify(opt.spec)) as CaseSpec);
  let dirty = opt.isNew && !!opt.notes.length, saved = !opt.isNew, idAuto = opt.isNew && !spec.title, changed = false;
  const openTp = new Set<string>(), openOpt = new Set<string>();
  const invalid = new Set<string>(); // fields whose text could not be read
  let busy = "", problems: string[] = [], toast = "", popup: { cp: number } | null = null;

  const field = (label: string, p: string, kind: Kind, extra = "", hint = "") => `<label class="f ${kind === "text" || kind === "opt" || kind === "lines" || kind === "json" || kind === "musts" || kind === "harms" ? "wide" : ""}"><span>${label}</span>${input(p, kind, extra)}${hint ? `<small>${hint}</small>` : ""}</label>`;
  function read(p: string, kind: Kind): string {
    const v = getAt(spec, p.split("."));
    switch (kind) {
      case "list": return Array.isArray(v) ? v.join(", ") : "";
      case "lines": return Array.isArray(v) ? v.join("\n") : "";
      case "json": return v === undefined ? "" : JSON.stringify(v, null, 2);
      case "dur": return typeof v === "number" ? clock(v) : "";
      case "conds": return condsText(v as never);
      case "musts": return Array.isArray(v) ? v.map((m: { flag: string; label: string }) => `${m.flag}: ${m.label}`).join("\n") : "";
      case "harms": return Array.isArray(v) ? v.map((h: { tag: string; label: string; when: never }) => `${h.tag}: ${h.label} | ${condsText(h.when)}`).join("\n") : "";
      case "drugs": return Array.isArray(v) ? v.map((d: { drug: string; mg: number }) => `${d.drug} ${d.mg}`).join("; ") : "";
      case "tri": return v === true ? "correct" : v === false ? "wrong" : "";
      case "tri2": return v === true ? "on" : v === false ? "off" : "";
      default: return v === undefined || v === null ? "" : String(v);
    }
  }
  function input(p: string, kind: Kind, extra: string): string {
    const val = read(p, kind), bad = invalid.has(p) ? ' aria-invalid="true"' : "", at = `data-p="${p}" data-t="${kind}"${bad}`;
    if (kind === "bool") return `<input type="checkbox" ${at} ${getAt(spec, p.split(".")) ? "checked" : ""}>`;
    if (kind === "sel") return `<select ${at}>${extra.split("|").map((o) => { const [v, l] = o.split("="); return `<option value="${v}" ${v === val ? "selected" : ""}>${l ?? v}</option>`; }).join("")}</select>`;
    if (kind === "tri2") return `<select ${at}>${[["", "Unchanged"], ["on", "Start"], ["off", "Stop"]].map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    if (kind === "tri") return `<select ${at}>${[["", "Not graded"], ["correct", "Correct"], ["wrong", "Wrong"]].map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    if (kind === "lines" || kind === "json" || kind === "musts" || kind === "harms" || kind === "opt" || kind === "text" && extra === "area") return `<textarea ${at} rows="${kind === "json" ? 5 : 2}" spellcheck="${kind === "json" ? "false" : "true"}">${esc(val)}</textarea>`;
    if (kind === "num" || kind === "int") return `<input type="number" step="any" ${at} value="${esc(val)}" ${extra}>`;
    return `<input type="text" ${at} value="${esc(val)}" ${extra}>`;
  }

  // ---------------------------------------------------------------- pieces
  const presetSelect = (target: string, presets: Preset[], label: string) =>
    `<select class="preset" data-preset="${target}"><option value="">${label}</option>${presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("")}</select>`;
  const presetList = (target: string) => (target === "start" ? START_PRESETS : CHANGE_PRESETS);

  function outcomeBlock(base: string, label: string): string {
    const o = (getAt(spec, base.split(".")) ?? {}) as Outcome;
    return `<div class="out"><h5>${label}</h5>
      ${field("News shown to the learner", `${base}.reveal`, "lines", "", "One line per message.")}
      <div class="f wide"><span>Change the patient</span><div class="presetrow">${presetSelect(`${base}.patch`, CHANGE_PRESETS, "Add a change…")}<button type="button" data-act="clearpatch" data-p="${base}.patch">Clear</button></div>${input(`${base}.patch`, "json", "")}</div>
      <div class="f2">
        ${field("Flags set", `${base}.flags`, "list", "", "Names later time points can require.")}
        ${field("Ends the case", `${base}.end`, "sel", "=Continues|success=Success|fail=Fail")}
        ${field("Chest compressions", `${base}.cpr`, "tri2")}
        <label class="f chk"><input type="checkbox" data-p="${base}.order" data-t="order" ${o.order ? "checked" : ""}><span>Order primary PCI</span></label>
      </div></div>`;
  }

  function optionBlock(ci: number, oi: number, o: Option): string {
    const base = `checkpoints.${ci}.prompt.options.${oi}`, key = `${ci}.${oi}`;
    const sign = (o.points ?? 0) > 0 ? "plus" : (o.points ?? 0) < 0 ? "minus" : "";
    return `<li class="opt"><div class="opt-head"><span class="pts ${sign}">${(o.points ?? 0) > 0 ? "+" : ""}${o.points ?? 0}</span><span class="grade">${o.correct === true ? "Correct" : o.correct === false ? "Wrong" : "Not graded"}</span>
        <span class="grow"></span><button type="button" data-act="optup" data-ci="${ci}" data-oi="${oi}" aria-label="Move option up">Up</button><button type="button" data-act="optdown" data-ci="${ci}" data-oi="${oi}" aria-label="Move option down">Down</button><button type="button" data-act="optdel" data-ci="${ci}" data-oi="${oi}">Remove</button></div>
      <div class="f3">${field("Answer shown", `${base}.label`, "opt")}${field("Points", `${base}.points`, "num")}${field("Graded as", `${base}.correct`, "tri")}</div>
      ${field("Why (the teaching point in the debrief)", `${base}.why`, "opt")}
      <details data-open="o${key}" ${openOpt.has(key) ? "open" : ""}><summary>What happens after this answer</summary>${outcomeBlock(`${base}.outcome`, "Then")}</details></li>`;
  }

  function triggerLabel(c: CaseSpec["checkpoints"][number]): string {
    const bits: string[] = [];
    if (c.atS !== undefined) bits.push(clock(c.atS));
    if (c.when?.length) bits.push(condsText(c.when) + (c.forS ? ` for ${c.forS}s` : ""));
    if (c.requires?.length) bits.push(`after ${c.requires.join(", ")}`);
    return bits.join(" · ") || "no trigger";
  }
  function kindOf(c: CaseSpec["checkpoints"][number]) { return c.prompt ? "Question" : c.outcome?.end ? "Ending" : c.outcome?.patch || c.outcome?.shock ? "Patient change" : "News"; }

  function timepoint(ci: number): string {
    const c = spec.checkpoints[ci], base = `checkpoints.${ci}`;
    const q = c.prompt;
    return `<li class="tp"><details data-open="t${c.id}" ${openTp.has(c.id) ? "open" : ""}>
      <summary><span class="when">${esc(triggerLabel(c))}</span><span class="kind">${kindOf(c)}</span><span class="what">${esc(q?.text || c.outcome?.reveal?.[0] || c.id)}</span></summary>
      <div class="tp-body">
        <div class="tp-tools"><button type="button" data-act="tpup" data-ci="${ci}">Move up</button><button type="button" data-act="tpdown" data-ci="${ci}">Move down</button><button type="button" data-act="tpdup" data-ci="${ci}">Duplicate</button><button type="button" data-act="tpdel" data-ci="${ci}">Remove</button></div>
        <h4>When it happens</h4>
        <div class="f3">${field("Name", `${base}.id`, "text", "", "A short label for this point.")}${field("At time (m:ss)", `${base}.atS`, "dur", 'placeholder="0:05"')}${field("Repeats every (seconds)", `${base}.repeatAfterS`, "int", 'placeholder="once"')}</div>
        ${field("Only when (all must hold)", `${base}.when`, "conds", 'placeholder="map < 62; not pci"', "Measures: map, hr, ef, lvIschemia, rvIschemia, congestion, fluidsL, shocks, epiDoses, amioMg, lidoDoses. Also pci, pciPending, cpr, ecmo, impella, iabp, dead, rhythm = vf, arrest = rosc, drug betaBlocker &gt; 0.1. Join alternatives with “or”.")}
        <div class="f3">${field("…held for (seconds)", `${base}.forS`, "int")}${field("Requires flags", `${base}.requires`, "list")}${field("Skipped once flagged", `${base}.forbids`, "list")}</div>
        <label class="f chk"><input type="checkbox" data-p="${base}.branch" data-t="bool" ${c.branch ? "checked" : ""}><span>Only after a wrong turn (not counted in the best possible score)</span></label>
        <h4>What happens</h4>
        <div class="seg" role="group" aria-label="Kind of time point"><button type="button" data-act="kind" data-ci="${ci}" data-k="news" aria-pressed="${!q}">News or a change in the patient</button><button type="button" data-act="kind" data-ci="${ci}" data-k="question" aria-pressed="${!!q}">Question popup</button></div>
        ${q ? `${field("The question", `${base}.prompt.text`, "opt")}
          <ol class="opts">${q.options.map((o, oi) => optionBlock(ci, oi, o)).join("")}</ol>
          <div class="row"><button type="button" data-act="optadd" data-ci="${ci}">Add an answer</button><button type="button" data-act="popup" data-ci="${ci}">Preview the popup</button></div>`
        : outcomeBlock(`${base}.outcome`, "Outcome")}
      </div></details></li>`;
  }

  function sections(): string {
    const t = spec.checkpoints.map((c, i) => ({ c, i })).sort((a, b) => (a.c.atS ?? 1e9) - (b.c.atS ?? 1e9) || a.i - b.i);
    const sorted = t.map((x) => x.i).join() === spec.checkpoints.map((_, i) => i).join();
    return `
    <section class="bs"><h2>Details</h2>
      <div class="f3">${field("Title", "title", "text")}${field("Id", "id", "text", saved ? "disabled" : "", "The address of the case. Fixed once saved.")}${field("Difficulty", "tier", "sel", "easy=Easy|medium=Medium|hard=Hard")}</div>
      <div class="f3">${field("Chief complaint", "complaint", "text", 'placeholder="Chest pain"', "Cases are grouped by this on the Cases page.")}${field("Devices", "devices", "list", 'placeholder="ECMO, Impella"', "Comma separated.")}${field("Time limit (m:ss)", "limitS", "dur")}</div>
      ${field("One-line summary", "blurb", "text", "", "Shown in the case list.")}
    </section>
    <section class="bs"><h2>Patient card</h2>
      ${field("Presents", "card.presents", "opt", "", "What the learner reads first: age, story, vitals.")}
      ${field("History", "card.pmh", "opt")}
      ${field("Known findings", "card.info", "lines", "", "One line each, for example the ECG.")}
    </section>
    <section class="bs"><h2>Starting patient</h2>
      <div class="f wide"><div class="presetrow">${presetSelect("start", START_PRESETS, "Add a preset…")}<button type="button" data-act="clearpatch" data-p="start">Clear</button></div>${input("start", "json", "")}<small>The simulator patient the case opens with. Presets merge into it; the JSON can be edited directly.</small></div>
      <details ${spec.opening ? "open" : ""}><summary>The team has already done something (opening moves)</summary>
        <div class="f3">${field("Rhythm", "opening.rhythm", "text", 'placeholder="vf-coarse"')}${field("Drugs given (drug mg; …)", "opening.drugs", "drugs", 'placeholder="epinephrine 1; amiodarone 150"')}<label class="f chk"><input type="checkbox" data-p="opening.cpr" data-t="bool" ${spec.opening?.cpr ? "checked" : ""}><span>CPR in progress</span></label></div></details>
    </section>
    <section class="bs"><h2>Time points</h2>
      <p class="hint">The case runs on its own clock. A question popup pauses it until answered. ${sorted ? "" : "Time points are checked in this order when several come due together."}</p>
      <ol class="timeline">${spec.checkpoints.map((_, i) => timepoint(i)).join("") || `<li class="none">No time points yet.</li>`}</ol>
      <div class="row"><button type="button" data-act="tpadd" data-k="question">Add a question</button><button type="button" data-act="tpadd" data-k="news">Add news or a patient change</button></div>
    </section>
    <section class="bs"><h2>Scoring</h2>
      <div class="f3">${field("Points for surviving", "points.survive", "num")}${field("Points for staying stable", "points.stable", "num")}${field("Points lost to harm", "points.harm", "num")}</div>
      ${field("Steps the learner should have taken", "musts", "musts", "", "One per line: flag: what to do. Listed in the debrief if the flag was never set.")}
      <details><summary>Advanced: what counts as stable, and extra harms</summary>
        ${field("Stable while", "stable", "conds", 'placeholder="map >= 60; arrest != arrest"', "Default: pressure of 60 or more and not in arrest.")}
        ${field("Harms particular to this case", "harms", "harms", "", "One per line: tag: label | condition. Time spent in a harm lowers the score.")}
        ${field("Standard harms that do not apply", "skipHarms", "list", "", "By tag: vasodilator, beta blocker, catecholamine, pure vasoconstrictor, diuretic, calcium channel blocker, dual AV-nodal blockade, fluid into congestion.")}
      </details>
    </section>`;
  }

  function head(): string {
    const pub = !!spec.published;
    return `<div class="bar"><button type="button" data-act="back">Back to the cases</button><h1>${esc(spec.title || "Untitled case")} <small class="state">${pub ? "Published" : "Draft"}${dirty ? ", unsaved changes" : ""}</small></h1>
      <div class="bar-actions"><button type="button" data-act="test">Test</button><button type="button" data-act="download">Download</button>${saved ? `<button type="button" data-act="delete">Delete</button>` : ""}${pub ? `<button type="button" data-act="unpublish">Unpublish</button>` : ""}<button type="button" data-act="save">${pub ? "Save" : "Save draft"}</button><button type="button" class="primary" data-act="publish">${pub ? "Save and keep published" : "Publish"}</button></div></div>
      <div class="notes" id="notes" role="status"></div>`;
  }

  // ---------------------------------------------------------------- drawing
  function checks() {
    problems = validateCase(spec);
    const notes = host.querySelector<HTMLElement>("#notes"); if (!notes) return;
    const list = (title: string, xs: string[]) => xs.length ? `<div><b>${title}</b><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    const fromFile = opt.notes.length && dirty ? list("From the uploaded file", opt.notes) : "";
    notes.innerHTML = `${toast ? `<p class="toast">${esc(toast)}</p>` : ""}${problems.length ? list(`To fix before it can be published (${problems.length})`, problems) : `<p class="ok">Ready to publish.</p>`}${fromFile}`;
  }
  function draw() {
    const scroll = window.scrollY;
    host.innerHTML = `${head()}<div class="form">${sections()}</div>${popup ? popupHtml() : ""}`;
    checks();
    window.scrollTo(0, scroll);
  }
  function popupHtml(): string {
    const c = spec.checkpoints[popup!.cp];
    return `<div class="pop" role="dialog" aria-modal="true" aria-label="Question preview"><div class="pop-box"><p class="pop-time">${esc(spec.title || "Case")} · ${clock(c.atS ?? 0)}</p><p class="pop-q">${esc(c.prompt?.text)}</p>
      ${(c.prompt?.options ?? []).map((o) => `<button type="button" data-act="popclose">${esc(o.label)}</button>`).join("")}<p class="hint">This is what the learner sees; the clock is held until they answer.</p></div></div>`;
  }

  // ---------------------------------------------------------------- editing the spec
  /** Keep the headings of the time points and the option badges in step with what was typed, without redrawing (which would lose the cursor). */
  function refresh() {
    host.querySelectorAll<HTMLElement>(".tp").forEach((li, i) => {
      const c = spec.checkpoints[i]; if (!c) return;
      li.querySelector(".when")!.textContent = triggerLabel(c);
      li.querySelector(".kind")!.textContent = kindOf(c);
      li.querySelector(".what")!.textContent = c.prompt?.text || c.outcome?.reveal?.[0] || c.id;
      li.querySelectorAll<HTMLElement>(".opt").forEach((ol, j) => {
        const o = c.prompt?.options[j]; if (!o) return;
        const pts = ol.querySelector<HTMLElement>(".pts")!; pts.textContent = `${(o.points ?? 0) > 0 ? "+" : ""}${o.points ?? 0}`;
        pts.className = `pts ${(o.points ?? 0) > 0 ? "plus" : (o.points ?? 0) < 0 ? "minus" : ""}`;
        ol.querySelector(".grade")!.textContent = o.correct === true ? "Correct" : o.correct === false ? "Wrong" : "Not graded";
      });
    });
  }
  const touch = () => {
    refresh();
    dirty = true; toast = "";
    const state = host.querySelector(".state"); if (state) state.textContent = `${spec.published ? "Published" : "Draft"}, unsaved changes`;
    const h1 = host.querySelector("h1"); if (h1 && h1.firstChild) h1.firstChild.textContent = (spec.title || "Untitled case") + " ";
    clearTimeout(timer); timer = setTimeout(checks, 250);
  };
  let timer: ReturnType<typeof setTimeout>;

  function convert(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, kind: string): { ok: boolean; v?: unknown } {
    const raw = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
    const s = String(raw).trim();
    switch (kind) {
      case "text": return { ok: true, v: String(raw) };
      case "opt": return { ok: true, v: String(raw) };
      case "sel": return { ok: true, v: s || undefined };
      case "bool": return { ok: true, v: raw === true ? true : undefined };
      case "order": return { ok: true, v: raw === true ? "pci" : undefined };
      case "num": case "int": { if (!s) return { ok: true, v: undefined }; const n = Number(s); return Number.isFinite(n) ? { ok: true, v: n } : { ok: false }; }
      case "list": return { ok: true, v: s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined };
      case "lines": { const xs = String(raw).split("\n").map((x) => x.trim()).filter(Boolean); return { ok: true, v: xs.length ? xs : undefined }; }
      case "json": { if (!s) return { ok: true, v: undefined }; try { const j = JSON.parse(s); return j && typeof j === "object" && !Array.isArray(j) ? { ok: true, v: j } : { ok: false }; } catch { return { ok: false }; } }
      case "dur": { if (!s) return { ok: true, v: undefined }; const d = parseDuration(s); return d === undefined ? { ok: false } : { ok: true, v: d }; }
      case "conds": { if (!s) return { ok: true, v: undefined }; const r = parseConds(s); return r.errors.length ? { ok: false } : { ok: true, v: r.conds }; }
      case "tri": return { ok: true, v: s === "correct" ? true : s === "wrong" ? false : undefined };
      case "tri2": return { ok: true, v: s === "on" ? true : s === "off" ? false : undefined };
      case "musts": { const xs = String(raw).split("\n").map((x) => x.trim()).filter(Boolean); const out = xs.map((x) => { const i = x.indexOf(":"); return i > 0 ? { flag: x.slice(0, i).trim(), label: x.slice(i + 1).trim() } : null; }); return out.includes(null) ? { ok: false } : { ok: true, v: out.length ? out : undefined }; }
      case "harms": { const xs = String(raw).split("\n").map((x) => x.trim()).filter(Boolean); const out = xs.map((x) => { const m = x.match(/^([^:]+):\s*(.*?)\s*\|\s*(.*)$/); if (!m) return null; const c = parseConds(m[3]); return c.errors.length ? null : { tag: m[1].trim(), label: m[2].trim(), when: c.conds }; }); return out.includes(null) ? { ok: false } : { ok: true, v: out.length ? out : undefined }; }
      case "drugs": { if (!s) return { ok: true, v: undefined }; const out = s.split(";").map((x) => x.trim().match(/^(epinephrine|amiodarone|lidocaine)\s+(\d+(?:\.\d+)?)$/)).map((m) => (m ? { drug: m[1], mg: +m[2] } : null)); return out.includes(null) ? { ok: false } : { ok: true, v: out }; }
    }
    return { ok: true, v: String(raw) };
  }

  /** Empty objects left behind by clearing a field do not belong in the stored case. */
  function prune() {
    for (const c of spec.checkpoints) {
      const tidy = (o: Outcome | undefined) => { if (o) for (const k of Object.keys(o) as (keyof Outcome)[]) if (Array.isArray(o[k]) && !(o[k] as unknown[]).length) delete o[k]; return o && !Object.keys(o).length ? undefined : o; };
      c.outcome = tidy(c.outcome); if (c.outcome === undefined) delete c.outcome;
      for (const op of c.prompt?.options ?? []) { op.outcome = tidy(op.outcome); if (op.outcome === undefined) delete op.outcome; }
    }
    if (spec.opening && !spec.opening.rhythm && !spec.opening.cpr && !spec.opening.drugs?.length) delete spec.opening;
  }

  host.oninput = host.onchange = (e) => {
    const el = e.target as HTMLInputElement;
    if (e.type === "input" && (el.tagName === "SELECT" || (el.type === "checkbox"))) return; // those are handled on change
    if (el.dataset.preset !== undefined) {
      const i = el.value; if (i === "") return;
      const target = el.dataset.preset, pre = presetList(target.endsWith("patch") ? "x" : target)[+i];
      const path = target === "start" ? ["start"] : target.split(".");
      setAt(spec as never, path, mergePatch(getAt(spec, path) as never, pre.patch));
      el.value = ""; touch(); draw(); return;
    }
    const p = el.dataset.p, kind = el.dataset.t; if (!p || !kind) return;
    const r = convert(el, kind);
    if (!r.ok) { invalid.add(p); el.setAttribute("aria-invalid", "true"); return; }
    invalid.delete(p); el.removeAttribute("aria-invalid");
    if (kind === "dur" && p === "limitS" && r.v === undefined) return;
    const before = getAt(spec, p.split("."));
    setAt(spec as never, p.split("."), r.v);
    if (p === "title" && idAuto) { spec.id = slug(spec.title) || spec.id; const id = host.querySelector<HTMLInputElement>('[data-p="id"]'); if (id) id.value = spec.id; }
    if (p === "id") idAuto = false;
    if (/^checkpoints\.\d+\.id$/.test(p) && openTp.delete(before as string)) openTp.add(String(r.v));
    prune(); touch();
  };

  host.addEventListener("toggle", (e) => {
    const d = e.target as HTMLDetailsElement, k = d.dataset?.open; if (!k) return;
    const set = k.startsWith("t") ? openTp : openOpt, id = k.slice(1);
    if (d.open) set.add(id); else set.delete(id);
  }, true);

  const cps = () => spec.checkpoints;
  function uniqueId(base: string) { let n = 1, id = base; const ids = new Set(cps().map((c) => c.id)); while (ids.has(id)) id = `${base}-${++n}`; return id; }
  const move = <T,>(a: T[], i: number, d: number) => { const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; };

  async function save(publish: boolean | undefined) {
    prune();
    const next = { ...spec, published: publish ?? !!spec.published } as CaseSpec;
    if (next.devices && !next.devices.length) delete next.devices;
    if (!next.complaint) delete next.complaint;
    if (next.published) { const errs = validateCase(next); if (errs.length) { toast = "It cannot be published yet; the list below says what to fix."; checks(); return; } }
    busy = "save"; const r = await saveSpec(next); busy = "";
    if (!r.ok) { toast = `Not saved: ${r.errors.join(" ")}`; checks(); return; }
    spec.published = next.published; saved = true; dirty = false; changed = true; toast = next.published ? "Saved and published. Everyone can play it." : "Saved as a draft.";
    draw();
  }

  host.onclick = async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]"); if (!b) return;
    const ci = +(b.dataset.ci ?? -1), oi = +(b.dataset.oi ?? -1), act = b.dataset.act!;
    switch (act) {
      case "back": if (dirty && !confirm("Leave without saving your changes?")) return; await opt.close(changed); return;
      case "save": await save(undefined); return;
      case "publish": await save(true); return;
      case "unpublish": await save(false); return;
      case "test": {
        prune();
        const errs = validateCase(spec);
        if (errs.length) { toast = "Fix what is listed before testing: the case has to be complete to play."; checks(); return; }
        setPreview(spec); window.open(playUrl(spec.id, true), "_blank"); return;
      }
      case "download": { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([caseToMarkdown(spec)], { type: "text/markdown" })); a.download = `${spec.id || "case"}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return; }
      case "delete": if (confirm(`Delete “${spec.title || spec.id}” for everyone? This cannot be undone.`)) { if (await deleteSpec(spec.id)) { changed = true; dirty = false; await opt.close(true); } else { toast = "The server did not delete it."; checks(); } } return;
      case "clearpatch": { const p = b.dataset.p!; setAt(spec as never, p === "start" ? ["start"] : p.split("."), p === "start" ? {} : undefined); prune(); touch(); draw(); return; }
      case "tpadd": {
        const id = uniqueId(b.dataset.k === "question" ? "question" : "news"), last = cps().reduce((m, c) => Math.max(m, c.atS ?? 0), 0);
        cps().push(b.dataset.k === "question"
          ? { id, atS: last + 10, prompt: { text: "", options: [{ label: "", points: 10, correct: true }, { label: "", points: -5, correct: false }] } }
          : { id, atS: last + 10, outcome: { reveal: [] } });
        openTp.add(id); break;
      }
      case "tpdel": cps().splice(ci, 1); break;
      case "tpup": move(cps(), ci, -1); break;
      case "tpdown": move(cps(), ci, 1); break;
      case "tpdup": { const c = JSON.parse(JSON.stringify(cps()[ci])); c.id = uniqueId(c.id); cps().splice(ci + 1, 0, c); openTp.add(c.id); break; }
      case "kind": {
        const c = cps()[ci]; if (b.dataset.k === "question" && !c.prompt) { delete c.outcome; c.prompt = { text: "", options: [{ label: "", points: 10, correct: true }, { label: "", points: -5, correct: false }] }; }
        else if (b.dataset.k === "news" && c.prompt) { delete c.prompt; c.outcome = { reveal: [] }; }
        break;
      }
      case "optadd": cps()[ci].prompt!.options.push({ label: "", points: 0 }); break;
      case "optdel": cps()[ci].prompt!.options.splice(oi, 1); break;
      case "optup": move(cps()[ci].prompt!.options, oi, -1); break;
      case "optdown": move(cps()[ci].prompt!.options, oi, 1); break;
      case "popup": popup = { cp: ci }; draw(); return;
      case "popclose": popup = null; draw(); return;
    }
    touch(); draw();
  };

  window.onbeforeunload = () => (dirty ? "You have unsaved changes." : undefined);
  draw();
}
