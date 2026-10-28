// ---------------------------------------------------------------- the arrest UI (C8): ACLS panel, ROSC banner, death overlay
// Reads the simulation's arrest machine (sim.arrest / sim.arrestState()) and drives startCpr / setCpr / shock / giveDrug / restartPatient.
// The panel lives at the top of the dock's Support tab and appears when the patient arrests; the overlay and the banner sit in the 3D view.
import { ARREST } from "../config/arrest";
import type { ArrestDrug, RhythmClass } from "../sim/arrest";
import { $, S, sim, inCases, on, range } from "./state";
import { setDockTab } from "./dock";
import { adoptSimState } from "./model";
import { rhythmPickerUi } from "./rhythmPicker";

const CLASS_LABEL: Record<RhythmClass, string> = { vf: "Ventricular fibrillation", pulselessVt: "Pulseless ventricular tachycardia", asystole: "Asystole", pea: "Pulseless electrical activity", perfusing: "Perfusing rhythm" };
const SHOCKABLE: Record<RhythmClass, string> = { vf: "Shockable: defibrillate", pulselessVt: "Shockable: defibrillate", asystole: "Not shockable: CPR and epinephrine", pea: "Not shockable: CPR, epinephrine, treat the cause", perfusing: "Pulse present" };
const DRUGS: ArrestDrug[] = ["epinephrine", "amiodarone", "lidocaine"];

/** m:ss for a number of seconds. */
export const clock = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
let sync = false;          // the Synchronized toggle
let lastStatus = "none";   // to bring the Support tab forward once, when an arrest begins
let lastNote = "";         // the result of the last action (a refusal, a shock)
/** Set when the patient died on the cases page (the case runner ends the case). */
export const arrestLoss = { lost: false };

/** One ACLS cycle: two minutes of compressions between rhythm checks. */
const CYCLE_S = 120;
const num = (id: string) => +$<HTMLInputElement>(id).value;
/** A rhythm the simulation changed (a shock converted it, ROSC) is the patient's now: take it over before the frame loop hands S.rhythm back to the simulation. */
let seenRhythm: string = sim.patient?.rhythm ?? "sinus";
export function arrestSync() {
  const r = sim.patient?.rhythm;
  if (r !== undefined && r !== seenRhythm) { seenRhythm = r; S.rhythm = r; rhythmPickerUi(); }
}

const cprPatch = () => ({ rate: num("a_rate"), depthCm: num("a_depth"), quality: num("a_quality") / 100 });
function act(r: { ok: boolean; note?: string }) { lastNote = r.ok ? "" : r.note ?? ""; arrestUi(); }

/** Wire the panel's controls (called once at start-up; the markup is in sim/index.html). */
export function wireArrest() {
  on("a_cpr", () => act(sim.arrest?.cpr.on ? sim.stopCpr() : sim.startCpr(cprPatch())));
  for (const id of ["a_rate", "a_depth", "a_quality"]) range(id, () => { if (sim.arrest?.cpr.on) sim.setCpr(cprPatch()); arrestUi(); });
  on("a_sync", () => { sync = !sync; arrestUi(); });
  $("a_energy").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-j]");
    if (b) { $<HTMLInputElement>("a_joules").value = b.dataset.j!; arrestUi(); }
  });
  on("a_shock", () => {
    const r = sim.shock({ joules: +$<HTMLInputElement>("a_joules").value, sync });
    lastNote = r.note ?? (r.discharged ? (r.success ? "Shock delivered: the rhythm converted." : "Shock delivered: no conversion.") : "No shock delivered.");
    arrestSync(); arrestUi();
  });
  on("a_epi", () => act(sim.giveDrug("epinephrine", ARREST.drugs.epinephrine.doseMg)));
  on("a_amio", () => { const n = sim.arrest?.drugs.filter((d) => d.drug === "amiodarone").length ?? 0; act(sim.giveDrug("amiodarone", n ? ARREST.drugs.amiodarone.secondMg : ARREST.drugs.amiodarone.firstMg)); });
  on("a_lido", () => act(sim.giveDrug("lidocaine", ARREST.drugs.lidocaine.doseMg)));
  on("arrestRestart", () => { lastNote = ""; arrestLoss.lost = false; sim.restartPatient(); seenRhythm = sim.patient.rhythm; adoptSimState(true); lastStatus = "none"; arrestUi(); });
  on("arrestRoscClose", () => { $("arrestRosc").hidden = true; });
}

/** Seconds since the last dose of a drug, or null. */
const since = (drug: ArrestDrug) => { const a = sim.arrest, d = a?.drugs.filter((x) => x.drug === drug).pop(); return a && d ? a.tS - d.tS : null; };

/** Refresh the panel, the banner and the overlay. Cheap; the frame loop calls it with the other readouts and the controls call it after an action. */
export function arrestUi() {
  const core = sim.engine === "core", st = core ? sim.arrestState() : null, a = sim.arrest;
  const status = st?.status ?? "none", dead = core && (sim.dead || status === "dead");
  document.body.classList.toggle("dead", dead);
  document.body.dataset.arrest = status;
  $("arrest").hidden = status === "none";
  $("arrestDead").hidden = !dead;
  if (!st || !a || status === "none") { $("arrestRosc").hidden = true; lastStatus = "none"; return; }
  if (status !== lastStatus) {
    if (lastStatus === "none" && status === "arrest") { lastNote = ""; setDockTab("support"); } // bring the ACLS panel forward when the arrest begins
    $("arrestRosc").hidden = status !== "rosc";
    lastStatus = status;
  }
  $("arrest").dataset.status = status;
  $("a_state").textContent = status === "arrest" ? "Cardiac arrest" : status === "rosc" ? "ROSC" : "Dead";
  const rc = st.rhythmClass;
  $("a_rhythm").textContent = CLASS_LABEL[rc];
  $("a_shockable").textContent = SHOCKABLE[rc]; $("a_shockable").classList.toggle("go", status === "arrest" && (rc === "vf" || rc === "pulselessVt"));
  $("a_arrestS").textContent = clock(st.arrestS);
  $("a_noflow").textContent = clock(st.noFlowS);
  $("a_noflow").style.color = st.noFlowS >= ARREST.injuryOnsetNoFlowS ? "var(--bad)" : st.noFlowS > 120 ? "var(--warn)" : "var(--ink)";
  const bar = $("a_noflowbar"); bar.style.width = `${Math.min(100, (100 * st.noFlowS) / ARREST.deathAfterNoFlowS)}%`;
  bar.style.background = st.noFlowS >= ARREST.injuryOnsetNoFlowS ? "var(--bad)" : st.noFlowS > 120 ? "var(--warn)" : "var(--ok)";
  $("a_injury").textContent = `${Math.round(st.injury * 100)}%`;
  $("a_injury").style.color = st.injury > 0.5 ? "var(--bad)" : st.injury > 0 ? "var(--warn)" : "var(--ink)";
  // the two-minute cycle: it restarts at the arrest and at every shock, and says when the rhythm is next checked
  const ls = st.lastShock, cycleFrom = ls ? ls.tS : 0, into = (a.tS - cycleFrom) % CYCLE_S, left = CYCLE_S - into;
  $("a_cycle").textContent = status === "arrest" ? clock(left) : "—";
  $("a_cyclebox").classList.toggle("now", status === "arrest" && left <= 10);
  const cprBtn = $("a_cpr"); cprBtn.classList.toggle("on", a.cpr.on); cprBtn.textContent = a.cpr.on ? "CPR running: stop" : "Start CPR";
  $("a_ratev").textContent = `${num("a_rate")}/min`; $("a_depthv").textContent = `${num("a_depth")} cm`; $("a_qualityv").textContent = `${num("a_quality")}%`;
  $("a_output").textContent = a.cpr.on ? `${Math.round(st.cpr.output * 100)}% of normal output` : "no compressions: no flow";
  for (const b of document.querySelectorAll<HTMLButtonElement>("#a_energy button")) b.classList.toggle("on", b.dataset.j === $<HTMLInputElement>("a_joules").value);
  const syncBtn = $("a_sync"); syncBtn.classList.toggle("on", sync); syncBtn.textContent = sync ? "Sync on" : "Sync off"; syncBtn.setAttribute("aria-pressed", String(sync));
  $("a_shock").textContent = sync ? "Cardiovert" : "Shock";
  for (const id of ["a_cpr", "a_shock", "a_epi", "a_amio", "a_lido"]) $<HTMLButtonElement>(id).disabled = dead;
  $("a_shocks").textContent = String(st.shocks);
  const lastEl = $("a_last");
  lastEl.textContent = ls ? `${ls.joules} J${ls.sync ? " sync" : ""}, ${clock(a.tS - ls.tS)} ago: ${ls.success ? "converted" : "no conversion"}` : "No shocks yet";
  lastEl.parentElement!.classList.toggle("ok", !!ls?.success); lastEl.parentElement!.classList.toggle("miss", !!ls && !ls.success);
  for (const d of DRUGS) {
    const s = since(d), n = a.drugs.filter((x) => x.drug === d).length, el = $("a_t_" + d);
    const due = d === "epinephrine" && s !== null && s >= ARREST.drugs.epinephrine.minIntervalS;
    el.textContent = s === null ? (d === "epinephrine" ? "give now" : "not given") : due ? `${n}x · due (${clock(s)})` : `${n}x · ${clock(s)} ago`;
    el.classList.toggle("due", due);
    $(d === "epinephrine" ? "a_epi" : d === "amiodarone" ? "a_amio" : "a_lido").classList.toggle("due", due);
  }
  $("a_amio").textContent = a.drugs.some((x) => x.drug === "amiodarone") ? "Amiodarone 150 mg" : "Amiodarone 300 mg";
  $("a_note").textContent = lastNote;
  if (dead) {
    $("a_deadAt").textContent = `Declared dead ${clock(st.arrestS)} into the arrest, after ${clock(st.noFlowS)} of no flow (irreversible injury ${Math.round(st.injury * 100)}%).`;
    $("a_deadMsg").textContent = inCases ? "The patient died: the case is over." : "The readouts are frozen. Restart the patient to begin again.";
    $<HTMLButtonElement>("arrestRestart").hidden = inCases;
    if (inCases) arrestLoss.lost = true;
  }
}
