import "./library.css";
import { mountShell } from "../shell/shell";
import { Entry, NO_COMPLAINT, authored, builtinEntries, forgetPasscode, fromSpec, passcode, playUrl, playable, signIn } from "./api";
import { openBuilder, blankCase } from "./builder";
import { parseCaseMarkdown } from "../cases/markdown";
import { blankTemplate } from "./template";

/**
 * The Cases page: the landing for every case, filtered and grouped by difficulty, chief complaint and device. With the passcode it also becomes the
 * place to write cases (the builder, in builder.ts). Anyone can play what is listed; only the server, given the passcode, changes what is published.
 */
mountShell({ page: "cases", root: "../", share: false }).ai.setHidden(true);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TIERS = ["easy", "medium", "hard"] as const;
const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;
const NO_DEVICE = "No device";

type GroupBy = "tier" | "complaint" | "device" | "none";
const state = { entries: [] as Entry[], tier: new Set<string>(), complaint: new Set<string>(), device: new Set<string>(), q: "", group: "tier" as GroupBy, editing: false, notice: "" };

const best: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem("corosim.cases") || "{}"); } catch { return {}; } })();

// ---------------------------------------------------------------- data

async function load() {
  state.entries = await playable();
  if (state.editing) await mergeDrafts();
  render();
}
/** An editor also sees drafts, and their authored cases come from the full list rather than the published one. */
async function mergeDrafts() {
  try {
    const all = await authored();
    state.entries = [...builtinEntries(), ...all.map((s) => { try { return fromSpec(s); } catch { return undefined; } }).filter((e): e is Entry => !!e)];
  } catch (e) { state.editing = false; forgetPasscode(); state.notice = (e as Error).message; }
}

// ---------------------------------------------------------------- filtering

const facetValues = (e: Entry, f: "tier" | "complaint" | "device") => (f === "tier" ? [e.tier] : f === "complaint" ? [e.complaint] : e.devices.length ? e.devices : [NO_DEVICE]);
function matches(e: Entry, skip?: string): boolean {
  for (const f of ["tier", "complaint", "device"] as const) {
    if (f === skip) continue;
    const want = state[f];
    if (want.size && !facetValues(e, f).some((v) => want.has(v))) return false;
  }
  const q = state.q.trim().toLowerCase();
  return !q || [e.title, e.blurb, e.complaint, ...e.devices].some((x) => x.toLowerCase().includes(q));
}

function renderFacets() {
  const block = (f: "tier" | "complaint" | "device", title: string, values: string[], label = (v: string) => v) => {
    const counts = new Map<string, number>();
    for (const e of state.entries) if (matches(e, f)) for (const v of facetValues(e, f)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return `<div class="facet"><h2>${title}</h2>${values.map((v) => `<button type="button" data-f="${f}" data-v="${esc(v)}" aria-pressed="${state[f].has(v)}"><span>${esc(label(v))}</span><i>${counts.get(v) ?? 0}</i></button>`).join("")}</div>`;
  };
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const complaints = uniq(state.entries.map((e) => e.complaint));
  const devices = uniq(state.entries.flatMap((e) => facetValues(e, "device")));
  $("facets").innerHTML = block("tier", "Difficulty", [...TIERS], (v) => TIER_LABEL[v as keyof typeof TIER_LABEL]) + block("complaint", "Chief complaint", complaints) + block("device", "Device", devices);
  $("clear").hidden = !(state.tier.size || state.complaint.size || state.device.size || state.q);
}

function groups(es: Entry[]): { name: string; items: Entry[] }[] {
  if (state.group === "none") return [{ name: "", items: es }];
  const map = new Map<string, Entry[]>();
  for (const e of es) for (const v of facetValues(e, state.group)) { const k = v; (map.get(k) ?? map.set(k, []).get(k)!).push(e); }
  const names = [...map.keys()];
  if (state.group === "tier") names.sort((a, b) => TIERS.indexOf(a as never) - TIERS.indexOf(b as never));
  else names.sort((a, b) => (a === NO_DEVICE || a === NO_COMPLAINT ? 1 : b === NO_DEVICE || b === NO_COMPLAINT ? -1 : a.localeCompare(b)));
  return names.map((n) => ({ name: state.group === "tier" ? TIER_LABEL[n as keyof typeof TIER_LABEL] : n, items: map.get(n)! }));
}

const row = (e: Entry) => {
  const meta = [e.complaint === NO_COMPLAINT ? "" : e.complaint, ...e.devices].filter(Boolean).join(" · ");
  const draft = state.editing && !e.published ? `<b class="draft">Draft</b>` : "";
  const edit = state.editing && e.source === "authored" ? `<button type="button" class="edit" data-edit="${esc(e.id)}">Edit</button>` : "";
  return `<li class="case">
    <a class="open" href="${playUrl(e.id)}"><i class="tier ${e.tier}">${TIER_LABEL[e.tier]}</i><span class="t">${esc(e.title)}</span>${draft}<span class="b">${esc(e.blurb)}</span>${meta ? `<span class="m">${esc(meta)}</span>` : ""}</a>
    <span class="best">${best[e.id] !== undefined ? `best ${best[e.id]}` : ""}</span>${edit}
  </li>`;
};

function render() {
  renderFacets();
  const shown = state.entries.filter((e) => matches(e));
  $("status").textContent = state.notice || `${shown.length} of ${state.entries.length} cases`;
  const gs = groups(shown);
  $("list").innerHTML = shown.length
    ? gs.map((g) => `<section class="group">${g.name ? `<h2>${esc(g.name)} <small>${g.items.length}</small></h2>` : ""}<ul>${g.items.map(row).join("")}</ul></section>`).join("")
    : `<p class="none">No case matches. Clear a filter to see more.</p>`;
  const by = { tier: "difficulty", complaint: "chief complaint", device: "device", none: "" }[state.group];
  $("cap").textContent = shown.length ? `Table 1. The cases${state.tier.size || state.complaint.size || state.device.size || state.q ? " that match" : ""}${by ? `, grouped by ${by}` : ""}.` : "";
  for (const b of document.querySelectorAll<HTMLElement>(".groupby button")) b.setAttribute("aria-pressed", String(b.dataset.g === state.group));
  renderEditbar();
}

// ---------------------------------------------------------------- editing

function renderEditbar() {
  if (!state.editing) { $("editbar").innerHTML = `<button type="button" id="signin">Edit cases</button>`; return; }
  $("editbar").innerHTML = `<button type="button" id="newcase" class="primary">New case</button><button type="button" id="importbtn">Import a file</button><button type="button" id="template">Download template</button><button type="button" id="signout">Stop editing</button><input type="file" id="importfile" accept=".md,.txt,text/markdown,text/plain" hidden>`;
}
const download = (name: string, text: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** Open an uploaded document: what the format could not read is listed with line numbers; what reads cleanly opens in the builder as a draft. */
async function importFile(f: File) {
  const text = await f.text();
  const r = parseCaseMarkdown(text);
  if (!r.spec) { state.notice = `${f.name} could not be read:\n${r.errors.join("\n")}`; render(); $("status").classList.add("bad"); return; }
  state.notice = ""; $("status").classList.remove("bad");
  edit(r.spec, true, r.warnings);
}

function edit(spec: ReturnType<typeof blankCase>, isNew: boolean, notes: string[] = []) {
  $("lib").hidden = true; $("build").hidden = false;
  openBuilder($("build"), {
    spec, isNew, notes,
    existing: () => state.entries.map((e) => e.id),
    close: async (changed) => { $("build").hidden = true; $("lib").hidden = false; history.replaceState(null, "", location.pathname); if (changed) await load(); else render(); window.scrollTo(0, 0); },
  });
  history.replaceState(null, "", "#edit");
  window.scrollTo(0, 0);
}

function wire() {
  $("facets").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-f]"); if (!b) return;
    const set = state[b.dataset.f as "tier" | "complaint" | "device"], v = b.dataset.v!;
    if (!set.delete(v)) set.add(v);
    render();
  });
  $("clear").addEventListener("click", () => { state.tier.clear(); state.complaint.clear(); state.device.clear(); state.q = ""; $<HTMLInputElement>("q").value = ""; render(); });
  $("q").addEventListener("input", (e) => { state.q = (e.target as HTMLInputElement).value; render(); });
  document.querySelector(".groupby")!.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-g]"); if (b) { state.group = b.dataset.g as GroupBy; render(); } });
  $("list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-edit]"); if (!b) return;
    const spec = state.entries.find((x) => x.id === b.dataset.edit)?.spec;
    if (spec) edit(JSON.parse(JSON.stringify(spec)), false);
  });
  $("editbar").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest("button")?.id;
    if (id === "signin") { $("gate-err").textContent = ""; $<HTMLInputElement>("pass").value = ""; $<HTMLDialogElement>("gate").showModal(); $("pass").focus(); }
    else if (id === "signout") { forgetPasscode(); state.editing = false; state.notice = ""; void load(); }
    else if (id === "newcase") edit(blankCase(state.entries.map((x) => x.id)), true);
    else if (id === "importbtn") $("importfile").click();
    else if (id === "template") download("case-template.md", blankTemplate());
  });
  $("editbar").addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (t.id === "importfile" && t.files?.[0]) { void importFile(t.files[0]); t.value = ""; } });
  $("gate-cancel").addEventListener("click", () => $<HTMLDialogElement>("gate").close());
  $("gateform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = await signIn($<HTMLInputElement>("pass").value);
    if (err) { $("gate-err").textContent = err; return; }
    $<HTMLDialogElement>("gate").close(); state.editing = true; state.notice = ""; await load();
  });
}

wire();
state.entries = builtinEntries();
state.editing = !!passcode();
render();
void load();
