import "./cath.css";
import "../customSelect";
import { mountShell } from "../shell/shell";
import { Simulation } from "../sim/simulation";
import { Scenario } from "../sim/scenario";
import { decodeScenario } from "../sim/llm";
import { Procedure } from "../config/management";
import { angioModel, cathReport, ffrCall, timi, wireModel, AngioModel, WireModel, CathReport } from "../sim/cath";
import { WIRE } from "../config/cath";
import { AngioView } from "./angio";
import { drawPullback } from "./pullback";
import { CASES, CASE_BY_ID, CathCase } from "./cases";

/**
 * The cath lab: an angiogram with contrast filling at each vessel's solved flow, TIMI flow, and a pressure-wire pullback with FFR,
 * all read off the simulator's own patient (src/sim/cath.ts). Opens a library patient, or the one in a simulator link (#s=…).
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

mountShell({ page: "cath", root: "../" }).ai.start();
const sim = new Simulation({ seed: 1 });
const view = new AngioView($<HTMLCanvasElement>("ang"));
let current: CathCase = CASES[0];
let model!: AngioModel, report!: CathReport, wire!: WireModel;
let artery = "LAD";
let shared = false;

/** Put a patient in the lab and read everything the panels show. */
function load(c: CathCase, fromLink = false) {
  current = c; shared = fromLink;
  sim.reset(c.scenario, { settled: true });
  sim.warmup(20);
  $("treatResult").textContent = "";
  view.opts.rot = c.view.rot; view.opts.tilt = c.view.tilt; view.opts.injection = c.view.injection;
  $<HTMLInputElement>("rot").value = String(c.view.rot); $<HTMLInputElement>("tilt").value = String(c.view.tilt); $<HTMLSelectElement>("inj").value = c.view.injection;
  artery = c.artery;
  angleText();
  refresh();
  renderList();
}

/** Re-read the patient (after loading or after treatment) and redraw the panels. */
function refresh() {
  model = angioModel(sim);
  report = cathReport(sim);
  view.opts.heartRate = sim.state().rolling10s.hr ?? 70;
  view.setModel(model);
  $("title").textContent = current.title;
  $("summary").textContent = current.blurb;
  const order = ["LM", "LAD", "LCX", "RCA"].filter((id) => sim.tree.byId[id]).concat(sim.tree.segments.map((s) => s.id).filter((id) => !["LM", "LAD", "LCX", "RCA"].includes(id)));
  const sel = $<HTMLSelectElement>("artery");
  sel.innerHTML = order.map((id) => `<option value="${id}">${esc(sim.tree.byId[id].name)}</option>`).join("");
  if (!sim.tree.byId[artery]) artery = order.find((id) => id === "LAD") ?? order[0];
  sel.value = artery;
  const hasLesion = sim.n.lesionSpecs.length > 0;
  document.querySelectorAll<HTMLButtonElement>("#treat button[data-proc]").forEach((b) => (b.disabled = !hasLesion));
  flowUi();
  wireUi();
}

// ---------------------------------------------------------------- angiogram readout
function flowUi() {
  const tile = (id: string) => {
    const t = timi(sim, id, model);
    const bad = t.grade < 3;
    const where = t.blockedAt !== null ? ` · cut off ${t.blockedAt.toFixed(0)} mm in` : t.frames !== null ? ` · ${t.frames} frames` : "";
    return `<div><b>${id === "LCX" ? "Circumflex" : id} flow</b><span class="${t.grade === 0 ? "bad" : bad ? "warn" : "ok"}">TIMI ${t.grade}${where}</span></div>`;
  };
  $("flow").innerHTML = report.flow.map((t) => tile(t.artery)).join("");
  const f = report.findings.map((x) => {
    const what = x.occluded ? `${x.artery} total occlusion` : `${x.artery} ${x.diameterStenosisPct}% stenosis (${x.minimumMm} mm lumen in a ${x.referenceMm} mm vessel)`;
    const ffr = x.ffr === null ? "" : `, FFR ${x.ffr.toFixed(2)} (${x.ffrCall})`;
    return `<li class="${x.occluded || x.timi.grade < 3 || (x.ffr !== null && x.ffr <= WIRE.ffrCutoff) ? "bad" : ""}">${esc(what)}; TIMI ${x.timi.grade}${esc(ffr)}</li>`;
  });
  if (!f.length) f.push("<li>No coronary lesions: smooth vessels, TIMI 3 flow throughout.</li>");
  $("findings").innerHTML = f.join("");
}

// ---------------------------------------------------------------- pressure wire
function wireUi() {
  wire = wireModel(sim, artery);
  const pos = +$<HTMLInputElement>("pos").value / 100;
  const p = wire.at(pos);
  $("posv").textContent = `${p.s.toFixed(0)} mm${p.stopped ? " · stopped" : ""}`;
  drawPullback($<HTMLCanvasElement>("pull"), wire, pos, sim.tree.byId[artery].name);
  const ffr = wire.ffr;
  const call = ffr === null ? "" : ffrCall(ffr);
  const tiles = [
    ffr === null ? `<div><b>FFR</b><span class="bad">no flow: the wire cannot cross</span></div>`
      : `<div><b>FFR</b><span class="${ffr <= WIRE.ffrCutoff ? "bad" : "ok"}">${ffr.toFixed(2)} · ${call}</span></div>`,
    `<div><b>Pd/Pa at wire, hyperemia</b><span>${p.hyperRatio.toFixed(2)} (${p.hyperMmHg.toFixed(0)} / ${wire.paHyperMmHg.toFixed(0)} mmHg)</span></div>`,
    `<div><b>Pd/Pa at wire, rest</b><span>${p.restRatio.toFixed(2)} (${p.restMmHg.toFixed(0)} / ${wire.paRestMmHg.toFixed(0)} mmHg)</span></div>`,
    `<div><b>Lumen at wire</b><span>${p.diameterMm.toFixed(1)} mm</span></div>`,
  ];
  $("wirestat").innerHTML = tiles.join("");
}

// ---------------------------------------------------------------- patient library and loading
function renderList() {
  const lib = CASES.map((c) => `<a data-id="${c.id}" class="${!shared && c.id === current.id ? "on" : ""}" href="#case=${c.id}">${esc(c.title)}<small>${esc(c.blurb)}</small></a>`);
  if (shared) lib.unshift(`<a class="on" href="#">Patient from the simulator<small>${esc(current.blurb)}</small></a>`);
  $("list").innerHTML = lib.join("");
}

/** The injection side and the artery to start on, chosen from where the patient's first lesion is. */
function caseFromScenario(sc: Scenario): CathCase {
  const first = sc.lesions?.[0]?.artery?.toUpperCase();
  const right = !!first && /^(RCA|AM|CONUS|PDA|PLV|SAN|AVN)/.test(first);
  const probe = new Simulation(sc);
  const art = first && probe.tree.byId[probe.n.lesionSpecs[0]?.artery ?? ""] ? probe.n.lesionSpecs[0].artery : "LAD";
  return {
    id: "link", title: "Patient from the simulator", scenario: sc,
    blurb: probe.n.lesionSpecs.length ? probe.n.lesionSpecs.map((l) => (l.occluded ? `${l.artery} occluded` : `${l.artery} ${Math.round(l.stenosis * 100)}% stenosis`)).join("; ") + "." : "No coronary lesions.",
    view: right ? { injection: "right", rot: 30, tilt: 0 } : { injection: "left", rot: 30, tilt: 25 }, artery: art,
  };
}

/** #case=id opens a library patient, #s=… the patient from a simulator link; anything else, the first case. */
function fromHash() {
  const h = location.hash, s = h.match(/^#s=([\w-]+)/)?.[1], id = h.match(/case=([\w-]+)/)?.[1];
  if (s) { try { return load(caseFromScenario(decodeScenario(s)), true); } catch { /* a damaged link: fall through to the library */ } }
  load((id && CASE_BY_ID[id]) || CASES[0]);
}

// ---------------------------------------------------------------- controls
const bind = (id: string, f: () => void) => $(id).addEventListener("input", f);
const angleText = () => {
  const o = view.opts;
  $("rotv").textContent = `${o.rot < 0 ? "RAO" : "LAO"} ${Math.abs(o.rot)}°`; $("tiltv").textContent = `${o.tilt < 0 ? "caud" : "cran"} ${Math.abs(o.tilt)}°`;
};
bind("rot", () => { view.opts.rot = +$<HTMLInputElement>("rot").value; angleText(); });
bind("tilt", () => { view.opts.tilt = +$<HTMLInputElement>("tilt").value; angleText(); });
$("inj").addEventListener("change", () => { view.opts.injection = $<HTMLSelectElement>("inj").value as "both" | "left" | "right"; view.setModel(model); });
$("lab").addEventListener("change", () => { view.opts.labels = $<HTMLInputElement>("lab").checked; });
$("inject").addEventListener("click", () => view.inject());
$("artery").addEventListener("change", () => { artery = $<HTMLSelectElement>("artery").value; wireUi(); });
bind("pos", wireUi);
document.querySelectorAll<HTMLButtonElement>("#treat button[data-proc]").forEach((b) => b.addEventListener("click", () => {
  try {
    const r = sim.revascularize(b.dataset.proc as Procedure);
    sim.warmup(20);
    $("treatResult").textContent = `${r.procedure} after ${r.delayMinutes} min: ${r.result}`;
    refresh();
  } catch (e) { $("treatResult").textContent = (e as Error).message; }
}));
$("reset").addEventListener("click", () => load(current, shared));
window.addEventListener("hashchange", fromHash);

angleText();
fromHash();
const frame = (now: number) => { view.draw(now); requestAnimationFrame(frame); };
requestAnimationFrame(frame);
(window as unknown as { corosimCath: object }).corosimCath = { sim, load: (id: string) => { if (CASE_BY_ID[id]) load(CASE_BY_ID[id]); }, model: () => model, report: () => report };
