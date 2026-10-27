import "../cath/cath.css";
import "./structural.css";
import { mountShell } from "../shell/shell";
import { mountCrossLinks } from "../shell/crossLinkRow";
import { assess, defaults, lesionHash, LESIONS, LESION_BY_ID, LesionDef, parseLesionHash, patientFromLesionHash, StructuralFindings, ValveFinding } from "../sim/structural";
import { NodeName } from "../physics/structural";
import { morphFor, satMap } from "./morph";
import { buildProps } from "./props";
import { legendGradient, StructuralHeartView } from "./heartView";
import { clearCanvas, drawLoop, drawTraces, LEFT, RIGHT } from "./traces";

/**
 * The structural page: a lesion from the library, sliders for its severity, and everything the closed-loop model says about it
 * (src/sim/structural.ts): catheter-style pressures and saturations, valve grades, shunts, traces and pressure-volume loops.
 * The lesion and its sliders live in the URL hash so a view can be shared: #lesion=tof&spasm=0.8.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : "–"), f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–"), f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–");

let def: LesionDef = LESIONS[0];
let values: Record<string, number> = defaults(def);
let result!: StructuralFindings;
/** "Open in…" links: the lesion on screen with its slider values, as a PatientSpec. */
const links = mountCrossLinks($("xlinks"), "structural", "../", () => patientFromLesionHash(lesionHash(def.id, values)), { skip: () => (def.patient === "adult" ? [] : ["sim", "cath"]) }); // a newborn lesson has no Simulator or cath-lab patient
let heart: StructuralHeartView | null = null;
try { heart = new StructuralHeartView($("view3d")); $("satbar").style.background = legendGradient(); } catch { $("view3d").textContent = "3D view needs WebGL."; document.querySelectorAll<HTMLElement>(".views button, #cut").forEach((el) => ((el as HTMLButtonElement | HTMLInputElement).disabled = true)); }

// ---------------------------------------------------------------- library and controls
function renderList() {
  const group = (g: LesionDef["group"], name: string) =>
    `<h3>${name}</h3>` + LESIONS.filter((l) => l.group === g).map((l) => `<a data-id="${l.id}" class="${l.id === def.id ? "on" : ""}"${l.id === def.id ? ` aria-current="page"` : ""} href="#lesion=${l.id}">${esc(l.label)}</a>`).join("");
  $("list").innerHTML = group("valve", "Valve disease") + group("congenital", "Congenital");
}

function renderControls() {
  $("controls").innerHTML = def.params.map((p) =>
    `<label><span>${esc(p.label)}</span><output id="o-${p.key}"></output><input type="range" id="p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${values[p.key]}"></label>`).join("");
  for (const p of def.params) {
    const input = $<HTMLInputElement>(`p-${p.key}`), out = $(`o-${p.key}`);
    const show = () => (out.textContent = `${values[p.key]}${p.unit ? " " + p.unit : ""}`);
    show();
    input.addEventListener("input", () => { values[p.key] = +input.value; show(); schedule(); });
  }
}

/** Open a lesion. `push` adds a history entry (a library click), so Back returns to the lesion before. */
function load(id: string, v: Record<string, number> = {}, push = false) {
  def = LESION_BY_ID[id] ?? LESIONS[0];
  values = { ...defaults(def), ...v };
  renderList(); renderControls(); refresh(push);
}

// ---------------------------------------------------------------- readouts
const tone = (bad: boolean, warn = false) => (bad ? "bad" : warn ? "warn" : "ok");

function refresh(push = false) {
  result = assess(def.id, values);
  const r = result.report;
  $("title").textContent = def.label;
  $("summary").textContent = def.teach;

  const tile = (label: string, value: string, cls = "") => `<div><b>${label}</b><span class="${cls}">${value}</span></div>`;
  const shunt = r.rightToLeft > 0.05 || r.leftToRight > 0.05;
  $("meas").innerHTML = [
    tile("Heart rate", `${f0(r.hr)} bpm`),
    tile("Aorta, mmHg", `${f0(r.pressure.AO.max)}/${f0(r.pressure.AO.min)} (${f0(r.pressure.AO.mean)})`),
    Math.abs(r.preductalSat - r.postductalSat) < 0.01
      ? tile("SpO₂", pct(r.preductalSat), tone(r.preductalSat < 0.9, r.preductalSat < 0.95))
      : tile("SpO₂ upper / lower body", `${pct(r.preductalSat)} / ${pct(r.postductalSat)}`, tone(Math.min(r.preductalSat, r.postductalSat) < 0.9, true)),
    tile("Qp:Qs", f2(r.qpQs), tone(r.qpQs > 2 || r.qpQs < 0.6, r.qpQs > 1.3 || r.qpQs < 0.9)),
    tile("Systemic flow", `${f2(r.qs)} L/min`), tile("Pulmonary flow", `${f2(r.qp)} L/min`),
    ...(shunt ? [tile("Right → left", `${f2(Math.max(0, r.rightToLeft))} L/min`, r.rightToLeft > 0.05 ? "bad" : ""), tile("Left → right", `${f2(Math.max(0, r.leftToRight))} L/min`, r.leftToRight > 0.05 ? "warn" : "")] : []),
    tile("LV / RV ejection fraction", `${pct(r.lvEf)} / ${pct(r.rvEf)}`),
    tile("SVRi / PVRi", `${f1(r.svri)} / ${f1(r.pvri)} WU·m²`),
  ].join("");

  const fs: string[] = [`<li>${esc(result.headline)}</li>`];
  for (const v of result.valves) {
    const bits: string[] = [];
    if (v.stenosis === "atretic") bits.push("atretic");
    else if (v.stenosis !== "none") bits.push(`${v.stenosis} stenosis (${v.gorlinArea === null ? "" : `Gorlin ${f2(v.gorlinArea)} cm², `}mean gradient ${f0(v.meanGradient)} mmHg)`);
    if (v.regurgitation !== "none") bits.push(`${v.regurgitation} regurgitation${v.regurgFraction === null ? "" : ` (regurgitant fraction ${pct(v.regurgFraction)})`}`);
    if (bits.length) fs.push(`<li class="${v.grade === "severe" || v.grade === "atretic" ? "bad" : ""}">${esc(v.label)} valve: ${esc(bits.join("; "))}</li>`);
  }
  if (Math.abs(r.shunt.pda) > 0.2) fs.push(`<li>Ductus: ${r.shunt.pda > 0 ? "aorta to pulmonary artery" : "pulmonary artery to aorta"} ${f1(Math.abs(r.shunt.pda))} ml/s</li>`);
  if (Math.abs(r.shunt.asd) > 0.2) fs.push(`<li>Atrial defect: ${r.shunt.asd > 0 ? "left to right" : "right to left"} ${f1(Math.abs(r.shunt.asd))} ml/s</li>`);
  if (Math.abs(r.shunt.vsd) > 0.2) fs.push(`<li>Ventricular defect: ${r.shunt.vsd > 0 ? "left to right" : "right to left"} (net) ${f1(Math.abs(r.shunt.vsd))} ml/s</li>`);
  if (r.shunt.rvao > 0.2) fs.push(`<li>Overriding aorta: right ventricle to aorta ${f1(r.shunt.rvao)} ml/s (right to left)</li>`);
  if (Math.abs(r.shunt.bt) > 0.2) fs.push(`<li>BT shunt: ${f1(Math.abs(r.shunt.bt))} ml/s to the lungs</li>`);
  $("findings").innerHTML = fs.join("");

  if (heart) { const m = morphFor(result.spec, r); heart.update(m, satMap(r)); heart.setProps(buildProps(result.spec, r, m, result.valves), satMap(r)); }
  sitesTable(); valvesTable();
  $("murmur").textContent = `Auscultation: ${result.murmur}`;
  const w = $("warn"); w.hidden = !r.warnings.length; w.textContent = r.warnings.join(" ");
  $("notes").textContent = result.notes.join(" ");
  draw();
  links.repoint();
  const h = lesionHash(def.id, values);
  if (location.hash !== h) (push ? history.pushState : history.replaceState).call(history, null, "", h);
}

const SITES: { node: NodeName; label: string }[] = [
  { node: "SVC", label: "SVC" }, { node: "IVC", label: "IVC" }, { node: "RA", label: "Right atrium" }, { node: "RV", label: "Right ventricle" },
  { node: "PA", label: "Pulmonary artery" }, { node: "LA", label: "Left atrium" }, { node: "LV", label: "Left ventricle" }, { node: "AO", label: "Aorta, arch" }, { node: "DAO", label: "Aorta, descending" },
];
function sitesTable() {
  const r = result.report;
  $("sites").querySelector("tbody")!.innerHTML = SITES.map(({ node, label }) => {
    const p = r.pressure[node], s = r.saturation[node];
    // atria and veins: mean (range); ventricles: peak systolic / end-diastolic; arteries: systolic / diastolic (mean)
    const pr = node === "SVC" || node === "IVC" || node === "RA" || node === "LA" ? `mean ${f0(p.mean)}  (${f0(p.min)}–${f0(p.max)})`
      : node === "RV" || node === "LV" ? `${f0(p.max)}/${f0(p.end)}  (peak / end-diastolic)` : `${f0(p.max)}/${f0(p.min)}  (mean ${f0(p.mean)})`;
    const empty = Number.isNaN(s);
    return `<tr class="${empty ? "dim" : ""}"><td>${label}</td><td>${empty ? "no blood reaches it" : pr}</td><td class="${empty ? "dim" : s < 0.9 && (node === "AO" || node === "DAO" || node === "LV" || node === "LA") ? "bad" : ""}">${pct(s)}</td></tr>`;
  }).join("");
}
function valvesTable() {
  const row = (v: ValveFinding) => {
    const st = v.stenosis === "none" ? `<span class="dim">–</span>` : `<span class="${v.stenosis === "severe" || v.stenosis === "atretic" ? "bad" : "warn"}">${v.stenosis}</span>`;
    const rg = v.regurgitation === "none" ? `<span class="dim">–</span>` : `<span class="${v.regurgitation === "severe" ? "bad" : "warn"}">${v.regurgitation}${v.regurgFraction === null ? "" : ` ${pct(v.regurgFraction)}`}</span>`;
    return `<tr><td>${v.label}</td><td>${st}</td><td>${rg}</td><td>${v.stenosis === "atretic" ? "–" : `${f1(v.meanGradient)} mmHg`}</td></tr>`;
  };
  $("valves").querySelector("tbody")!.innerHTML = result.valves.map(row).join("");
}

function draw() {
  const w = result.report.waveform;
  if (!w) { for (const id of ["trL", "trR", "pvL", "pvR"]) clearCanvas($<HTMLCanvasElement>(id)); return; }
  drawTraces($<HTMLCanvasElement>("trL"), w, LEFT, "Left heart");
  drawTraces($<HTMLCanvasElement>("trR"), w, RIGHT, "Right heart");
  drawLoop($<HTMLCanvasElement>("pvL"), w.vLV, w.p.LV, "LV", "#f4f1ea");
  drawLoop($<HTMLCanvasElement>("pvR"), w.vRV, w.p.RV, "RV", "#ffb36a");
}

// ---------------------------------------------------------------- hash and wiring
function fromHash() {
  const { id, values: v } = parseLesionHash(location.hash);
  load(id, v);
}
let pending = 0;
function schedule() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; refresh(); }); }

$("list").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a[data-id]") as HTMLAnchorElement | null;
  if (a) { e.preventDefault(); load(a.dataset.id!, {}, true); }
});
document.querySelectorAll<HTMLButtonElement>(".views button[data-view]").forEach((b) => b.addEventListener("click", () => {
  heart?.view(b.dataset.view!);
  document.querySelectorAll(".views button[data-view]").forEach((x) => x.classList.toggle("on", x === b));
}));
$("cut").addEventListener("input", () => heart?.setCut(+$<HTMLInputElement>("cut").value / 100));
window.addEventListener("hashchange", fromHash);
new ResizeObserver(() => { if (result) draw(); }).observe($("app"));
mountShell({ page: "structural", root: "../" }).ai.start();
fromHash();

(window as unknown as { corosimStructural: object }).corosimStructural = { load, result: () => result, heart: () => heart };
