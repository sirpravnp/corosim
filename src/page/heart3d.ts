// ---------------------------------------------------------------- heart (chambers, great vessels)
import * as THREE from "three";
import { rotateHeart } from "../anatomy/tree";
import { meshHeart, projectToEpicardium, septalDistance, latitude, AV_GROOVE_LAT, Part } from "../anatomy/heartSurface";
import { V3 } from "../anatomy/curve";
import { o2Frame, myocardiumO2Color } from "../sim/o2View";
import type { SurfaceMesh } from "../anatomy/heartSurface";
import type { O2Frame } from "../sim/o2View";
import type { Saturations } from "../sim/hemoSource";
import { tree, sites, $, S, sev, panelSource } from "./state";
import { heartGroup } from "./scene";

const heartGeo = new THREE.BufferGeometry();
let hRef: V3[] = []; // heart-frame position of each vertex
export let hPart: Uint8Array = new Uint8Array(0);
/** Put the heart's mesh into the geometry (it arrives from the worker some time after the page has painted). */
export function installHeart(m: SurfaceMesh) {
  const n = m.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  hRef = [];
  for (let i = 0; i < n; i++) {
    const p: V3 = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
    hRef.push(p);
    pos.set(rotateHeart(p), 3 * i);
    nor.set(rotateHeart([m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]]), 3 * i);
  }
  hPart = m.parts;
  heartGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  heartGeo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  heartGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  heartGeo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  heartGroup.add(heartMesh);
  prepareMyocardium();
}
/** The heart's mesh: built off the main thread (the page paints meanwhile), on this thread only where there is no worker. */
export function loadHeartMesh(): Promise<SurfaceMesh> {
  return new Promise((resolve) => {
    try {
      const w = new Worker(new URL("../structural/meshWorker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ mesh: SurfaceMesh }>) => { w.terminate(); resolve(e.data.mesh); };
      w.onerror = () => { w.terminate(); resolve(meshHeart()); };
      w.postMessage({ id: 0, step: 1.4 });
    } catch { resolve(meshHeart()); }
  });
}
const heartMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.35, sheenColor: new THREE.Color(0xffc9b8), sheenRoughness: 0.6,
});
export const heartMesh = new THREE.Mesh(heartGeo, heartMat); // added to the scene when the mesh arrives (installHeart)
heartMesh.visible = false;
// Specimen palette: muscle-red ventricles, thinner darker atria, pale aorta.
const PART_COLOR: Record<Part, THREE.Color> = {
  [Part.LV]: new THREE.Color(0x7c2a24), [Part.RV]: new THREE.Color(0x82302a), [Part.RA]: new THREE.Color(0x70282a), [Part.LA]: new THREE.Color(0x732b2b),
  [Part.Aorta]: new THREE.Color(0xd2a08f),
};
const FAT = new THREE.Color(0xc9a564), DUSKY = new THREE.Color(0x3f3150);
let fatK = new Float32Array(0), grain = new Float32Array(0);
let bedIdx: Int16Array = new Int16Array(0), bedW = new Float32Array(0), cover = new Float32Array(0);
const NB = 4;
const isVentricle = (i: number) => hPart[i] === Part.LV || hPart[i] === Part.RV;

/**
 * Per-vertex epicardial fat (in the grooves and along the arteries) and nearest-bed weights for ischemia. About 0.7 s of work, so it
 * runs in slices between frames (`pumpMyocardium`); the arrays are swapped in when it is done, and a new call restarts it.
 */
let myoJob: Generator<void> | null = null, myoReady = false;
export function prepareMyocardium() { myoJob = hRef.length ? myocardiumSteps() : null; }
export function pumpMyocardium(ms: number) {
  if (!myoJob) return;
  const t0 = performance.now();
  do { if (myoJob.next().done) { myoJob = null; myoReady = true; applyHeartView(); paintMyocardium(); return; } } while (performance.now() - t0 < ms);
}
function* myocardiumSteps(): Generator<void> {
  const n = hRef.length;
  const nFat = new Float32Array(n), nGrain = new Float32Array(n), nIdx = new Int16Array(n * NB), nW = new Float32Array(n * NB), nCover = new Float32Array(n);
  const vs: { p: V3; w: number }[] = [];
  for (const seg of tree.segments) {
    const main = ["LAD", "LCX", "RCA", "PDA_R", "PDA_L", "LM"].includes(seg.id);
    for (let i = 0; i < seg.heartSamples.length; i += 3) vs.push({ p: projectToEpicardium(seg.heartSamples[i], 0).pos, w: main ? 4.2 : 2.6 });
  }
  const bedPos = sites.map((s) => { const [segId, k] = s.key.split("#"), sg = tree.byId[segId]; return projectToEpicardium(sg.curve.at(k === "end" ? 1 : sg.taps[+k].pos), 0).pos; });
  yield;
  for (let i = 0; i < n; i++) {
    if (i % 400 === 399) yield;
    const p = hRef[i];
    nGrain[i] = 0.92 + 0.08 * Math.sin(p[0] * 0.21 + Math.sin(p[1] * 0.13) * 3) * Math.sin(p[2] * 0.19 + p[1] * 0.07);
    if (!isVentricle(i)) { nCover[i] = 0; continue; }
    let f = 0;
    for (const v of vs) { const d2 = (p[0] - v.p[0]) ** 2 + (p[1] - v.p[1]) ** 2 + (p[2] - v.p[2]) ** 2; f = Math.max(f, Math.exp(-d2 / (v.w * v.w))); }
    f = Math.max(f, 0.65 * Math.exp(-(((latitude(p) - AV_GROOVE_LAT) / 0.06) ** 2))); // atrioventricular groove
    f = Math.max(f, 0.45 * Math.exp(-((septalDistance(p) / 4.5) ** 2)) * (p[1] < 50 ? 1 : 0)); // interventricular grooves
    nFat[i] = Math.min(0.72, f * 0.78);
    const near = bedPos.map((b, j) => ({ j, d2: (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2 })).sort((a, b) => a.d2 - b.d2).slice(0, NB);
    let sum = 0;
    near.forEach((e, k) => { const w = Math.exp(-e.d2 / (22 * 22)); nIdx[i * NB + k] = e.j; nW[i * NB + k] = w; sum += w; });
    nCover[i] = Math.min(1, sum * 1.6);
    for (let k = 0; k < NB; k++) nW[i * NB + k] /= sum || 1;
  }
  fatK = nFat; grain = nGrain; bedIdx = nIdx; bedW = nW; cover = nCover;
}
/** The O₂ sat mode's frame: the panels' source's saturations (none before the panel workspace exists, i.e. in the game). */
export function o2Now(): O2Frame { return o2Frame(panelSource ? panelSource.saturations() : noSat()); }
const noSat = (): Saturations => ({ node: {} as Saturations["node"], spo2: NaN, preductal: NaN, postductal: NaN, svo2: NaN, do2: NaN, vo2: NaN, lactate: NaN, bed: {}, bedSource: "ischemia-derived" });
export function paintMyocardium() {
  if (!myoReady) return;
  const ca = heartGeo.attributes.color as THREE.BufferAttribute, c = new THREE.Color(), base = new THREE.Color();
  const o2 = S.mode === "o2" ? o2Now() : null, bk: string[] = ["", "", "", ""], bw = [0, 0, 0, 0];
  for (let i = 0; i < hRef.length; i++) {
    c.copy(PART_COLOR[hPart[i] as Part]).multiplyScalar(grain[i]);
    if (o2 && isVentricle(i)) {
      for (let k = 0; k < NB; k++) { bk[k] = sites[bedIdx[i * NB + k]].key; bw[k] = bedW[i * NB + k]; }
      base.copy(c); myocardiumO2Color(o2, bk, bw, cover[i], base, c);
    } else if (isVentricle(i)) {
      let isch = 0;
      if (!S.hideIsch) for (let k = 0; k < NB; k++) isch += bedW[i * NB + k] * (sev[sites[bedIdx[i * NB + k]].key] ?? 0);
      isch *= cover[i];
      c.lerp(DUSKY, 0.75 * isch);
      c.lerp(FAT, fatK[i] * (1 - 0.4 * isch));
    }
    ca.setXYZ(i, c.r, c.g, c.b);
  }
  ca.needsUpdate = true;
}
export function applyHeartView() {
  heartMesh.visible = S.heart !== "none" && myoReady;
  heartMat.transparent = S.heart === "ghost"; heartMat.opacity = S.heart === "ghost" ? 0.28 : 1; heartMat.depthWrite = S.heart !== "ghost";
  heartMat.needsUpdate = true;
  for (const k of ["solid", "ghost", "none"] as const) $("h_" + k).classList.toggle("on", S.heart === k);
}
