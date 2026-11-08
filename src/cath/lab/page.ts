import "../cath.css";
import "./lab.css";
import "../../customSelect";
import { mountShell } from "../../shell/shell";
import { Simulation } from "../../sim/simulation";
import { angioModel, wireModel, AngioModel } from "../../sim/cath";
import { AngioView } from "../angio";
import { FluoroView, deviceGeometry, DeviceGeometry } from "./fluoro";
import { createEngine, catalog, PHYSICS_LIVE } from "./engine";
import { deviceShelf, monitorModel, eventFeed, procedureSummary, nextStep, Slot, Vitals } from "./panels";
import type { Action, LabEvent } from "../../lab/types";

/**
 * The PCI lab page: fluoroscopy on the simulator's own patient, with the procedure engine driving the devices.
 * All numbers come from the engine and the simulation; this file only draws them and turns clicks and keys into actions.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

mountShell({ page: "cath", root: "../../" }).ai.start();

const SCENARIO = { seed: 1, lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.5 }] };
const sim = new Simulation(SCENARIO);
sim.warmup(20);
const engine = createEngine(sim);
const view = new AngioView($<HTMLCanvasElement>("ang"));
view.opts.catheter = false;
const fluoro = new FluoroView($<HTMLCanvasElement>("dev"));
let model: AngioModel, geom: DeviceGeometry;
const log: LabEvent[] = [];

function remodel() { model = angioModel(sim); view.setModel(model); }

/** Run one action, keep its events, and redraw everything that depends on the result. */
function act(a: Action, refreshVessels = false) {
  const events = engine.apply(a);
  log.push(...events);
  if (a.t === "inject") { const g = engine.state().guide?.engaged; view.opts.injection = g === "RCA" ? "right" : g === "LM" ? "left" : "both"; view.setModel(model); view.inject(); }
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
function vitals(): Vitals {
  const r = sim.state().rolling10s;
  let ffr: number | null = null;
  try { ffr = wireModel(sim, "LAD").ffr; } catch { /* no such vessel */ }
  return { hr: r.hr, map: r.map, sbp: r.sbp, dbp: r.dbp, ffr };
}
function render() {
  const st = engine.state();
  geom = deviceGeometry(st, engine.graph(), engine.plaques(), (id) => catalog.find((d) => d.id === id));
  $("next").textContent = nextStep(st, engine.plaques());
  renderShelf();
  $("tiles").innerHTML = monitorModel(vitals(), st).map((t) => `<div><b>${t.label}</b><span class="${t.tone}"><i>${esc(t.value)}</i><em>${esc(t.unit)}</em></span></div>`).join("");
  $("feed").innerHTML = eventFeed(log, 8).map((e) => `<li class="${e.severity}"><time>${e.at.toFixed(0)} s</time>${esc(e.text)}</li>`).join("");
  const s = procedureSummary(st);
  $("summary").textContent = `Contrast ${s.contrastMl} mL. Fluoroscopy ${s.fluoroLabel}. Air kerma ${s.doseMGy} mGy.`;
  $("monitorNote").textContent = PHYSICS_LIVE ? "" : "Preview: the procedure engine is not connected yet, so vital signs and FFR stay at the baseline of the untreated patient.";
  $<HTMLButtonElement>("doSheath").disabled = !st.access;
  const hb = ["doHeparin", "doNitro"]; for (const id of hb) $<HTMLButtonElement>(id).disabled = !st.access;
  const on = (id: string, v: boolean) => { $<HTMLButtonElement>(id).disabled = !v; };
  const wireIn = !!st.wire; ["advance", "retract", "rotL", "rotR"].forEach((id) => on(id, !!st.guide || wireIn));
  on("inject", !!st.guide);
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
$("reset").addEventListener("click", () => { engine.reset(); sim.reset(SCENARIO, { settled: true }); sim.warmup(20); log.length = 0; remodel(); render(); });

/** Hold a button to keep moving the device, about 55 mm a second. */
function holdToMove(id: string, mm: number) {
  const b = $(id); let timer = 0;
  const stop = () => { clearInterval(timer); timer = 0; };
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); act({ t: "advance", mm }); timer = window.setInterval(() => act({ t: "advance", mm }), 70); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act({ t: "advance", mm }); } });
}
holdToMove("advance", 4); holdToMove("retract", -4);

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const big = e.shiftKey ? 12 : 3, k = e.key.toLowerCase();
  const turn = (d: number) => { view.opts.rot = Math.max(-60, Math.min(60, view.opts.rot + d)); $<HTMLInputElement>("rot").value = String(view.opts.rot); angleText(); };
  if (k === "w") act({ t: "advance", mm: big }); else if (k === "s") act({ t: "advance", mm: -big });
  else if (k === "a") act({ t: "torque", deg: -15 }); else if (k === "d") act({ t: "torque", deg: 15 });
  else if (k === "i") act({ t: "inflate", atm: atm(), seconds: 5 }); else if (k === "o") act({ t: "deflate" });
  else if (k === " ") { e.preventDefault(); act({ t: "inject", where: "LCA", ml: 6 }); }
  else if (k === "[") turn(-5); else if (k === "]") turn(5); else return;
  e.preventDefault();
});

buildShelf();
angleText();
remodel();
render();
const frame = (now: number) => {
  view.opts.heartRate = sim.state().rolling10s.hr ?? 70;
  view.draw(now);
  fluoro.draw(now, model.centre, view.opts, geom, engine.state());
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
(window as unknown as { corosimLab: object }).corosimLab = { sim, engine, act };
