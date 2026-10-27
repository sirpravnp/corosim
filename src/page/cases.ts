// ---------------------------------------------------------------- cases: the front door, the case panel, the prompts (the engine is src/cases)
// A case is the simulator page with a scripted patient: the page builds a Probe from the simulation each frame, the runner (src/cases/engine.ts)
// decides what fires, and this module carries it out: a patch to the patient, a line of news, an order, a prompt that holds the clock.
import { CASES } from "../cases";
import { CaseDef, CaseRunner, Debrief, Probe, Tick } from "../cases/engine";
import { $, K, S, sim, T, inCases, on } from "./state";
import { arrestSync } from "./arrest";
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

let debrief: Debrief | null = null;
let opening = false; // the case's opening moves (rhythm, CPR, drugs given) are still to be made
let revealed = false; // the lesion is on show

/** What the runner may ask of the patient now. */
function probe(): Probe {
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
    ecmo: (d?.ecmo?.flowLpm ?? 0) > 0.5, impella: !!d?.impella?.on, iabp: !!d?.iabp?.on,
    pci: reperfused(), pciPending: T.pending?.kind === "pci",
    dead: sim.dead,
  };
}

/** Carry out what the runner came back with. */
function carry(t: Tick) {
  for (const p of t.patches) {
    pgPatch(p);
    if (p.patient?.rhythm) S.rhythm = p.patient.rhythm; // the frame loop hands S.rhythm to the simulation
  }
  arrestSync();
  for (const o of t.orders) if (o === "pci") orderProcedure("pci");
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
  K.phase = "over"; debrief = r.debrief(); keep(r.def.id, debrief.score);
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
  carry(r.tick(probe(), dt));
}

function startCase(def: CaseDef) {
  K.def = def; K.runner = new CaseRunner(def); K.phase = "run"; debrief = null; opening = true; revealed = false;
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = true;
  if (S.mode !== "real" && S.mode !== "anat") S.mode = "real";
  S.flow = false; points.visible = false; S.speed = 1; S.selected = "";
  S.hide = S.hideIsch = true;
  document.body.classList.add("case-run");
  pgAdopt(def.start);
  history.replaceState(null, "", location.pathname + location.search);
  casesUi();
}
function quit() {
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = false;
  document.body.classList.remove("case-run");
  K.phase = "idle"; K.def = null; K.runner = null; debrief = null; opening = false;
  S.hide = S.hideIsch = false; revealed = false; S.speed = 1;
  pgAdopt({});
  buildVessels(); initParticles(); paintMyocardium();
  casesUi();
}

// ---- the page
let listSig = "", introId = "", promptKey = "", logSig = "", overSig = "";
/** Keep the front door, the case panel and the prompt in step with the case. Cheap: the frame loop calls it with the other readouts. */
export function casesUi() {
  const door = inCases && K.phase === "idle", panel = inCases && K.phase !== "idle";
  $("cgate").hidden = !door; $("cases").hidden = !panel;
  document.body.classList.toggle("gated", door);
  if (door) doorUi();
  if (!panel) { $("cprompt").hidden = true; promptKey = ""; return; }
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
    $("cp_time").textContent = `${def.title} · ${clock(r.t)}`;
    $("cp_text").textContent = o.prompt.text;
    $("cp_opts").innerHTML = o.prompt.options.map((x, i) => `<button data-i="${i}">${esc(x.label)}</button>`).join("");
  }
  if (!o) promptKey = "";
}
function doorUi() {
  const sig = JSON.stringify(best) + introId;
  if (sig === listSig) return;
  listSig = sig;
  $("c_cards").innerHTML = CASES.map((c) => `<button class="c-case" data-id="${c.id}"><i class="tier ${c.tier}">${TIER_LABEL[c.tier]}</i><b>${esc(c.title)}</b><span>${esc(c.blurb)}</span>${best[c.id] !== undefined ? `<em>best ${best[c.id]}</em>` : ""}</button>`).join("");
  $("c_list").hidden = !!introId; $("c_intro").hidden = !introId;
  const def = CASES.find((c) => c.id === introId);
  if (def) {
    $("ci_title").textContent = def.title; $("ci_tier").textContent = TIER_LABEL[def.tier];
    $("ci_presents").textContent = def.card.presents; $("ci_pmh").textContent = def.card.pmh;
    $("ci_info").innerHTML = (def.card.info ?? []).map((x) => `<li>${esc(x)}</li>`).join("");
  }
}

/** The front door's cards, the prompt's options, and the buttons. */
export function wireCases() {
  $("c_cards").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (b) { introId = b.dataset.id!; listSig = ""; casesUi(); } });
  on("ci_back", () => { introId = ""; listSig = ""; casesUi(); });
  on("ci_begin", () => { const def = CASES.find((c) => c.id === introId); introId = ""; listSig = ""; if (def) startCase(def); });
  $("cp_opts").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (b && K.runner) carry(K.runner.answer(+b.dataset.i!));
  });
  on("c_quit", quit);
  on("c_again", () => { const def = K.def; quit(); if (def) { introId = def.id; listSig = ""; casesUi(); } });
}
