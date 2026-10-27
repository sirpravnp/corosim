// ---------------------------------------------------------------- management: orders, infarct clock, advice
import { LEADS } from "../config/ecg";
import { Lesion } from "../physics/network";
import { meetsStElevation } from "../physics/ecgLink";
import { PROCEDURE, SUPPORT, Procedure } from "../config/management";
import { lvInfarctSize, clinicalTime } from "../physics/infarct";
import { order, applyProcedure } from "../physics/revasc";
import { assess, Situation } from "../physics/advice";
import { tree, A, sites, circ, $, S, sim, sev, T, nec, clearTreatment, scheduleLesion, on, range, G, ecg, rstate, pageVitals, PHYS, patientOpts } from "./state";
import { DEFAULT_IABP, DEFAULT_IMPELLA } from "../sim/patient";
import { buildGrafts } from "./vessels3d";

export const PROC_LABEL: Record<Procedure, string> = { pci: PROCEDURE.pci.label, lysis: PROCEDURE.lysis.label, cabg: PROCEDURE.cabg.label };
const currentLesion = (): Lesion | null => (S.ds > 0 || S.occ ? { segId: S.lesionSeg, pos: S.pos, ds: S.occ ? 1 : S.ds, occluded: S.occ } : null);
export const reperfused = () => T.treated.stent || T.treated.lysed === true || T.treated.grafts.length > 0;

/** One step of the clinical clock: muscle that stays ischemic dies, and an ordered procedure moves toward the artery. */
export function manageStep(minutes: number, burden: number) {
  // (necrosis itself is stepped by the simulation on the same clinical minutes)
  if (burden > 0.005) T.ischemicMin += minutes;
  if (T.pending && (T.pending.remaining -= minutes) <= 0) land(T.pending.kind);
}
/** The procedure reaches the artery. */
function land(kind: Procedure) {
  T.pending = null;
  const les = currentLesion();
  if (!les) { T.lastResult = `${PROC_LABEL[kind]}: there was no lesion to treat.`; return; }
  T.original ??= { seg: S.lesionSeg, pos: S.pos, ds: S.ds, occ: S.occ };
  const r = applyProcedure(kind, les, tree, T.seed), name = tree.byId[les.segId].name;
  if (kind === "pci") { S.ds = 0; S.occ = false; T.treated.stent = true; T.lastResult = `PCI: stent in the ${name}, flow restored.`; }
  else if (kind === "cabg") { T.treated.grafts = r.graft ?? []; T.lastResult = `CABG: graft sewn onto the ${name} beyond the lesion. The native lesion is still there.`; }
  else if (r.lysed === undefined) T.lastResult = "Fibrinolytic: no clot to lyse in a stenosis.";
  else if (r.lysed) { S.occ = false; S.ds = r.lesion!.ds; T.treated.lysed = true; T.lastResult = `Fibrinolytic: the clot lysed; a ${Math.round(S.ds * 100)}% stenosis is left behind. Consider angiography.`; }
  else { T.treated.lysed = false; T.lastResult = "Fibrinolytic: the artery stayed closed. Rescue PCI."; }
  if (G.treat && reperfused() && G.treat.reperfusedBy === null) G.treat.reperfusedBy = PROC_LABEL[kind];
  scheduleLesion(); buildGrafts();
}
function orderProcedure(kind: Procedure) {
  if (T.pending) { T.lastResult = `${PROC_LABEL[T.pending.kind]} is already on its way.`; return; }
  if (!currentLesion()) { T.lastResult = "There is no lesion to treat."; return; }
  T.pending = order(kind); T.lastResult = "";
  if (G.treat && G.treat.orderedAt === null) G.treat.orderedAt = G.treat.minutes;
}

/** The facts the advisor reads, from the live state. */
export function situation(): Situation | null {
  if (!circ || !rstate) return null;
  const st = ecg.st(), les = currentLesion(), roll = sim.rolling(10);
  return {
    hasLesion: !!les && !reperfused(), occluded: S.occ, ds: S.ds, ffr: S.ds > 0 && !S.occ ? A.ffr[0] : null, leftMain: S.lesionSeg === "LM",
    stElevation: meetsStElevation(st), // two contiguous leads; aVR alone does not count
    diffuseDepressionAvr: st.aVR >= 1 && LEADS.filter((l) => st[l] <= -1).length >= 4,
    map: sim.map, cardiacOutput: Number.isFinite(roll.cardiacOutput) ? roll.cardiacOutput : circ.cardiacOutput, lvIschemia: circ.lvIschemia, rvIschemia: circ.rvIschemia,
    avDegree: rstate.avDegree, hr: Number.isFinite(roll.hr) ? roll.hr : circ.hr, vagal: rstate.vagal, congestion: circ.congestion,
    minutesIschemic: T.ischemicMin, infarctSize: lvInfarctSize(sites, nec), reperfused: reperfused(), pending: T.pending ? PROC_LABEL[T.pending.kind] : null,
    grafted: T.treated.grafts.length > 0, support: T.support, exertion: S.exert,
  };
}

/** What this module cannot reach: the playground state lives in patient.ts, which installs these on the Simulator page (the game has no playground). */
export const hooks: { device?: (id: "iabp" | "impella" | "ecmo", on: boolean) => void; resetTreatment?: () => void } = {};

/** The Support tab's sections, in order: each is a <details> with a live one-line summary in its header. */
const SECTION_OF: Record<string, string> = { support: "drugs", revasc: "treat", assess: "assess" }; // the old sub-tab names
/** Open one section of the Support tab by name (treat, volume, drugs, devices, vent, assess; the old sub-tab names work too). */
export function setTab(t: string) {
  const d = document.getElementById("sec-" + (SECTION_OF[t] ?? t)) as HTMLDetailsElement | null;
  if (d) d.open = true;
}

/** The "More drugs" sliders (core engine only): control id, the Support key, the name in the summary. */
export const MORE_DRUGS = [["epi", "epi", "epinephrine"], ["mil", "milrinone", "milrinone"], ["vaso", "vasopressin", "vasopressin"], ["nitp", "nitroprusside", "nitroprusside"], ["furo", "furosemide", "furosemide"]] as const;

const MORE_NOTE = "Receptor-level drugs of the core engine: epinephrine (beta and alpha), milrinone (inodilator), vasopressin (non-adrenergic pressor), nitroprusside (arterial and venous dilator), furosemide (diuretic). Doses are fractions of the full effect.";
const lastText = new Map<string, string>();
const setText = (id: string, v: string) => { if (lastText.get(id) === v) return; lastText.set(id, v); $(id).textContent = v; };
const join = (parts: (string | false | undefined | null | 0)[]) => parts.filter(Boolean).join(" · ") || "none";
const pct = (x: number) => Math.round(x * 100) + "%";

/** The IV volume given, grouped by kind: the playground's boluses plus the legacy litres (the game, or `support.fluids` from chat). */
function volumeGiven(): string {
  const by: Record<string, number> = {};
  for (const d of patientOpts.patient?.fluids?.given ?? []) by[d.kind] = (by[d.kind] ?? 0) + d.ml;
  if (T.support.fluids > 0) by.crystalloid = (by.crystalloid ?? 0) + T.support.fluids * 1000;
  return Object.entries(by).filter(([, ml]) => ml > 0).map(([k, ml]) => `${Math.round(ml)} ml ${k}`).join(", ");
}
/** The line in the header of each section: what is on, read from the live state, so a change made from chat shows too. */
function summaries() {
  const sp = T.support, spec = patientOpts.patient, dev = spec?.devices, fl = spec?.fluids, vent = spec?.ventilation;
  setText("sum-volume", join([PHYS.bl > 0 && `blood loss ${PHYS.bl}%`, PHYS.bl < 0 && `overload ${-PHYS.bl}%`, !!fl?.hemorrhageMlMin && `bleeding ${fl.hemorrhageMlMin} ml/min`, volumeGiven()]));
  setText("sum-drugs", join([sp.norepi > 0 && `norepinephrine ${pct(sp.norepi)}`, sp.dobutamine > 0 && `dobutamine ${pct(sp.dobutamine)}`, PHYS.bb > 0 && `beta blocker ${PHYS.bb}%`, sp.nitro > 0 && "nitroglycerin", sp.atropine && "atropine", ...(sim.engine === "core" ? MORE_DRUGS.map(([, k, name]) => sp[k] > 0 && `${name} ${pct(sp[k])}`) : [])]));
  setText("sum-more-drugs", sim.engine === "core" ? join(MORE_DRUGS.map(([, k, name]) => sp[k] > 0 && `${name} ${pct(sp[k])}`)) : "");
  const im = { ...DEFAULT_IMPELLA, ...dev?.impella }, ia = { ...DEFAULT_IABP, ...dev?.iabp };
  setText("sum-devices", join([sp.iabp && `IABP 1:${ia.ratio}`, sp.impella && (spec ? `Impella ${im.model} P${im.level}` : "Impella"), !!dev?.ecmo && `ECMO ${(dev.ecmo.flowLpm ?? 3).toFixed(1)} L/min`, sp.pacing && `pacing ${sp.paceRate}`]));
  setText("sum-vent", vent && (vent.mode === "positive" || vent.peep) ? join([vent.mode === "positive" ? "positive pressure" : "spontaneous", !!vent.peep && `PEEP ${vent.peep}`, !!vent.tidalMlKg && `${vent.tidalMlKg} ml/kg`]) : "none");
  const done = [T.treated.stent && "stented", T.treated.lysed === true && "lysed", T.treated.lysed === false && "lysis failed", T.treated.grafts.length > 0 && "grafted"];
  setText("sum-treat", T.pending ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}` : done.some(Boolean) ? join(done) : "nothing on order");
}

/** The panel: readouts, which support is running, what is on order, where things stand, and the hint. */
let manageSig = "";
export function manageUi() {
  const live = G.phase !== "play";
  const inf = lvInfarctSize(sites, nec);
  const set = (id: string, v: string, bad = false) => { const e = $(id); e.textContent = v; e.classList.toggle("bad", bad); };
  set("m_time", T.ischemicMin > 0 ? clinicalTime(T.ischemicMin) : "—");
  set("m_inf", inf > 0.005 ? Math.round(inf * 100) + "%" : "none", inf > 0.15);
  const sp = T.support, onOff = (id: string, on: boolean) => { $(id).classList.toggle("on", on); $(id).textContent = on ? "On" : "Off"; };
  $("norv").textContent = sp.norepi ? Math.round(sp.norepi * 100) + "%" : "off";
  $("dobv").textContent = sp.dobutamine ? Math.round(sp.dobutamine * 100) + "%" : "off";
  onOff("m_nitro", sp.nitro > 0); onOff("m_atropine", sp.atropine); onOff("m_pace", sp.pacing); onOff("m_iabp", sp.iabp); onOff("m_impella", sp.impella);
  onOff("m_ecmo", !!patientOpts.patient?.devices?.ecmo);
  const core = sim.engine === "core";
  for (const [id, k] of MORE_DRUGS) { $(id + "v").textContent = sp[k] ? Math.round(sp[k] * 100) + "%" : "off"; const r = $<HTMLInputElement>(id); r.disabled = !core; if (document.activeElement !== r) r.value = String(Math.round(sp[k] * 100)); }
  $("more-drugs-note").textContent = core ? MORE_NOTE : "These drugs are modelled on the core engine only (the Simulator); the legacy engine, which the game runs on, ignores them.";
  $("pacev").textContent = sp.paceRate + " bpm";
  $("manage").classList.toggle("pacing", sp.pacing);
  const total = $("fluidv"); if (total) total.textContent = volumeGiven() || "none";
  for (const b of $("gamefluid").querySelectorAll("button")) b.disabled = sp.fluids >= SUPPORT.maxFluids;
  summaries();
  $("fluidnote").textContent = circ && circ.congestion > 0.2 ? `Lungs congesting (${Math.round(circ.congestion * 100)}%).` : "";
  for (const k of ["pci", "lysis", "cabg"] as const) {
    const b = $("m_" + k) as HTMLButtonElement;
    b.classList.toggle("on", T.pending?.kind === k); b.disabled = !live || (!!T.pending && T.pending.kind !== k);
  }
  ($("m_cancel") as HTMLButtonElement).disabled = !T.pending;
  $("mstatus").textContent = T.pending
    ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}.`
    : T.lastResult || `Nothing on order. PCI takes about ${PROCEDURE.pci.delayMin} min to reach the artery, a fibrinolytic ${PROCEDURE.lysis.delayMin}, CABG ${PROCEDURE.cabg.delayMin / 60} h.`;

  const sit = live ? situation() : null;
  if (!sit) return;
  const a = assess(sit);
  const n = a.issues.length, w = a.warnings.length;
  setText("sum-assess", n + w === 0 ? "stable" : join([n > 0 && `${n} issue${n > 1 ? "s" : ""}`, w > 0 && `${w} warning${w > 1 ? "s" : ""}`]));
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = a.issues.map((i) => `<div class="${i.tone}">${esc(i.text)}</div>`).join("") || `<div class="ok">Stable</div>`;
  const warn = a.warnings.map((w) => `<div>${esc(w.text)}</div>`).join("");
  const steps = a.steps.map((x) => `<div><b>${esc(x.text)}</b><small>${esc(x.why)}</small></div>`).join("");
  const sig = html + "|" + warn + "|" + steps + "|" + T.hint;
  if (sig === manageSig) return;
  manageSig = sig;
  $("issues").innerHTML = html; $("warns").innerHTML = warn;
  $("steps").innerHTML = steps; $("steps").hidden = !T.hint;
  $("m_hint").textContent = T.hint ? "Hide the guidelines" : "What would the guidelines do?";
}
/** Forget the last advice drawn, so the next `manageUi` repaints it (a new patient, a game phase change). */
export const resetManageSig = () => { manageSig = ""; };
/** The Management panel's controls: support switches, orders, the reset. */
export function wireManage() {
  const toggle = (f: () => void) => () => { f(); manageUi(); };
  // the (i) in each section's header shows or hides its explanation, without opening or closing the section
  for (const b of document.querySelectorAll<HTMLButtonElement>("#manage .sec-info")) b.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    const note = $("info-" + b.dataset.info), show = note.hidden;
    note.hidden = !show; b.setAttribute("aria-expanded", String(show)); b.classList.toggle("on", show);
    if (show) (b.closest("details") as HTMLDetailsElement).open = true;
  });
  // the game plays on the legacy engine, whose IV fluid is litres given (the Simulator's bolus is the playground's `fluids.given`)
  const gf = $("gamefluid");
  for (const ml of [250, 500, 1000]) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = `+${ml} ml`;
    b.addEventListener("click", toggle(() => { T.support.fluids = Math.min(SUPPORT.maxFluids, T.support.fluids + ml / 1000); }));
    gf.append(b);
  }
  const total = document.createElement("span"); total.className = "val"; total.id = "fluidv"; gf.append(total);
  range("nor", (v) => { T.support.norepi = v / 100; manageUi(); });
  range("dob", (v) => { T.support.dobutamine = v / 100; manageUi(); });
  for (const [id, k] of MORE_DRUGS) range(id, (v) => { T.support[k] = v / 100; manageUi(); });
  range("pacerate", (v) => { T.support.paceRate = v; manageUi(); });
  on("m_nitro", toggle(() => { T.support.nitro = T.support.nitro ? 0 : 1; }));
  on("m_atropine", toggle(() => { T.support.atropine = !T.support.atropine; }));
  on("m_pace", toggle(() => { T.support.pacing = !T.support.pacing; }));
  // One switch per device. The Simulator's switch edits `devices.*` (the legacy `support.iabp` / `support.impella` follow it); the game has only the legacy flags.
  const device = (id: "iabp" | "impella" | "ecmo") => toggle(() => {
    if (hooks.device) hooks.device(id, !(id === "ecmo" ? patientOpts.patient?.devices?.ecmo : T.support[id]));
    else if (id !== "ecmo") T.support[id] = !T.support[id];
  });
  on("m_iabp", device("iabp")); on("m_impella", device("impella")); on("m_ecmo", device("ecmo"));
  on("m_pci", toggle(() => orderProcedure("pci")));
  on("m_lysis", toggle(() => orderProcedure("lysis")));
  on("m_cabg", toggle(() => orderProcedure("cabg")));
  on("m_cancel", toggle(() => { T.pending = null; T.lastResult = "Order cancelled."; }));
  on("m_hint", toggle(() => { T.hint = !T.hint; manageSig = ""; }));
  on("m_reset", () => {
    // back to the lesion as it was drawn: take the treatment away and let the heart start over
    const o = T.original;
    clearTreatment(); manageSig = "";
    for (const k of Object.keys(sev)) delete sev[k];
    if (o) { S.lesionSeg = o.seg; S.pos = o.pos; S.ds = o.ds; S.occ = o.occ; $<HTMLSelectElement>("lseg").value = o.seg; $<HTMLInputElement>("pos").value = String(o.pos * 100); $<HTMLInputElement>("ds").value = String(o.ds * 100); }
    $<HTMLInputElement>("nor").value = "0"; $<HTMLInputElement>("dob").value = "0"; for (const [id] of MORE_DRUGS) $<HTMLInputElement>(id).value = "0"; $<HTMLInputElement>("pacerate").value = String(SUPPORT.paceDefault);
    hooks.resetTreatment?.(); // the Simulator: devices, boluses and the beta blocker are treatment too
    scheduleLesion(); buildGrafts(); manageUi();
  });
}
