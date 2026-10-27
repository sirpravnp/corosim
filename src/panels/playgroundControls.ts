/**
 * The Simulator's playground controls (task P12): presets, and one collapsible group per part of the
 * `PatientSpec`. DOM only. The logic (state edits, the spec builder) is in src/sim/playground.ts; the page owns the state and
 * commits it. The groups come in containers (`mounts`) that the page's settings dock puts in its tabs and, for the Support tab, in
 * the rows of its sections (volume, ventilation, the settings of each device); the dock's other tabs (Rhythm, Coronary, Display) hold the
 * page's own controls, so there is one place for every control. The on/off switch of a device is the page's own (sim/index.html).
 */
import { GROUP_INFO, addBolus, bolusTotalMl, patchDevice, patchSection, withBloodVolume } from "../sim/playground";
import type { FieldGroupInfo, PlaygroundState } from "../sim/playground";
import { PATIENT_RANGES } from "../sim/patient";
import type { FluidKind, ImpellaModel } from "../sim/patient";
import { PRESETS, PRESET_BY_ID } from "../sim/presets";
import { LESIONS, LESION_BY_ID, defaults } from "../sim/structural";
import type { LesionId } from "../sim/structural";
import { buildValves } from "./valvesPanel";

export interface PlaygroundHost {
  getState(): PlaygroundState;
  /** The controls changed the state; the page rebuilds the spec and applies it. */
  setState(next: PlaygroundState): void;
  loadPreset(id: string): void;
  exit(): void;
  /** True when the page runs the legacy engine (the game): the per-valve controls are disabled. */
  legacy?(): boolean;
}
export interface PlaygroundInfo { warnings: readonly string[]; link: string; presetId: string | null }
export type MountId = "patient" | "valves" | "pericardium" | "volume" | "ventilation" | "iabp" | "impella" | "ecmo";
export interface PlaygroundUi {
  /** The containers for the settings dock's tabs. */
  mounts: Record<MountId, HTMLElement>;
  /** The field path (sim/registry.ts) each control edits, one entry per control (`action:preset` is the preset picker). */
  fields: readonly string[];
  /** Show the state: every control takes its value from it. */
  sync(state: PlaygroundState, info: PlaygroundInfo): void;
}

const R = PATIENT_RANGES;
const CUSTOM = "custom";

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
/** A group's tag: nothing when the group is simulated (the usual case), "not simulated" when it is only saved with the patient. */
const badge = (m: FieldGroupInfo["modelled"]) => { const t = h("span", { className: `pg-tag pg-${m}`, textContent: m === "legacy" ? "on/off only" : "not simulated", title: m === "legacy" ? "Only the on/off switch changes this patient" : "Saved with the patient and in the share link, but it does not change the numbers yet" }); t.hidden = m === "yes"; return t; };

export function createPlaygroundUi(host: PlaygroundHost): PlaygroundUi {
  const syncs: ((st: PlaygroundState) => void)[] = [];
  /** The field path (sim/registry.ts) of every control built here: the parity test checks each one has a field. */
  const fields: string[] = ["action:preset"];
  const flat = () => h("div", { className: "ctl-flat" }); // the Support sections' rows: cells of the section's own label | control | value grid
  const mounts = { patient: h("div", { className: "pg" }), valves: h("div", { className: "pg" }), pericardium: h("div", { className: "pg" }), volume: flat(), ventilation: flat(), iabp: flat(), impella: flat(), ecmo: flat() } as Record<MountId, HTMLElement>;
  /** How the building blocks lay out: stacked in a group, or as the cells of a Support row (label | control | value); `sub` indents the label. */
  let layout: "stack" | "row" | "sub" = "stack";
  let el = mounts.patient; // the container the groups below are added to

  // ---- building blocks -----------------------------------------------------------------------------------------------
  const ctlId = (() => { let n = 0; return () => `pg-c${++n}`; })();
  const edit = (f: (s: PlaygroundState) => PlaygroundState) => host.setState(f(host.getState()));

  function group(title: string, info: FieldGroupInfo | null, open = false, cls = ""): { box: HTMLDetailsElement; body: HTMLElement } {
    const box = h("details", { className: `fold pg-group ${cls}`.trim() });
    box.open = open;
    const body = h("div", { className: "pg-body" });
    const tag = h("span"), note = h("p", { className: "note pg-note" });
    box.append(h("summary", {}, h("h2", { textContent: title }), ...(info ? [tag] : [])), body);
    if (info) {
      body.append(note);
      syncs.push((s) => { const m = info.modelled; const b = badge(m); tag.className = b.className; tag.textContent = b.textContent; tag.title = b.title; tag.hidden = b.hidden; note.textContent = info.note; note.hidden = m === "yes"; });
    }
    return { box, body };
  }
  function slider(body: HTMLElement, path: string, label: string, min: number, max: number, step: number, get: (s: PlaygroundState) => number | undefined, dflt: number, fmt: (v: number) => string, set: (s: PlaygroundState, v: number) => PlaygroundState) {
    fields.push(path);
    const id = ctlId(), val = h("span", { className: "val" }), input = h("input", { id, type: "range", min: String(min), max: String(max), step: String(step) });
    if (layout === "stack") body.append(h("label", { htmlFor: id }, label + " ", val), input);
    else body.append(h("label", { htmlFor: id, textContent: label, className: layout === "sub" ? "ctl-sub" : "" }), input, val);
    input.addEventListener("input", () => edit((s) => set(s, Number(input.value))));
    syncs.push((s) => { const v = get(s) ?? dflt; if (document.activeElement !== input) input.value = String(v); val.textContent = fmt(v); });
  }
  function choice<T extends string | number>(body: HTMLElement, path: string, label: string, options: readonly (readonly [T, string])[], get: (s: PlaygroundState) => T | undefined, dflt: T, set: (s: PlaygroundState, v: T) => PlaygroundState) {
    fields.push(path);
    const id = ctlId(), sel = h("select", { id });
    for (const [v, t] of options) sel.append(h("option", { value: String(v), textContent: t }));
    body.append(h("label", { htmlFor: id, textContent: label, className: layout === "sub" ? "ctl-sub" : "" }), sel);
    if (layout !== "stack") body.append(h("span", { className: "val" }));
    sel.addEventListener("change", () => { const o = options.find(([v]) => String(v) === sel.value); if (o) edit((s) => set(s, o[0])); });
    syncs.push((s) => { sel.value = String(get(s) ?? dflt); });
  }
  function toggle(body: HTMLElement, path: string, text: string, get: (s: PlaygroundState) => boolean, set: (s: PlaygroundState, on: boolean) => PlaygroundState) {
    fields.push(path);
    const b = h("button", { type: "button", textContent: text });
    b.addEventListener("click", () => edit((s) => set(s, !get(s))));
    body.append(h("div", { className: "row" }, b));
    syncs.push((s) => { b.classList.toggle("on", get(s)); b.setAttribute("aria-pressed", String(get(s))); });
    return b;
  }

  // ---- header, presets -----------------------------------------------------------------------------------
  const preset = h("select", { id: "pg-preset", title: "Load a whole patient into every control and panel" });
  preset.append(h("option", { value: "", textContent: "Custom patient" }), ...PRESETS.map((p) => h("option", { value: p.id, textContent: p.label })));
  preset.addEventListener("change", () => { if (preset.value) host.loadPreset(preset.value); });
  const presetNote = h("p", { className: "note", id: "pg-presetnote" });
  const warnings = h("div", { className: "warns pg-warns", id: "pg-warnings" });
  warnings.setAttribute("aria-live", "polite");
  el.append(
    h("p", { className: "note pg-first", textContent: "Build the patient with the controls in these tabs, or start from a preset. Every panel shows this patient; the Share button at the top copies a link to it." }),
    h("label", { htmlFor: "pg-preset", textContent: "Preset", className: "pg-first" }), preset, presetNote,
    warnings,
  );
  // baseline blood volume: what the patient starts with (the Support tab's blood loss, hemorrhage and boluses change it from there)
  slider(el, "heart.volumeMl", "Blood volume", -1000, 5000, 50, (s) => (s.structural ? 0 : s.heart?.volumeMl), 0, (v) => (v ? `${v > 0 ? "+" : "−"}${Math.abs(v)} ml` : "normal"), (s, v) => withBloodVolume(s, v));
  el.append(h("p", { className: "note pg-note", textContent: "Baseline blood volume, as extra ml on the patient's normal. Blood loss, hemorrhage and IV boluses (Support tab) change it from here." }));

  // ---- structural heart (Valves tab) ---------------------------------------------------------------------------------
  el = mounts.valves;
  {
    const { box, body } = group("Structural heart", GROUP_INFO.heart, true);
    fields.push("heart");
    const sel = h("select", { id: "pg-lesion", "aria-label": "Structural lesion" } as Partial<HTMLSelectElement>);
    const customOpt = h("option", { value: CUSTOM, textContent: "Custom heart (from a preset or link)" });
    customOpt.hidden = true;
    sel.append(customOpt);
    for (const [g, label] of [["valve", "Valves"], ["congenital", "Congenital"]] as const) {
      const og = h("optgroup", { label });
      for (const l of LESIONS.filter((x) => x.group === g && x.patient === "adult")) og.append(h("option", { value: l.id, textContent: l.label }));
      sel.append(og);
    }
    const sliders = h("div", { className: "pg-sliders" }), teach = h("p", { className: "note" }), custom = h("p", { className: "note pg-json" });
    body.append(h("label", { htmlFor: "pg-lesion", textContent: "Lesion", className: "pg-first" }), sel, sliders, teach, custom);
    sel.addEventListener("change", () => {
      if (sel.value === CUSTOM) return;
      const def = LESION_BY_ID[sel.value]!;
      edit((s) => ({ ...s, structural: { id: def.id, values: defaults(def) }, heart: undefined }));
    });
    let shown: string | null = null;
    syncs.push((s) => {
      const id = s.structural?.id ?? null;
      sel.value = id ?? (s.heart ? CUSTOM : "normal"); customOpt.hidden = !(s.heart && !s.structural);
      custom.textContent = !s.structural && s.heart ? `Heart fields in the spec: ${JSON.stringify(s.heart)}. Pick a lesion above to replace them.` : "";
      const def = id ? LESION_BY_ID[id] : undefined;
      teach.textContent = def?.teach ?? "";
      const key = id ?? "";
      if (key !== shown) {
        shown = key; sliders.replaceChildren();
        for (const p of def?.params ?? []) {
          const sid = ctlId(), val = h("span", { className: "val" }), input = h("input", { id: sid, type: "range", min: String(p.min), max: String(p.max), step: String(p.step) });
          sliders.append(h("label", { htmlFor: sid }, `${p.label} `, val), input);
          input.addEventListener("input", () => edit((st) => st.structural ? { ...st, structural: { id: st.structural.id, values: { ...st.structural.values, [p.key]: Number(input.value) } } } : st));
          (input as HTMLInputElement & { _sync?: (v: number) => void })._sync = (v) => { if (document.activeElement !== input) input.value = String(v); val.textContent = `${+v.toFixed(3)}${p.unit ? ` ${p.unit}` : ""}`; };
        }
      }
      if (def) [...sliders.querySelectorAll("input")].forEach((inp, i) => (inp as HTMLInputElement & { _sync?: (v: number) => void })._sync?.(s.structural!.values[def.params[i].key] ?? def.params[i].default));
    });
    el.append(box);
  }
  {
    const { box, body } = group("Valves one by one", null, true);
    buildValves({ body, h, ctlId, fields, syncs, edit, legacy: host.legacy });
    el.append(box);
  }

  // ---- pericardium (its own tab) --------------------------------------------------------------------------------------
  el = mounts.pericardium;
  {
    const { box, body } = group("Pericardium", GROUP_INFO.pericardium, true);
    slider(body, "pericardium.effusionMl", "Effusion", R.effusionMl[0], R.effusionMl[1], 25, (s) => s.pericardium?.effusionMl, 0, (v) => `${v} ml`, (s, v) => patchSection(s, "pericardium", { effusionMl: v || undefined }));
    slider(body, "pericardium.stiffness", "Stiffness", R.stiffness[0], R.stiffness[1], 0.1, (s) => s.pericardium?.stiffness, 1, (v) => `${v.toFixed(1)}× normal`, (s, v) => patchSection(s, "pericardium", { stiffness: v === 1 ? undefined : v }));
    slider(body, "pericardium.effusionRateMlMin", "Accumulating", 0, 100, 5, (s) => s.pericardium?.effusionRateMlMin, 0, (v) => (v ? `${v} ml per clinical minute` : "stable"), (s, v) => patchSection(s, "pericardium", { effusionRateMlMin: v || undefined }));
    toggle(body, "pericardium.open", "Pericardium open (after surgery)", (s) => !!s.pericardium?.open, (s, on) => patchSection(s, "pericardium", { open: on || undefined }));
    fields.push("pericardium.drainMl");
    const drain = h("button", { type: "button", textContent: "Pericardiocentesis: remove 100 ml", title: "Take 100 ml (or what is left) out of the sac; the pressure and the output recover at once" });
    drain.addEventListener("click", () => edit((s) => patchSection(s, "pericardium", { effusionMl: Math.max(0, (s.pericardium?.effusionMl ?? 0) - 100) || undefined })));
    body.append(h("div", { className: "row" }, drain));
    syncs.push((s) => { drain.disabled = !(s.pericardium?.effusionMl && s.pericardium.effusionMl > 0); });
    toggle(body, "septum", "Ventricular interdependence (septum)", (s) => !!s.septum, (s, on) => ({ ...s, septum: on || undefined }));
    el.append(box);
  }

  // ---- the Support tab's rows: volume, ventilation and the settings of each device -----------------------------------------
  // (blood loss, the drugs, pacing and the device switches are the page's own controls in sim/index.html; these fill the rows around them)
  layout = "row";
  {
    const body = mounts.volume;
    slider(body, "fluids.hemorrhageMlMin", "Ongoing hemorrhage", R.hemorrhageMlMin[0], 200, 5, (s) => s.fluids?.hemorrhageMlMin, 0, (v) => (v ? `${v} ml/min` : "none"), (s, v) => patchSection(s, "fluids", { hemorrhageMlMin: v || undefined }));
    slider(body, "fluids.capillaryLeak", "Capillary leak", R.capillaryLeak[0], R.capillaryLeak[1], 0.05, (s) => s.fluids?.capillaryLeak, 0, (v) => (v ? `${Math.round(v * 100)}%` : "none"), (s, v) => patchSection(s, "fluids", { capillaryLeak: v || undefined }));
    {
      fields.push("fluids.legRaise");
      const lid = ctlId(), lb = h("button", { id: lid, type: "button", textContent: "Off", title: "Passive leg raise: shifts blood from the legs to the chest, a reversible fluid challenge" });
      lb.addEventListener("click", () => edit((s) => patchSection(s, "fluids", { legRaise: !s.fluids?.legRaise || undefined })));
      body.append(h("label", { htmlFor: lid, textContent: "Passive leg raise" }), lb, h("span", { className: "val" }));
      syncs.push((s) => { const on = !!s.fluids?.legRaise; lb.classList.toggle("on", on); lb.setAttribute("aria-pressed", String(on)); lb.textContent = on ? "On" : "Off"; });
    }
    // IV bolus: the kind of the next dose, quick volumes that add up, and the total given
    const KINDS: readonly (readonly [FluidKind, string])[] = [["crystalloid", "Crystalloid"], ["colloid", "Colloid"], ["albumin", "Albumin"], ["blood", "Blood"]];
    let kind: FluidKind = "crystalloid";
    fields.push("fluids.given");
    const id = ctlId(), sel = h("select", { id, title: "What the next bolus is made of" }), total = h("span", { className: "val" });
    for (const [v, t] of KINDS) sel.append(h("option", { value: v, textContent: t }));
    sel.addEventListener("change", () => { kind = sel.value as FluidKind; });
    body.append(h("label", { htmlFor: id, textContent: "IV bolus" }), sel, total);
    const quick = h("div", { className: "row ctl-wide" });
    for (const ml of [250, 500, 1000]) {
      const b = h("button", { type: "button", textContent: `+${ml} ml`, title: `Give ${ml} ml now; boluses add up` });
      b.addEventListener("click", () => edit((s) => addBolus(s, kind, ml)));
      quick.append(b);
    }
    body.append(quick);
    syncs.push((s) => { const ml = bolusTotalMl(s); total.textContent = ml ? `${ml} ml` : "none"; });
  }
  {
    const body = mounts.ventilation;
    choice(body, "ventilation.mode", "Mode", [["spontaneous", "Spontaneous"], ["positive", "Positive pressure"]] as const, (s) => s.ventilation?.mode, "spontaneous", (s, m) => patchSection(s, "ventilation", { mode: m }));
    slider(body, "ventilation.peep", "PEEP", R.peep[0], R.peep[1], 1, (s) => s.ventilation?.peep, 0, (v) => `${v} cmH₂O`, (s, v) => patchSection(s, "ventilation", { peep: v || undefined }));
    slider(body, "ventilation.tidalMlKg", "Tidal volume", R.tidalMlKg[0], R.tidalMlKg[1], 1, (s) => s.ventilation?.tidalMlKg, 8, (v) => `${v} ml/kg`, (s, v) => patchSection(s, "ventilation", { tidalMlKg: v === 8 ? undefined : v }));
  }
  // ---- devices: the settings of each, shown only while it is on (its switch is the page's: m_impella, m_iabp, m_ecmo) -------
  layout = "sub";
  {
    /** A device's settings, shown only while it is switched on. */
    const settings = (body: HTMLElement, on: (s: PlaygroundState) => boolean) => { const d = h("div", { className: "pg-dev" }); body.append(d); syncs.push((s) => { d.hidden = !on(s); }); return d; };
    const imp = settings(mounts.impella, (s) => !!s.devices?.impella);
    choice<ImpellaModel>(imp, "devices.impella.model", "Model", [["2.5", "Impella 2.5"], ["CP", "Impella CP"], ["5.5", "Impella 5.5"]], (s) => s.devices?.impella?.model, "CP", (s, m) => patchDevice(s, "impella", { model: m }));
    slider(imp, "devices.impella.level", "P-level", R.impellaLevel[0], R.impellaLevel[1], 1, (s) => s.devices?.impella?.level, 6, (v) => `P${v}`, (s, v) => patchDevice(s, "impella", { level: v }));
    choice(imp, "devices.impella.position", "Position", [["correct", "Correct"], ["aortic", "Too far out"], ["deep", "Too deep"]] as const, (s) => s.devices?.impella?.position, "correct", (s, p) => patchDevice(s, "impella", { position: p }));
    const iabp = settings(mounts.iabp, (s) => !!s.devices?.iabp);
    choice(iabp, "devices.iabp.ratio", "Ratio", [[1, "1:1"], [2, "1:2"], [3, "1:3"]] as const, (s) => s.devices?.iabp?.ratio, 1, (s, r) => patchDevice(s, "iabp", { ratio: r }));
    const timing = (v: number) => (v === 0 ? "correct" : `${v > 0 ? "late" : "early"} ${Math.abs(v)} ms`);
    slider(iabp, "devices.iabp.inflateMs", "Inflation", R.iabpOffsetMs[0], R.iabpOffsetMs[1], 10, (s) => s.devices?.iabp?.inflateMs, 0, timing, (s, v) => patchDevice(s, "iabp", { inflateMs: v }));
    slider(iabp, "devices.iabp.deflateMs", "Deflation", R.iabpOffsetMs[0], R.iabpOffsetMs[1], 10, (s) => s.devices?.iabp?.deflateMs, 0, timing, (s, v) => patchDevice(s, "iabp", { deflateMs: v }));
    const ecmo = settings(mounts.ecmo, (s) => !!s.devices?.ecmo);
    slider(ecmo, "devices.ecmo.flowLpm", "Flow", R.ecmoFlowLpm[0], R.ecmoFlowLpm[1], 0.5, (s) => s.devices?.ecmo?.flowLpm, 3, (v) => `${v.toFixed(1)} L/min`, (s, v) => patchDevice(s, "ecmo", { flowLpm: v }));
    slider(ecmo, "devices.ecmo.sweepLpm", "Sweep gas", R.ecmoSweepLpm[0], R.ecmoSweepLpm[1], 0.5, (s) => s.devices?.ecmo?.sweepLpm, 2, (v) => `${v.toFixed(1)} L/min`, (s, v) => patchDevice(s, "ecmo", { sweepLpm: v }));
    slider(ecmo, "devices.ecmo.fio2", "FiO₂", R.fio2[0], R.fio2[1], 0.01, (s) => s.devices?.ecmo?.fio2, 0.6, (v) => `${Math.round(v * 100)}%`, (s, v) => patchDevice(s, "ecmo", { fio2: v }));
  }
  layout = "stack";

  return {
    mounts, fields,
    sync(state, info) {
      for (const f of syncs) f(state);
      preset.value = info.presetId ?? "";
      const p = info.presetId ? PRESET_BY_ID[info.presetId] : undefined;
      presetNote.textContent = p ? `${p.blurb}${p.stored ? ` Not simulated yet: ${p.stored}.` : ""}` : "";
      warnings.replaceChildren(...info.warnings.map((w) => h("div", { textContent: w })));
    },
  };
}
