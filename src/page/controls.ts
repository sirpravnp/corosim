import * as THREE from "three";
import { Variant, TYPICAL } from "../anatomy/tree";
import { PART_NAMES } from "../anatomy/heartSurface";
import { Bbb, Rhythm } from "../config/ecg";
import { untreated } from "../physics/revasc";
import { tree, A, $, MMHG, Mode, HeartView, V, S, T, scheduleAnatomy, scheduleLesion, on, sel, range, G } from "./state";
import { renderer, camera, controls, VIEWS, setView, propsView, ray } from "./scene";
import { hPart, heartMesh, applyHeartView } from "./heart3d";
import { built, vesselGroup, shapeVessels, points, buildGrafts, branchMesh, segIdOfHit } from "./vessels3d";
import { callUi } from "./gameUi";
import { controlsUi, liveUi } from "./readouts";
import { syncSelects } from "./model";

let heartBeforeProps: HeartView | null = null; // the heart view the toggle replaced with see-through, put back when it is turned off

/** "Valves and defects": the structural props inside the heart. On, a solid heart becomes see-through so they show; off, it comes back. */
export function setProps(on: boolean) {
  if (on === S.props) return;
  S.props = on;
  if (on) { heartBeforeProps = null; if (S.heart === "solid") { heartBeforeProps = "solid"; S.heart = "ghost"; } }
  else if (heartBeforeProps && S.heart === "ghost") { S.heart = heartBeforeProps; heartBeforeProps = null; }
  propsView.show(on); applyHeartView(); controlsUi();
}
/** The view overlay shows one panel at a time (View, Layers, Heat map); the tab of the open one pressed again closes it. */
function openVc(id: string) {
  const open = $(`vc`).querySelector<HTMLElement>(`[data-vcp="${id}"]`)!.hidden;
  for (const p of document.querySelectorAll<HTMLElement>(".vc-pane")) p.hidden = p.dataset.vcp !== id || !open;
  for (const t of document.querySelectorAll<HTMLElement>(".vc-tab")) { const on = open && t.dataset.vc === id; t.classList.toggle("on", on); t.setAttribute("aria-expanded", String(on)); }
}
/** The lesion, anatomy, display, time-scale and camera controls. */
export function wireControls() {
  sel("dom", (v) => { V.dominance = v as Variant["dominance"]; scheduleAnatomy(); });
  sel("lm", (v) => { V.lm = v as Variant["lm"]; scheduleAnatomy(); });
  sel("lad", (v) => { V.ladCourse = v as Variant["ladCourse"]; scheduleAnatomy(); });
  sel("san", (v) => { V.saNodeFrom = v as Variant["saNodeFrom"]; scheduleAnatomy(); });
  sel("conus", (v) => { V.conusOstium = v as Variant["conusOstium"]; scheduleAnatomy(); });
  sel("lseg", (v) => { S.lesionSeg = v; T.treated = untreated(); T.pending = null; T.original = null; buildGrafts(); scheduleLesion(); });
  const preset = (p: Partial<Variant>) => { Object.assign(V, TYPICAL, p); syncSelects(); scheduleAnatomy(); };
  on("p_typ", () => preset({})); on("p_left", () => preset({ dominance: "left" })); on("p_ramus", () => preset({ lm: "trifurcation" })); on("p_abs", () => preset({ lm: "absent" }));
  range("pos", (v) => { S.pos = v / 100; scheduleLesion(); });
  range("ds", (v) => { S.ds = v / 100; S.occ = false; scheduleLesion(); });
  range("ex", (v) => { S.exag = v; shapeVessels(); controlsUi(); });
  on("occ", () => { S.occ = !S.occ; scheduleLesion(); });
  on("exert", () => { S.exert = !S.exert; scheduleLesion(); });
  for (const s of [1, 3, 6]) on("s" + s, () => { S.speed = s; controlsUi(); });
  for (const r of ["sinus", "af"] as Rhythm[]) on("r_" + r, () => { S.rhythm = r; controlsUi(); });
  for (const b of ["none", "rbbb", "lbbb"] as Bbb[]) on("c_" + b, () => { S.bbb = b; controlsUi(); });
  on("postbtn", () => { S.posterior = !S.posterior; controlsUi(); liveUi(); });
  (["real", "isch", "anat", "pressure", "velocity", "wss", "o2"] as Mode[]).forEach((m) => on("m_" + m, () => { S.mode = m; shapeVessels(); controlsUi(); }));
  (["solid", "ghost", "none"] as HeartView[]).forEach((h) => on("h_" + h, () => { S.heart = h; applyHeartView(); controlsUi(); }));
  on("labelbtn", () => { S.labels = !S.labels; controlsUi(); });
  for (const t of document.querySelectorAll<HTMLElement>(".vc-tab")) t.addEventListener("click", () => openVc(t.dataset.vc!));
  on("propsbtn", () => setProps(!S.props));
  on("flowbtn", () => { S.flow = !S.flow; points.visible = S.flow; shapeVessels(); controlsUi(); });
  for (const k of Object.keys(VIEWS)) on(k, () => setView(k));
  on("spin", () => { controls.autoRotate = !controls.autoRotate; controls.autoRotateSpeed = 1.2; $("spin").classList.toggle("on", controls.autoRotate); });
}

/** Click a vessel (or the heart) in the 3D view: select it, show its facts, or in a case make the call. */
export function wirePicking() {
  const mouse = new THREE.Vector2();
  let down = [0, 0];
  renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const rc = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects([...built.map((b) => b.mesh), ...(branchMesh() ? [branchMesh()!] : []), heartMesh])[0];
    S.selected = hit && hit.object !== heartMesh ? segIdOfHit(hit) : "";
    const box = $("pick");
    if (hit && hit.object === heartMesh && hit.face) {
      box.style.display = "block";
      box.innerHTML = `<b>${PART_NAMES[hPart[hit.face.a]]}</b>`;
    } else if (!S.selected) box.style.display = "none";
    else if (G.phase === "play") {
      // in a case the click is the call: the spot on the vessel nearest the hit
      const b = built.find((x) => x.seg.id === S.selected)!, r = A.cond.seg[b.seg.id], q = vesselGroup.worldToLocal(hit.point.clone());
      let i = 0, best = Infinity;
      b.ctr.forEach((c, k) => { const d2 = q.distanceToSquared(c); if (d2 < best) { best = d2; i = k; } });
      G.call = { segId: b.seg.id, pos: r.s[i] / b.seg.length };
      box.style.display = "none"; callUi();
    } else {
      const sg = tree.byId[S.selected], r2 = A.cond.seg[S.selected], n = r2.s.length;
      box.style.display = "block";
      box.innerHTML = `<b>${sg.name}</b><br>length ${sg.length.toFixed(0)} mm · Ø ${(Math.min(...r2.d) * 1e3).toFixed(1)}–${(Math.max(...r2.d) * 1e3).toFixed(1)} mm<br>inflow ${(r2.Q[0] * 6e7).toFixed(0)} ml/min<br>pressure ${(r2.P[0] / MMHG).toFixed(0)} → ${(r2.P[n - 1] / MMHG).toFixed(0)} mmHg<br>supplies ${(sg.subMass * 100).toFixed(0)}% of myocardium`;
    }
    shapeVessels();
  });
}
