// ---------------------------------------------------------------- playground mode (task P12)
import { createPlaygroundUi } from "../panels/playgroundControls";
import { decodePatient, encodePatient } from "../sim/llm";
import { buildPlaygroundSpec, hasPlaygroundFields, stateOfSpec, withDevice } from "../sim/playground";
import { PRESET_BY_ID } from "../sim/presets";
import type { SlotId } from "../panels/playgroundControls";
import type { PlaygroundState } from "../sim/playground";
import type { PatientSpec } from "../sim/patient";
import { $, sim, T, on, inGame, bridgeOpts } from "./state";
import { propsView } from "./scene";
import { vesselGroup } from "./vessels3d";
import { loadScenario } from "./model";
import { bridge, pushPatient } from "./workspace";

/**
 * One PatientSpec drives the page. The Scenario part lives in `sim` and its existing controls; the rest is `pg`, edited by the
 * playground's controls. Every change rebuilds the spec (`buildPlaygroundSpec`: join, normalise, warn) and applies it: the
 * Scenario to the Simulation (when a load or the kind changes it), the whole spec to the bridge (`bridgeOpts.patient` and a
 * refresh), the props view, and the share link in the address bar (`#s=`).
 */
let pgOn = false, pg: PlaygroundState = {}, pgPreset: string | null = null, pgSticky: string[] = [], pgSig = "", pgRefreshTimer = 0;
const PG_MOVES: { slot: SlotId; from: string; skip: string }[] = [{ slot: "coronary", from: "lesionsec", skip: "H2" }, { slot: "rhythm", from: "patient", skip: "SUMMARY" }, { slot: "drugs", from: "volume", skip: "SUMMARY" }];
const pgMoved = new Map<string, Element[]>();
let pgUi: ReturnType<typeof createPlaygroundUi>;
/** The playground state of the patient on screen: the spec of a link plus the support switches as they are now. */
function pgFromLive(): PlaygroundState {
  const sup = sim.scenario().support ?? {};
  return stateOfSpec({ ...(bridgeOpts.patient ?? {}), support: { impella: !!sup.impella, iabp: !!sup.iabp } });
}
/** Neonates have no coronary view: its controls, tracings and the vessels go; the heart stays. */
function pgView() {
  const neo = (bridgeOpts.patient?.kind ?? pg.kind) === "neonate";
  document.body.classList.toggle("neonate", neo); vesselGroup.visible = !neo;
  $("pgbanner").hidden = !neo || inGame; // why the monitor does not match the panels (also kept after leaving playground, where the adult view is not restored automatically)
}
/** Rebuild the spec from the live Scenario and the playground state and apply it everywhere. */
function pgApply(refresh: boolean) {
  const built = buildPlaygroundSpec(sim.scenario(), pg), spec = built.spec;
  T.support.impella = !!spec.support?.impella; T.support.iabp = !!spec.support?.iabp; // the legacy device model follows the switches
  bridgeOpts.patient = spec; propsView.setPatient(spec);
  if (refresh) { clearTimeout(pgRefreshTimer); pgRefreshTimer = window.setTimeout(() => bridge?.refresh(), 150); pushPatient(); }
  try { window.history.replaceState(null, "", `${location.pathname}${location.search}#s=${encodePatient(spec)}`); } catch { /* sandboxed frame: the link field still shows it */ }
  pgSig = JSON.stringify([sim.scenario(), pg]);
  pgView();
  pgUi.sync(pg, { warnings: [...new Set([...pgSticky, ...built.warnings])], link: location.href, presetId: pgPreset });
}
/** Show or hide the playground; its groups hold the page's own controls while it is on. */
export function pgShow(on: boolean) {
  if (on === pgOn) return;
  pgOn = on;
  $("pgmount").hidden = !on; $("pg_on").classList.toggle("on", on); $("pg_off").classList.toggle("on", !on);
  $("pg_on").setAttribute("aria-pressed", String(on)); $("pg_off").setAttribute("aria-pressed", String(!on));
  for (const m of PG_MOVES) {
    const from = $(m.from);
    if (on) { const kids = [...from.children].filter((c) => c.tagName !== m.skip); pgMoved.set(m.from, kids); pgUi.slot(m.slot).append(...kids); }
    else from.append(...(pgMoved.get(m.from) ?? []));
    from.hidden = on;
  }
  if (on) { pg = pgFromLive(); pgPreset = null; pgSticky = []; pgUi.el.hidden = false; pgApply(false); }
  pgView();
}
/** Make `spec` the patient: its Scenario to the Simulation, the rest into the controls, then everything follows. */
export function pgAdopt(spec: PatientSpec, presetId: string | null = null) {
  const st = stateOfSpec(spec), built = buildPlaygroundSpec(spec, st);
  const wasOn = pgOn;
  if (!wasOn) pgShow(true);
  pg = st; pgPreset = presetId; pgSticky = built.warnings;
  bridgeOpts.patient = built.spec;
  const w = loadScenario(built.spec); if (w.length) console.warn("CoroSim: the patient was adjusted:", w.join("; "));
  pgApply(true);
}
/** A #s= link opens that patient, on load and when a link is pasted into an open tab. A link with playground fields opens in playground mode. */
export function openShared() {
  const shared = !inGame && location.hash.match(/^#s=([\w-]+)/);
  if (!shared) return;
  try {
    const spec = decodePatient(shared[1]);
    if (pgOn || hasPlaygroundFields(spec) || !inGame) { pgAdopt(spec); return; }
    bridgeOpts.patient = spec; bridge?.refresh(); propsView.setPatient(spec);
    const w = loadScenario(spec); pushPatient(true); if (w.length) console.warn("CoroSim: the shared patient was adjusted:", w.join("; ")); pgView(); }
  catch (e) { console.warn("CoroSim: could not open the shared patient", e); }
}
/** Build the playground's controls and start watching the existing controls for changes to the patient. */
export function initPatient() {
  pgUi = createPlaygroundUi({
    getState: () => pg,
    setState(next) {
      const wasNeonate = pg.kind === "neonate";
      pg = next; pgPreset = null;
      if (!wasNeonate) pgSticky = [];
      if (next.kind === "neonate" && sim.scenario().lesions?.length) { // a neonate has no coronary tree: drop the lesions from the simulation too
        const b = buildPlaygroundSpec(sim.scenario(), pg);
        loadScenario(b.spec); pgSticky = b.warnings.filter((w) => /neonate has no coronary tree/.test(w));
      }
      pgApply(true);
    },
    loadPreset(id) { const p = PRESET_BY_ID[id]; if (p) pgAdopt(p.spec, id); },
    exit: () => pgShow(false),
  });
  $("pgmount").append(pgUi.el);
  // The existing controls (lesions, rhythm, drugs, support) change the Scenario inside the Simulation: pick that up for the link and the bridge.
  setInterval(() => {
    if (!pgOn || inGame) return;
    for (const id of ["impella", "iabp"] as const) if (!!T.support[id] !== !!pg.devices?.[id]) pg = withDevice(pg, id, !!T.support[id]); // the Management switches and the playground's are one
    if (JSON.stringify([sim.scenario(), pg]) !== pgSig) pgApply(false);
  }, 300);
  on("pg_on", () => pgShow(true));
  on("pg_off", () => pgShow(false));
  on("pg_adult", () => { pgShow(true); pgUi.setKind("adult"); });
}
/** The playground state and spec, for `window.corosim.playground`. */
export const pgState = () => pg;
