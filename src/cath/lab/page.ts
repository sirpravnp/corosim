import "../cath.css";
import "./lab.css";
import "../../customSelect";
import { mountShell } from "../../shell/shell";
import { Simulation } from "../../sim/simulation";
import { angioModel, wireModel, AngioModel } from "../../sim/cath";
import { AngioView } from "../angio";
import { FluoroView, deviceGeometry, DeviceGeometry } from "./fluoro";
import { drawSchematic } from "./schematic";
import { scoreProcedure } from "../../lab/score";
import { EcgStrip } from "../../ecgStrip";
import { ARREST } from "../../config/arrest";
import type { LabEngine } from "../../lab/engine";
import { deviceFocus, zoneOf } from "../../lab/camera";
import { samplePoint } from "../../lab/geometry";
import type { V3 } from "../../anatomy/curve";
import { createEngine, catalog, PHYSICS_LIVE, CASE, SCENARIO } from "./engine";
import { camTarget, easeCam, isSchematic, Cam, CameraMode } from "./camera";
import { STANDARD_VIEWS as VIEWS, deviceShelf, monitorModel, eventFeed, procedureSummary, nextStep, Slot, Vitals } from "./panels";
import type { AccessSite, Action, LabEvent } from "../../lab/types";

/**
 * The PCI lab page: fluoroscopy on the simulator's own patient, with the procedure engine driving the devices.
 * All numbers come from the engine and the simulation; this file only draws them and turns clicks and keys into actions.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

mountShell({ page: "cath", root: "../../" }).ai.start();

const sim = new Simulation(SCENARIO);
sim.warmup(20);
const engine = createEngine(sim);
const view = new AngioView($<HTMLCanvasElement>("ang"));
view.opts.catheter = false; view.opts.loop = false; // one injection per press, and none until the first
const ecg = new EcgStrip($<HTMLCanvasElement>("ecg"), sim.stream); ecg.strip = ["II", "V3"]; ecg.reset(sim.t); // the paper starts from now: the strip's clock is the simulation's
const fluoro = new FluoroView($<HTMLCanvasElement>("dev"));
let model: AngioModel, geom: DeviceGeometry;
const log: LabEvent[] = [];

/** Where the wire went through the vessel, once it has: the picture leaks dye there. */
let perfPoint: V3 | null = null;
function noteEvents(events: LabEvent[]) {
  for (const e of events) {
    const d = e.data as { segId?: string; mm?: number } | undefined;
    if (e.kind === "perforation" && d?.segId) perfPoint = samplePoint(engine.graph(), d.segId, d.mm ?? 0);
  }
}
function remodel() { model = angioModel(sim); view.setModel(model, false); }

// ---------------------------------------------------------------- camera: Heart (the angiographic frame), Follow (the leading device tip) or Overview (puncture to heart)
let mode: CameraMode = "follow"; // a procedure starts at the puncture site and works up: Follow starts at the groin
let cam: Cam | null = null;
function setMode(m: CameraMode) {
  mode = m;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-cam]")) b.setAttribute("aria-pressed", String(b.dataset.cam === m));
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-cam]")) b.addEventListener("click", () => setMode(b.dataset.cam as CameraMode));
/** Bring a fresh procedure straight to the coronaries: access, sheath, heparin, the guide, then the guide to the left main. */
function skipToCoronaries() {
  const st = engine.state();
  if (!st.access) { act({ t: "access", site: "femoral-R" }); act({ t: "sheath", french: 6 }); act({ t: "drug", id: "heparin", dose: 6000 }); }
  if (!engine.state().guide) act({ t: "select", slot: "guide", id: CASE.recommended.guide });
  act({ t: "autoAdvance", to: "LM" }, true);
  setMode("heart"); setView(VIEWS[4].rot, VIEWS[4].tilt); // the spider view is the usual one to engage the left main
}
$("skip").addEventListener("click", skipToCoronaries);

/** Run one action, keep its events, and redraw everything that depends on the result. */
function act(a: Action, refreshVessels = false) {
  if (sim.dead) return; // nothing to do for a patient who has died
  // where the contrast goes depends on where the guide is: down a coronary it fills that tree, anywhere else it opacifies the aorta or the groin vessels
  const eng = engine.state().guide?.engaged ?? null;
  if (a.t === "inject") a = { ...a, where: eng === "RCA" ? "RCA" : eng === "LM" ? "LCA" : "aorta" };
  const events = engine.apply(a);
  log.push(...events); noteEvents(events);
  if (a.t === "inject" && events.some((e) => e.kind === "contrast")) {
    const g = engine.graph(), st = engine.state();
    view.opts.injection = eng === "RCA" ? "right" : eng === "LM" ? "left" : "none";
    view.opts.accessDye = eng ? null : {
      segs: [...g.segs.filter((sg) => zoneOf(sg.id, 0) !== "coronary"), ...(g.branches ?? [])].map((sg) => ({ id: sg.id, samples: sg.samples, diameterMm: sg.diameterMm, calcification: sg.calcification, length: sg.length })),
      origin: deviceFocus(st as never, g).point, reachMm: 260,
    };
    view.setModel(model, false); view.inject(!!eng);
  }
  if (refreshVessels || a.t === "inflate" || a.t === "deflate" || a.t === "deploy") remodel();
  render();
}

// ---------------------------------------------------------------- device shelf (built once, then enabled and disabled)
const slots: Slot[] = ["guide", "wire", "balloon", "stent"];
function buildShelf() {
  $("shelf").innerHTML = slots.map((s) => `<div class="slot" id="slot-${s}"><span></span><select id="sel-${s}" aria-label=""></select><button id="use-${s}">Use</button><p class="why" id="why-${s}" hidden></p></div>`).join("");
  for (const s of slots) $(`use-${s}`).addEventListener("click", () => act({ t: "select", slot: s, id: $<HTMLSelectElement>(`sel-${s}`).value }));
  const first = deviceShelf(engine.state(), catalog, engine.plaques());
  for (const sl of first) {
    const sel = $<HTMLSelectElement>(`sel-${sl.slot}`);
    sel.innerHTML = sl.options.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
    sel.setAttribute("aria-label", sl.label); $(`slot-${sl.slot}`).firstElementChild!.textContent = sl.label;
  }
}
function renderShelf() {
  for (const sl of deviceShelf(engine.state(), catalog, engine.plaques())) {
    const row = $(`slot-${sl.slot}`), sel = $<HTMLSelectElement>(`sel-${sl.slot}`), why = $(`why-${sl.slot}`);
    sel.disabled = !sl.enabled; ($(`use-${sl.slot}`) as HTMLButtonElement).disabled = !sl.enabled;
    row.classList.toggle("on", sl.selected !== null);
    why.hidden = sl.enabled; why.textContent = sl.reason ?? "";
    if (sl.selected && sel.value !== sl.selected) sel.value = sl.selected;
  }
}

// ---------------------------------------------------------------- readouts
/** The rhythm, from the main model: the arrest machine's class when the patient has no pulse, else what the strip measures. */
function rhythmName(): string {
  if (sim.dead) return "Dead";
  const cls = sim.rhythmClass().rhythmClass;
  if (cls === "vf") return "VF"; if (cls === "pulselessVt") return "Pulseless VT"; if (cls === "asystole") return "Asystole"; if (cls === "pea") return "PEA";
  const r = ecg.rhythm();
  return !r.hr ? "…" : r.atrial > 100 ? "Sinus tachycardia" : r.atrial > 0 && r.atrial < 60 ? "Sinus bradycardia" : r.pvc ? "Sinus, PVCs" : "Sinus rhythm";
}
function vitals(): Vitals {
  const r = sim.dead ? { hr: 0, map: 0, sbp: 0, dbp: 0 } : sim.state().rolling10s; // a dead patient has no pulse, whatever the last ten seconds averaged
  let ffr: number | null = null;
  try { ffr = wireModel(sim, "LAD").ffr; } catch { /* no such vessel */ }
  return { hr: r.hr, map: r.map, sbp: r.sbp, dbp: r.dbp, ffr, rhythm: rhythmName(), arrest: sim.dead || sim.arrestState().status === "arrest" };
}
function renderTiles() {
  $("tiles").innerHTML = monitorModel(vitals(), engine.state()).map((t) => `<div><b>${t.label}</b><span class="${t.tone}"><i>${esc(t.value)}</i><em>${esc(t.unit)}</em></span></div>`).join("");
}
/** The arrest status line, the ACLS buttons and the death screen: all read from the main model's arrest machine. */
function arrestUi() {
  const a = sim.arrestState(), st = $("status"), box = $("acls");
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, "0")}`;
  const arrested = a.status === "arrest";
  box.hidden = !arrested || sim.dead;
  $("cpr").textContent = a.cpr.on ? "Stop CPR" : "Start CPR";
  st.className = `status ${arrested || sim.dead ? "bad" : ""}`;
  st.textContent = sim.dead ? "" : arrested ? `Cardiac arrest, ${a.rhythmClass === "vf" ? "ventricular fibrillation" : a.rhythmClass === "pulselessVt" ? "pulseless ventricular tachycardia" : a.rhythmClass === "pea" ? "pulseless electrical activity" : "asystole"}. No flow ${clock(a.noFlowS)}; death at ${clock(ARREST.deathAfterNoFlowS)} without compressions and a rhythm change.` : a.status === "rosc" ? "Circulation restored. Look for the cause." : "";
  const dead = $("dead"); dead.hidden = !sim.dead;
  if (sim.dead) $("deadText").textContent = sim.deathCause === "shock" ? "The patient died in refractory shock." : "The patient died: no circulation for ten minutes.";
}
function acls(text: string, ok = true) { const ev: LabEvent = { at: engine.state().elapsedS, kind: "acls", text, severity: ok ? "info" : "caution" }; log.push(ev); render(); }
for (const [id, f] of [
  ["cpr", () => { const r = sim.arrest?.cpr.on ? sim.stopCpr() : sim.startCpr(); acls(r.ok ? (sim.arrest?.cpr.on ? "Compressions started." : "Compressions stopped.") : r.note ?? "No arrest.", r.ok); }],
  ["shock", () => { const r = sim.shock({ joules: 200 }); acls(r.note ?? (r.discharged ? (r.success ? "Shock delivered: the rhythm converted." : "Shock delivered: no conversion.") : "No shock delivered."), !!r.success); }],
  ["epi", () => { const r = sim.giveDrug("epinephrine", ARREST.drugs.epinephrine.doseMg); acls(r.ok ? "Epinephrine given." : r.note ?? "Not given.", r.ok); }],
  ["amio", () => { const n = sim.arrest?.drugs.filter((d) => d.drug === "amiodarone").length ?? 0; const r = sim.giveDrug("amiodarone", n ? ARREST.drugs.amiodarone.secondMg : ARREST.drugs.amiodarone.firstMg); acls(r.ok ? "Amiodarone given." : r.note ?? "Not given.", r.ok); }],
] as [string, () => void][]) $(id).addEventListener("click", f);
$("restart").addEventListener("click", () => $("reset").click());
function render() {
  const st = engine.state();
  geom = deviceGeometry(st, engine.graph(), engine.plaques(), (id) => catalog.find((d) => d.id === id));
  $("next").textContent = nextStep(st, engine.plaques());
  const lastEv = eventFeed(log, 1)[0], lastEl = $("last");
  lastEl.textContent = lastEv ? lastEv.text : ""; lastEl.className = `last ${lastEv?.severity ?? ""}`;
  renderShelf();
  renderTiles(); arrestUi();
  $("feed").innerHTML = eventFeed(log, 8).map((e) => `<li class="${e.severity}"><time>${e.at.toFixed(0)} s</time>${esc(e.text)}</li>`).join("");
  const s = procedureSummary(st);
  $("summary").textContent = `Contrast ${s.contrastMl} mL. Fluoroscopy ${s.fluoroLabel}. Air kerma ${s.doseMGy} mGy.`;
  $("monitorNote").textContent = PHYSICS_LIVE ? "" : "Preview: the procedure engine is not connected yet, so vital signs and FFR stay at the baseline of the untreated patient.";
  $("title").textContent = CASE.title;
  $<HTMLButtonElement>("doSheath").disabled = !st.access;
  const hb = ["doHeparin", "doNitro"]; for (const id of hb) $<HTMLButtonElement>(id).disabled = !st.access;
  const on = (id: string, v: boolean) => { $<HTMLButtonElement>(id).disabled = !v; };
  const wireIn = !!st.wire; ["advance", "retract", "rotL", "rotR"].forEach((id) => on(id, !!st.guide || wireIn));
  on("inject", !!st.sheathFr); // through the sheath or the guide
  const inflated = !!st.balloon && st.balloon.inflatedAtm > 0;
  on("inflate", !!st.balloon && !inflated); on("deflate", inflated); on("deploy", !!st.stent && !st.stent.deployed && !inflated);
}

// ---------------------------------------------------------------- controls
const angleText = () => { const o = view.opts; $("rotv").textContent = `${o.rot < 0 ? "RAO" : "LAO"} ${Math.abs(o.rot)}°`; $("tiltv").textContent = `${o.tilt < 0 ? "caud" : "cran"} ${Math.abs(o.tilt)}°`; };
const bindRange = (id: string, f: () => void) => $(id).addEventListener("input", f);
bindRange("rot", () => { view.opts.rot = +$<HTMLInputElement>("rot").value; angleText(); engine.apply({ t: "carm", rot: view.opts.rot, tilt: view.opts.tilt }); });
bindRange("tilt", () => { view.opts.tilt = +$<HTMLInputElement>("tilt").value; angleText(); engine.apply({ t: "carm", rot: view.opts.rot, tilt: view.opts.tilt }); });
$("lab").addEventListener("change", () => { view.opts.labels = $<HTMLInputElement>("lab").checked; });
bindRange("atm", () => { $("atmv").textContent = `${$<HTMLInputElement>("atm").value} atm`; });

const atm = () => +$<HTMLInputElement>("atm").value;
$("doAccess").addEventListener("click", () => act({ t: "access", site: $<HTMLSelectElement>("site").value as "femoral-R" }));
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
$("reset").addEventListener("click", () => { perfPoint = null; view.opts.perforation = null; engine.reset(); sim.reset(SCENARIO, { settled: true }); sim.warmup(20); ecg.reset(sim.t); log.length = 0; remodel(); render(); });

/** Hold a button to keep moving the device, about 55 mm a second. */
function holdToMove(id: string, mm: number) {
  const b = $(id); let timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; };
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); act({ t: "advance", mm }); timer = window.setInterval(() => act({ t: "advance", mm }), 70); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act({ t: "advance", mm }); } });
}
holdToMove("advance", 4); holdToMove("retract", -4);

function setView(rot: number, tilt: number) {
  view.opts.rot = Math.max(-60, Math.min(60, rot)); view.opts.tilt = Math.max(-45, Math.min(45, tilt));
  $<HTMLInputElement>("rot").value = String(view.opts.rot); $<HTMLInputElement>("tilt").value = String(view.opts.tilt);
  angleText(); engine.apply({ t: "carm", rot: view.opts.rot, tilt: view.opts.tilt });
}
const MODES: CameraMode[] = ["heart", "follow", "overview"];

// a mouse click leaves focus on the button, which used to swallow the keyboard: let go of it
document.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest?.("button"); if (b && (e as MouseEvent).detail > 0) b.blur(); });

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // let a focused button press itself
  const big = e.shiftKey ? 12 : 3, k = e.key.toLowerCase(), step = e.shiftKey ? 15 : 5;
  if (k === "w") act({ t: "advance", mm: big }); else if (k === "s") act({ t: "advance", mm: -big });
  else if (k === "a") act({ t: "torque", deg: -15 }); else if (k === "d") act({ t: "torque", deg: 15 });
  else if (k === "i") act({ t: "inflate", atm: atm(), seconds: 5 }); else if (k === "o") act({ t: "deflate" });
  else if (k === " ") act({ t: "inject", where: "LCA", ml: 6 });
  else if (k === "arrowleft") setView(view.opts.rot - step, view.opts.tilt); else if (k === "arrowright") setView(view.opts.rot + step, view.opts.tilt);
  else if (k === "arrowup") setView(view.opts.rot, view.opts.tilt + step); else if (k === "arrowdown") setView(view.opts.rot, view.opts.tilt - step);
  else if (k >= "1" && k <= "5") { const v = VIEWS[+k - 1]; setView(v.rot, v.tilt); }
  else if (k === "c") setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  else if (k === "v") { const box = $<HTMLInputElement>("lab"); box.checked = !box.checked; view.opts.labels = box.checked; }
  else if (k === "g") skipToCoronaries();
  else if (k === "k") { if (!($("acls") as HTMLElement).hidden) $("shock").click(); }
  else if (k === "p") { if (!($("acls") as HTMLElement).hidden) $("cpr").click(); }
  else if (k === "[") setView(view.opts.rot - step, view.opts.tilt); else if (k === "]") setView(view.opts.rot + step, view.opts.tilt);
  else return;
  e.preventDefault();
});

/** Score the procedure so far: the same rubric the engine tests use, listed with a note per item. */
$("score").addEventListener("click", () => {
  const r = scoreProcedure(engine as unknown as LabEngine, CASE);
  $("scoreOut").innerHTML = `<table class="score"><caption><b>Table 2.</b> Procedure score, ${r.total} of 100.</caption><tbody>${r.items.map((i) => `<tr><th scope="row">${esc(i.label)}</th><td>${i.points}/${i.max}</td><td>${esc(i.note)}</td></tr>`).join("")}</tbody></table>`;
});

buildShelf();
setView(0, 0); // AP for the vessels of the abdomen and pelvis; the number keys pick the usual coronary views
setMode(mode);
remodel();
render();
const angCtx = $<HTMLCanvasElement>("ang").getContext("2d")!;
const devCanvas = $<HTMLCanvasElement>("dev");
let lastFrame = performance.now(), tilesClock = 0, ringClock = 0;
/** Real time passes in the lab: the patient bleeds, ischemia builds and the rhythm runs whether or not the learner acts. */
function liveStep(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (sim.dead) { if ((tilesClock += dt) > 0.4) { tilesClock = 0; renderTiles(); arrestUi(); } return; } // death freezes the patient: nothing evolves until the learner restarts
  const events = engine.tick ? engine.tick(dt) : [];
  if (!engine.state().access) sim.step(dt, { minutes: 0 }); // before access the patient is just on the table: heart, pressure and ECG run, the infarct clock does not
  if (events.length) { log.push(...events); noteEvents(events); if (events.some((e) => ["perforation", "no-reflow", "spasm", "dissection", "arrest"].includes(e.kind))) remodel(); render(); }
  const fx = sim.ecgInputs();
  if (!sim.dead) ecg.step(dt, fx.injury, fx.tBoost, sim.rstate.rhythm, fx.potassium);
  ecg.draw();
  if ((tilesClock += dt) > 0.4) { tilesClock = 0; renderTiles(); arrestUi(); }
}
const frame = (now: number) => {
  liveStep(now);
  if (isSchematic(mode)) {
    // Overview: a schematic of the route, drawn without the fluoro backdrop
    drawSchematic(angCtx, devCanvas.width, devCanvas.height, engine.graph(), geom, engine.state());
    devCanvas.getContext("2d")!.clearRect(0, 0, devCanvas.width, devCanvas.height);
    requestAnimationFrame(frame);
    return;
  }
  view.opts.heartRate = sim.state().rolling10s.hr ?? 70;
  const want = camTarget(mode, engine.state(), engine.graph(), model.centre, $<HTMLSelectElement>("site").value as AccessSite);
  cam = cam ? easeCam(cam, want) : want;
  view.opts.cam = mode === "heart" && cam.spanMm === want.spanMm ? undefined : cam;
  view.opts.plaques = engine.plaques();
  view.opts.overlay = fluoro.att;
  view.opts.effusionMl = engine.effusionMl ? engine.effusionMl() : 0; view.opts.perforation = perfPoint ? { point: perfPoint } : null;
  fluoro.draw(now, model.centre, view.opts, geom, engine.state(), mode === "heart" ? null : engine.graph(), engine.plaques());
  view.draw(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
(window as unknown as { corosimLab: object }).corosimLab = { sim, engine, act, view, noteEvents };
