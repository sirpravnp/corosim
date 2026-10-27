// ---------------------------------------------------------------- management: orders, infarct clock, advice
import { LEADS } from "../config/ecg";
import { Lesion } from "../physics/network";
import { meetsStElevation } from "../physics/ecgLink";
import { PROCEDURE, SUPPORT, Procedure } from "../config/management";
import { lvInfarctSize, clinicalTime } from "../physics/infarct";
import { order, applyProcedure } from "../physics/revasc";
import { assess, Situation } from "../physics/advice";
import { tree, A, sites, circ, $, S, sim, sev, T, nec, clearTreatment, scheduleLesion, on, range, ecg, rstate } from "./state";
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
  scheduleLesion(); buildGrafts();
}
export function orderProcedure(kind: Procedure) {
  if (T.pending) { T.lastResult = `${PROC_LABEL[T.pending.kind]} is already on its way.`; return; }
  if (!currentLesion()) { T.lastResult = "There is no lesion to treat."; return; }
  T.pending = order(kind); T.lastResult = "";
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

/** The panel: readouts, which support is running, what is on order, where things stand, and the hint. */
let manageSig = "";
export function setTab(t: string) {
  $("manage").dataset.tab = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#manage .tab")) b.classList.toggle("on", b.dataset.tab === t);
}
export function manageUi() {
  const inf = lvInfarctSize(sites, nec);
  const set = (id: string, v: string, bad = false) => { const e = $(id); e.textContent = v; e.classList.toggle("bad", bad); };
  set("m_time", T.ischemicMin > 0 ? clinicalTime(T.ischemicMin) : "—");
  set("m_inf", inf > 0.005 ? Math.round(inf * 100) + "%" : "none", inf > 0.15);
  set("m_ef", circ ? Math.round(circ.ejectionFraction * 100) + "%" : "—", !!circ && circ.ejectionFraction < 0.4);
  set("m_cpp", circ ? Math.round(sim.perfusion) + " mmHg" : "—");
  const sp = T.support, onOff = (id: string, on: boolean) => { $(id).classList.toggle("on", on); $(id).textContent = on ? "On" : "Off"; };
  $("norv").textContent = sp.norepi ? Math.round(sp.norepi * 100) + "%" : "off";
  $("dobv").textContent = sp.dobutamine ? Math.round(sp.dobutamine * 100) + "%" : "off";
  onOff("m_nitro", sp.nitro > 0); onOff("m_atropine", sp.atropine); onOff("m_pace", sp.pacing); onOff("m_iabp", sp.iabp); onOff("m_impella", sp.impella);
  $("pacev").textContent = sp.pacing ? sp.paceRate + " bpm" : "off";
  $("manage").classList.toggle("pacing", sp.pacing);
  $("fluidv").textContent = sp.fluids ? sp.fluids.toFixed(1) + " L" : "none";
  $("m_fluid").classList.toggle("on", sp.fluids > 0);
  $("m_fluid").textContent = sp.fluids >= SUPPORT.maxFluids ? "At max" : "+500 ml";
  ($("m_fluid") as HTMLButtonElement).disabled = sp.fluids >= SUPPORT.maxFluids;
  $("fluidnote").textContent = circ && circ.congestion > 0.2 ? `Lungs congesting (${Math.round(circ.congestion * 100)}%).` : "";
  for (const k of ["pci", "lysis", "cabg"] as const) {
    const b = $("m_" + k) as HTMLButtonElement;
    b.classList.toggle("on", T.pending?.kind === k); b.disabled = (!!T.pending && T.pending.kind !== k);
  }
  ($("m_cancel") as HTMLButtonElement).disabled = !T.pending;
  $("mstatus").textContent = T.pending
    ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}.`
    : T.lastResult || `Nothing on order. PCI takes about ${PROCEDURE.pci.delayMin} min to reach the artery, a fibrinolytic ${PROCEDURE.lysis.delayMin}, CABG ${PROCEDURE.cabg.delayMin / 60} h.`;

  const sit = situation();
  if (!sit) return;
  const a = assess(sit);
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
  for (const b of document.querySelectorAll<HTMLButtonElement>("#manage .tab")) b.addEventListener("click", () => setTab(b.dataset.tab!));
  range("nor", (v) => { T.support.norepi = v / 100; manageUi(); });
  range("dob", (v) => { T.support.dobutamine = v / 100; manageUi(); });
  range("pacerate", (v) => { T.support.paceRate = v; manageUi(); });
  on("m_fluid", toggle(() => { T.support.fluids = Math.min(SUPPORT.maxFluids, T.support.fluids + 0.5); }));
  on("m_nitro", toggle(() => { T.support.nitro = T.support.nitro ? 0 : 1; }));
  on("m_atropine", toggle(() => { T.support.atropine = !T.support.atropine; }));
  on("m_pace", toggle(() => { T.support.pacing = !T.support.pacing; }));
  on("m_iabp", toggle(() => { T.support.iabp = !T.support.iabp; }));
  on("m_impella", toggle(() => { T.support.impella = !T.support.impella; }));
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
    $<HTMLInputElement>("nor").value = "0"; $<HTMLInputElement>("dob").value = "0"; $<HTMLInputElement>("pacerate").value = String(SUPPORT.paceDefault);
    scheduleLesion(); buildGrafts(); manageUi();
  });
}
