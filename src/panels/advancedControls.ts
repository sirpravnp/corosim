/**
 * The Patient tab's "Advanced" group: the fields that used to be reachable only from chat (the autonomic loop, serum potassium and
 * magnesium, the ectopy and arrhythmia tendencies, the random seed). Collapsed by default. DOM only; the Scenario part of the patient
 * is read through `scenario()` and changed through `patch()` (the page applies it to the Simulation), the seed through `reseed()`.
 * Every slider names its registry field (src/sim/registry.ts) and takes its one-line description from the registry's schema.
 */
import { FIELDS } from "../sim/registry";
import { defaultControls } from "../physics/autonomic";
import { ARRHYTHMIA } from "../config/arrhythmia";
import type { PatientSpec } from "../sim/patient";
import type { Scenario } from "../sim/scenario";

type H = <K extends keyof HTMLElementTagNameMap>(tag: K, props?: Partial<HTMLElementTagNameMap[K]> & { className?: string }, ...kids: (Node | string)[]) => HTMLElementTagNameMap[K];
export interface AdvancedCtx {
  h: H; ctlId: () => string; fields: string[];
  /** Run with the live Scenario every time the page syncs its controls. */
  scenarioSyncs: ((sc: Scenario) => void)[];
  scenario(): Scenario;
  patch(p: PatientSpec): void;
  reseed(seed: number): void;
  /** True on the legacy engine, which ignores the core-only fields. */
  legacy?: () => boolean;
}

const D = defaultControls();
const describe = (path: string) => String((FIELDS.find((f) => f.path === path)?.schema as { description?: string } | undefined)?.description ?? "");

/** Build the group. The caller appends the returned element after the rest of the Patient tab. */
export function buildAdvanced(c: AdvancedCtx): HTMLDetailsElement {
  const { h } = c;
  const box = h("details", { className: "fold pg-group pg-advanced", id: "pg-advanced" });
  const body = h("div", { className: "pg-body" });
  box.append(h("summary", {}, h("h2", { textContent: "Advanced" }), h("span", { className: "sum", textContent: "reflexes, electrolytes, ectopy, seed" })), body);
  body.append(h("p", { className: "note pg-note", textContent: "Teaching overrides of the patient's physiology. The default is marked on each slider; Reset advanced puts them all back (the seed is kept)." }));

  /** One slider on a Scenario field: `read` takes the value from the live Scenario, `make` the patch for a new value. */
  function slider(path: string, label: string, min: number, max: number, step: number, dflt: number, unit: string, read: (s: Scenario) => number | undefined, make: (sc: Scenario, v: number) => PatientSpec, core = false) {
    c.fields.push(path);
    const id = c.ctlId(), val = h("span", { className: "val" }), input = h("input", { id, type: "range", min: String(min), max: String(max), step: String(step) });
    const list = h("datalist", { id: `${id}-d` });
    list.append(h("option", { value: String(dflt) }));
    input.setAttribute("list", list.id);
    const fmt = (v: number) => `${+v.toFixed(2)}${unit}${Math.abs(v - dflt) < 1e-9 ? " (default)" : ""}`;
    body.append(h("label", { htmlFor: id }, label + " ", val), input, list, h("p", { className: "note pg-note", textContent: /default/i.test(describe(path)) ? describe(path) : `${describe(path)} Default ${dflt}${unit}.` }));
    input.addEventListener("input", () => { val.textContent = fmt(Number(input.value)); c.patch(make(c.scenario(), Number(input.value))); });
    c.scenarioSyncs.push((sc) => { const v = read(sc) ?? dflt; if (document.activeElement !== input) input.value = String(v); val.textContent = fmt(v); input.disabled = core && !!c.legacy?.(); });
  }
  const aut = (key: "baroreflexGain" | "respRate" | "respDepth" | "setPointShift" | "noise") => (sc: Scenario, v: number): PatientSpec => ({ autonomic: { ...sc.autonomic, [key]: v } });
  const lyte = (key: "potassium" | "magnesium" | "calcium") => (sc: Scenario, v: number): PatientSpec => ({ electrolytes: { potassium: ARRHYTHMIA.potassium.normal, magnesium: ARRHYTHMIA.magnesium.normal, calcium: ARRHYTHMIA.calcium.normal, ...sc.electrolytes, [key]: v } });

  slider("autonomic.baroreflexGain", "Baroreflex gain", 0, 4, 0.1, 1, "×", (s) => s.autonomic?.baroreflexGain, aut("baroreflexGain"));
  slider("autonomic.respRate", "Respiratory rate", 4, 40, 1, D.respRate, " /min", (s) => s.autonomic?.respRate, aut("respRate"));
  slider("autonomic.respDepth", "Breath depth", 0, 2, 0.1, D.respDepth, "", (s) => s.autonomic?.respDepth, aut("respDepth"));
  slider("autonomic.setPointShift", "Baroreceptor set point", -30, 60, 1, 0, " mmHg", (s) => s.autonomic?.setPointShift, aut("setPointShift"));
  slider("autonomic.noise", "Physiological noise", 0, 3, 0.1, 1, "×", (s) => s.autonomic?.noise, aut("noise"));
  slider("electrolytes.potassium", "Potassium", 2, 8.5, 0.1, ARRHYTHMIA.potassium.normal, " mmol/l", (s) => s.electrolytes?.potassium, lyte("potassium"), true);
  slider("electrolytes.magnesium", "Magnesium", 0.2, 3, 0.05, ARRHYTHMIA.magnesium.normal, " mmol/l", (s) => s.electrolytes?.magnesium, lyte("magnesium"), true);
  slider("electrolytes.calcium", "Calcium", 1.2, 3.6, 0.05, ARRHYTHMIA.calcium.normal, " mmol/l", (s) => s.electrolytes?.calcium, lyte("calcium"), true);
  slider("ectopyTendency", "Ectopy tendency", 0, 3, 0.1, 1, "×", (s) => s.ectopyTendency, (_s, v) => ({ ectopyTendency: v }), true);
  slider("arrhythmiaTendency", "Arrhythmia tendency", 0, 3, 0.1, 1, "×", (s) => s.arrhythmiaTendency, (_s, v) => ({ arrhythmiaTendency: v }), true);

  // the seed: a number and a button for a new one (a new seed is a new patient: the beats start over)
  c.fields.push("seed");
  const sid = c.ctlId(), seed = h("input", { id: sid, type: "number", min: "0", step: "1" });
  const fresh = h("button", { type: "button", id: "pg-newseed", textContent: "New random seed", title: "Draw another seed: the same patient with different random beats (ectopy, noise, who lyses)" });
  body.append(h("label", { htmlFor: sid, textContent: "Random seed" }), h("div", { className: "row pg-seedrow" }, seed, fresh), h("p", { className: "note pg-note", textContent: `${describe("seed")} Changing it starts the patient over, with treatment cleared. Default 1.` }));
  const setSeed = (n: number) => { if (Number.isFinite(n) && n >= 0) c.reseed(Math.trunc(n)); };
  seed.addEventListener("change", () => setSeed(Number(seed.value)));
  fresh.addEventListener("click", () => setSeed(1 + Math.floor(Math.random() * 999998)));
  c.scenarioSyncs.push((sc) => { if (document.activeElement !== seed) seed.value = String(sc.seed ?? 1); });

  const reset = h("button", { type: "button", id: "pg-advreset", textContent: "Reset advanced", title: "Put every advanced slider back to its default (the seed is kept)" });
  reset.addEventListener("click", () => c.patch({
    autonomic: { baroreflexGain: 1, respRate: D.respRate, respDepth: D.respDepth, setPointShift: 0, noise: 1 },
    electrolytes: { potassium: ARRHYTHMIA.potassium.normal, magnesium: ARRHYTHMIA.magnesium.normal, calcium: ARRHYTHMIA.calcium.normal }, ectopyTendency: 1, arrhythmiaTendency: 1,
  }));
  body.append(h("div", { className: "row" }, reset));
  return box;
}
