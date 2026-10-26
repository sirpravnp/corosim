/**
 * The Simulator's playground controls (task P12): presets, the share link, and one collapsible group per part of the
 * `PatientSpec`. DOM only. The logic (state edits, the spec builder) is in src/sim/playground.ts; the page owns the state and
 * commits it. The groups for the coronary lesions, rhythm and conduction, and drugs are slots: the page moves its existing
 * controls into them while the mode is on, so there is one place for every control and the old controls keep working.
 */
import { GROUP_INFO, patchDevice, patchSection, withBolus, withDevice } from "../sim/playground";
import type { FieldGroupInfo, PlaygroundState } from "../sim/playground";
import { PATIENT_RANGES } from "../sim/patient";
import type { FluidKind, ImpellaModel } from "../sim/patient";
import { PRESETS, PRESET_BY_ID } from "../sim/presets";
import { LESIONS, LESION_BY_ID, defaults } from "../sim/structural";
import type { LesionId } from "../sim/structural";

export interface PlaygroundHost {
  getState(): PlaygroundState;
  /** The controls changed the state; the page rebuilds the spec and applies it. */
  setState(next: PlaygroundState): void;
  loadPreset(id: string): void;
  exit(): void;
}
export interface PlaygroundInfo { warnings: readonly string[]; link: string; presetId: string | null }
export type SlotId = "coronary" | "rhythm" | "drugs";
export interface PlaygroundUi {
  el: HTMLElement;
  /** The body of a group whose controls the page supplies. */
  slot(id: SlotId): HTMLElement;
  /** Show the state: every control takes its value from it. */
  sync(state: PlaygroundState, info: PlaygroundInfo): void;
  /** Set the patient kind as the buttons do. */
  setKind(kind: "adult" | "neonate"): void;
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
/** The badge and note of a group for the patient kind on screen: an adult runs on the core engine, a neonate on the bridge, which reads less (`FieldGroupInfo.neonate`). */
const modelledFor = (info: FieldGroupInfo, kind: "adult" | "neonate" | undefined) => (kind === "neonate" ? info.neonate ?? info.modelled : info.modelled);

export function createPlaygroundUi(host: PlaygroundHost): PlaygroundUi {
  const syncs: ((st: PlaygroundState) => void)[] = [];
  const slots = {} as Record<SlotId, HTMLElement>;
  const el = h("section", { id: "playground", className: "pg" });
  el.hidden = true;

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
      syncs.push((s) => { const m = modelledFor(info, s.kind); const b = badge(m); tag.className = b.className; tag.textContent = b.textContent; tag.title = b.title; tag.hidden = b.hidden; note.textContent = s.kind === "neonate" && info.neonateNote ? info.neonateNote : info.note; note.hidden = m === "yes"; });
    }
    return { box, body };
  }
  function slider(body: HTMLElement, label: string, min: number, max: number, step: number, get: (s: PlaygroundState) => number | undefined, dflt: number, fmt: (v: number) => string, set: (s: PlaygroundState, v: number) => PlaygroundState) {
    const id = ctlId(), val = h("span", { className: "val" }), input = h("input", { id, type: "range", min: String(min), max: String(max), step: String(step) });
    body.append(h("label", { htmlFor: id }, label + " ", val), input);
    input.addEventListener("input", () => edit((s) => set(s, Number(input.value))));
    syncs.push((s) => { const v = get(s) ?? dflt; if (document.activeElement !== input) input.value = String(v); val.textContent = fmt(v); });
  }
  function choice<T extends string | number>(body: HTMLElement, label: string, options: readonly (readonly [T, string])[], get: (s: PlaygroundState) => T | undefined, dflt: T, set: (s: PlaygroundState, v: T) => PlaygroundState) {
    const id = ctlId(), sel = h("select", { id });
    for (const [v, t] of options) sel.append(h("option", { value: String(v), textContent: t }));
    body.append(h("label", { htmlFor: id, textContent: label }), sel);
    sel.addEventListener("change", () => { const o = options.find(([v]) => String(v) === sel.value); if (o) edit((s) => set(s, o[0])); });
    syncs.push((s) => { sel.value = String(get(s) ?? dflt); });
  }
  function toggle(body: HTMLElement, text: string, get: (s: PlaygroundState) => boolean, set: (s: PlaygroundState, on: boolean) => PlaygroundState) {
    const b = h("button", { type: "button", textContent: text });
    b.addEventListener("click", () => edit((s) => set(s, !get(s))));
    body.append(h("div", { className: "row" }, b));
    syncs.push((s) => { b.classList.toggle("on", get(s)); b.setAttribute("aria-pressed", String(get(s))); });
    return b;
  }

  // ---- header, presets, share link -----------------------------------------------------------------------------------
  const preset = h("select", { id: "pg-preset", title: "Load a whole patient into every control and panel" });
  preset.append(h("option", { value: "", textContent: "Custom patient" }), ...PRESETS.map((p) => h("option", { value: p.id, textContent: p.label })));
  preset.addEventListener("change", () => { if (preset.value) host.loadPreset(preset.value); });
  const presetNote = h("p", { className: "note", id: "pg-presetnote" });
  const linkIn = h("input", { id: "pg-link", type: "text", readOnly: true, title: "Share link: opens this exact patient" });
  linkIn.setAttribute("aria-label", "Share link");
  const copy = h("button", { type: "button", textContent: "Copy link" });
  copy.addEventListener("click", () => { linkIn.select(); void navigator.clipboard?.writeText(linkIn.value).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy link"; }, 1500); }, () => { /* selected for a manual copy */ }); });
  const warnings = h("div", { className: "warns pg-warns", id: "pg-warnings" });
  warnings.setAttribute("aria-live", "polite");
  el.append(
    h("div", { className: "pg-head" }, h("h2", { textContent: "Patient" })),
    h("p", { className: "note pg-first", textContent: "Build the patient with the controls below, or start from a preset. Every panel shows this patient; the share link opens it." }),
    h("label", { htmlFor: "pg-preset", textContent: "Preset", className: "pg-first" }), preset, presetNote,
    h("label", { htmlFor: "pg-link", textContent: "Share link" }), h("div", { className: "pg-link" }, linkIn, copy),
    warnings,
  );

  // ---- patient kind --------------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Patient kind", GROUP_INFO.kind, true);
    const row = h("div", { className: "row pg-first" });
    const btns = (["adult", "neonate"] as const).map((k) => {
      const b = h("button", { type: "button", textContent: k === "adult" ? "Adult" : "Neonate", id: `pg-kind-${k}` });
      b.addEventListener("click", () => edit((s) => ({ ...s, kind: k })));
      return [k, b] as const;
    });
    row.append(...btns.map(([, b]) => b));
    body.append(row, h("p", { className: "note", textContent: "A neonate has no coronary tree: its coronary lesions and view are hidden, and any lesion in a link is dropped with a warning." }));
    syncs.push((s) => { for (const [k, b] of btns) b.classList.toggle("on", (s.kind ?? "adult") === k); });
    el.append(box);
  }

  // ---- slots for the page's existing controls ------------------------------------------------------------------------
  for (const [id, title, cls, open] of [["coronary", "Coronary lesions", "pg-coronary", true], ["rhythm", "Rhythm and conduction", "", false]] as const) {
    const { box, body } = group(title, null, open, cls);
    slots[id] = body; el.append(box);
  }

  // ---- structural heart ----------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Structural heart", GROUP_INFO.heart, false);
    const sel = h("select", { id: "pg-lesion", "aria-label": "Structural lesion" } as Partial<HTMLSelectElement>);
    const customOpt = h("option", { value: CUSTOM, textContent: "Custom heart (from a preset or link)" });
    customOpt.hidden = true;
    sel.append(customOpt);
    for (const [g, label] of [["valve", "Valves"], ["congenital", "Congenital"]] as const) {
      const og = h("optgroup", { label });
      for (const l of LESIONS.filter((x) => x.group === g)) og.append(h("option", { value: l.id, textContent: l.label }));
      sel.append(og);
    }
    const sliders = h("div", { className: "pg-sliders" }), teach = h("p", { className: "note" }), custom = h("p", { className: "note pg-json" });
    body.append(h("label", { htmlFor: "pg-lesion", textContent: "Lesion", className: "pg-first" }), sel, sliders, teach, custom);
    sel.addEventListener("change", () => {
      if (sel.value === CUSTOM) return;
      const def = LESION_BY_ID[sel.value]!;
      edit((s) => ({ ...s, structural: { id: def.id, values: defaults(def) }, heart: undefined, kind: def.patient === "neonate" ? "neonate" : s.kind }));
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

  // ---- pericardium ---------------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Pericardium", GROUP_INFO.pericardium);
    slider(body, "Effusion", R.effusionMl[0], R.effusionMl[1], 25, (s) => s.pericardium?.effusionMl, 0, (v) => `${v} ml`, (s, v) => patchSection(s, "pericardium", { effusionMl: v || undefined }));
    slider(body, "Stiffness", R.stiffness[0], R.stiffness[1], 0.1, (s) => s.pericardium?.stiffness, 1, (v) => `${v.toFixed(1)}× normal`, (s, v) => patchSection(s, "pericardium", { stiffness: v === 1 ? undefined : v }));
    slider(body, "Accumulating", 0, 100, 5, (s) => s.pericardium?.effusionRateMlMin, 0, (v) => (v ? `${v} ml per clinical minute` : "stable"), (s, v) => patchSection(s, "pericardium", { effusionRateMlMin: v || undefined }));
    toggle(body, "Pericardium open (after surgery)", (s) => !!s.pericardium?.open, (s, on) => patchSection(s, "pericardium", { open: on || undefined }));
    const drain = h("button", { type: "button", textContent: "Pericardiocentesis: remove 100 ml", title: "Take 100 ml (or what is left) out of the sac; the pressure and the output recover at once" });
    drain.addEventListener("click", () => edit((s) => patchSection(s, "pericardium", { effusionMl: Math.max(0, (s.pericardium?.effusionMl ?? 0) - 100) || undefined })));
    body.append(h("div", { className: "row" }, drain));
    syncs.push((s) => { drain.disabled = !(s.pericardium?.effusionMl && s.pericardium.effusionMl > 0); });
    toggle(body, "Ventricular interdependence (septum)", (s) => !!s.septum, (s, on) => ({ ...s, septum: on || undefined }));
    el.append(box);
  }

  // ---- fluids --------------------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Fluids and hemorrhage", GROUP_INFO.fluids);
    const KINDS: readonly (readonly [FluidKind, string])[] = [["crystalloid", "Crystalloid"], ["colloid", "Colloid"], ["albumin", "Albumin"], ["blood", "Blood"]];
    choice(body, "Bolus kind", KINDS, (s) => s.fluids?.given?.[0]?.kind, "crystalloid", (s, k) => withBolus(s, k, s.fluids?.given?.[0]?.ml ?? 500));
    slider(body, "Bolus volume", 0, 2000, 50, (s) => s.fluids?.given?.[0]?.ml, 0, (v) => (v ? `${v} ml` : "none"), (s, v) => withBolus(s, s.fluids?.given?.[0]?.kind ?? "crystalloid", v));
    slider(body, "Hemorrhage", R.hemorrhageMlMin[0], 200, 5, (s) => s.fluids?.hemorrhageMlMin, 0, (v) => (v ? `${v} ml/min` : "none"), (s, v) => patchSection(s, "fluids", { hemorrhageMlMin: v || undefined }));
    el.append(box);
  }

  // ---- ventilation ---------------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Ventilation", GROUP_INFO.ventilation);
    choice(body, "Mode", [["spontaneous", "Spontaneous breathing"], ["positive", "Positive-pressure ventilation"]] as const, (s) => s.ventilation?.mode, "spontaneous", (s, m) => patchSection(s, "ventilation", { mode: m }));
    slider(body, "PEEP", R.peep[0], R.peep[1], 1, (s) => s.ventilation?.peep, 0, (v) => `${v} cmH₂O`, (s, v) => patchSection(s, "ventilation", { peep: v || undefined }));
    slider(body, "Tidal volume", R.tidalMlKg[0], R.tidalMlKg[1], 1, (s) => s.ventilation?.tidalMlKg, 8, (v) => `${v} ml/kg`, (s, v) => patchSection(s, "ventilation", { tidalMlKg: v === 8 ? undefined : v }));
    el.append(box);
  }

  // ---- devices -------------------------------------------------------------------------------------------------------
  {
    const { box, body } = group("Mechanical support", null);
    const sub = (title: string, info: FieldGroupInfo) => {
      const tag = h("span"), note = h("p", { className: "note pg-note" });
      body.append(h("p", { className: "glabel pg-sub" }, title, " ", tag), note);
      syncs.push((s) => { const m = modelledFor(info, s.kind); const b = badge(m); tag.className = b.className; tag.textContent = b.textContent; tag.title = b.title; tag.hidden = b.hidden; note.textContent = s.kind === "neonate" && info.neonateNote ? info.neonateNote : info.note; note.hidden = m === "yes"; });
    };
    /** A device's settings, shown only while it is switched on. */
    const settings = (on: (s: PlaygroundState) => boolean) => { const d = h("div", { className: "pg-dev" }); body.append(d); syncs.push((s) => { d.hidden = !on(s); }); return d; };
    sub("Impella", GROUP_INFO.impella);
    toggle(body, "Impella on", (s) => !!s.devices?.impella, (s, on) => withDevice(s, "impella", on));
    const imp = settings((s) => !!s.devices?.impella);
    choice<ImpellaModel>(imp, "Model", [["2.5", "Impella 2.5"], ["CP", "Impella CP"], ["5.5", "Impella 5.5"]], (s) => s.devices?.impella?.model, "CP", (s, m) => patchDevice(s, "impella", { model: m }));
    slider(imp, "P-level", R.impellaLevel[0], R.impellaLevel[1], 1, (s) => s.devices?.impella?.level, 6, (v) => `P${v}`, (s, v) => patchDevice(s, "impella", { level: v }));
    choice(imp, "Position", [["correct", "Correct"], ["aortic", "Too far out (in the aorta)"], ["deep", "Too deep (in the ventricle)"]] as const, (s) => s.devices?.impella?.position, "correct", (s, p) => patchDevice(s, "impella", { position: p }));
    sub("Intra-aortic balloon pump", GROUP_INFO.iabp);
    toggle(body, "Balloon pump on", (s) => !!s.devices?.iabp, (s, on) => withDevice(s, "iabp", on));
    const iabp = settings((s) => !!s.devices?.iabp);
    choice(iabp, "Ratio", [[1, "1:1"], [2, "1:2"], [3, "1:3"]] as const, (s) => s.devices?.iabp?.ratio, 1, (s, r) => patchDevice(s, "iabp", { ratio: r }));
    slider(iabp, "Inflation timing", R.iabpOffsetMs[0], R.iabpOffsetMs[1], 10, (s) => s.devices?.iabp?.inflateMs, 0, (v) => (v === 0 ? "correct" : `${v > 0 ? "late" : "early"} ${Math.abs(v)} ms`), (s, v) => patchDevice(s, "iabp", { inflateMs: v }));
    slider(iabp, "Deflation timing", R.iabpOffsetMs[0], R.iabpOffsetMs[1], 10, (s) => s.devices?.iabp?.deflateMs, 0, (v) => (v === 0 ? "correct" : `${v > 0 ? "late" : "early"} ${Math.abs(v)} ms`), (s, v) => patchDevice(s, "iabp", { deflateMs: v }));
    sub("ECMO (VA)", GROUP_INFO.ecmo);
    toggle(body, "ECMO on", (s) => !!s.devices?.ecmo, (s, on) => withDevice(s, "ecmo", on));
    const ecmo = settings((s) => !!s.devices?.ecmo);
    slider(ecmo, "Flow", R.ecmoFlowLpm[0], R.ecmoFlowLpm[1], 0.5, (s) => s.devices?.ecmo?.flowLpm, 3, (v) => `${v.toFixed(1)} L/min`, (s, v) => patchDevice(s, "ecmo", { flowLpm: v }));
    slider(ecmo, "Sweep gas", R.ecmoSweepLpm[0], R.ecmoSweepLpm[1], 0.5, (s) => s.devices?.ecmo?.sweepLpm, 2, (v) => `${v.toFixed(1)} L/min`, (s, v) => patchDevice(s, "ecmo", { sweepLpm: v }));
    slider(ecmo, "FiO₂", R.fio2[0], R.fio2[1], 0.01, (s) => s.devices?.ecmo?.fio2, 0.6, (v) => `${Math.round(v * 100)}%`, (s, v) => patchDevice(s, "ecmo", { fio2: v }));
    el.append(box);
  }

  // ---- drugs and support (the page's controls) -----------------------------------------------------------------------
  {
    const { box, body } = group("Drugs and volume", null);
    slots.drugs = body;
    body.after(h("p", { className: "note pg-after", textContent: "Pressors, inotropes, nitroglycerin, atropine, pacing and IV fluid are in Management, Support." }));
    el.append(box);
  }

  return {
    el,
    slot: (id) => slots[id],
    setKind: (k) => edit((s) => ({ ...s, kind: k })),
    sync(state, info) {
      for (const f of syncs) f(state);
      preset.value = info.presetId ?? "";
      const p = info.presetId ? PRESET_BY_ID[info.presetId] : undefined;
      presetNote.textContent = p ? `${p.blurb}${p.stored ? ` Not simulated yet: ${p.stored}.` : ""}` : "";
      if (document.activeElement !== linkIn) linkIn.value = info.link;
      warnings.replaceChildren(...info.warnings.map((w) => h("div", { textContent: w })));
    },
  };
}
