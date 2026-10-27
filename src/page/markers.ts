// ---------------------------------------------------------------- markers: the lesion, and the player's call
import * as THREE from "three";
import { A, S } from "./state";
import { view, camera, ray } from "./scene";
import { heartMesh } from "./heart3d";
import { Built, built, vesselGroup } from "./vessels3d";

/** A floating label anchored to a point on a vessel: a bracket on the vessel, a leader line and a tag. */
interface Marker { el: HTMLElement; tag: HTMLElement; text: string; back: boolean; point: THREE.Vector3 }
function makeMarker(id: string): Marker {
  const el = document.createElement("div");
  el.id = id; el.hidden = true;
  el.innerHTML = '<i class="lz-ring"></i><i class="lz-line"></i><span class="lz-tag"></span>';
  view.append(el);
  return { el, tag: el.querySelector(".lz-tag") as HTMLElement, text: "", back: false, point: new THREE.Vector3() };
}
export const lesionMarker = makeMarker("lesion");
const lzDir = new THREE.Vector3();
let lzClock = 0;
/** `margin` keeps the anchor off the vessel's ends (the physics holds a lesion half a window in); `probe` re-tests occlusion by the heart. */
function placeMarker(m: Marker, b: Built | undefined, pos: number, text: string, margin: number, probe: boolean) {
  if (!b) { m.el.hidden = true; return; }
  const r = A.cond.seg[b.seg.id], L = b.seg.length;
  const s = Math.min(L - margin, Math.max(margin, pos * L));
  let i = 0;
  for (let k = 1; k < r.s.length; k++) if (Math.abs(r.s[k] - s) < Math.abs(r.s[i] - s)) i = k;
  m.point.copy(b.ctr[i]).addScaledVector(b.out[i], b.rad[i] * S.exag * 0.6);
  vesselGroup.localToWorld(m.point);
  const p = m.point.clone().project(camera);
  const inView = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
  m.el.hidden = !inView;
  if (!inView) return;
  m.el.style.transform = `translate(${((p.x + 1) / 2) * view.clientWidth}px, ${((1 - p.y) / 2) * view.clientHeight}px)`;
  if (text !== m.text) { m.text = text; m.tag.textContent = text; }
  // dim the marker when its point is behind the heart or another vessel as seen from the camera
  if (probe) {
    lzDir.copy(m.point).sub(camera.position);
    const dist = lzDir.length();
    ray.set(camera.position, lzDir.normalize());
    const hit = ray.intersectObjects([...built.filter((x) => x !== b).map((x) => x.mesh), ...(heartMesh.visible ? [heartMesh] : [])])[0];
    m.back = !!hit && hit.distance < dist - 3;
  }
  m.el.classList.toggle("back", m.back);
}
export function updateMarkers(dt: number) {
  const probe = (lzClock += dt) > 0.1;
  if (probe) lzClock = 0;
  const lb = (S.ds > 0 || S.occ) && !S.hide ? built.find((x) => x.seg.id === S.lesionSeg) : undefined;
  placeMarker(lesionMarker, lb, S.pos, `${S.occ ? "Occluded" : Math.round(S.ds * 100) + "% stenosis"} · ${lb?.seg.name ?? ""}`, 7, probe);
  updateLabels(probe);
}

// ---------------------------------------------------------------- name labels (the Layers panel's Labels switch)
const LABELLED = ["LM", "LAD", "LCX", "RCA", "PDA_R", "PDA_L"];
const segLabels = new Map<string, { el: HTMLElement; p: THREE.Vector3 }>();
const lp = new THREE.Vector3();
/** Floating names on the main arteries, placed at the middle of each, dimmed when the heart or another vessel is in front. */
export function updateLabels(probe: boolean) {
  for (const l of segLabels.values()) l.el.hidden = !S.labels;
  if (!S.labels) return;
  for (const b of built) {
    if (!LABELLED.includes(b.seg.id)) continue;
    let l = segLabels.get(b.seg.id);
    if (!l) { const el = document.createElement("div"); el.className = "seglabel"; el.textContent = b.seg.name; view.append(el); l = { el, p: new THREE.Vector3() }; segLabels.set(b.seg.id, l); }
    const i = b.ctr.length >> 1;
    l.p.copy(b.ctr[i]).addScaledVector(b.out[i], b.rad[i] * S.exag * 1.4);
    vesselGroup.localToWorld(l.p);
    lp.copy(l.p).project(camera);
    const inView = lp.z < 1 && Math.abs(lp.x) < 1 && Math.abs(lp.y) < 1;
    l.el.hidden = !inView;
    if (!inView) continue;
    l.el.style.transform = `translate(${((lp.x + 1) / 2) * view.clientWidth}px, ${((1 - lp.y) / 2) * view.clientHeight}px) translate(-50%, -120%)`;
    if (probe) {
      lzDir.copy(l.p).sub(camera.position);
      const dist = lzDir.length();
      ray.set(camera.position, lzDir.normalize());
      const hit = ray.intersectObjects([...built.filter((x) => x !== b).map((x) => x.mesh), ...(heartMesh.visible ? [heartMesh] : [])])[0];
      l.el.classList.toggle("back", !!hit && hit.distance < dist - 3);
    }
  }
}
