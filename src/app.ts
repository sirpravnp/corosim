import "./customSelect";
// Entry of the Simulator (/sim/) and the game (/game/) page. The page lives in the modules of src/page: state (shared singletons), scene and heart3d/vessels3d/markers
// (the 3D view), readouts and model (controls -> simulation -> text), manage (support, orders), game and gameUi (find the culprit), controls (event wiring),
// patient (playground state, shared links), workspace (panels and their source), connect (shell, AI line, versions) and loop (the frame loop).
// This file only wires them in the order the page needs and keeps `window.corosim` for scripts and browser-driving assistants.
import { $, S, sim, inGame, patientOpts, ecg, playClock, panelSource } from "./page/state";
import { setView, resize } from "./page/scene";
import { installHeart, loadHeartMesh, applyHeartView } from "./page/heart3d";
import { wireManage } from "./page/manage";
import { controlsUi, liveUi, physUi } from "./page/readouts";
import { rebuildAnatomy, syncSelects, wireVolume, loadScenario } from "./page/model";
import { wireControls, wirePicking } from "./page/controls";
import { wireGame } from "./page/game";
import { shell, cathLinkUi, applyMode, initShell } from "./page/connect";
import { mountPanels } from "./page/workspace";
import { pgShow, pgAdopt, openShared, initPatient, pgState } from "./page/patient";
import { frame } from "./page/loop";

wireManage(); wireControls(); wirePicking(); wireGame(); initShell(); wireVolume();

// Browsers restore form values on reload; force every control to match the model's starting state.
$<HTMLInputElement>("pos").value = String(S.pos * 100);
$<HTMLInputElement>("ds").value = String(S.ds * 100);
$<HTMLInputElement>("ex").value = String(S.exag);
physUi(); sim.warmup(20); ecg.reset(sim.t); // start with the reflexes already settled
resize(); setView("vAnt"); syncSelects(); rebuildAnatomy(); applyHeartView(); controlsUi(); liveUi(); applyMode();
initPatient();
openShared();
addEventListener("hashchange", openShared);
cathLinkUi();
// One Simulator: every control is always there (the separate "Playground" mode is gone); the game keeps its own plain controls.
$("pgentry").hidden = true;
if (!inGame) {
  pgShow(true);
  // Impella and balloon pump have one place: Patient, Mechanical support (with model, level and timing). Hide Management's duplicate switches.
  for (const id of ["m_iabp", "m_impella"]) { const b = $(id); for (const el of [b.previousElementSibling, b, b.nextElementSibling]) if (el) (el as HTMLElement).hidden = true; }
}
if (!inGame) mountPanels(); // not in the game (inGame is set by applyMode)
void shell.ai.start();
/** Handle for scripts and browser-driving assistants: corosim.sim, corosim.load(scenario), corosim.live. */
(window as unknown as { corosim: object }).corosim = { sim, load: loadScenario, playground: { source: () => panelSource, state: () => pgState(), spec: () => patientOpts.patient, adopt: pgAdopt, show: pgShow }, clock: playClock, live: shell.ai.live, account: shell.ai.account, refresh: () => { controlsUi(); liveUi(); } };
void loadHeartMesh().then(installHeart); // the heart appears when its mesh has been built (the page is live before that)
requestAnimationFrame(frame);
