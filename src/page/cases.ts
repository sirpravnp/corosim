// ---------------------------------------------------------------- cases: the front door, the case panel, the prompts (the engine is src/cases)
// A case is the simulator page with a scripted patient: the page builds a Probe from the simulation each frame, the runner (src/cases/engine.ts)
// decides what fires, and this module carries it out: a patch to the patient, a line of news, an order, a prompt that holds the clock.
import { CASES } from "../cases";
import { compileCase } from "../cases/spec";
import { builtinEntries, getPreview, playable } from "../library/api";
import { CaseDef, CaseRunner, Debrief, Probe, Tick } from "../cases/engine";
import { $, K, S, sim, T, inCases, on, ecg, rstate, circ, panelSource, pageVitals } from "./state";
import { buildPatientNow, accrueLowFlow, resetLowFlow, lowFlow } from "./patientNow";
import { setCaseLabs } from "../sim/labs";
import { orderProbe, ordersBegin, ordersEnd, ordersStop, ordersStep, ordersUi, wireOrders, orders } from "./orders";
import { rhythmLabel, setBedsideTemp } from "./readouts";
import { bedsideOverride } from "../sim/bedside";
import { AUTONOMIC } from "../physics/autonomic";
import { withOrderLines } from "../cases/orderBook";
import type { PatientNow } from "../cases/orders";
import { arrestSync } from "./arrest";
import { caseChrome } from "./caseChrome";
import { setDockTab } from "./dock";
import { pgAdopt, pgPatch } from "./patient";
import { orderProcedure, reperfused } from "./manage";
import { paintMyocardium } from "./heart3d";
import { buildVessels, initParticles, points } from "./vessels3d";

const LOCKED = ["m_isch", "m_pressure", "m_velocity", "m_wss", "flowbtn"]; // displays that would show where the artery is closed
const STORE = "corosim.cases";
const best: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } })();
const keep = (id: string, score: number) => { if (score > (best[id] ?? -1)) { best[id] = score; try { localStorage.setItem(STORE, JSON.stringify(best)); } catch { /* blocked storage: the best score is not kept */ } } };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clock = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const TIER_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;
/** Every case this page can run: the built-in ones, then (once fetched) a published one or a draft being tested. */
let pool: CaseDef[] = [...CASES];
let missing = false; // the address names a case that could not be found
const CASES_URL = "../cases/";

let debrief: Debrief | null = null;
let opening = false; // the case's opening moves (rhythm, CPR, drugs given) are still to be made
let revealed = false; // the lesion is on show

/** What the runner may ask of the patient now. */
export function probe(): Probe {
  const st = sim.arrestState(), d = sim.devices(), drugs = st.drugs;
  return {
    map: sim.map, hr: sim.circ?.hr ?? 0,
    arrest: sim.dead ? "dead" : st.status,
    rhythmClass: st.rhythmClass,
    shocks: st.shocks,
    epiDoses: drugs.filter((x) => x.drug === "epinephrine").length,
    amioMg: drugs.filter((x) => x.drug === "amiodarone").reduce((a, x) => a + x.dose, 0),
    lidoDoses: drugs.filter((x) => x.drug === "lidocaine").length,
    cpr: st.cpr.on,
    ecmo: (d?.ecmo?.flowLpm ?? 0) > 0.5, coroPump: !!d?.coroPump?.on, iabp: !!d?.iabp?.on,
    pci: reperfused(), pciPending: T.pending?.kind === "pci",
    drugs: { ...(sim.drugState()?.level ?? {}) },
    ef: sim.circ?.ejectionFraction ?? 0.6, lvIschemia: sim.circ?.lvIschemia ?? 0, rvIschemia: sim.circ?.rvIschemia ?? 0, congestion: sim.circ?.congestion ?? 0, fluidsL: sim.support.fluids,
    dead: sim.dead,
    ...orderProbe(),
  };
}

/** The patient as the order system reads it (a result is computed from this when it returns). */
export function patientNow(): PatientNow {
  const st = sim.arrestState(), v = pageVitals();
  return buildPatientNow({
    vitals: v, fallbackMap: sim.map, fallbackHr: sim.circ?.hr ?? 0,
    spo2: panelSource?.saturations().spo2 ?? NaN, lactate: sim.oxygenState()?.lactate ?? NaN, urineMlPerMin: sim.fluids()?.urineRate ?? NaN,
    lvIschemia: circ?.lvIschemia ?? 0, rvIschemia: circ?.rvIschemia ?? 0, congestion: circ?.congestion ?? 0,
    arrest: sim.dead ? "dead" : st.status,
    rhythmLabel: st.status === "arrest" ? ARREST_LABEL[st.rhythmClass] ?? st.rhythmClass : rhythmLabel(ecg.rhythm(), rstate),
    respRateBase: sim.autonomic?.controls.respRate ?? AUTONOMIC.respRate, tempOverrideC: bedsideOverride.tempOverrideC,
    co: circ?.cardiacOutput, lvEf: circ?.ejectionFraction, lowFlowMin: lowFlow.min, caseMin: (K.runner?.t ?? 0) / 60,
    pfHbMgDl: sim.plasmaFreeHb(),
  });
}
const ARREST_LABEL: Record<string, string> = { vf: "Ventricular fibrillation", pulselessVt: "Pulseless ventricular tachycardia", asystole: "Asystole", pea: "Pulseless electrical activity", perfusing: "Perfusing rhythm" };

/** Carry out what the runner came back with. */
function carry(t: Tick) {
  for (const p of t.patches) {
    pgPatch(p);
    if (p.patient?.rhythm) S.rhythm = p.patient.rhythm; // the frame loop hands S.rhythm to the simulation
  }
  arrestSync();
  if (t.cpr !== undefined) { if (t.cpr) sim.startCpr(); else sim.stopCpr(); arrestSync(); }
  for (const o of t.orders) if (o === "pci") orderProcedure("pci");
  for (const sh of t.shocks) {
    const r = sim.shock({ joules: sh.joules, sync: sh.sync });
    arrestSync();
    const next = r.success ? sh.onSuccess : sh.onFail;
    if (next && K.runner) carry(K.runner.resolve(next));
  }
  if (t.over) end();
  setReveal();
  casesUi();
}

/** Show the lesion once the team has found it (or the case is over): the 3D displays then tell the truth. */
function setReveal() {
  const r = K.runner, should = !!r && (r.over || r.flags.has("pciOrdered"));
  if (should === revealed) return;
  revealed = should; S.hide = S.hideIsch = !should;
  if (should) { const l = K.def?.start.lesions?.[0]; if (l) S.selected = ""; }
  buildVessels(); initParticles(); paintMyocardium();
}

function end() {
  const r = K.runner;
  if (!r || K.phase === "over") return;
  K.phase = "over"; debrief = withOrderLines(r.debrief(), orders.book); keep(r.def.id, debrief.score);
  ordersStop();
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = false;
  document.body.classList.remove("case-run");
}

/** Each frame while a case runs: make the opening moves once the patient is in arrest, then tick the runner with the time that passed. */
export function caseStep(dt: number) {
  const r = K.runner;
  if (!r || K.phase !== "run" || sim.settling) return;
  if (opening) {
    const op = r.def.opening ?? {};
    if (op.rhythm && sim.arrestState().status === "none") { if (S.rhythm !== op.rhythm) { S.rhythm = op.rhythm; sim.apply({ patient: { rhythm: op.rhythm } }); } return; } // wait for the arrest to be recognised
    for (const d of op.drugs ?? []) sim.giveDrug(d.drug, d.mg);
    if (op.cpr) sim.startCpr();
    opening = false;
    return;
  }
  accrueLowFlow(dt, sim.map);
  const p = probe(), t = r.tick(p, dt);
  carry(t);
  if (K.phase === "run") ordersStep(r, p, t);
  ordersUi();
}

function startCase(def: CaseDef) {
  K.def = def; K.runner = new CaseRunner(def); K.phase = "run"; debrief = null; opening = true; revealed = false;
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = true;
  if (S.mode !== "real" && S.mode !== "anat") S.mode = "real";
  S.flow = false; points.visible = false; S.speed = 1; S.selected = "";
  S.hide = S.hideIsch = true;
  document.body.classList.add("case-run");
  pgAdopt(def.start);
  setBedsideTemp(def.tempC); setCaseLabs(def.labs); resetLowFlow(); ordersBegin(def);
  history.replaceState(null, "", location.pathname + location.search);
  casesUi();
}
function quit() {
  ordersEnd(); // first: it restores the speed a skip saved, and the reset below must win
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = false;
  document.body.classList.remove("case-run");
  K.phase = "idle"; K.def = null; K.runner = null; debrief = null; opening = false;
  S.hide = S.hideIsch = false; revealed = false; S.speed = 1;
  pgAdopt({});
  setBedsideTemp(undefined); setCaseLabs(undefined); resetLowFlow();
  buildVessels(); initParticles(); paintMyocardium();
  casesUi();
}

// ---- the case screen: what the page keeps (caseChrome) and where the alerts live
const ALERTS = ["arrestRosc", "clockCritical", "arrestDead"];
let chromeBare = false, ecgCaption = "";
/** Strip the simulator's chrome while a case runs (and in its debrief) and put it back when the case is left. Does DOM work only when the answer changes. */
function applyChrome() {
  const c = caseChrome(inCases, K.phase), bare = !c.stage;
  if (bare === chromeBare) return;
  chromeBare = bare;
  document.body.classList.toggle("case-bare", bare);
  // the ROSC banner, the clock-critical line and the dead-patient dialog live in the bedside monitor's container, not the 3D stage
  const home = $(bare ? "casemon" : "view");
  for (const id of ALERTS) home.append($(id));
  // the dock is the Treatments section: its one tab is dropped
  document.querySelector<HTMLElement>("#dock .dock-tabs h2")!.textContent = c.treatments && bare ? "Treatments" : "Settings";
  const strip = document.querySelector<HTMLElement>("#dock .dock-tabs")!; // one section, no tabs: no tablist role while bare
  if (bare) { strip.removeAttribute("role"); strip.removeAttribute("aria-label"); } else { strip.setAttribute("role", "tablist"); strip.setAttribute("aria-label", "Settings"); }
  $("dock").setAttribute("aria-label", bare ? "Treatments" : "Settings");
  setDockTab(bare ? "support" : "patient");
  // the ECG figure keeps a caption: only the paper speed and gain
  const cap = $("ecg").closest("figure")?.querySelector("figcaption");
  if (cap) { if (bare) { ecgCaption = cap.innerHTML; cap.innerHTML = "<b>Figure 2.</b> ECG at 25 mm/s, 10 mm/mV."; } else if (ecgCaption) cap.innerHTML = ecgCaption; }
}

// ---- the page
let listSig = "", introId = "", promptKey = "", logSig = "", overSig = "";
/** Keep the front door, the case panel and the prompt in step with the case. Cheap: the frame loop calls it with the other readouts. */
export function casesUi() {
  applyChrome();
  const door = inCases && K.phase === "idle", panel = inCases && K.phase !== "idle";
  $("cgate").hidden = !door; $("cases").hidden = !panel;
  document.body.classList.toggle("gated", door);
  if (door) doorUi();
  if (!panel) { $("cprompt").hidden = true; promptKey = ""; return; }
  ordersUi();
  const r = K.runner!, def = r.def;
  $("c_name").textContent = def.title;
  $("c_clock").textContent = clock(r.t);
  $("c_state").textContent = K.phase === "over" ? "Case over" : r.paused ? "Paused" : opening ? "Starting" : "Running";
  const card = `<b>${esc(def.card.presents)}</b><br>${esc(def.card.pmh)}${(def.card.info ?? []).map((x) => `<br>${esc(x)}`).join("")}`;
  if ($("c_card").dataset.id !== def.id) { $("c_card").innerHTML = card; $("c_card").dataset.id = def.id; }
  const sig = String(r.log.length);
  if (sig !== logSig) { logSig = sig; $("c_log").innerHTML = r.log.map((l) => `<li><span>${clock(l.t)}</span>${esc(l.text)}</li>`).join("") || `<li class="none">Nothing new yet.</li>`; }
  $("cases").dataset.phase = K.phase;
  if (K.phase === "over" && debrief) {
    const osig = `${debrief.score}|${debrief.result}`;
    if (osig !== overSig) {
      overSig = osig;
      $("c_result").className = "q-result " + (debrief.result === "success" ? "vessel" : debrief.result === "died" ? "miss" : "territory");
      $("c_result").innerHTML = `${debrief.score} of ${debrief.max} points <span class="pts">best ${best[def.id] ?? debrief.score}</span>`;
      $("c_debrief").innerHTML = debrief.lines.map((l) => `<li>${esc(l)}</li>`).join("");
    }
  } else overSig = "";
  // the prompt
  const o = r.open;
  $("cprompt").hidden = !o;
  if (o && promptKey !== o.id + "@" + r.t) {
    promptKey = o.id + "@" + r.t;
    $("cp_time").textContent = `${def.title}, ${clock(r.t)}`;
    $("cp_text").textContent = o.prompt.text;
    $("cp_opts").innerHTML = o.prompt.options.map((x, i) => `<button data-i="${i}">${esc(x.label)}</button>`).join("");
  }
  if (!o) promptKey = "";
}
function doorUi() {
  const sig = introId + String(missing) + pool.length;
  if (sig === listSig) return;
  listSig = sig;
  const def = pool.find((c) => c.id === introId);
  $("ci_begin").hidden = !def;
  if (def) {
    $("ci_title").textContent = def.title; $("ci_tier").textContent = TIER_LABEL[def.tier];
    $("ci_presents").textContent = def.card.presents; $("ci_pmh").textContent = def.card.pmh;
    $("ci_info").innerHTML = (def.card.info ?? []).map((x) => `<li>${esc(x)}</li>`).join("");
  } else {
    $("ci_title").textContent = missing ? "That case was not found" : "Loading the case";
    $("ci_tier").textContent = ""; $("ci_presents").textContent = missing ? "It may have been unpublished or removed. The Cases page lists what is available." : ""; $("ci_pmh").textContent = ""; $("ci_info").innerHTML = "";
  }
}

/** Find the case the address names (?id=…): built in, a published one from the server, or the draft the builder just handed over (&preview=1). */
async function loadFromAddress() {
  if (!/\/case(\/(index\.html)?)?$/.test(location.pathname)) return; // the plain simulator has no case to load
  const q = new URLSearchParams(location.search), id = q.get("id");
  if (!id) { location.replace(CASES_URL); return; }
  introId = id;
  if (!pool.some((c) => c.id === id)) {
    try {
      const draft = q.get("preview") ? getPreview() : undefined;
      if (draft && draft.id === id) pool = [compileCase(draft), ...pool.filter((c) => c.id !== id)];
      else { const all = await playable(); pool = [...builtinEntries(), ...all.filter((e) => e.source === "authored")].map((e) => e.def); }
    } catch { /* the server is away: only the built-in cases */ }
    missing = !pool.some((c) => c.id === id);
  }
  listSig = ""; casesUi();
}

/** The front door's cards, the prompt's options, and the buttons. */
export function wireCases() {
  void loadFromAddress();
  wireOrders();
  on("ci_back", () => { location.href = CASES_URL; });
  on("ci_begin", () => { const def = pool.find((c) => c.id === introId); listSig = ""; if (def) startCase(def); });
  $("cp_opts").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (b && K.runner) carry(K.runner.answer(+b.dataset.i!));
  });
  on("c_quit", () => { quit(); location.href = CASES_URL; });
  on("c_again", () => { quit(); location.href = CASES_URL; });
}
