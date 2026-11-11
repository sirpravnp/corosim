import "../cath.css";
import "../lab/lab.css";
import "./unified.css";
import "../../customSelect";
import { mountShell } from "../../shell/shell";
import { mountCrossLinks } from "../../shell/crossLinkRow";
import { joinPatient } from "../../sim/crossLinks";
import { decodePatient } from "../../sim/llm";
import type { LiveSource } from "../../sim/liveSource";
import { openHeartSource } from "../heart";
import { rhcPanel } from "../../panels/rightHeartCath";
import { leftHeartCathPanel } from "../../panels/leftHeartCath";
import { angioModel, wireModel, type AngioModel } from "../../sim/cath";
import { AngioView, frameOf } from "../angio";
import { FluoroView, deviceGeometry, type DeviceGeometry } from "../lab/fluoro";
import { drawSchematic } from "../lab/schematic";
import { drawPullback } from "../pullback";
import { EcgStrip } from "../../ecgStrip";
import { ARREST } from "../../config/arrest";
import { CATALOG as catalog } from "../../config/labDevices";
import { deviceFocus, zoneOf } from "../../lab/camera";
import { samplePoint } from "../../lab/geometry";
import { nextHint, type Hint } from "../../lab/hint";
import { OLD_PRESETS, segmentChoices } from "../../lab/lesions";
import { applyCpr, applyFluid, applyPericardiocentesis, applyPressor, applyRestart, applyShock } from "../../lab/resus";
import type { V3 } from "../../anatomy/curve";
import { PadReader, padName, type PadCommand } from "./gamepad";
import { camTarget, easeCam, isSchematic, peripheralCam, peripheralDye, PERIPHERAL_VIEWS, type Cam, type CameraMode, type PeripheralView } from "../lab/camera";
import { STANDARD_VIEWS as VIEWS, deviceShelf, monitorModel, eventFeed, procedureSummary, nextStep, type Slot, type Vitals } from "../lab/panels";
import type { AccessSite, Action, LabEvent, LesionSlider } from "../../lab/types";
import {
  createUnified, setLesions, loadPreset, setStep, newLesion, sliderRanges, lesionSummary, coronaryOf, hasProcedure,
  diagnoseModel, wireReadout, hintToAction, hintGoal, resusModel, slidersFromScenario, undoStep, type Step,
} from "./model";

/**
 * The cath lab: one patient through Set up, Diagnose and Treat on the same realistic fluoroscopy. Numbers come from the
 * Simulation and the procedure engine (src/lab); this file draws them and turns clicks and keys into actions.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const CONFIRM = "Changing the lesions restarts the procedure: access, devices, stents and complications are cleared. Continue?";
const confirmReset = () => window.confirm(CONFIRM);

mountShell({ page: "cath", root: "../" }).ai.start();

const S = createUnified((location.hash.match(/case=([\w-]+)/)?.[1]) ?? "lad75");
const view = new AngioView($<HTMLCanvasElement>("ang"));
view.opts.loop = false;
const fluoro = new FluoroView($<HTMLCanvasElement>("dev"));
const ecg = new EcgStrip($<HTMLCanvasElement>("ecgFull"), S.sim.stream, "full"); ecg.reset(S.sim.t);
const hintCanvas = $<HTMLCanvasElement>("hintc");
let model!: AngioModel, geom!: DeviceGeometry;
const log: LabEvent[] = [];
let perfPoint: V3 | null = null;
let hint: Hint | null = null;
/** The vessel the learner chose to treat in Set up; sent to the engine once access is gained. */
let target: string | null = null;
let peri: PeripheralView | null = null;
let wireArtery = "LAD";

function remodel() { model = angioModel(S.sim); view.setModel(model, false); }
/** "Open in…" links carry the patient on screen, with whatever treatment has changed. */
const links = mountCrossLinks($("xlinks"), "cath", "../", () => joinPatient(S.sim.scenario()));
let linkNote = "";

// ---------------------------------------------------------------- steps
function goStep(step: Step) {
  setStep(S, step);
  document.body.dataset.step = String(step);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".stepbar button[data-step]")) {
    if (+b.dataset.step! === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  }
  for (const p of document.querySelectorAll<HTMLElement>("[data-panel]")) p.hidden = +p.dataset.panel! !== step;
  $("next").hidden = step !== 3;
  if (step !== 2) setPeri(null);
  if (step === 2) diagnoseUi();
  if (step === 3) applyTarget();
  render();
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".stepbar button[data-step]")) b.addEventListener("click", () => goStep(+b.dataset.step! as Step));
$("toDiagnose").addEventListener("click", () => goStep(2));
$("toTreat").addEventListener("click", () => goStep(3));

// ---------------------------------------------------------------- 1 Set up
function title(): string {
  const p = OLD_PRESETS.find((x) => x.id === S.presetId);
  return p ? p.title : "Custom patient";
}
/** A new patient was built (preset, slider or reset): drop everything drawn from the old one. */
function patientChanged() {
  log.length = 0; perfPoint = null; hint = null; view.opts.perforation = null; view.opts.injection = "none";
  ecg.reset(S.sim.t);
  if (!target || !S.lesions.some((l) => l.segId === target && l.ds > 0)) target = S.lesions.find((l) => l.ds > 0)?.segId ?? null;
  wireArtery = target ?? (S.lesions[0]?.segId ?? "LAD");
  remodel();
  setupUi();
  if (S.step === 2) diagnoseUi();
  render();
}
function commit(lesions: LesionSlider[], exertion: boolean, presetId: string | null = null): boolean {
  const ok = setLesions(S, lesions, exertion, confirmReset, presetId);
  if (ok) patientChanged(); else setupUi(); // a cancel puts the sliders back to the patient as it is
  return ok;
}

const SEGS = segmentChoices();
const segLabel = (id: string) => SEGS.find((s) => s.segId === id)?.label ?? id;
function segOptions(sel: string) { return SEGS.map((s) => `<option value="${s.segId}"${s.segId === sel ? " selected" : ""}>${esc(s.label)}</option>`).join(""); }

function setupUi() {
  $("presets").innerHTML = OLD_PRESETS.map((p) => `<button type="button" role="listitem" data-preset="${p.id}" aria-pressed="${p.id === S.presetId}">${esc(p.title)}<small>${esc(p.blurb)}</small></button>`).join("");
  $("lesions").innerHTML = S.lesions.length ? S.lesions.map((l, i) => {
    const r = sliderRanges(l.segId);
    return `<fieldset class="lesion" data-i="${i}">
      <legend>Lesion ${i + 1}</legend>
      <div class="row"><label class="field"><span>Artery</span><select data-k="seg" aria-label="Artery, lesion ${i + 1}">${segOptions(l.segId)}</select></label><button type="button" data-k="remove">Remove</button></div>
      <label class="slide"><span>Position</span><input type="range" data-k="pos" min="${r.position[0]}" max="${r.position[1]}" step="1" value="${Math.round(l.centerMm)}" aria-label="Position along the artery, lesion ${i + 1}"><output>${Math.round(l.centerMm)} mm</output></label>
      <label class="slide"><span>Severity</span><input type="range" data-k="ds" min="0" max="100" step="5" value="${Math.round(l.ds * 100)}" aria-label="Diameter stenosis, lesion ${i + 1}"><output>${l.ds >= 1 ? "occluded" : `${Math.round(l.ds * 100)}%`}</output></label>
      <label class="slide"><span>Length</span><input type="range" data-k="len" min="${r.length[0]}" max="${r.length[1]}" step="1" value="${Math.round(l.lengthMm)}" aria-label="Lesion length, lesion ${i + 1}"><output>${Math.round(l.lengthMm)} mm</output></label>
    </fieldset>`;
  }).join("") : `<p class="fine">No lesions: normal coronaries. Add one below.</p>`;
  $<HTMLSelectElement>("addSeg").innerHTML = segOptions("LAD");
  $<HTMLInputElement>("exertion").checked = S.exertion;
  const treatable = [...new Set(S.lesions.filter((l) => l.ds > 0).map((l) => l.segId))];
  $<HTMLSelectElement>("target").innerHTML = treatable.length ? treatable.map((id) => `<option value="${id}"${id === target ? " selected" : ""}>${esc(segLabel(id))}</option>`).join("") : `<option value="">No lesion to treat</option>`;
  $<HTMLSelectElement>("target").disabled = !treatable.length;
  const dup = S.lesions.some((l, i) => l.ds > 0 && S.lesions.some((m, j) => j < i && m.ds > 0 && m.segId === l.segId));
  $("setupNote").textContent = [linkNote, dup ? "Two lesions on one artery: the angiogram and the procedure show both, but the coronary flow model counts only the first." : ""].filter(Boolean).join(" ");
  $("patientLine").textContent = lesionSummary(S.lesions, S.exertion);
  $("title").textContent = title();
  links.refresh();
}
$("presets").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]"); if (!b) return;
  if (loadPreset(S, b.dataset.preset!, confirmReset)) { target = null; linkNote = ""; patientChanged(); }
});
$("lesions").addEventListener("input", (e) => { // live labels while dragging; the patient is rebuilt on release
  const inp = e.target as HTMLInputElement; if (inp.type !== "range") return;
  const out = inp.nextElementSibling as HTMLOutputElement;
  out.textContent = inp.dataset.k === "ds" ? (+inp.value >= 100 ? "occluded" : `${inp.value}%`) : `${inp.value} mm`;
});
$("lesions").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement, box = el.closest<HTMLElement>("[data-i]"); if (!box) return;
  const i = +box.dataset.i!, next = S.lesions.map((l) => ({ ...l }));
  const k = el.dataset.k;
  if (k === "seg") next[i] = newLesion(el.value);
  else if (k === "pos") next[i].centerMm = +el.value;
  else if (k === "ds") next[i].ds = +el.value / 100;
  else if (k === "len") next[i].lengthMm = +el.value;
  else return;
  commit(next, S.exertion);
});
$("lesions").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-k=remove]"); if (!b) return;
  const i = +b.closest<HTMLElement>("[data-i]")!.dataset.i!;
  commit(S.lesions.filter((_, j) => j !== i), S.exertion);
});
$("addLesion").addEventListener("click", () => commit([...S.lesions, newLesion($<HTMLSelectElement>("addSeg").value)], S.exertion));
$("exertion").addEventListener("change", () => commit(S.lesions, $<HTMLInputElement>("exertion").checked, S.presetId));
$("target").addEventListener("change", () => { target = $<HTMLSelectElement>("target").value || null; wireArtery = target ?? wireArtery; applyTarget(); render(); });

/** Tell the engine which vessel the wire is for, once there is access to tell it through. */
function applyTarget() {
  const st = S.engine.state();
  if (!target || !st.access || st.targetSeg === target) return;
  act({ t: "target", segId: target });
}

// ---------------------------------------------------------------- 2 Diagnose
function diagnoseUi() {
  heartSource();
  const d = diagnoseModel(S.sim);
  $("flow").innerHTML = d.flow.map((f) => `<div><b>${esc(f.label)} flow</b><span class="${f.tone}"><i>TIMI ${f.grade}</i><em>${esc(f.detail)}</em></span></div>`).join("");
  $("findings").innerHTML = d.findings.map((f) => `<li class="${f.bad ? "bad" : ""}">${esc(f.text)}</li>`).join("");
  const order = ["LM", "LAD", "LCX", "RCA"].filter((id) => S.sim.tree.byId[id]).concat(S.sim.tree.segments.map((s) => s.id).filter((id) => !["LM", "LAD", "LCX", "RCA"].includes(id)));
  if (!S.sim.tree.byId[wireArtery]) wireArtery = "LAD";
  $<HTMLSelectElement>("artery").innerHTML = order.map((id) => `<option value="${id}"${id === wireArtery ? " selected" : ""}>${esc(S.sim.tree.byId[id].name)}</option>`).join("");
  $<HTMLSelectElement>("inj").value = coronaryOf(wireArtery) === "RCA" ? "right" : "left";
  wireUi();
}
function wireUi() {
  const pos = +$<HTMLInputElement>("pos").value / 100;
  const r = wireReadout(S.sim, wireArtery, pos), p = r.at;
  $("posv").textContent = `${p.s.toFixed(0)} mm${p.stopped ? ", stopped" : ""}`;
  drawPullback($<HTMLCanvasElement>("pull"), r.wire, pos, S.sim.tree.byId[wireArtery]?.name ?? wireArtery);
  const ffrTile = r.ffr === null ? `<div><b>FFR</b><span class="bad">no flow: the wire cannot cross</span></div>`
    : `<div><b>FFR</b><span class="${r.ffr <= 0.8 ? "bad" : ""}"><i>${r.ffr.toFixed(2)}</i><em>${esc(r.call)}</em></span></div>`;
  $("wirestat").innerHTML = [
    ffrTile,
    `<div><b>Pd/Pa, hyperemia</b><span>${p.hyperRatio.toFixed(2)}<em>${p.hyperMmHg.toFixed(0)} / ${r.wire.paHyperMmHg.toFixed(0)} mmHg</em></span></div>`,
    `<div><b>Pd/Pa, rest</b><span>${p.restRatio.toFixed(2)}<em>${p.restMmHg.toFixed(0)} / ${r.wire.paRestMmHg.toFixed(0)} mmHg</em></span></div>`,
    `<div><b>Lumen at wire</b><span>${p.diameterMm.toFixed(1)}<em>mm</em></span></div>`,
  ].join("");
}
$("artery").addEventListener("change", () => { wireArtery = $<HTMLSelectElement>("artery").value; wireUi(); });
$("pos").addEventListener("input", wireUi);
$("dxInject").addEventListener("click", () => {
  setPeri(null);
  const eng = S.engine.state().guide?.engaged ?? null;
  const want = $<HTMLSelectElement>("inj").value as "left" | "right" | "both";
  // a diagnostic catheter stands in until the learner has a guide of their own in a coronary
  view.opts.catheter = !eng; view.opts.injection = eng ? (eng === "RCA" ? "right" : "left") : want; view.opts.accessDye = null;
  if (S.engine.state().access) S.engine.apply({ t: "inject", where: view.opts.injection === "right" ? "RCA" : view.opts.injection === "left" ? "LCA" : "aorta", ml: 8 });
  setMode("heart");
  view.setModel(model, false); view.inject(true);
  render();
});

/** A peripheral view frames its vessels on the AP projection and runs a contrast injection through them. */
function setPeri(v: PeripheralView | null) {
  peri = v;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-peri]")) b.setAttribute("aria-pressed", String(b.dataset.peri === v));
  if (!v) { view.opts.accessDye = null; return; }
  setView(PERIPHERAL_VIEWS[v].rot, PERIPHERAL_VIEWS[v].tilt);
  view.opts.catheter = false; view.opts.injection = "none";
  view.opts.accessDye = peripheralDye(v, S.engine.graph());
  view.setModel(model, false); view.inject(false);
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-peri]")) b.addEventListener("click", () => { setPeri(b.dataset.peri as PeripheralView); render(); });

// ---------------------------------------------------------------- 3 Treat
function noteEvents(events: LabEvent[]) {
  for (const e of events) {
    const d = e.data as { segId?: string; mm?: number } | undefined;
    if (e.kind === "perforation" && d?.segId) perfPoint = samplePoint(S.engine.graph(), d.segId, d.mm ?? 0);
  }
}
/** Run one action, keep its events, and redraw what depends on the result. */
function act(a: Action, refreshVessels = false) {
  if (S.sim.dead && a.t !== "restart") return;
  const eng = S.engine.state().guide?.engaged ?? null;
  if (a.t === "inject") a = { ...a, where: eng === "RCA" ? "RCA" : eng === "LM" ? "LCA" : "aorta" };
  const events = S.engine.apply(a);
  log.push(...events); noteEvents(events);
  if (a.t === "access") applyTarget();
  if (a.t === "inject" && events.some((e) => e.kind === "contrast")) {
    const g = S.engine.graph(), st = S.engine.state();
    view.opts.catheter = false;
    view.opts.injection = eng === "RCA" ? "right" : eng === "LM" ? "left" : "none";
    view.opts.accessDye = eng ? null : {
      segs: [...g.segs.filter((sg) => zoneOf(sg.id, 0) !== "coronary"), ...(g.branches ?? [])].map((sg) => ({ id: sg.id, samples: sg.samples, diameterMm: sg.diameterMm, calcification: sg.calcification, length: sg.length })),
      origin: deviceFocus(st as never, g).point, reachMm: 260,
    };
    view.setModel(model, false); view.inject(!!eng);
  }
  if (refreshVessels || ["inflate", "deflate", "deploy", "restart"].includes(a.t)) remodel();
  if (hint) refreshHint();
  render();
}

// device shelf, built once and then enabled and disabled
const slots: Slot[] = ["guide", "wire", "balloon", "stent"];
function buildShelf() {
  $("shelf").innerHTML = slots.map((s) => `<div class="slot" id="slot-${s}"><span></span><select id="sel-${s}" aria-label=""></select><button type="button" id="use-${s}">Use</button><p class="why" id="why-${s}" hidden></p></div>`).join("");
  for (const s of slots) $(`use-${s}`).addEventListener("click", () => act({ t: "select", slot: s, id: $<HTMLSelectElement>(`sel-${s}`).value }));
  for (const sl of deviceShelf(S.engine.state(), catalog, S.engine.plaques())) {
    const sel = $<HTMLSelectElement>(`sel-${sl.slot}`);
    sel.innerHTML = sl.options.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
    sel.setAttribute("aria-label", sl.label); $(`slot-${sl.slot}`).firstElementChild!.textContent = sl.label;
  }
}
function renderShelf() {
  for (const sl of deviceShelf(S.engine.state(), catalog, S.engine.plaques())) {
    const row = $(`slot-${sl.slot}`), sel = $<HTMLSelectElement>(`sel-${sl.slot}`), why = $(`why-${sl.slot}`);
    sel.disabled = !sl.enabled; $<HTMLButtonElement>(`use-${sl.slot}`).disabled = !sl.enabled;
    row.classList.toggle("on", sl.selected !== null);
    why.hidden = sl.enabled; why.textContent = sl.reason ?? "";
    if (sl.selected && sel.value !== sl.selected) sel.value = sl.selected;
  }
}

// hint and undo
function refreshHint() {
  const goal = hintGoal(S);
  hint = goal ? nextHint(S.engine, goal) : { kind: "none", why: "There is no lesion to treat. Add one in Set up." };
  const action = hintToAction(hint);
  $("hintText").textContent = hint.why;
  $<HTMLButtonElement>("showMe").disabled = !action || S.sim.dead;
}
$("hint").addEventListener("click", () => { if (hint) { hint = null; $("hintText").textContent = ""; $<HTMLButtonElement>("showMe").disabled = true; } else refreshHint(); render(); });
$("showMe").addEventListener("click", () => {
  if (!hint) return;
  const a = hintToAction(hint); if (!a) return;
  act(a, a.t === "target");
});
function undo() {
  if (!undoStep(S)) return;
  log.push({ at: S.engine.state().elapsedS, kind: "undo", text: "Undid the last action.", severity: "caution" });
  // the picture follows the restored patient: a sealed vessel, no leak, the effusion as it was
  perfPoint = null; view.opts.perforation = null;
  if ((S.engine.effusionMl?.() ?? 0) > 0) {
    const last = [...log].reverse().find((e) => e.kind === "perforation");
    const d = last?.data as { segId?: string; mm?: number } | undefined;
    if (d?.segId) perfPoint = samplePoint(S.engine.graph(), d.segId, d.mm ?? 0);
  }
  ecg.reset(S.sim.t);
  remodel();
  if (hint) refreshHint();
  render();
}
$("undo").addEventListener("click", undo);

// resuscitation: the engine's actions once there is access (so undo covers them), the same Simulation calls before it
function resus(kind: "cpr" | "shock" | "norepi" | "fluid" | "drain" | "restart") {
  const st = S.engine.state();
  if (st.access) {
    const cprOn = S.sim.arrestState().cpr.on;
    const a: Action = kind === "cpr" ? { t: "cpr", on: !cprOn } : kind === "shock" ? { t: "shock", joules: 200 }
      : kind === "norepi" ? { t: "pressor", id: "norepi", dose: 0.3 } : kind === "fluid" ? { t: "fluid", ml: 500 }
        : kind === "drain" ? { t: "pericardiocentesis", ml: Math.max(50, Math.round(S.engine.effusionMl?.() ?? 0)) } : { t: "restart" };
    act(a, kind === "restart");
    return;
  }
  const at = st.elapsedS;
  const ev = kind === "cpr" ? applyCpr(S.sim, !S.sim.arrestState().cpr.on) : kind === "shock" ? applyShock(S.sim, 200)
    : kind === "norepi" ? applyPressor(S.sim, "norepi", 0.3) : kind === "fluid" ? applyFluid(S.sim, 500)
      : kind === "drain" ? applyPericardiocentesis(S.sim, 100, 0, () => undefined).events : applyRestart(S.sim);
  log.push(...ev.map((e) => ({ ...e, at })));
  if (kind === "restart") { ecg.reset(S.sim.t); remodel(); }
  render();
}
$("cpr").addEventListener("click", () => resus("cpr"));
$("shock").addEventListener("click", () => resus("shock"));
$("norepi").addEventListener("click", () => resus("norepi"));
$("fluid").addEventListener("click", () => resus("fluid"));
$("drain").addEventListener("click", () => resus("drain"));
$("restart").addEventListener("click", () => resus("restart"));
function acls(text: string, ok = true) { log.push({ at: S.engine.state().elapsedS, kind: "acls", text, severity: ok ? "info" : "caution" }); render(); }
$("epi").addEventListener("click", () => { const r = S.sim.giveDrug("epinephrine", ARREST.drugs.epinephrine.doseMg); acls(r.ok ? "Epinephrine given." : r.note ?? "Not given.", r.ok); });
$("amio").addEventListener("click", () => {
  const n = S.sim.arrest?.drugs.filter((d) => d.drug === "amiodarone").length ?? 0;
  const r = S.sim.giveDrug("amiodarone", n ? ARREST.drugs.amiodarone.secondMg : ARREST.drugs.amiodarone.firstMg);
  acls(r.ok ? "Amiodarone given." : r.note ?? "Not given.", r.ok);
});
$("reset").addEventListener("click", () => { if (commit(S.lesions, S.exertion, S.presetId)) goStep(3); });

// ---------------------------------------------------------------- readouts
function rhythmName(): string {
  const sim = S.sim;
  if (sim.dead) return "Dead";
  const cls = sim.rhythmClass().rhythmClass;
  if (cls === "vf") return "VF"; if (cls === "pulselessVt") return "Pulseless VT"; if (cls === "asystole") return "Asystole"; if (cls === "pea") return "PEA";
  const r = ecg.rhythm();
  return !r.hr ? "…" : r.atrial > 100 ? "Sinus tachycardia" : r.atrial > 0 && r.atrial < 60 ? "Sinus bradycardia" : r.pvc ? "Sinus, PVCs" : "Sinus rhythm";
}
function vitals(): Vitals {
  const sim = S.sim, r = sim.dead ? { hr: 0, map: 0, sbp: 0, dbp: 0 } : sim.state().rolling10s;
  let ffr: number | null = null;
  try { ffr = wireModel(sim, target ?? "LAD").ffr; } catch { /* no such vessel */ }
  return { hr: r.hr, map: r.map, sbp: r.sbp, dbp: r.dbp, ffr, rhythm: rhythmName(), arrest: sim.dead || sim.arrestState().status === "arrest" };
}
function renderTiles() {
  $("tiles").innerHTML = monitorModel(vitals(), S.engine.state()).map((t) => `<div><b>${t.label}</b><span class="${t.tone}"><i>${esc(t.value)}</i><em>${esc(t.unit)}</em></span></div>`).join("");
}
function arrestUi() {
  const sim = S.sim, a = sim.arrestState(), st = $("status"), m = resusModel(sim, S.engine);
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, "0")}`;
  for (const id of ["cpr", "shock", "epi", "amio"]) $(id).hidden = !m.arrest || m.dead;
  $("cpr").textContent = m.cprOn ? "Stop CPR" : "Start CPR";
  $("drain").hidden = m.effusionMl <= 0 || m.dead;
  $("drain").textContent = `Pericardiocentesis (${Math.round(m.effusionMl)} mL)`;
  $("resusNote").textContent = m.dead ? "" : m.tamponade ? "Blood in the pericardium is compressing the heart: drain it." : m.hypotensive ? "The pressure is low: a pressor or fluid will support it." : "";
  st.className = `status ${m.arrest || m.dead ? "bad" : ""}`;
  st.textContent = m.dead ? "" : m.arrest ? `Cardiac arrest, ${a.rhythmClass === "vf" ? "ventricular fibrillation" : a.rhythmClass === "pulselessVt" ? "pulseless ventricular tachycardia" : a.rhythmClass === "pea" ? "pulseless electrical activity" : "asystole"}. No flow ${clock(a.noFlowS)}; death at ${clock(ARREST.deathAfterNoFlowS)} without compressions and a rhythm change.` : a.status === "rosc" ? "Circulation restored. Look for the cause." : "";
  $("dead").hidden = !m.dead;
  if (m.dead) $("deadText").textContent = sim.deathCause === "shock" ? "The patient died in refractory shock." : "The patient died: no circulation for ten minutes.";
}
function fig1(): string {
  if (isSchematic(mode)) return "Overview: a front-view schematic of the whole access route, not fluoroscopy, because no single x-ray field can hold it.";
  if (peri) return `${PERIPHERAL_VIEWS[peri].caption} Contrast moves through the vessels at their drawn caliber; the bones behind them turn with the C-arm.`;
  if (S.step === 1) return "Live fluoroscopy of the patient set up here, before any procedure. Inject in Diagnose to see the lesions.";
  if (S.step === 2) return "Coronary angiography. Contrast fills each vessel at its solved flow, so a tight lesion fills late and an occlusion stops the dye.";
  return "Live fluoroscopy. The guide, wire, balloon and stent are radiopaque devices in the same image; a dashed line marks the hint's next move when one is shown.";
}
function render() {
  const st = S.engine.state();
  geom = deviceGeometry(st, S.engine.graph(), S.engine.plaques(), (id) => catalog.find((d) => d.id === id));
  $("next").textContent = nextStep(st, S.engine.plaques());
  const lastEv = eventFeed(log, 1)[0], lastEl = $("last");
  lastEl.textContent = lastEv ? lastEv.text : ""; lastEl.className = `last ${lastEv?.severity ?? ""}`;
  renderShelf(); renderTiles(); arrestUi();
  $("feed").innerHTML = eventFeed(log, 8).map((e) => `<li class="${e.severity}"><time>${e.at.toFixed(0)} s</time>${esc(e.text)}</li>`).join("");
  const s = procedureSummary(st);
  $("summary").textContent = `Contrast ${s.contrastMl} mL. Fluoroscopy ${s.fluoroLabel}. Air kerma ${s.doseMGy} mGy.`;
  const on = (id: string, v: boolean) => { $<HTMLButtonElement>(id).disabled = !v; };
  on("doSheath", !!st.access); on("doHeparin", !!st.access); on("doNitro", !!st.access);
  const wireIn = !!st.wire; ["advance", "retract", "rotL", "rotR"].forEach((id) => on(id, !!st.guide || wireIn));
  on("inject", !!st.sheathFr);
  const inflated = !!st.balloon && st.balloon.inflatedAtm > 0;
  on("inflate", !!st.balloon && !inflated); on("deflate", inflated); on("deploy", !!st.stent && !st.stent.deployed && !inflated);
  on("undo", hasProcedure(S));
  const w = st.wire;
  $("tipv").textContent = !w ? "" : !w.bendDeg ? "Wire tip straight: shape a bend to steer into a branch." : `Wire tip bent ${w.bendDeg}°, turned ${(((Math.round(w.rotDeg) % 360) + 540) % 360) - 180}° from where it started.`;
  $("undoCount").textContent = S.undos ? `Undos used: ${S.undos}` : "";
  $("fig1Text").textContent = fig1();
}

// ---------------------------------------------------------------- camera and C-arm
let mode: CameraMode = "heart";
let cam: Cam | null = null;
function setMode(m: CameraMode) {
  mode = m; if (peri) setPeri(null);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-cam]")) b.setAttribute("aria-pressed", String(b.dataset.cam === m));
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-cam]")) b.addEventListener("click", () => setMode(b.dataset.cam as CameraMode));
/** The picture turns at once; the engine (fluoroscopy dose by angle) hears the angle once it has settled, so a drag is one C-arm move, not dozens. */
let carmTimer = 0;
function setView(rot: number, tilt: number) {
  view.opts.rot = Math.max(-60, Math.min(60, rot)); view.opts.tilt = Math.max(-45, Math.min(45, tilt));
  $<HTMLInputElement>("rot").value = String(view.opts.rot); $<HTMLInputElement>("tilt").value = String(view.opts.tilt);
  angleText();
  clearTimeout(carmTimer);
  carmTimer = window.setTimeout(() => {
    const c = S.engine.state().carm;
    if (S.engine.state().access && (c.rot !== view.opts.rot || c.tilt !== view.opts.tilt)) S.engine.apply({ t: "carm", rot: view.opts.rot, tilt: view.opts.tilt });
  }, 400);
}
const angleText = () => { const o = view.opts; $("rotv").textContent = `${o.rot < 0 ? "RAO" : "LAO"} ${Math.abs(o.rot)}°`; $("tiltv").textContent = `${o.tilt < 0 ? "caud" : "cran"} ${Math.abs(o.tilt)}°`; };
$("rot").addEventListener("input", () => setView(+$<HTMLInputElement>("rot").value, view.opts.tilt));
$("tilt").addEventListener("input", () => setView(view.opts.rot, +$<HTMLInputElement>("tilt").value));
$("lab").addEventListener("change", () => { view.opts.labels = $<HTMLInputElement>("lab").checked; });
$("atm").addEventListener("input", () => { $("atmv").textContent = `${$<HTMLInputElement>("atm").value} atm`; });

/** Bring a fresh procedure straight to the coronaries: access, sheath, heparin, the right guide for the target, engaged. */
function skipToCoronaries() {
  const root = coronaryOf(target ?? "LAD");
  if (!S.engine.state().access) { act({ t: "access", site: "femoral-R" }); act({ t: "sheath", french: 6 }); act({ t: "drug", id: "heparin", dose: 6000 }); }
  if (!S.engine.state().guide) act({ t: "select", slot: "guide", id: root === "RCA" ? "guide-jr4" : "guide-jl4" });
  act({ t: "autoAdvance", to: root }, true);
  setMode("heart");
  const v = root === "RCA" ? VIEWS[1] : VIEWS[4];
  setView(v.rot, v.tilt);
}
$("skip").addEventListener("click", skipToCoronaries);

const atm = () => +$<HTMLInputElement>("atm").value;
$("doAccess").addEventListener("click", () => { act({ t: "access", site: $<HTMLSelectElement>("site").value as AccessSite }); setMode("follow"); });
$("doSheath").addEventListener("click", () => act({ t: "sheath", french: 6 }));
$("doHeparin").addEventListener("click", () => act({ t: "drug", id: "heparin", dose: 6000 }));
$("doNitro").addEventListener("click", () => act({ t: "drug", id: "nitro", dose: 1 }));
$("shape").addEventListener("change", () => act({ t: "shape", tipBendDeg: +$<HTMLSelectElement>("shape").value }));
$("inject").addEventListener("click", () => act({ t: "inject", where: "LCA", ml: 6 }));
$("rotL").addEventListener("click", () => act({ t: "torque", deg: -15 }));
$("rotR").addEventListener("click", () => act({ t: "torque", deg: 15 }));
$("inflate").addEventListener("click", () => act({ t: "inflate", atm: atm(), seconds: 5 }));
$("deflate").addEventListener("click", () => act({ t: "deflate" }));
$("deploy").addEventListener("click", () => act({ t: "deploy", atm: atm(), seconds: 5 }));

/** Hold a button to keep moving the device. */
function holdToMove(id: string, mm: number) {
  const b = $(id); let timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; };
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); act({ t: "advance", mm }); timer = window.setInterval(() => act({ t: "advance", mm }), 70); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act({ t: "advance", mm }); } });
}
holdToMove("advance", 4); holdToMove("retract", -4);

document.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest?.("button"); if (b && (e as MouseEvent).detail > 0) b.blur(); });
const MODES: CameraMode[] = ["heart", "follow", "overview"];
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (/^(INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
  const big = e.shiftKey ? 12 : 3, k = e.key.toLowerCase(), step = e.shiftKey ? 15 : 5, treat = S.step === 3;
  if (k === "arrowleft") setView(view.opts.rot - step, view.opts.tilt); else if (k === "arrowright") setView(view.opts.rot + step, view.opts.tilt);
  else if (k === "arrowup") setView(view.opts.rot, view.opts.tilt + step); else if (k === "arrowdown") setView(view.opts.rot, view.opts.tilt - step);
  else if (k >= "1" && k <= "5") { const v = VIEWS[+k - 1]; setView(v.rot, v.tilt); }
  else if (k === "c") setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  else if (k === "v") { const box = $<HTMLInputElement>("lab"); box.checked = !box.checked; view.opts.labels = box.checked; }
  else if (!treat) return;
  else if (k === "w") act({ t: "advance", mm: big }); else if (k === "s") act({ t: "advance", mm: -big });
  else if (k === "a") act({ t: "torque", deg: -15 }); else if (k === "d") act({ t: "torque", deg: 15 });
  else if (k === "i") act({ t: "inflate", atm: atm(), seconds: 5 }); else if (k === "o") act({ t: "deflate" });
  else if (k === " ") act({ t: "inject", where: "LCA", ml: 6 });
  else if (k === "g") skipToCoronaries();
  else if (k === "h") $("hint").click();
  else if (k === "z") undo();
  else if (k === "k") { if (!$("shock").hidden) resus("shock"); }
  else if (k === "p") { if (!$("cpr").hidden) resus("cpr"); }
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- the hint's ghost arrow
/** A dashed line from the leading device tip to where the hint says to go, with a chevron. Grayscale: it is a device-side mark, not physiology. */
function drawHintArrow(now: number) {
  const g = hintCanvas.getContext("2d")!, W = hintCanvas.width, H = hintCanvas.height;
  g.clearRect(0, 0, W, H);
  if (!hint?.target || S.step !== 3 || isSchematic(mode) || peri || hint.kind === "none") return;
  let to: V3;
  try { to = samplePoint(S.engine.graph(), hint.target.segId, hint.target.mm); } catch { return; }
  const st = S.engine.state();
  const from: V3 | null = geom.wireTip ?? (geom.guide.length ? geom.guide[geom.guide.length - 1] : st.access ? deviceFocus(st as never, S.engine.graph()).point : null);
  const F = frameOf(model.centre, view.opts, now, W, H);
  const b = F.toScreen(to);
  g.save(); g.strokeStyle = "rgba(255,255,255,0.85)"; g.fillStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 2;
  if (from) {
    const a = F.toScreen(from);
    g.setLineDash([7, 6]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 12 * Math.cos(ang - 0.45), b[1] - 12 * Math.sin(ang - 0.45)); g.lineTo(b[0] - 12 * Math.cos(ang + 0.45), b[1] - 12 * Math.sin(ang + 0.45)); g.closePath(); g.fill();
  }
  g.beginPath(); g.arc(b[0], b[1], 9, 0, 6.283); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- right- and left-heart cath tabs (Diagnose), on a live source over the same patient
let source: LiveSource | null = null, sourceGen = -1;
const TABS = [
  { tab: $("tab-rhc"), body: $("tabpanel-rhc"), panel: rhcPanel.create() },
  { tab: $("tab-lhc"), body: $("tabpanel-lhc"), panel: leftHeartCathPanel.create() },
];
let activeTab = 0, tabsMounted = false;
function heartSource() {
  if (source && sourceGen === S.generation) return;
  source?.dispose(); source = openHeartSource(S.sim); sourceGen = S.generation;
  if (!tabsMounted) { TABS.forEach((t) => t.panel.mount(t.body, source!)); tabsMounted = true; }
  else TABS.forEach((t) => t.panel.setSource?.(source!));
}
function selectTab(i: number, focus = false) {
  activeTab = i;
  TABS.forEach((t, k) => { t.tab.setAttribute("aria-selected", String(k === i)); t.tab.tabIndex = k === i ? 0 : -1; t.body.hidden = k !== i; });
  if (focus) TABS[i].tab.focus();
  requestAnimationFrame(() => TABS[i].panel.resize?.());
}
TABS.forEach((t, i) => {
  t.tab.addEventListener("click", () => selectTab(i));
  t.tab.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key, n = TABS.length;
    const to = k === "ArrowRight" ? (i + 1) % n : k === "ArrowLeft" ? (i + n - 1) % n : k === "Home" ? 0 : k === "End" ? n - 1 : -1;
    if (to >= 0) { e.preventDefault(); selectTab(to, true); }
  });
});
window.addEventListener("resize", () => TABS[activeTab].panel.resize?.());

/** #case=id opens a preset; #s=… the patient from a simulator link, as sliders. */
function fromHash() {
  const h = location.hash, s = h.match(/^#s=([\w-]+)/)?.[1], id = h.match(/case=([\w-]+)/)?.[1];
  if (s) {
    try {
      const r = slidersFromScenario(decodePatient(s));
      if (commit(r.lesions, r.exertion)) linkNote = r.dropped.length ? `From the simulator. Not placed here: ${r.dropped.join(", ")}.` : "Patient from the simulator.";
      setupUi();
      return;
    } catch { /* a damaged link: fall through */ }
  }
  if (id && loadPreset(S, id, confirmReset)) { target = null; patientChanged(); }
}
window.addEventListener("hashchange", fromHash);

// ---------------------------------------------------------------- game controllers (Xbox, 8BitDo): polled every frame
const pads = new Map<number, PadReader>();
let viewIdx = 0;
function padConnected() {
  const list = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
  $("padStatus").textContent = list.length ? `Connected: ${list.map((p) => padName(p.id)).join(", ")}.` : "No controller connected. Press any button on a paired controller to wake it.";
}
window.addEventListener("gamepadconnected", padConnected);
window.addEventListener("gamepaddisconnected", padConnected);
function runPad(c: PadCommand) {
  const treat = S.step === 3;
  if (c.k === "carm") { setView(view.opts.rot + c.dRot, view.opts.tilt + c.dTilt); return; }
  if (c.k === "advance") { if (treat) act({ t: "advance", mm: c.mm }); return; }
  if (c.k === "torque") { if (treat) act({ t: "torque", deg: c.deg }); return; }
  switch (c.id) {
    case "inject": if (S.step === 2) $("dxInject").click(); else if (treat) act({ t: "inject", where: "LCA", ml: 6 }); break;
    case "viewPrev": case "viewNext": viewIdx = (viewIdx + (c.id === "viewNext" ? 1 : VIEWS.length - 1)) % VIEWS.length; setView(VIEWS[viewIdx].rot, VIEWS[viewIdx].tilt); break;
    case "camera": setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); break;
    default:
      if (!treat) return;
      if (c.id === "inflate") act({ t: "inflate", atm: atm(), seconds: 5 });
      else if (c.id === "deflate") act({ t: "deflate" });
      else if (c.id === "deploy") { if (!$<HTMLButtonElement>("deploy").disabled) act({ t: "deploy", atm: atm(), seconds: 5 }); }
      else if (c.id === "undo") undo();
      else if (c.id === "hint") { if (hint && !$<HTMLButtonElement>("showMe").disabled) $("showMe").click(); else if (!hint) $("hint").click(); }
      else if (c.id === "skip") skipToCoronaries();
      else if (c.id === "shock") { if (!$("shock").hidden) resus("shock"); }
      else if (c.id === "cpr") { if (!$("cpr").hidden) resus("cpr"); }
  }
}
function pollPads(dt: number) {
  const list = navigator.getGamepads?.() ?? [];
  for (const p of list) {
    if (!p || !p.connected) continue;
    let r = pads.get(p.index); if (!r) { r = new PadReader(); pads.set(p.index, r); padConnected(); }
    for (const c of r.read(p, dt)) runPad(c);
  }
}

// ---------------------------------------------------------------- the frame loop
buildShelf();
setView(30, -20);
remodel();
patientChanged();
if (/^#s=/.test(location.hash)) fromHash();
goStep(1);
padConnected();
const angCtx = $<HTMLCanvasElement>("ang").getContext("2d")!;
const devCanvas = $<HTMLCanvasElement>("dev");
let lastFrame = performance.now(), slowClock = 0;
/** Real time passes: the patient bleeds, ischemia builds and the rhythm runs whether or not the learner acts. */
function liveStep(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (S.sim.dead) { if ((slowClock += dt) > 0.4) { slowClock = 0; renderTiles(); arrestUi(); } return; }
  const events = S.engine.tick ? S.engine.tick(dt) : [];
  if (!S.engine.state().access) S.sim.step(dt, { minutes: 0 });
  if (events.length) {
    log.push(...events); noteEvents(events);
    if (events.some((e) => ["perforation", "no-reflow", "spasm", "dissection", "arrest"].includes(e.kind))) remodel();
    render();
  }
  const fx = S.sim.ecgInputs();
  ecg.step(dt, fx.injury, fx.tBoost, S.sim.rstate.rhythm, fx.potassium);
  if (($("ecg12") as HTMLDetailsElement).open) ecg.draw();
  if ((slowClock += dt) > 0.4) { slowClock = 0; renderTiles(); arrestUi(); }
  if (S.step === 2 && source) TABS[activeTab].panel.draw(S.sim.t);
}
let padClock = performance.now();
const frame = (now: number) => {
  pollPads(Math.min(0.05, (now - padClock) / 1000)); padClock = now;
  liveStep(now);
  if (isSchematic(mode) && !peri) {
    drawSchematic(angCtx, devCanvas.width, devCanvas.height, S.engine.graph(), geom, S.engine.state());
    devCanvas.getContext("2d")!.clearRect(0, 0, devCanvas.width, devCanvas.height);
    hintCanvas.getContext("2d")!.clearRect(0, 0, hintCanvas.width, hintCanvas.height);
    requestAnimationFrame(frame);
    return;
  }
  view.opts.heartRate = S.sim.state().rolling10s.hr ?? 70;
  const want = peri ? peripheralCam(peri, S.engine.graph()) : camTarget(mode, S.engine.state(), S.engine.graph(), model.centre, $<HTMLSelectElement>("site").value as AccessSite);
  cam = cam ? easeCam(cam, want) : want;
  view.opts.cam = mode === "heart" && !peri && Math.abs(cam.spanMm - want.spanMm) < 0.5 ? undefined : cam;
  view.opts.plaques = S.engine.plaques();
  view.opts.overlay = fluoro.att;
  view.opts.effusionMl = S.engine.effusionMl ? S.engine.effusionMl() : 0;
  view.opts.perforation = perfPoint ? { point: perfPoint } : null;
  const roadmap = mode === "heart" || peri ? null : S.engine.graph();
  fluoro.draw(now, model.centre, view.opts, geom, S.engine.state(), roadmap, S.engine.plaques());
  view.draw(now);
  drawHintArrow(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
(window as unknown as { corosimCath: object }).corosimCath = { state: S, act, view, goStep, setPeri, undo, hint: () => hint, hasProcedure: () => hasProcedure(S) };
