// One headless core-engine run. LiveSource is created immediately after reset, and the insult is applied
// with Simulation.apply (what the page does). ECMO and Impella RP are inserted with setPatient, because
// apply() only retunes a circuit that is already in the heart; the page inserts them the same way.
import { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import type { PatientSpec } from "../../src/sim/patient";
import { context, snapshot, type Value } from "./variables";
import { CHECKPOINTS, type State } from "./states";

export const BASE_SPEC = { lesions: [] as never[] };
const WARM_S = 40;
export type Row = Record<string, Value>;
export interface SeedRun { state: string; seed: number; error?: string; warnings: string[]; at: Record<string, Row> }

function mergeSpec(base: PatientSpec, insult: PatientSpec): PatientSpec {
  const out: PatientSpec = { ...base, ...insult };
  for (const k of ["heart", "pericardium", "fluids", "ventilation", "devices", "support", "drugs", "patient", "autonomic", "anatomy", "electrolytes"] as const) {
    const a = base[k], b = insult[k];
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b))
      (out as Record<string, unknown>)[k] = { ...(a as object), ...(b as object) };
  }
  return out;
}

export function runOne(st: State, seed: number): SeedRun {
  const out: SeedRun = { state: st.id, seed, warnings: [], at: {} };
  try {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ ...BASE_SPEC, ...(st.baseline ?? {}), seed }, { settled: true, warmup: 30 });
    // The page makes its LiveSource first. A LiveSource only sees beats made after it exists; one made late has an empty ring
    // and falls back to a single stored warm-up beat (identical for every seed), which would make every baseline look the same.
    const src = new LiveSource(s);
    if (s.engine !== "core") throw new Error(`engine is ${s.engine}, not core`);
    if (s.coreNote) throw new Error(`core engine could not settle this patient: ${s.coreNote}`);
    s.warmup(WARM_S - 30);
    s.step(20);
    out.at["base"] = snapshot(context(s, src, 20));
    if (st.speed) s.speed = st.speed;
    const t0 = s.t;
    s.apply({ ...st.insult });
    // apply() does not insert a circuit that changes what the heart is built from. setPatient does, and it takes the whole spec.
    if (st.insult.devices) s.setPatient(mergeSpec(st.baseline ?? {}, st.insult));
    if (s.engine !== "core") throw new Error(`engine is ${s.engine}, not core`);
    if (s.coreNote) throw new Error(`core engine could not settle this patient: ${s.coreNote}`);
    const cps = [...(st.checkpoints ?? CHECKPOINTS)].sort((a, b) => a - b);
    const acts = [...(st.actions ?? [])].sort((a, b) => a.atS - b.atS);
    const events = [...cps.map((t) => ({ t, kind: "snap" as const })), ...acts.map((a) => ({ t: a.atS, kind: "act" as const, a }))].sort((x, y) => x.t - y.t || (x.kind === "act" ? -1 : 1));
    for (const e of events) {
      const dt = t0 + e.t - s.t;
      if (dt > 0) s.step(dt);
      if (e.kind === "act") e.a.run(s); else out.at[String(e.t)] = snapshot(context(s, src, Math.max(5, Math.min(20, e.t))));
    }
    out.warnings = s.warnings.slice();
  } catch (e) { out.error = (e as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? String(e); }
  return out;
}

export const cpOf = (st: State) => (st.checkpoints ?? CHECKPOINTS).slice().sort((a, b) => a - b);

export function summarise(runs: SeedRun[], cp: string, id: string, kind: string): string {
  const vals = runs.map((r) => r.at[cp]?.[id]).filter((x) => x !== undefined && x !== null) as Exclude<Value, null>[];
  if (!vals.length) return "";
  if (kind === "num") {
    const a = vals as number[], m = a.reduce((x, y) => x + y, 0) / a.length;
    const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
    return `${f(m)} (${f(Math.min(...a))}..${f(Math.max(...a))})`;
  }
  if (kind === "bool") return `p=${((vals as boolean[]).filter(Boolean).length / vals.length).toFixed(2)}`;
  const c = new Map<string, number>();
  for (const x of vals) c.set(String(x), (c.get(String(x)) ?? 0) + 1);
  const top = [...c.entries()].sort((a, b) => b[1] - a[1]);
  return top.length === 1 ? top[0][0] : `${top[0][0]} (${top[0][1]}/${vals.length}; also ${top.slice(1).map((x) => x[0]).join(" | ")})`;
}
