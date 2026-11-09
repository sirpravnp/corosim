import { mountWorkspace } from "../panels/workspace";
import { CLINICAL_SCALES } from "../panels/timeControl";
import { monitorPanel, monitorHooks, applyMonitorRows } from "../panels/monitor";
import { casePanels } from "./caseMonitor";
import { setCaseMonitorItems } from "./caseMonitorView";
import { itemById } from "../cases/orders";
import { ecgPanel } from "../panels/ecg";
import { numbersPanel } from "../panels/numbers";
import { tracesPanel } from "../panels/traces";
import { loopsPanel } from "../panels/loops";
import { rhcPanel } from "../panels/rightHeartCath";
import { leftHeartCathPanel } from "../panels/leftHeartCath";
import { jvpPanel } from "../panels/jvp";
import { coroPumpPanel } from "../panels/coroPump";
import { ischemiaPanel } from "./ischemiaPanel";
import { oxygenPanel } from "../panels/oxygen";
import { LiveSource } from "../sim/liveSource";
import type { Workspace } from "../panels/workspace";
import type { HemoSource } from "../sim/hemoSource";
import { $, S, sim, patientOpts, playClock, panelSource, setPanelSource } from "./state";
import { controlsUi, vitalsUi } from "./readouts";

/** The workspace's "settling" note, shown while the core engine builds and warms up (panels have no beats yet). */
const settlingNote = document.createElement("div");
settlingNote.className = "ws-settling"; settlingNote.textContent = "Settling the hemodynamic model\u2026"; settlingNote.setAttribute("role", "status"); settlingNote.hidden = true;
export function settlingUi(on: boolean) { settlingNote.hidden = !on; }
// ---------------------------------------------------------------- the panels' source (task P16)
/**
 * The panels read the live core engine (`LiveSource`: beat-by-beat). In the game, which runs the legacy engine, the source has no live
 * heart and the panels are not shown.
 */
let liveSrc: LiveSource | null = null;
let workspace: Workspace | null = null;
function chooseSource(): HemoSource { return (liveSrc ??= new LiveSource(sim)); }
/** Point the panels at the source (kept for the workspace; the live source follows the Simulation's heart by itself). */
function syncSource() {
  const next = chooseSource();
  if (next === panelSource) return;
  setPanelSource(next);
  workspace?.setSource(next);
}
let patientTimer = 0;
/** Hand the PatientSpec on screen to the core engine (a structural change rebuilds and settles the heart, about a second, so slider drags wait for a pause). */
export function pushPatient(now = false) {
  clearTimeout(patientTimer);
  const go = () => { sim.setPatient(patientOpts.patient ?? {}); syncSource(); };
  if (now) go(); else patientTimer = window.setTimeout(go, 200);
}
/** The panel workspace, below the main view (not in the game). Its source is the live core engine of this page's Simulation (task P16). */
export function mountPanels() {
  const ws = $("workspace"); (ws.parentElement as HTMLElement).hidden = false;
  (ws.parentElement as HTMLElement).insertBefore(settlingNote, ws);
  if (caseIds) queueMicrotask(() => setCaseMonitor(caseIds)); // a case began before the panels mounted: re-apply its monitor
  pushPatient(true); // a link that was opened before the workspace existed has its structure in the core engine already; this settles the source choice
  monitorHooks.draw = vitalsUi;
  const first = chooseSource(); setPanelSource(first);
  workspace = mountWorkspace(ws, [ecgPanel, tracesPanel, loopsPanel, monitorPanel, numbersPanel, ischemiaPanel, oxygenPanel, rhcPanel, leftHeartCathPanel, jvpPanel, coroPumpPanel], first, {
    clock: playClock, clinical: { scales: CLINICAL_SCALES, get: () => S.speed, set: (v) => { S.speed = v; controlsUi(); } }, // both clocks in the workspace bar
  });
  $("bedsfig").hidden = true; // its table now lives in the Ischemia panel (the game keeps the figure)
  $("ts-l").style.display = $("ts-row").style.display = "none"; // the Lesion section's old time-scale buttons: now in the workspace bar
}

/**
 * Set the case's monitor for this session: the ids of the monitor items shown (cases/orders.ts). The bedside monitor (caseMonitorView) draws
 * the strip (`ecg`) and the tiles (hr, bp, spo2, rr, temp). The workspace below holds only what the learner orders: a panel item opens its own
 * panel, and the Simulator's Monitor panel (rhythm name, Stable/Shock) is never opened in a case.
 * The viewer's saved layout is never written by this. Null restores it.
 */
let caseIds: string[] | null = null;
export function setCaseMonitor(ids: string[] | null): void {
  caseIds = ids;
  setCaseMonitorItems(ids);
  if (!workspace) return;
  const section = $("workspace").parentElement as HTMLElement;
  if (!ids) { monitorHooks.rows = null; workspace.setSession(null); applyMonitorRows(); section.hidden = false; return; }
  const panels = casePanels(ids, (id) => itemById(id)?.panel);
  monitorHooks.rows = null;
  workspace.setSession(panels);
  applyMonitorRows();
  section.hidden = panels.length === 0; // the "Live hemodynamics" heading appears only when something the learner ordered is open
}
