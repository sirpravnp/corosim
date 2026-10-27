import { Variant, TYPICAL } from "../anatomy/tree";
import { untreated } from "../physics/revasc";
import { Scenario, LesionSpec } from "../sim/scenario";
import { tree, A, $, V, S, sim, takeTree, takeAnalysis, T, clearTreatment, pend, clearPending, on, range, PHYS_REST, PHYS, ecg } from "./state";
import { prepareMyocardium } from "./heart3d";
import { built, blockedFlags, buildVessels, lumen, shapeVessels, points, initParticles, buildGrafts } from "./vessels3d";
import { resetManageSig } from "./manage";
import { controlsUi, liveUi, physUi } from "./readouts";

let extraLesions: LesionSpec[] = []; // lesions from a loaded scenario beyond the one the controls edit

// ---------------------------------------------------------------- model
export function rebuildAnatomy() {
  T.treated = untreated(); T.pending = null; T.original = null; // a graft belongs to the tree it was sewn on
  sim.grafts = [];
  sim.apply({ anatomy: { ...V } });
  takeTree();
  const sel = $<HTMLSelectElement>("lseg");
  sel.innerHTML = tree.segments.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (!tree.byId[S.lesionSeg]) S.lesionSeg = "LAD";
  sel.value = S.lesionSeg;
  solve();
  prepareMyocardium();
  buildVessels(); initParticles(); points.visible = S.flow;
  buildGrafts();
}

/** Push the lesion controls and any grafts into the simulation; it re-solves the coronary network. */
function solve() {
  const mine: LesionSpec[] = S.ds > 0 || S.occ ? [{ artery: S.lesionSeg, stenosis: S.ds, occluded: S.occ, position: S.pos }] : [];
  sim.grafts = T.treated.grafts;
  sim.apply({ lesions: [...mine, ...extraLesions.filter((l) => l.artery !== S.lesionSeg)], exertion: S.exert });
  takeAnalysis();
}
export function flush() {
  if (pend.anatomy) { clearPending(); rebuildAnatomy(); controlsUi(); return; }
  if (pend.lesion) {
    pend.lesion = false;
    const before = tree.segments.map((sg) => A.cond.seg[sg.id].s.length);
    solve();
    // A stenosis adds fine samples inside its window, changing that vessel's ring count: rebuild those meshes.
    if (tree.segments.some((sg, i) => A.cond.seg[sg.id].s.length !== before[i])) { buildVessels(); initParticles(); }
    else { for (const b of built) { b.blocked = blockedFlags(b.seg); lumen(b); } shapeVessels(); }
    controlsUi();
  }
}

/** The anatomy presets: each is the typical variant with these fields changed. */
export const ANATOMY_PRESETS: Record<string, Partial<Variant>> = { typical: {}, left: { dominance: "left" }, ramus: { lm: "trifurcation" }, absent: { lm: "absent" } };
/** The preset whose variant equals the current anatomy, else "custom". */
export const anatomyPreset = (): string => Object.keys(ANATOMY_PRESETS).find((k) => (Object.keys(TYPICAL) as (keyof Variant)[]).every((f) => V[f] === ({ ...TYPICAL, ...ANATOMY_PRESETS[k] })[f])) ?? "custom";
export const syncSelects = () => { $<HTMLSelectElement>("dom").value = V.dominance; $<HTMLSelectElement>("lm").value = V.lm; $<HTMLSelectElement>("lad").value = V.ladCourse; $<HTMLSelectElement>("san").value = V.saNodeFrom; $<HTMLSelectElement>("conus").value = V.conusOstium; $<HTMLSelectElement>("anat").value = anatomyPreset(); };

function applyPhys() { sim.apply({ bloodLoss: PHYS.bl / 100, drugs: { betaBlocker: PHYS.bb / 100 } }); physUi(); }
export const setPhys = (p: Partial<typeof PHYS>) => { Object.assign(PHYS, p); applyPhys(); };
/** The Volume and drugs sliders and presets. */
export function wireVolume() {
  for (const k of Object.keys(PHYS) as (keyof typeof PHYS)[]) range(k, (v) => setPhys({ [k]: v }));
  on("x_bleed", () => setPhys({ bl: 20 })); on("x_reset", () => setPhys(PHYS_REST));
}

// ---------------------------------------------------------------- the simulation changed underneath the controls
/**
 * Bring every control and every mesh into line with the simulation after something other than the controls changed
 * it: a shared link, or an AI over the live connection. `reset` means the patient was replaced, so treatment starts over.
 */
export function adoptSimState(reset: boolean) {
  if (reset) { clearTreatment(); resetManageSig(); }
  const n = sim.n, first = n.lesionSpecs[0];
  Object.assign(V, n.anatomy);
  extraLesions = n.lesionSpecs.slice(1);
  if (first) { S.lesionSeg = first.artery; S.occ = !!first.occluded; S.ds = first.occluded ? 0 : first.stenosis; S.pos = first.position; } else { S.ds = 0; S.occ = false; }
  S.exert = n.exertion; S.rhythm = sim.patient.rhythm; S.bbb = sim.patient.bbb;
  T.support = { ...sim.support }; // the frame loop hands this back to the simulation every frame
  T.treated = sim.treated; // a PCI, lysis or graft the AI ordered
  Object.assign(PHYS, { bl: Math.round(n.bloodLoss * 100), bb: Math.round(n.drugs.betaBlocker * 100) });
  $<HTMLInputElement>("pos").value = String(S.pos * 100); $<HTMLInputElement>("ds").value = String(S.ds * 100);
  $<HTMLInputElement>("nor").value = String(T.support.norepi * 100); $<HTMLInputElement>("dob").value = String(T.support.dobutamine * 100); $<HTMLInputElement>("pacerate").value = String(T.support.paceRate);
  physUi(); syncSelects();
  if (ecg.stream !== sim.stream || Math.abs(sim.t - ecg.t) > 1) { ecg.stream = sim.stream; ecg.reset(sim.t); } // a new patient, or time jumped
  takeTree(); takeAnalysis();
  const sel = $<HTMLSelectElement>("lseg");
  sel.innerHTML = tree.segments.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
  if (!tree.byId[S.lesionSeg]) S.lesionSeg = "LAD";
  sel.value = S.lesionSeg;
  prepareMyocardium(); buildVessels(); initParticles(); points.visible = S.flow; buildGrafts();
  controlsUi(); liveUi();
}
/** Replace the patient with a scenario and settle it (the core engine does so in chunks while the page runs; `corosim.sim.settleNow()` waits for it). */
export function loadScenario(sc: Scenario): string[] {
  sim.reset(sc, { settled: true });
  sim.warmup(20);
  adoptSimState(true);
  return sim.warnings;
}
