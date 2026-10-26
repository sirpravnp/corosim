// Shared state of the Simulator/game page: the singletons every page module reads and writes, so no module has to import another
// just to reach them. Values that are reassigned (tree, A, sites, rstate, circ, inGame, panelSource) are `let` exports with a
// setter here: importers see the current value through the ES live binding but only this file may assign it.
import { Tree, Variant, TYPICAL } from "../anatomy/tree";
import { Bbb, Rhythm } from "../config/ecg";
import { Analysis } from "../physics/network";
import { Circulation } from "../physics/circulation";
import { BedSite } from "../physics/ecgLink";
import { EcgStrip } from "../ecgStrip";
import { RhythmState } from "../physics/rhythm";
import { noSupport } from "../physics/support";
import { Pending, Treated, untreated } from "../physics/revasc";
import { Simulation } from "../sim/simulation";
import { PlayClock } from "../panels/timeControl";
import { Case, Point, TreatRecord } from "../game";
import type { PatientSpec } from "../sim/patient";
import type { BridgeSolver } from "../sim/bridgeSolver";
import type { HemoSource } from "../sim/hemoSource";

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const MMHG = 133.322;
export type Mode = "real" | "anat" | "pressure" | "velocity" | "wss" | "o2";
export type HeartView = "solid" | "ghost" | "none";


export const V: Variant = { ...TYPICAL };
export const S = {
  lesionSeg: "LAD", pos: 0.15, ds: 0, occ: false, exert: false, speed: 1,
  mode: "real" as Mode, heart: "solid" as HeartView, exag: 2.5, flow: false, selected: "",
  hide: false, // game: the lesion is kept out of every display (lumen, vessel shading, marker, perfusion table)
  hideIsch: false, // game: the myocardium does not darken either
  rhythm: "sinus" as Rhythm, bbb: "none" as Bbb, // what the patient brought with them
  props: false, // structural valves, defects and jets inside the heart (not in the game)
  posterior: false, // show V7–V9 as a fifth column
};
// The physics lives in the shared headless Simulation (the MCP server and the tests step the same object);
// the page modules draw it, feed it the controls, and run the game and the management panel around it.
// The simulator runs the beat-by-beat core engine (task P16: cannon a waves, PVC loops, AF, device waveforms, pericardium, ventilation, ECMO);
// the game keeps the legacy engine, whose cases and scoring were tuned to it.
// The core engine's build and warm-up (about 1.3 s of work) run in chunks between frames (`sim.settleStep`, in `frame`), so the page paints and answers at once.
const coreEngine = !/\/game(\/(index\.html)?)?$/.test(location.pathname);
export const sim = new Simulation({ seed: 1 }, { engine: coreEngine ? "core" : "legacy", deferCore: coreEngine });
export let tree: Tree = sim.tree, A: Analysis = sim.analysis, sites: BedSite[] = sim.sites;
/** Re-read the tree and its bed sites from the simulation (after an anatomy change). */
export const takeTree = () => { tree = sim.tree; sites = sim.sites; };
/** Re-read the coronary analysis from the simulation (after a lesion, perfusion pressure or demand change). */
export const takeAnalysis = () => { A = sim.analysis; };
export const sev = sim.sev; // per-bed ischemia state (0..1), evolves in time; the simulation clears it in place

// ---------------------------------------------------------------- management: support, orders, infarct
export const T = {
  support: noSupport(),
  pending: null as Pending | null,
  treated: untreated() as Treated,
  ischemicMin: 0, // clinical minutes with ischemia present
  seed: 11, // fixes whether this patient's clot lyses
  lastResult: "",
  hint: false,
  original: null as null | { seg: string; pos: number; ds: number; occ: boolean }, // the lesion before any procedure changed it
};
export const nec = sim.scar; // irreversible injury per bed, 0..1 (the simulation steps it on the clinical clock)
export const clearTreatment = () => {
  T.support = noSupport(); T.pending = null; T.treated = untreated(); T.ischemicMin = 0; T.lastResult = ""; T.hint = false; T.original = null;
  for (const k of Object.keys(nec)) delete nec[k];
};
// Lesion/anatomy edits are applied once per frame: the controls only mark what changed (model.ts `flush` does the work).
export const pend = { anatomy: false, lesion: false };
export const scheduleAnatomy = () => { pend.anatomy = true; };
export const scheduleLesion = () => { pend.lesion = true; };
export const clearPending = () => { pend.anatomy = pend.lesion = false; };

// ---------------------------------------------------------------- DOM helpers
export const on = (id: string, f: () => void) => $(id).addEventListener("click", f);
export const sel = (id: string, f: (v: string) => void) => $<HTMLSelectElement>(id).addEventListener("change", (e) => f((e.target as HTMLSelectElement).value));
export const range = (id: string, f: (v: number) => void) => $<HTMLInputElement>(id).addEventListener("input", (e) => f(+(e.target as HTMLInputElement).value));

// ---------------------------------------------------------------- game: find the culprit, one case a day
type Phase = "idle" | "play" | "treat" | "reveal";
/** The treatment phase as it runs: the clock, the baselines the infarct is judged against, and what was done. */
interface Treating extends TreatRecord { minutes: number; seconds: number; stableS: number; harmS: number; found: { result: string; pts: string; cls: string; total: number; distance: number } }
export const G = {
  phase: "idle" as Phase, day: "", score: 0,
  clock: 0, // s of the patient's time since the occlusion
  call: null as Point | null, // where the player has pressed on the tree
  rv: null as boolean | null, // the second question: is the right ventricle involved
  target: "", // the day the front door is for: today, or an archive day from ?day=
  kase: null as Case | null, saved: null as null | { V: Variant; S: Partial<typeof S> },
  treat: null as Treating | null,
};
/** The page at /game (set by connect.ts `applyMode`). */
export let inGame = false;
export const setInGame = (v: boolean) => { inGame = v; };

// ---------------------------------------------------------------- volume and drugs
// The reflexes themselves are not shown or controlled here: they are the physiology, and show up in rate and pressure.
export const PHYS_REST = { bl: 0, bb: 0 };
export const PHYS = { ...PHYS_REST };
/** The whole PatientSpec on screen (the structural fields the Scenario does not carry): read by the bridge at each solve and handed to the core engine (`sim.setPatient`). */
export const bridgeOpts: { patient?: PatientSpec; solver?: BridgeSolver } = {};

export const ecg = new EcgStrip($<HTMLCanvasElement>("ecg"), sim.stream);
/** Pause, slow motion and step-one-beat for the Simulator page (task P13); scales heartbeat time only, never the game. */
export const playClock = new PlayClock();
export let rstate: RhythmState | null = sim.rstate, circ: Circulation | null = sim.circ;
/** Re-read the rhythm and circulation state from the simulation (once per frame). */
export const takeRC = () => { rstate = sim.rstate; circ = sim.circ; };
/** What the 3D view's O2 mode and the panels read from: the live core engine or the bridge (workspace.ts `syncSource`). */
export let panelSource: HemoSource | null = null;
export const setPanelSource = (s: HemoSource | null) => { panelSource = s; };
