import { Simulation } from "../../sim/simulation";
import { LabEngine } from "../../lab/engine";
import { OLD_PRESETS, plaquesToScenario, segmentChoices, sliderToPlaque } from "../../lab/lesions";
import { cathReport, ffrCall, timi, wireModel, type CathReport, type WireModel } from "../../sim/cath";
import { WIRE } from "../../config/cath";
import { hintAction, type Hint } from "../../lab/hint";
import type { AccessVariant, Action, LabEngineLike, LesionSlider, Plaque } from "../../lab/types";
import type { Scenario } from "../../sim/scenario";

/**
 * The unified cath page's state, without a DOM: one patient (lesions, exertion), one Simulation and one procedure engine that
 * Set up, Diagnose and Treat all read. The page draws this; the tests drive it directly.
 */
export type Step = 1 | 2 | 3;
export const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: "Set up" }, { step: 2, label: "Diagnose" }, { step: 3, label: "Treat" },
];

export interface UnifiedState {
  step: Step;
  lesions: LesionSlider[];
  exertion: boolean;
  presetId: string | null;
  engine: LabEngineLike;
  sim: Simulation;
  /** Increments whenever the patient is rebuilt, so views know to drop cached pictures. */
  generation: number;
  /** Procedure steps the learner has undone on this patient: a practice aid, shown on the page. */
  undos: number;
}

export const ACCESS: AccessVariant = { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false };
const SIM_SEED = 4, ENGINE_SEED = 7;

/** A lesion's slider values clamped to its segment, the way the engine will see it. */
export function clampSlider(s: LesionSlider): LesionSlider {
  const p = sliderToPlaque(s);
  return { segId: p.segId, centerMm: p.centerMm, lengthMm: p.lengthMm, ds: p.ds };
}

export function plaquesOf(lesions: readonly LesionSlider[]): Plaque[] {
  return lesions.map(sliderToPlaque);
}

function build(lesions: LesionSlider[], exertion: boolean): { sim: Simulation; engine: LabEngine } {
  const plaques = plaquesOf(lesions);
  const sim = new Simulation({ seed: SIM_SEED, ...plaquesToScenario(plaques, exertion) });
  const engine = new LabEngine(sim, { seed: ENGINE_SEED, access: ACCESS, plaques });
  // the engine resets the patient to its baseline when it is built, so the ischemia (and the ECG's ST changes) settle after it
  sim.warmup(20);
  return { sim, engine };
}

export function createUnified(presetId = "lad75"): UnifiedState {
  const p = OLD_PRESETS.find((x) => x.id === presetId) ?? OLD_PRESETS[0]!;
  const lesions = p.lesions.map(clampSlider);
  const { sim, engine } = build(lesions, p.exertion);
  return { step: 1, lesions, exertion: p.exertion, presetId: p.id, engine, sim, generation: 0, undos: 0 };
}

/** True once the learner has done anything in the procedure: editing the lesions then would throw that work away. */
export const hasProcedure = (s: UnifiedState) => s.engine.state().log.some((a) => a.t !== "carm"); // turning the C-arm is not a procedure step

/**
 * Undo the last procedure step. The engine logs C-arm moves as actions too; they are stepped over, so Undo after a perforation
 * takes back the perforating advance, not the last turn of the C-arm. Returns whether a step was undone.
 */
export function undoStep(s: UnifiedState): boolean {
  const e = s.engine;
  const log = () => e.state().log;
  if (!log().some((a) => a.t !== "carm")) return false;
  while (e.canUndo() && log()[log().length - 1]!.t === "carm") e.undo();
  if (!e.canUndo()) return false;
  e.undo();
  s.undos += 1;
  return true;
}


/**
 * Put new lesions on the patient. A procedure in progress is reset only after `confirm` agrees; cancel keeps everything,
 * stents included. Returns whether the change went through.
 */
export function setLesions(s: UnifiedState, lesions: LesionSlider[], exertion: boolean, confirm: () => boolean = () => true, presetId: string | null = null): boolean {
  if (hasProcedure(s) && !confirm()) return false;
  const clean = lesions.map(clampSlider);
  // keep the same Simulation object so the ECG strips and monitor stay attached to its beat stream
  s.sim.reset({ seed: SIM_SEED, ...plaquesToScenario(plaquesOf(clean), exertion) }, { settled: true });
  s.engine = new LabEngine(s.sim, { seed: ENGINE_SEED, access: ACCESS, plaques: plaquesOf(clean) });
  s.sim.warmup(20);
  s.lesions = clean; s.exertion = exertion; s.presetId = presetId; s.generation += 1; s.undos = 0;
  return true;
}

/**
 * A simulator patient (a #s= link) as lesion sliders: each lesion the simulator resolved, placed at its position along the segment.
 * Lesions on vessels the builder cannot place are left out and named, so the learner knows what did not come across.
 */
export function slidersFromScenario(sc: Scenario): { lesions: LesionSlider[]; exertion: boolean; dropped: string[] } {
  const probe = new Simulation(sc);
  const lesions: LesionSlider[] = [], dropped: string[] = [];
  for (const l of probe.n.lesionSpecs) {
    const seg = segmentChoices().find((c) => c.segId === l.artery);
    if (!seg) { dropped.push(l.artery); continue; }
    lesions.push(clampSlider({ segId: seg.segId, centerMm: l.position * seg.lengthMm, lengthMm: Math.min(12, seg.lengthMm), ds: l.occluded ? 1 : l.stenosis }));
  }
  return { lesions, exertion: !!sc.exertion, dropped };
}

export function loadPreset(s: UnifiedState, id: string, confirm: () => boolean = () => true): boolean {
  const p = OLD_PRESETS.find((x) => x.id === id);
  if (!p) return false;
  return setLesions(s, p.lesions, p.exertion, confirm, p.id);
}

/** Moving between steps never touches the patient or the procedure. */
export function setStep(s: UnifiedState, step: Step) { s.step = step; }

/** A new lesion for the builder: the middle of the chosen segment, 70 percent, 12 mm long (clamped to the segment). */
export function newLesion(segId: string): LesionSlider {
  const seg = segmentChoices().find((c) => c.segId === segId) ?? segmentChoices()[1]!;
  return clampSlider({ segId: seg.segId, centerMm: seg.lengthMm / 2, lengthMm: Math.min(12, seg.lengthMm), ds: 0.7 });
}

/** Ranges for one lesion's sliders, from its segment's length. */
export function sliderRanges(segId: string): { lengthMm: number; position: [number, number]; length: [number, number] } {
  const seg = segmentChoices().find((c) => c.segId === segId);
  const L = seg?.lengthMm ?? 40;
  return { lengthMm: L, position: [0, Math.round(L)], length: [2, Math.max(2, Math.round(L))] };
}

/** One line for the patient: what the lesions are, as the Diagnose step would call them. */
export function lesionSummary(lesions: readonly LesionSlider[], exertion: boolean): string {
  const label = (id: string) => segmentChoices().find((c) => c.segId === id)?.label ?? id;
  const parts = lesions.filter((l) => l.ds > 0).map((l) => (l.ds >= 1 ? `${label(l.segId)} occluded` : `${label(l.segId)} ${Math.round(l.ds * 100)}%`));
  const body = parts.length ? parts.join(", ") : "No coronary lesions";
  return exertion ? `${body}, on exertion` : body;
}

/** Which coronary the target vessel hangs off: decides the guide and the injection. */
export function coronaryOf(segId: string): "LM" | "RCA" {
  return /^(RCA|PDA_R|PLV_R|AM|CONUS)/.test(segId) ? "RCA" : "LM";
}

// ---------------------------------------------------------------- Diagnose
export interface FlowTile { artery: string; label: string; grade: number; detail: string; tone: "" | "warn" | "bad" }
export interface DiagnoseModel { report: CathReport; flow: FlowTile[]; findings: { text: string; bad: boolean }[] }

export function diagnoseModel(sim: Simulation): DiagnoseModel {
  const report = cathReport(sim);
  const flow = report.flow.map((f) => {
    const t = timi(sim, f.artery);
    const detail = t.blockedAt !== null ? `cut off ${t.blockedAt.toFixed(0)} mm in` : t.frames !== null ? `${t.frames} frames` : "";
    return { artery: f.artery, label: f.artery === "LCX" ? "Circumflex" : f.artery, grade: t.grade, detail, tone: (t.grade === 0 ? "bad" : t.grade < 3 ? "warn" : "") as FlowTile["tone"] };
  });
  const findings = report.findings.map((x) => {
    const what = x.occluded ? `${x.artery} total occlusion` : `${x.artery} ${x.diameterStenosisPct}% stenosis (${x.minimumMm} mm lumen in a ${x.referenceMm} mm vessel)`;
    const ffr = x.ffr === null ? "" : `, FFR ${x.ffr.toFixed(2)} (${x.ffrCall})`;
    return { text: `${what}; TIMI ${x.timi.grade}${ffr}`, bad: x.occluded || x.timi.grade < 3 || (x.ffr !== null && x.ffr <= WIRE.ffrCutoff) };
  });
  if (!findings.length) findings.push({ text: "No coronary lesions: smooth vessels, TIMI 3 flow throughout.", bad: false });
  return { report, flow, findings };
}

export interface WireReadout { wire: WireModel; ffr: number | null; call: string; at: ReturnType<WireModel["at"]>; gradient: number | null }
/** The pressure wire in `artery` at `position` (0 ostium to 1 distal): FFR, the Pd/Pa there, and the drop across the vessel. */
export function wireReadout(sim: Simulation, artery: string, position: number): WireReadout {
  const wire = wireModel(sim, artery);
  const at = wire.at(Math.max(0, Math.min(1, position)));
  const ffr = wire.ffr;
  const gradient = ffr === null ? null : Math.max(0, wire.paHyperMmHg - ffr * wire.paHyperMmHg);
  return { wire, ffr, call: ffr === null ? "" : ffrCall(ffr), at, gradient };
}

// ---------------------------------------------------------------- Treat: hint to action
/** The one action Show me performs for a hint (the planner supplies it); null when there is nothing to do. */
export function hintToAction(h: Hint): Action | null {
  return h.action ?? hintAction(h) ?? null;
}

/** The goal the hint plans toward: the target vessel's lesion, else the first lesion. */
export function hintGoal(s: UnifiedState): { segId: string; centerMm: number } | null {
  const plaques = s.engine.plaques();
  const tgt = s.engine.state().targetSeg;
  // a stented lesion no longer narrows the vessel, but it is still the goal: the planner then says the work is done
  const p = plaques.find((x) => x.segId === tgt && x.ds > 0) ?? plaques.find((x) => x.ds > 0)
    ?? plaques.find((x) => x.segId === tgt) ?? plaques.find((x) => x.stents.length > 0);
  return p ? { segId: p.segId, centerMm: p.centerMm } : null;
}

// ---------------------------------------------------------------- Treat: resuscitation strip
export interface ResusModel { arrest: boolean; dead: boolean; tamponade: boolean; effusionMl: number; hypotensive: boolean; cprOn: boolean }
/** Which resuscitation controls are relevant now: CPR and shock in arrest, drainage with an effusion, pressors and fluids when the pressure is low. */
export function resusModel(sim: Simulation, engine: LabEngineLike): ResusModel {
  const a = sim.arrestState();
  const eff = engine.effusionMl ? engine.effusionMl() : 0;
  const map = sim.state().rolling10s.map ?? 90;
  return { arrest: a.status === "arrest", dead: sim.dead, tamponade: eff > 40, effusionMl: eff, hypotensive: map < 65, cprOn: a.cpr.on };
}
