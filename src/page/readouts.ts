// ---------------------------------------------------------------- UI text
import { ALL_LEADS, LEADS } from "../config/ecg";
import { CIRC } from "../physics/circulation";
import { ischemicBurden } from "../physics/ecgLink";
import { EcgStrip } from "../ecgStrip";
import { RhythmState } from "../physics/rhythm";
import { libraryRhythm } from "../physics/rhythmSource";
import { tree, A, sites, circ, $, V, S, sim, sev, PHYS, ecg, rstate } from "./state";
import { rhythmPickerUi } from "./rhythmPicker";
import { manageUi } from "./manage";
import { dockUi } from "./dock";
import { gameUi } from "./gameUi";

export function controlsUi() {
  $("posv").textContent = Math.round(S.pos * 100) + "%";
  $("dsv").textContent = S.occ ? "occluded" : Math.round(S.ds * 100) + "%";
  $("exv").textContent = String(S.exag);
  $("occ").textContent = S.occ ? "Reperfuse" : "Occlude";
  $("occ").classList.toggle("on", S.occ); $("exert").classList.toggle("on", S.exert);
  $("flowbtn").classList.toggle("on", S.flow);
  $("labelbtn").classList.toggle("on", S.labels);
  $("propsbtn").classList.toggle("on", S.props);
  for (const m of ["real", "isch", "anat", "pressure", "velocity", "wss", "o2"]) $("m_" + m).classList.toggle("on", S.mode === m);
  for (const s of [1, 3, 6]) $("s" + s).classList.toggle("on", S.speed === s);
  rhythmPickerUi();
  for (const b of ["none", "rbbb", "lbbb"]) $("c_" + b).classList.toggle("on", S.bbb === b);
  $("postbtn").classList.toggle("on", S.posterior); $("stmap").classList.toggle("wide", S.posterior); ecg.posterior = S.posterior;
  const risk = A.cond.atRisk * 100;
  $("risk").textContent = S.hide ? "—" : risk.toFixed(0) + "%"; $("risk").style.color = S.hide ? "var(--muted)" : risk > 25 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--ok)";
  $("ffr").textContent = S.ds > 0 && !S.occ && !S.hide ? A.ffr[0].toFixed(2) : "—";
  $("ffr").style.color = A.ffr[0] < 0.8 && !S.hide ? "var(--bad)" : "var(--ink)";
  $("tag").textContent = S.hide ? `${tree.segments.length} arteries · click the culprit · drag to orbit` : `${tree.segments.length} arteries · radius ×${S.exag} · click a vessel · drag to orbit`;
}

export const rhythmLabel = (r: ReturnType<EcgStrip["rhythm"]>, rs: RhythmState | null) => {
  const deg = rs?.avDegree ?? 0, bbb = rs?.bbb ?? "none";
  const tail = (bbb === "rbbb" ? ", right bundle branch block" : bbb === "lbbb" ? ", left bundle branch block" : "") + (r.pvc ? ", PVCs" : "");
  const lib = libraryRhythm(rs?.rhythm); // B2: a rhythm from the EKG library is named as the library names it
  if (lib) return lib.name + (r.pvc && !lib.spec.rhythm.kind.startsWith("v") ? ", PVCs" : "");
  if (rs?.rhythm === "af") return (deg === 3 ? "Atrial fibrillation with complete heart block, junctional escape" : deg >= 1 ? "Atrial fibrillation, slow ventricular response" : "Atrial fibrillation") + tail;
  const sinus = r.atrial < 60 ? "Sinus bradycardia" : r.atrial > 100 ? "Sinus tachycardia" : "Sinus rhythm";
  return (deg === 3 ? "Complete heart block, junctional escape"
    : deg === 2 ? `${sinus}, Mobitz I (Wenckebach)`
    : deg === 1 ? `${sinus}, first-degree AV block` : sinus) + tail;
};

const leadOrder = () => (S.posterior ? ALL_LEADS : LEADS);
export function liveUi() {
  const r = ecg.rhythm(), st = ecg.st();
  const hr = Math.round(r.hr), deg = rstate?.avDegree ?? 0;
  $("hr").textContent = hr ? hr + " bpm" : "…";
  $("hr").style.color = hr && (hr < 50 || hr > 110) ? "var(--bad)" : hr && (hr < 60 || hr > 100) ? "var(--warn)" : "var(--ink)";
  const af = rstate?.rhythm === "af";
  $("arate").textContent = af ? "fibrillating" : r.atrial ? Math.round(r.atrial) + " bpm" : "…";
  $("pr").textContent = af ? "—" : deg === 3 ? "dissociated" : r.pr === null ? "…" : Math.round(r.pr * 1000) + " ms" + (deg === 2 ? " (lengthening)" : "");
  $("pr").style.color = deg >= 1 && !af ? "var(--bad)" : "var(--ink)";
  $("rhythm").textContent = rhythmLabel(r, rstate);
  $("rhythm").style.color = deg >= 2 ? "var(--bad)" : af || deg === 1 || r.atrial < 60 || r.atrial > 100 ? "var(--warn)" : "var(--ink)";
  const up = leadOrder().filter((l) => st[l] >= 1), down = leadOrder().filter((l) => st[l] <= -1);
  $("stup").textContent = up.length ? up.join(", ") : "none"; $("stup").style.color = up.length ? "var(--bad)" : "var(--ink)";
  $("stdown").textContent = down.length ? down.join(", ") : "none";
  if (circ) {
    const mapSm = sim.map, lb = sim.history[sim.history.length - 1], roll = sim.rolling(10); // this beat's own pressure; output over 10 s
    $("bp").textContent = lb ? `${Math.round(lb.sbp)}/${Math.round(lb.dbp)} (${Math.round(mapSm)})` : `— (${Math.round(mapSm)})`;
    $("bp").style.color = mapSm < CIRC.shockMap ? "var(--bad)" : mapSm < CIRC.hypotensionMap ? "var(--warn)" : "var(--ink)";
    $("co").textContent = Number.isFinite(roll.cardiacOutput) ? `${roll.cardiacOutput.toFixed(1)} L/min · SV ${Math.round(roll.sv)} ml` : "…";
    const st8 = mapSm < CIRC.shockMap ? "Shock" : mapSm < CIRC.hypotensionMap ? "Hypotension" : "Stable";
    const why = circ.rvIschemia > 0.3 ? "RV involvement" : circ.lvIschemia > 0.35 ? "LV pump failure" : circ.hr < 50 ? "bradycardia" : "";
    $("circ").textContent = st8 + (st8 !== "Stable" && why ? `, ${why}` : "");
    $("circ").style.color = $("bp").style.color;
  }
  const burden = ischemicBurden(sites, sev) * 100;
  $("burden").textContent = S.hide ? "—" : burden.toFixed(0) + "%"; $("burden").style.color = S.hide ? "var(--muted)" : burden > 10 ? "var(--bad)" : burden > 1 ? "var(--warn)" : "var(--ink)";
  $("stmap").innerHTML = leadOrder().map((l) => {
    const v = st[l], cls = v >= 1 ? "up" : v <= -1 ? "down" : "";
    const txt = Math.abs(v) < 0.05 ? "0.0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1);
    return `<div><b>${l}</b><span class="${cls}">${txt}</span></div>`;
  }).join("");
  gameUi(); dockUi();
  manageUi();
  if (S.hide) return; // the perfusion table names the starved beds
  const bySeg: Record<string, { ratio: number; mass: number; label: string; isch: number }> = {};
  for (const t of A.cond.terminals) {
    const b = (bySeg[t.segId] ??= { ratio: Infinity, mass: 0, label: tree.byId[t.segId].name, isch: 0 });
    b.ratio = Math.min(b.ratio, t.ratio); b.isch += (sev[t.key] ?? 0) * t.mass; b.mass += t.mass;
  }
  $("beds").innerHTML = Object.values(bySeg).sort((a, b) => a.ratio - b.ratio || b.isch - a.isch).map((b) => {
    const col = b.ratio >= 0.95 ? "var(--ok)" : b.ratio > 0.5 ? "var(--warn)" : "var(--bad)";
    const isch = b.isch / b.mass;
    return `<div class="bed"><span>${b.label} <small>${(b.mass * 100).toFixed(0)}% of mass</small></span><span class="bar"><i style="width:${Math.min(100, b.ratio * 100)}%;background:${col}"></i></span><span class="num">${(Math.min(b.ratio, 9.99) * 100).toFixed(0)}%</span><span class="isch ${isch > 0.1 ? "hot" : ""}">${isch > 0.005 ? "isch " + (isch * 100).toFixed(0) + "%" : ""}</span></div>`;
  }).join("");
}

export function physUi() {
  $("blv").textContent = PHYS.bl === 0 ? "normal" : PHYS.bl > 0 ? `${PHYS.bl}% lost` : `${-PHYS.bl}% overload`;
  $("bbv").textContent = PHYS.bb ? PHYS.bb + "%" : "none";
  for (const k of Object.keys(PHYS) as (keyof typeof PHYS)[]) $<HTMLInputElement>(k).value = String(PHYS[k]);
}
