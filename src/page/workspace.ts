import { mountWorkspace } from "../panels/workspace";
import { CLINICAL_SCALES } from "../panels/timeControl";
import { monitorPanel } from "../panels/monitor";
import { ecgPanel } from "../panels/ecg";
import { numbersPanel } from "../panels/numbers";
import { tracesPanel } from "../panels/traces";
import { loopsPanel } from "../panels/loops";
import { rhcPanel } from "../panels/rightHeartCath";
import { leftHeartCathPanel } from "../panels/leftHeartCath";
import { jvpPanel } from "../panels/jvp";
import { oxygenPanel } from "../panels/oxygen";
import { BridgeSource } from "../sim/bridgeSource";
import { LiveSource } from "../sim/liveSource";
import { createWorkerSolver } from "../sim/bridgeWorkerSolver";
import type { Workspace } from "../panels/workspace";
import type { HemoSource } from "../sim/hemoSource";
import { $, S, sim, bridgeOpts, playClock, panelSource, setPanelSource } from "./state";
import { controlsUi } from "./readouts";

/** The workspace's "settling" note, shown while the core engine builds and warms up (panels have no beats yet). */
const settlingNote = document.createElement("div");
settlingNote.className = "ws-settling"; settlingNote.textContent = "Settling the hemodynamic model\u2026"; settlingNote.setAttribute("role", "status"); settlingNote.hidden = true;
export function settlingUi(on: boolean) { settlingNote.hidden = !on; }
// ---------------------------------------------------------------- the panels' source (task P16)
/**
 * The panels read the live core engine (`LiveSource`: beat-by-beat) for an adult patient the core can run. The bridge (a steady-state
 * solve of the structural engine replayed beat by beat, in a worker) stays for what the core does not represent yet: a neonate (the core
 * is the adult ACS patient) and any patient the core could not settle (`sim.coreNote`), and for the game's legacy engine.
 */
export let bridge: BridgeSource | null = null;
let liveSrc: LiveSource | null = null;
let workspace: Workspace | null = null;
const wantsBridge = () => sim.engine !== "core" || !!sim.coreNote || (bridgeOpts.patient?.kind ?? "adult") === "neonate";
function chooseSource(): HemoSource {
  if (wantsBridge()) { if (!bridge) { bridgeOpts.solver ??= createWorkerSolver(); bridge = new BridgeSource(sim, bridgeOpts); } return bridge; }
  return (liveSrc ??= new LiveSource(sim));
}
/** Point the panels at the right source; the one not in use is released (the bridge would otherwise keep solving for nothing). */
function syncSource() {
  const next = chooseSource();
  if (next === panelSource) return;
  setPanelSource(next);
  workspace?.setSource(next);
  if (next !== bridge && bridge) { bridge.dispose(); bridge = null; }
}
let patientTimer = 0;
/** Hand the PatientSpec on screen to the core engine (a structural change rebuilds and settles the heart, about a second, so slider drags wait for a pause). */
export function pushPatient(now = false) {
  clearTimeout(patientTimer);
  const go = () => { sim.setPatient(bridgeOpts.patient ?? {}); syncSource(); };
  if (now) go(); else patientTimer = window.setTimeout(go, 200);
}
/** The panel workspace, below the main view (not in the game). Its source is the live core engine of this page's Simulation, or for a
 *  neonate the bridge, which solves in a worker so the 3D view and ECG keep running (tasks P2b, P16). */
export function mountPanels() {
  const ws = $("workspace"); (ws.parentElement as HTMLElement).hidden = false;
  (ws.parentElement as HTMLElement).insertBefore(settlingNote, ws);
  pushPatient(true); // a link that was opened before the workspace existed has its structure in the core engine already; this settles the source choice
  const first = chooseSource(); setPanelSource(first);
  workspace = mountWorkspace(ws, [ecgPanel, tracesPanel, loopsPanel, monitorPanel, numbersPanel, oxygenPanel, rhcPanel, leftHeartCathPanel, jvpPanel], first, {
    clock: playClock, clinical: { scales: CLINICAL_SCALES, get: () => S.speed, set: (v) => { S.speed = v; controlsUi(); } }, // both clocks in the workspace bar
  });
  $("ts-l").style.display = $("ts-row").style.display = "none"; // the Lesion section's old time-scale buttons: now in the workspace bar
  setInterval(syncSource, 500); // the core engine may give up on a patient (coreNote) or take one back
}
