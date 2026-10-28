// ---------------------------------------------------------------- playground mode (task P12)
import { createPlaygroundUi } from "../panels/playgroundControls";
import { decodePatient, encodePatient } from "../sim/llm";
import { buildPlaygroundSpec, hasPlaygroundFields, patchDevice, patchSection, stateOfSpec, withDevice } from "../sim/playground";
import { PRESET_BY_ID } from "../sim/presets";
import type { PlaygroundState } from "../sim/playground";
import type { PatientSpec } from "../sim/patient";
import { $, sim, T, on, inCases, patientOpts } from "./state";
import { hooks } from "./manage";
import { propsView } from "./scene";
import { loadScenario, setPhys } from "./model";
import { pushPatient } from "./workspace";
import { mountDock } from "./dock";

/**
 * One PatientSpec drives the page. The Scenario part lives in `sim` and its existing controls; the rest is `pg`, edited by the
 * playground's controls. Every change rebuilds the spec (`buildPlaygroundSpec`: join, normalise, warn) and applies it: the
 * Scenario to the Simulation (when a load changes it), the whole spec to the core engine (`patientOpts.patient`), the props view, and the share link in the address bar (`#s=`).
 */
let pgOn = false, pg: PlaygroundState = {}, pgPreset: string | null = null, pgSticky: string[] = [], pgSig = "";
let pgUi: ReturnType<typeof createPlaygroundUi>;
/** The playground state of the patient on screen: the spec of a link plus the support switches as they are now. */
function pgFromLive(): PlaygroundState {
  const sup = sim.scenario().support ?? {};
  return stateOfSpec({ ...(patientOpts.patient ?? {}), support: { impella: !!sup.impella, iabp: !!sup.iabp } });
}
/** Rebuild the spec from the live Scenario and the playground state and apply it everywhere. */
function pgApply(refresh: boolean) {
  const built = buildPlaygroundSpec(sim.scenario(), pg), spec = built.spec;
  T.support.impella = !!spec.support?.impella; T.support.iabp = !!spec.support?.iabp; // the legacy device model follows the switches
  patientOpts.patient = spec; propsView.setPatient(spec);
  if (refresh) pushPatient();
  if (!inCases) try { window.history.replaceState(null, "", `${location.pathname}${location.search}#s=${encodePatient(spec)}`); } catch { /* sandboxed frame: the link field still shows it */ } // a case keeps its patient out of the address bar
  pgSig = JSON.stringify([sim.scenario(), pg]);
  pgUi.sync(pg, { warnings: [...new Set([...pgSticky, ...built.warnings])], link: location.href, presetId: pgPreset, scenario: sim.scenario() });
}
/** Turn the patient editing on or off (the dock's controls are always in place; this starts and stops following the state into the link). */
export function pgShow(on: boolean) {
  if (on === pgOn) return;
  pgOn = on;
  $("pg_on").classList.toggle("on", on); $("pg_off").classList.toggle("on", !on);
  $("pg_on").setAttribute("aria-pressed", String(on)); $("pg_off").setAttribute("aria-pressed", String(!on));
  if (on) { pg = pgFromLive(); pgPreset = null; pgSticky = []; pgApply(false); }
}
/** Make `spec` the patient: its Scenario to the Simulation, the rest into the controls, then everything follows. */
export function pgAdopt(spec: PatientSpec, presetId: string | null = null) {
  const st = stateOfSpec(spec), built = buildPlaygroundSpec(spec, st);
  const wasOn = pgOn;
  if (!wasOn) pgShow(true);
  pg = st; pgPreset = presetId; pgSticky = built.warnings;
  patientOpts.patient = built.spec;
  const w = loadScenario(built.spec); if (w.length) console.warn("CoroSim: the patient was adjusted:", w.join("; "));
  pgApply(true);
}
/** Change the patient on screen mid-run (a case's complication or device): devices go through the playground state, which owns them and would put the old values back; the rest goes to the simulation. */
export function pgPatch(patch: PatientSpec) {
  let st = pg;
  for (const id of ["impella", "iabp", "ecmo", "impellaRp"] as const) if (patch.devices?.[id]) st = patchDevice(st, id, patch.devices[id] as never);
  pg = st;
  const { devices: _devices, ...rest } = patch;
  if (Object.keys(rest).length) sim.apply(rest);
  if (rest.support) T.support = { ...sim.support }; // the frame loop hands T.support to the simulation: it must hold what the case just gave (fluids, pacing, a drip)
  pgApply(true);
}
/** A #s= link opens that patient, on load and when a link is pasted into an open tab. A link with playground fields opens in playground mode. */
export function openShared() {
  const shared = !inCases && location.hash.match(/^#s=([\w-]+)/);
  if (!shared) return;
  try {
    const spec = decodePatient(shared[1]);
    if (pgOn || hasPlaygroundFields(spec) || !inCases) { pgAdopt(spec); return; }
    patientOpts.patient = spec; propsView.setPatient(spec);
    const w = loadScenario(spec); pushPatient(true); if (w.length) console.warn("CoroSim: the shared patient was adjusted:", w.join("; ")); }
  catch (e) { console.warn("CoroSim: could not open the shared patient", e); }
}
/** Build the patient controls into the settings dock and start watching the existing controls for changes to the patient. */
export function initPatient() {
  pgUi = createPlaygroundUi({
    getState: () => pg,
    setState(next) {
      pg = next; pgPreset = null; pgSticky = [];
      pgApply(true);
    },
    loadPreset(id) { const p = PRESET_BY_ID[id]; if (p) pgAdopt(p.spec, id); },
    exit: () => pgShow(false),
    legacy: () => false,
    scenario: () => sim.scenario(),
    // the Advanced group's fields live in the Scenario: the Simulation takes the change, then the spec and the link follow
    patch(p) { sim.apply(p); pgApply(false); },
    reseed(seed) { pgAdopt({ ...buildPlaygroundSpec(sim.scenario(), pg).spec, seed }, null); },
  });
  mountDock(pgUi.mounts);
  // The Support tab's one switch per device edits `devices.*`; the legacy `support.iabp` / `support.impella` follow in pgApply.
  hooks.device = (id, isOn) => { if (!pgOn) pgShow(true); pg = withDevice(pg, id, isOn); pgPreset = null; pgSticky = []; pgApply(true); };
  // Reset treatment: the devices, the boluses and the beta blocker go; the insult (blood loss, hemorrhage) stays
  hooks.resetTreatment = () => {
    let next: PlaygroundState = { ...pg, devices: undefined };
    next = patchSection(next, "fluids", { given: undefined });
    pg = next; pgPreset = null; setPhys({ bb: 0 }); pgApply(true);
  };
  // The existing controls (lesions, rhythm, drugs, support) change the Scenario inside the Simulation: pick that up for the link.
  setInterval(() => {
    if (!pgOn || inCases) return;
    for (const id of ["impella", "iabp"] as const) if (!!T.support[id] !== !!pg.devices?.[id]) pg = withDevice(pg, id, !!T.support[id]); // the Management switches and the playground's are one
    if (JSON.stringify([sim.scenario(), pg]) !== pgSig) pgApply(false);
  }, 300);
  on("pg_on", () => pgShow(true));
  on("pg_off", () => pgShow(false));
}
/** The playground state and spec, for `window.corosim.playground`. */
export const pgState = () => pg;
