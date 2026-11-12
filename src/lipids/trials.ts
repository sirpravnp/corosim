/**
 * View options on the stage (camera, thermogram), remembered in this browser. Each one also sets a class on the root
 * (`opt-camera`, `opt-thermo`) so CSS can follow it.
 */
export type Trial = "camera" | "thermo";
const KEY = "corosim-lipids-view";
const on = new Set<Trial>();
try { for (const t of JSON.parse(localStorage.getItem(KEY) ?? "[]")) if (t === "camera" || t === "thermo") on.add(t); } catch { /* storage unavailable: start with none */ }
const listeners: (() => void)[] = [];
function sync() { for (const t of ["camera", "thermo"] as const) document.documentElement.classList.toggle("opt-" + t, on.has(t)); }
sync();

export const trial = (t: Trial) => on.has(t);
export const onTrials = (f: () => void) => listeners.push(f);
export function setTrial(t: Trial, v = !on.has(t)) {
  if (v) on.add(t); else on.delete(t);
  try { localStorage.setItem(KEY, JSON.stringify([...on])); } catch { /* not remembered */ }
  sync(); for (const f of listeners) f();
}
