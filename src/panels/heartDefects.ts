/**
 * The Valves tab's "Defect settings" (shunt, defect and outflow sizes) and the Patient tab's "Hemodynamic baseline" (systemic
 * resistance, pulmonary resistance, lung saturation, right ventricular contractility, the tetralogy flag). DOM only; every control
 * edits the playground state's `heart`, the same fields the Preset menu fills and the chat's `heart.*` fields set.
 */
import type { PlaygroundState } from "../sim/playground";
import type { HeartSpec } from "../sim/patient";
import type { ValvesCtx } from "./valvesPanel";
import { heartOf, withHeart } from "./valvesPanel";

const DEFAULT_PVRI = 1.5, DEFAULT_SAT_LUNG = 0.98;
const unit01 = (x: number) => Math.min(1, Math.max(0, x));

/** A slider on one number of the heart: `get` reads it (undefined: not set), `set` returns the edited state. `shown`: when the control applies (default: always). */
function heartSlider(c: ValvesCtx, body: HTMLElement, o: {
  path: string; label: string; min: number; max: number; step: number; dflt: number; fmt: (v: number) => string;
  get: (h: HeartSpec) => number | undefined; set: (s: PlaygroundState, v: number) => PlaygroundState; shown?: (h: HeartSpec) => boolean;
}) {
  c.fields.push(o.path);
  const id = c.ctlId(), val = c.h("span", { className: "val" }), input = c.h("input", { id, type: "range", min: String(o.min), max: String(o.max), step: String(o.step) });
  const label = c.h("label", { htmlFor: id }, o.label + " ", val);
  body.append(label, input);
  input.addEventListener("input", () => c.edit((s) => o.set(s, Number(input.value))));
  c.syncs.push((s) => {
    const h = heartOf(s), v = o.get(h) ?? o.dflt, on = o.shown ? o.shown(h) : true;
    label.hidden = input.hidden = !on;
    if (document.activeElement !== input) input.value = String(v);
    val.textContent = o.fmt(v);
  });
}
const patchHeart = (s: PlaygroundState, f: (h: HeartSpec) => HeartSpec) => withHeart(s, f(heartOf(s)));
/** Set one top-level number of the heart; `undefined` removes it (the field's own default). */
const setNum = (s: PlaygroundState, k: "pvri" | "svrScale" | "satLung" | "rvContractility", v: number | undefined) => patchHeart(s, (h) => { const n = { ...h }; if (v === undefined) delete n[k]; else n[k] = v; return n; });
const shuntDiameter = (k: "pda" | "asd" | "vsd" | "bt") => (s: PlaygroundState, v: number) => patchHeart(s, (h) => ({ ...h, [k]: { ...h[k], diameterMm: v } }));
export const hasShunt = (h: HeartSpec) => !!(h.pda || h.asd || h.vsd || h.bt || h.tof);

/** The Valves tab's Defect settings: the sizes of the shunts and defects the heart has, and the pulmonary resistance they depend on. */
export function buildDefects(c: ValvesCtx) {
  const { body } = c;
  body.append(c.h("p", { className: "note", textContent: "Sizes of the defects this heart has. Valve narrowing and leaks are set above, valve by valve." }));
  const mm = (v: number) => `${+v.toFixed(1)} mm`;
  const sizes = [["pda", "Ductus arteriosus", 1, 10, 6], ["asd", "Atrial defect", 2, 25, 12], ["vsd", "VSD diameter", 1, 14, 8], ["bt", "BT shunt", 0.5, 5, 3]] as const;
  for (const [k, label, min, max, dflt] of sizes)
    heartSlider(c, body, { path: `heart.${k}`, label, min, max, step: k === "asd" ? 1 : 0.5, dflt, fmt: mm, get: (h) => h[k]?.diameterMm, set: shuntDiameter(k), shown: (h) => !!h[k] });
  const tof = (f: (t: NonNullable<HeartSpec["tof"]>, v: number) => NonNullable<HeartSpec["tof"]>) => (s: PlaygroundState, v: number) => patchHeart(s, (h) => ({ ...h, tof: f(h.tof ?? { vsdMm: 8, rvotFrac: 0.15 }, v) }));
  heartSlider(c, body, { path: "heart.tof", label: "Tetralogy VSD", min: 4, max: 12, step: 0.5, dflt: 8, fmt: mm, get: (h) => h.tof?.vsdMm, set: tof((t, v) => ({ ...t, vsdMm: v })), shown: (h) => !!h.tof });
  // the outflow opening as the lesson's obstruction (0 = open, 1 = 90 % closed)
  heartSlider(c, body, { path: "heart.tof", label: "RVOT obstruction", min: 0, max: 1, step: 0.05, dflt: 0.9, fmt: (v) => `${Math.round(v * 100)}%`, get: (h) => (h.tof ? unit01((1 - (h.tof.rvotFrac ?? 1)) / 0.9) : undefined), set: tof((t, v) => ({ ...t, rvotFrac: 1 - 0.9 * v })), shown: (h) => !!h.tof });
  heartSlider(c, body, { path: "heart.tof", label: "Infundibular spasm", min: 0, max: 1, step: 0.05, dflt: 0, fmt: (v) => (v ? `${Math.round(v * 100)}%` : "none"), get: (h) => h.tof?.spasm, set: tof((t, v) => ({ ...t, spasm: v || undefined })), shown: (h) => !!h.tof });
  heartSlider(c, body, {
    path: "heart.pvri", label: "Pulmonary resistance", min: 1, max: 60, step: 0.5, dflt: DEFAULT_PVRI, fmt: (v) => `${+v.toFixed(1)} WU·m²`, get: (h) => h.pvri, shown: hasShunt,
    // the Eisenmenger lesson thickens the right ventricle as the resistance climbs; keep that coupling while its name is on
    set: (s, v) => { const n = setNum(s, "pvri", v === DEFAULT_PVRI ? undefined : v); return s.valvePreset === "vsd-eisenmenger" ? setNum(n, "rvContractility", 1 + 0.8 * unit01((v - 1.5) / 20)) : n; },
  });
}

/** The Patient tab's Hemodynamic baseline: the patient's systemic and pulmonary circulation, apart from the valves. */
export function buildBaseline(c: ValvesCtx) {
  const { body } = c;
  body.append(c.h("p", { className: "note", textContent: "The circulation the heart works in. Defaults are a normal adult; a preset on the Valves tab sets these too when its lesson needs it." }));
  heartSlider(c, body, { path: "heart.svrScale", label: "Systemic resistance", min: 0.2, max: 3, step: 0.05, dflt: 1, fmt: (v) => (v === 1 ? "normal" : `${v.toFixed(2)}× normal`), get: (h) => h.svrScale, set: (s, v) => setNum(s, "svrScale", v === 1 ? undefined : v) });
  heartSlider(c, body, { path: "heart.pvri", label: "Pulmonary resistance index", min: 0.5, max: 60, step: 0.5, dflt: DEFAULT_PVRI, fmt: (v) => `${+v.toFixed(1)} WU·m²`, get: (h) => h.pvri, set: (s, v) => setNum(s, "pvri", v === DEFAULT_PVRI ? undefined : v) });
  heartSlider(c, body, { path: "heart.satLung", label: "Lung saturation", min: 0.5, max: 1, step: 0.01, dflt: DEFAULT_SAT_LUNG, fmt: (v) => `${Math.round(v * 100)}%`, get: (h) => h.satLung, set: (s, v) => setNum(s, "satLung", v === DEFAULT_SAT_LUNG ? undefined : v) });
  heartSlider(c, body, { path: "heart.rvContractility", label: "RV contractility", min: 0.5, max: 3, step: 0.1, dflt: 1, fmt: (v) => (v === 1 ? "normal" : `${v.toFixed(1)}× normal`), get: (h) => h.rvContractility, set: (s, v) => setNum(s, "rvContractility", v === 1 ? undefined : v) });
  c.fields.push("heart.tof");
  const b = c.h("button", { type: "button", textContent: "Tetralogy of Fallot physiology", title: "Large VSD, right ventricular outflow obstruction and an overriding aorta; its sizes are in Defect settings on the Valves tab" });
  b.addEventListener("click", () => c.edit((s) => patchHeart(s, (h) => { const n = { ...h }; if (n.tof) delete n.tof; else n.tof = { vsdMm: 8, rvotFrac: 0.15 }; return n; })));
  body.append(c.h("div", { className: "row" }, b));
  c.syncs.push((s) => { const on = !!heartOf(s).tof; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
}
