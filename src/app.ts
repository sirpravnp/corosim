import "./customSelect";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildTree, Tree, Variant, TYPICAL, rotateHeart, Segment, diameterAt } from "./anatomy/tree";
import { meshHeart, projectToEpicardium, septalDistance, latitude, AV_GROOVE_LAT, Part, PART_NAMES } from "./anatomy/heartSurface";
import { V3 } from "./anatomy/curve";
import { ALL_LEADS, Bbb, LEADS, Rhythm, ST } from "./config/ecg";
import { Lesion, Analysis } from "./physics/network";
import { Circulation, CIRC } from "./physics/circulation";
import { BedSite, ischemicBurden, meetsStElevation } from "./physics/ecgLink";
import { EcgStrip } from "./ecgStrip";
import { RhythmState } from "./physics/rhythm";
import { INFARCT, PROCEDURE, SUPPORT, Procedure } from "./config/management";
import { noSupport } from "./physics/support";
import { stepNecrosis, lvInfarctSize, clinicalTime } from "./physics/infarct";
import { Pending, Treated, untreated, order, applyProcedure } from "./physics/revasc";
import { assess, Situation } from "./physics/advice";
import { Simulation } from "./sim/simulation";
import { Scenario, LesionSpec } from "./sim/scenario";
import { encodeScenario, decodeScenario } from "./sim/llm";
import { TOOLS } from "./mcp/tools";
import { mountShell } from "./shell/shell";
import { mountWorkspace } from "./panels/workspace";
import { PlayClock } from "./panels/timeControl";
import { numbersPanel } from "./panels/numbers";
import { tracesPanel } from "./panels/traces";
import { loopsPanel } from "./panels/loops";
import { rhcPanel } from "./panels/rightHeartCath";
import { leftHeartCathPanel } from "./panels/leftHeartCath";
import { jvpPanel } from "./panels/jvp";
import { oxygenPanel } from "./panels/oxygen";
import { BridgeSource } from "./sim/bridgeSource";
import { createWorkerSolver } from "./sim/bridgeWorkerSolver";
import { decodePatient, encodePatient } from "./sim/llm";
import { joinPatient } from "./sim/crossLinks";
import { mountCrossLinks } from "./shell/crossLinkRow";
import { SimPropsView } from "./sim/propsView";
import type { PatientSpec } from "./sim/patient";
import type { BridgeSolver } from "./sim/bridgeSolver";
import { o2Frame, o2Legend, myocardiumO2Color, vesselO2Color, type O2Frame } from "./sim/o2View";
import type { Saturations } from "./sim/hemoSource";
import { Case, MAX_SCORE, POINTS, Point, TREAT, TreatRecord, TreatScore, dailyCase, dayKey, dayNumber, explain, explainTreatment, fullFindings, judge, keyOfDay, muscleSaved, parseDay, rvInvolvement, score, streaks, treatScore } from "./game";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MMHG = 133.322;
type Mode = "real" | "anat" | "pressure" | "velocity" | "wss" | "o2";
type HeartView = "solid" | "ghost" | "none";

const V: Variant = { ...TYPICAL };
const S = {
  lesionSeg: "LAD", pos: 0.15, ds: 0, occ: false, exert: false, speed: 1,
  mode: "real" as Mode, heart: "solid" as HeartView, exag: 2.5, flow: false, selected: "",
  hide: false, // game: the lesion is kept out of every display (lumen, vessel shading, marker, perfusion table)
  hideIsch: false, // game: the myocardium does not darken either
  rhythm: "sinus" as Rhythm, bbb: "none" as Bbb, // what the patient brought with them
  props: false, // structural valves, defects and jets inside the heart (not in the game)
  posterior: false, // show V7–V9 as a fifth column
};
// The physics lives in the shared headless Simulation (the MCP server and the tests step the same object);
// this file draws it, feeds it the controls, and runs the game and the management panel around it.
const sim = new Simulation({ seed: 1 });
let tree: Tree = sim.tree, A: Analysis = sim.analysis, sites: BedSite[] = sim.sites;
const sev = sim.sev; // per-bed ischemia state (0..1), evolves in time; the simulation clears it in place
let extraLesions: LesionSpec[] = []; // lesions from a loaded scenario beyond the one the controls edit

// ---------------------------------------------------------------- renderer
const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
const camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Camera targets the middle of the whole heart, ventricles to great vessels.
const TARGET = new THREE.Vector3(-6, 14, -4);
const VIEWS: Record<string, [number, number, number]> = {
  vAnt: [0, 30, 330], vLeft: [320, 25, 10], vPost: [0, 30, -330], vInf: [20, -320, 90], vRight: [-320, 25, 10],
};
const setView = (id: string) => { camera.position.set(...VIEWS[id]).add(TARGET); controls.target.copy(TARGET); for (const k in VIEWS) $(k).classList.toggle("on", k === id); };
const key = new THREE.DirectionalLight(0xfff4ea, 1.6); key.position.set(120, 160, 220); scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5); fill.position.set(-180, -40, 120); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-60, 90, -220); scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

const heartGroup = new THREE.Group(); scene.add(heartGroup);
const propsView = new SimPropsView(heartGroup); // built when the toggle is first on, for the patient of a shared link
let heartBeforeProps: HeartView | null = null; // the heart view the toggle replaced with see-through, put back when it is turned off

// ---------------------------------------------------------------- helpers
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const VIRIDIS = ["#440154", "#3b528b", "#21908d", "#5dc863", "#fde725"], MAGMA = ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"];
const ramp = (stops: string[], t: number) => { t = Math.min(1, Math.max(0, t)) * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(t)); return new THREE.Color(stops[k]).lerp(new THREE.Color(stops[k + 1]), t - k); };
const lg = (v: number, lo: number, hi: number) => (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
const GROUP_COLOR: Record<string, number> = { LAD: 0x1f5fa8, LCx: 0x2e7d4f, RCA: 0xc77c00 };
const ARTERY = new THREE.Color(0xc2392f), ARTERY_DEEP = new THREE.Color(0x8a221d), GRAY = new THREE.Color(0x9a9a9a);

// ---------------------------------------------------------------- heart (chambers, great vessels)
const heartGeo = new THREE.BufferGeometry();
const hRef: V3[] = []; // heart-frame position of each vertex
let hPart: Uint8Array = new Uint8Array(0);
{
  const m = meshHeart();
  const n = m.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
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
}
const heartMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.35, sheenColor: new THREE.Color(0xffc9b8), sheenRoughness: 0.6,
});
const heartMesh = new THREE.Mesh(heartGeo, heartMat);
heartGroup.add(heartMesh);
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

/** Per-vertex epicardial fat (in the grooves and along the arteries) and nearest-bed weights for ischemia. */
function prepareMyocardium() {
  const n = hRef.length;
  fatK = new Float32Array(n); grain = new Float32Array(n);
  bedIdx = new Int16Array(n * NB); bedW = new Float32Array(n * NB); cover = new Float32Array(n);
  const vs: { p: V3; w: number }[] = [];
  for (const seg of tree.segments) {
    const main = ["LAD", "LCX", "RCA", "PDA_R", "PDA_L", "LM"].includes(seg.id);
    for (let i = 0; i < seg.heartSamples.length; i += 3) vs.push({ p: projectToEpicardium(seg.heartSamples[i], 0).pos, w: main ? 4.2 : 2.6 });
  }
  const bedPos = sites.map((s) => { const [segId, k] = s.key.split("#"), sg = tree.byId[segId]; return projectToEpicardium(sg.curve.at(k === "end" ? 1 : sg.taps[+k].pos), 0).pos; });
  for (let i = 0; i < n; i++) {
    const p = hRef[i];
    grain[i] = 0.92 + 0.08 * Math.sin(p[0] * 0.21 + Math.sin(p[1] * 0.13) * 3) * Math.sin(p[2] * 0.19 + p[1] * 0.07);
    if (!isVentricle(i)) { cover[i] = 0; continue; }
    let f = 0;
    for (const v of vs) { const d2 = (p[0] - v.p[0]) ** 2 + (p[1] - v.p[1]) ** 2 + (p[2] - v.p[2]) ** 2; f = Math.max(f, Math.exp(-d2 / (v.w * v.w))); }
    f = Math.max(f, 0.65 * Math.exp(-(((latitude(p) - AV_GROOVE_LAT) / 0.06) ** 2))); // atrioventricular groove
    f = Math.max(f, 0.45 * Math.exp(-((septalDistance(p) / 4.5) ** 2)) * (p[1] < 50 ? 1 : 0)); // interventricular grooves
    fatK[i] = Math.min(0.72, f * 0.78);
    const near = bedPos.map((b, j) => ({ j, d2: (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2 })).sort((a, b) => a.d2 - b.d2).slice(0, NB);
    let sum = 0;
    near.forEach((e, k) => { const w = Math.exp(-e.d2 / (22 * 22)); bedIdx[i * NB + k] = e.j; bedW[i * NB + k] = w; sum += w; });
    cover[i] = Math.min(1, sum * 1.6);
    for (let k = 0; k < NB; k++) bedW[i * NB + k] /= sum || 1;
  }
}
/** The O₂ sat mode's frame: the bridge's saturations (null before the panel workspace exists, i.e. in the game). */
function o2Now(): O2Frame { return o2Frame(bridge ? bridge.saturations() : noSat()); }
const noSat = (): Saturations => ({ node: {} as Saturations["node"], spo2: NaN, preductal: NaN, postductal: NaN, svo2: NaN, do2: NaN, vo2: NaN, lactate: NaN, bed: {}, bedSource: "ischemia-derived" });
function paintMyocardium() {
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
function applyHeartView() {
  heartMesh.visible = S.heart !== "none";
  heartMat.transparent = S.heart === "ghost"; heartMat.opacity = S.heart === "ghost" ? 0.28 : 1; heartMat.depthWrite = S.heart !== "ghost";
  heartMat.needsUpdate = true;
  for (const k of ["solid", "ghost", "none"] as const) $("h_" + k).classList.toggle("on", S.heart === k);
}

// ---------------------------------------------------------------- vessels
interface Built { seg: Segment; mesh: THREE.Mesh; ctr: THREE.Vector3[]; out: THREE.Vector3[]; nrm: THREE.Vector3[]; bin: THREE.Vector3[]; rad: number[]; d: number[]; blocked: boolean[] }
let built: Built[] = [];
const vesselGroup = new THREE.Group(); heartGroup.add(vesselGroup);
const M = 22;
const vesselMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: new THREE.Color(0xffd0c8) });

function blockedFlags(seg: Segment): boolean[] {
  const r = A.cond.seg[seg.id];
  let wholly = false, up: Segment | null = seg.parent ? tree.byId[seg.parent] : null, at = seg.attach * (up ? up.length : 0);
  while (up) { const bf = A.cond.seg[up.id].blockedFrom; if (bf !== null && bf < at) { wholly = true; break; } at = up.attach * (up.parent ? tree.byId[up.parent].length : 0); up = up.parent ? tree.byId[up.parent] : null; }
  return r.s.map((s) => wholly || (r.blockedFrom !== null && s > r.blockedFrom));
}

/** Tube along each vessel: lumen from the physics, plus display-only tortuosity, ostial flare and a tapered tip. */
function buildVessels() {
  for (const b of built) { vesselGroup.remove(b.mesh); b.mesh.geometry.dispose(); }
  built = [];
  for (const seg of tree.segments) {
    const r = A.cond.seg[seg.id], n = r.s.length, L = seg.length, ph = hash(seg.id) * 6.283;
    const placed = r.s.map((s) => projectToEpicardium(seg.curve.at(s / L), 0.6));
    const base = placed.map((q) => v3(rotateHeart(q.pos)));
    const surfN = placed.map((q) => v3(rotateHeart(q.n)));
    const ctr: THREE.Vector3[] = [], nrm: THREE.Vector3[] = [], bin: THREE.Vector3[] = [];
    const dMax = Math.max(...r.d) * 1000;
    const amp = 0.22 + 0.4 * (1 - Math.min(1, dMax / 3.5)); // mm; smaller arteries meander more
    for (let i = 0; i < n; i++) {
      const s = r.s[i];
      const t = base[Math.min(n - 1, i + 1)].clone().sub(base[Math.max(0, i - 1)]).normalize();
      const side = new THREE.Vector3().crossVectors(t, surfN[i]).normalize(); // tangent to the heart surface
      // irregular meander: incommensurate wavelengths so it never looks periodic
      const wig = smooth(s / 10) * smooth((L - s) / 6) * amp *
        (Math.sin((6.283 * s) / 23.1 + ph) + 0.55 * Math.sin((6.283 * s) / 11.7 + 2.3 * ph) + 0.25 * Math.sin((6.283 * s) / 5.3 + 4.1 * ph));
      ctr.push(base[i].clone().addScaledVector(side, wig));
    }
    let nv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = ctr[Math.min(n - 1, i + 1)].clone().sub(ctr[Math.max(0, i - 1)]).normalize();
      if (i === 0) nv = surfN[0].clone().sub(t.clone().multiplyScalar(surfN[0].dot(t))).normalize();
      else nv = nv.clone().sub(t.clone().multiplyScalar(nv.dot(t))).normalize();
      nrm.push(nv.clone()); bin.push(new THREE.Vector3().crossVectors(t, nv).normalize());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * (M + 1) * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * (M + 1) * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, vesselMat);
    mesh.userData.segId = seg.id; vesselGroup.add(mesh);
    const b: Built = { seg, mesh, ctr, out: surfN, nrm, bin, rad: [], d: [], blocked: blockedFlags(seg) };
    lumen(b); built.push(b);
  }
  shapeVessels();
}
/** Ring radii (mm) from the physics' lumen at each sample, with the ostial flare, tapered tip and a slight ripple. */
function lumen(b: Built) {
  const seg = b.seg, r = A.cond.seg[seg.id], L = seg.length, ph = hash(seg.id) * 6.283;
  b.d = S.hide ? r.s.map((s) => diameterAt(tree, seg, s)) : r.d; // a hidden lesion must not pinch the tube
  b.rad = r.s.map((s, i) => {
    const flare = 1 + 0.28 * Math.exp(-s / 2.2);
    const tip = Math.sqrt(Math.max(0, Math.min(1, (L - s) / 3.5))); // hemispherical close-off at the distal end
    const ripple = 1 + 0.025 * Math.sin((6.283 * s) / 13.3 + ph * 1.7) + 0.015 * Math.sin((6.283 * s) / 4.1 + ph);
    return (b.d[i] / 2) * 1000 * flare * tip * ripple;
  });
}

function shapeVessels() {
  const c = new THREE.Color(), o2f = S.mode === "o2" ? o2Now() : null;
  for (const b of built) {
    const r = A.cond.seg[b.seg.id], n = r.s.length;
    const pa = b.mesh.geometry.attributes.position as THREE.BufferAttribute, ca = b.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const dMax = Math.max(...b.d);
    for (let i = 0; i < n; i++) {
      const R = b.rad[i] * S.exag;
      const lift = R * 0.6; // arteries sit in the epicardial fat, mostly above the muscle
      const cx = b.ctr[i].x + b.out[i].x * lift, cy = b.ctr[i].y + b.out[i].y * lift, cz = b.ctr[i].z + b.out[i].z * lift;
      const blocked = b.blocked[i] && !S.hide;
      if (S.mode === "real") c.copy(ARTERY).lerp(ARTERY_DEEP, 0.35 * (1 - b.d[i] / dMax) + (blocked ? 0.45 : 0));
      else if (S.mode === "anat") c.setHex(GROUP_COLOR[b.seg.group]);
      else if (S.mode === "o2") vesselO2Color(o2f!, c);
      else if (blocked) c.copy(GRAY);
      else if (S.mode === "pressure") c.copy(ramp(VIRIDIS, (r.P[i] / MMHG - 20) / 70));
      else if (S.mode === "velocity") c.copy(ramp(MAGMA, lg(r.v[i], 0.01, 4)));
      else c.copy(ramp(MAGMA, lg(r.wss[i], 0.1, 1000)));
      if (S.selected === b.seg.id) c.lerp(new THREE.Color(0xffffff), 0.35);
      for (let j = 0; j <= M; j++) {
        const th = (j / M) * Math.PI * 2, cs = Math.cos(th) * R, sn = Math.sin(th) * R, o = i * (M + 1) + j;
        pa.setXYZ(o, cx + b.nrm[i].x * cs + b.bin[i].x * sn, cy + b.nrm[i].y * cs + b.bin[i].y * sn, cz + b.nrm[i].z * cs + b.bin[i].z * sn);
        ca.setXYZ(o, c.r, c.g, c.b);
      }
    }
    pa.needsUpdate = true; ca.needsUpdate = true; b.mesh.geometry.computeVertexNormals();
  }
  vesselMat.transparent = S.flow; vesselMat.opacity = S.flow ? 0.42 : 1; vesselMat.depthWrite = !S.flow; vesselMat.needsUpdate = true;
  legend(); paintMyocardium();
}

function legend() {
  $("legend2").hidden = S.mode !== "o2";
  const bar = $("bar");
  const set = (g: string, a: string, m: string, z: string) => { bar.style.background = g; $("l0").textContent = a; $("lmid").textContent = m; $("l1").textContent = z; };
  if (S.mode === "real") set("linear-gradient(90deg,#8e3a33 0 50%,#4e3a5a 50%)", "Myocardium", "", "Ischemic");
  else if (S.mode === "anat") set("linear-gradient(90deg,#1f5fa8 0 33%,#2e7d4f 33% 66%,#c77c00 66%)", "LAD", "Circumflex", "RCA");
  else if (S.mode === "pressure") set(`linear-gradient(90deg,${VIRIDIS.join(",")})`, "20 mmHg", "55", "90 mmHg");
  else if (S.mode === "velocity") set(`linear-gradient(90deg,${MAGMA.join(",")})`, "0.01 m/s", "log", "4 m/s");
  else if (S.mode === "o2") {
    const l = o2Legend(o2Now());
    set(l.blood.gradient, l.blood.lo, l.blood.mid, l.blood.hi);
    $("bar2").style.background = l.tissue.gradient; $("m0").textContent = l.tissue.lo; $("mmid").textContent = l.tissue.mid; $("m1").textContent = l.tissue.hi; $("lnote").textContent = l.note;
  }
  else set(`linear-gradient(90deg,${MAGMA.join(",")})`, "0.1 Pa", "log", "1000 Pa");
}

// ---------------------------------------------------------------- blood flow particles
const PER = 30;
let pu = new Float32Array(0), pa2 = new Float32Array(0), pb2 = new Float32Array(0), pSeg: number[] = [];
const pGeo = new THREE.BufferGeometry();
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x7a0f0f, size: 1.4, sizeAttenuation: true }));
vesselGroup.add(points);
function initParticles() {
  const N = built.length * PER;
  pu = new Float32Array(N); pa2 = new Float32Array(N); pb2 = new Float32Array(N); pSeg = [];
  for (let i = 0; i < N; i++) { pu[i] = Math.random(); const r = Math.sqrt(Math.random()) * 0.8, th = Math.random() * 6.283; pa2[i] = r * Math.cos(th); pb2[i] = r * Math.sin(th); pSeg.push(Math.floor(i / PER)); }
  pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
}
const bsearch = (xs: number[], x: number) => { let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; } return lo; };
function stepParticles(dt: number) {
  const pos = pGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pu.length; i++) {
    const b = built[pSeg[i]], r = A.cond.seg[b.seg.id], L = b.seg.length;
    let s = pu[i] * L, k = Math.min(r.s.length - 2, bsearch(r.s, s));
    s += Math.min(0.03 * L, r.v[k] * (b.blocked[k] ? 0 : 1) * 1000 * dt * 0.5);
    if (s >= L || !(s >= 0)) s = 0;
    pu[i] = s / L; k = Math.min(r.s.length - 2, bsearch(r.s, s));
    const w = (s - r.s[k]) / (r.s[k + 1] - r.s[k] || 1), R = (b.rad[k] * (1 - w) + b.rad[k + 1] * w) * S.exag;
    const p0 = b.ctr[k], p1 = b.ctr[k + 1], n0 = b.nrm[k], b0 = b.bin[k], o0 = b.out[k], lift = R * 0.6;
    pos.setXYZ(i, p0.x + (p1.x - p0.x) * w + o0.x * lift + (n0.x * pa2[i] + b0.x * pb2[i]) * R, p0.y + (p1.y - p0.y) * w + o0.y * lift + (n0.y * pa2[i] + b0.y * pb2[i]) * R, p0.z + (p1.z - p0.z) * w + o0.z * lift + (n0.z * pa2[i] + b0.z * pb2[i]) * R);
  }
  pos.needsUpdate = true;
}

// ---------------------------------------------------------------- model
function rebuildAnatomy() {
  T.treated = untreated(); T.pending = null; T.original = null; // a graft belongs to the tree it was sewn on
  sim.grafts = [];
  sim.apply({ anatomy: { ...V } });
  tree = sim.tree; sites = sim.sites;
  const sel = $<HTMLSelectElement>("lseg");
  sel.innerHTML = tree.segments.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (!tree.byId[S.lesionSeg]) S.lesionSeg = "LAD";
  sel.value = S.lesionSeg;
  solve();
  prepareMyocardium();
  buildVessels(); initParticles(); points.visible = S.flow;
  buildGrafts();
}

// ---------------------------------------------------------------- management: support, orders, infarct
const T = {
  support: noSupport(),
  pending: null as Pending | null,
  treated: untreated() as Treated,
  ischemicMin: 0, // clinical minutes with ischemia present
  seed: 11, // fixes whether this patient's clot lyses
  lastResult: "",
  hint: false,
  original: null as null | { seg: string; pos: number; ds: number; occ: boolean }, // the lesion before any procedure changed it
};
const nec = sim.scar; // irreversible injury per bed, 0..1 (the simulation steps it on the clinical clock)
const clearTreatment = () => {
  T.support = noSupport(); T.pending = null; T.treated = untreated(); T.ischemicMin = 0; T.lastResult = ""; T.hint = false; T.original = null;
  for (const k of Object.keys(nec)) delete nec[k];
};
/** Push the lesion controls and any grafts into the simulation; it re-solves the coronary network. */
function solve() {
  const mine: LesionSpec[] = S.ds > 0 || S.occ ? [{ artery: S.lesionSeg, stenosis: S.ds, occluded: S.occ, position: S.pos }] : [];
  sim.grafts = T.treated.grafts;
  sim.apply({ lesions: [...mine, ...extraLesions.filter((l) => l.artery !== S.lesionSeg)], exertion: S.exert });
  A = sim.analysis;
}
let pendingAnatomy = false, pendingLesion = false;
const scheduleAnatomy = () => { pendingAnatomy = true; };
const scheduleLesion = () => { pendingLesion = true; };
function flush() {
  if (pendingAnatomy) { pendingAnatomy = pendingLesion = false; rebuildAnatomy(); controlsUi(); return; }
  if (pendingLesion) {
    pendingLesion = false;
    const before = tree.segments.map((sg) => A.cond.seg[sg.id].s.length);
    solve();
    // A stenosis adds fine samples inside its window, changing that vessel's ring count: rebuild those meshes.
    if (tree.segments.some((sg, i) => A.cond.seg[sg.id].s.length !== before[i])) { buildVessels(); initParticles(); }
    else { for (const b of built) { b.blocked = blockedFlags(b.seg); lumen(b); } shapeVessels(); }
    controlsUi();
  }
}

// ---------------------------------------------------------------- UI text
function controlsUi() {
  $("posv").textContent = Math.round(S.pos * 100) + "%";
  $("dsv").textContent = S.occ ? "occluded" : Math.round(S.ds * 100) + "%";
  $("exv").textContent = String(S.exag);
  $("occ").textContent = S.occ ? "Reperfuse" : "Occlude";
  $("occ").classList.toggle("on", S.occ); $("exert").classList.toggle("on", S.exert);
  $("flowbtn").classList.toggle("on", S.flow);
  $("propsbtn").classList.toggle("on", S.props);
  for (const m of ["real", "anat", "pressure", "velocity", "wss", "o2"]) $("m_" + m).classList.toggle("on", S.mode === m);
  for (const s of [1, 3, 6]) $("s" + s).classList.toggle("on", S.speed === s);
  // the folded sections carry their state in the header
  $("patientsum").textContent = `${S.rhythm === "af" ? "Atrial fibrillation" : "Sinus"} · ${S.bbb === "none" ? "normal conduction" : S.bbb.toUpperCase()}`;
  const DOM = { right: "Right-dominant", co: "Co-dominant", left: "Left-dominant" }, LMP = { bifurcation: "bifurcation", trifurcation: "ramus", absent: "absent left main" }, LADC = { normal: "LAD to apex", short: "short LAD", wrap: "wrapping LAD" };
  $("anatomysum").textContent = `${DOM[V.dominance]} · ${LMP[V.lm]} · ${LADC[V.ladCourse]} · SA node from ${V.saNodeFrom}`;
  const MODE = { real: "Anatomic", anat: "Territory", pressure: "Pressure", velocity: "Velocity", wss: "Wall shear", o2: "O₂ sat" };
  $("volumesum").textContent = volumeSummary();
  $("displaysum").textContent = `${MODE[S.mode]} · ${S.heart === "solid" ? "solid" : S.heart === "ghost" ? "see-through" : "no"} heart · ${S.exag}×${S.flow ? " · flow" : ""}${S.props ? " · valves and defects" : ""}${S.posterior ? " · V7–V9" : ""}`;
  for (const r of ["sinus", "af"]) $("r_" + r).classList.toggle("on", S.rhythm === r);
  for (const b of ["none", "rbbb", "lbbb"]) $("c_" + b).classList.toggle("on", S.bbb === b);
  $("postbtn").classList.toggle("on", S.posterior); $("stmap").classList.toggle("wide", S.posterior); ecg.posterior = S.posterior;
  const risk = A.cond.atRisk * 100;
  $("risk").textContent = S.hide ? "—" : risk.toFixed(0) + "%"; $("risk").style.color = S.hide ? "var(--muted)" : risk > 25 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--ok)";
  $("ffr").textContent = S.ds > 0 && !S.occ && !S.hide ? A.ffr[0].toFixed(2) : "—";
  $("ffr").style.color = A.ffr[0] < 0.8 && !S.hide ? "var(--bad)" : "var(--ink)";
  $("tag").textContent = S.hide ? `${tree.segments.length} arteries · click the culprit · drag to orbit` : `${tree.segments.length} arteries · radius ×${S.exag} · click a vessel · drag to orbit`;
}

const rhythmLabel = (r: ReturnType<EcgStrip["rhythm"]>, rs: RhythmState | null) => {
  const deg = rs?.avDegree ?? 0, bbb = rs?.bbb ?? "none";
  const tail = (bbb === "rbbb" ? ", right bundle branch block" : bbb === "lbbb" ? ", left bundle branch block" : "") + (r.pvc ? ", PVCs" : "");
  if (rs?.rhythm === "af") return (deg === 3 ? "Atrial fibrillation with complete heart block, junctional escape" : deg >= 1 ? "Atrial fibrillation, slow ventricular response" : "Atrial fibrillation") + tail;
  const sinus = r.atrial < 60 ? "Sinus bradycardia" : r.atrial > 100 ? "Sinus tachycardia" : "Sinus rhythm";
  return (deg === 3 ? "Complete heart block, junctional escape"
    : deg === 2 ? `${sinus}, Mobitz I (Wenckebach)`
    : deg === 1 ? `${sinus}, first-degree AV block` : sinus) + tail;
};

const leadOrder = () => (S.posterior ? ALL_LEADS : LEADS);
function liveUi() {
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
  gameUi();
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

// ---------------------------------------------------------------- events
const on = (id: string, f: () => void) => $(id).addEventListener("click", f);
const sel = (id: string, f: (v: string) => void) => $<HTMLSelectElement>(id).addEventListener("change", (e) => f((e.target as HTMLSelectElement).value));
const range = (id: string, f: (v: number) => void) => $<HTMLInputElement>(id).addEventListener("input", (e) => f(+(e.target as HTMLInputElement).value));

// ---------------------------------------------------------------- management: orders, infarct clock, advice
const PROC_LABEL: Record<Procedure, string> = { pci: PROCEDURE.pci.label, lysis: PROCEDURE.lysis.label, cabg: PROCEDURE.cabg.label };
const currentLesion = (): Lesion | null => (S.ds > 0 || S.occ ? { segId: S.lesionSeg, pos: S.pos, ds: S.occ ? 1 : S.ds, occluded: S.occ } : null);
const reperfused = () => T.treated.stent || T.treated.lysed === true || T.treated.grafts.length > 0;

/** One step of the clinical clock: muscle that stays ischemic dies, and an ordered procedure moves toward the artery. */
function manageStep(minutes: number, burden: number) {
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
/** A hand-sewn graft: from the aortic root to the vessel just beyond the lesion. */
const graftGroup = new THREE.Group(); heartGroup.add(graftGroup);
const graftMat = new THREE.MeshStandardMaterial({ color: 0xcbb393, roughness: 0.55, metalness: 0.0 });
function buildGrafts() {
  for (const m of [...graftGroup.children] as THREE.Mesh[]) { graftGroup.remove(m); m.geometry.dispose(); }
  for (const g of T.treated.grafts) {
    const seg = tree.byId[g.segId];
    if (!seg) continue;
    const q = projectToEpicardium(seg.curve.at(Math.min(1, g.pos / seg.length)), 1.5);
    const end = v3(rotateHeart(q.pos)), n = v3(rotateHeart(q.n));
    const root = v3(rotateHeart([-3, 60, 14]));
    const mid = end.clone().lerp(root, 0.5).addScaledVector(n, 16);
    const curve = new THREE.CatmullRomCurve3([root, mid, end.clone().addScaledVector(n, 1.2)]);
    graftGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1.3, 12), graftMat));
  }
}

/** The facts the advisor reads, from the live state. */
function situation(): Situation | null {
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
function setTab(t: string) {
  $("manage").dataset.tab = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#manage .tab")) b.classList.toggle("on", b.dataset.tab === t);
}
function manageUi() {
  const live = G.phase !== "play";
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
    b.classList.toggle("on", T.pending?.kind === k); b.disabled = !live || (!!T.pending && T.pending.kind !== k);
  }
  ($("m_cancel") as HTMLButtonElement).disabled = !T.pending;
  $("mstatus").textContent = T.pending
    ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}.`
    : T.lastResult || `Nothing on order. PCI takes about ${PROCEDURE.pci.delayMin} min to reach the artery, a fibrinolytic ${PROCEDURE.lysis.delayMin}, CABG ${PROCEDURE.cabg.delayMin / 60} h.`;

  const sit = live ? situation() : null;
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
const syncSelects = () => { $<HTMLSelectElement>("dom").value = V.dominance; $<HTMLSelectElement>("lm").value = V.lm; $<HTMLSelectElement>("lad").value = V.ladCourse; $<HTMLSelectElement>("san").value = V.saNodeFrom; $<HTMLSelectElement>("conus").value = V.conusOstium; };
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
(["real", "anat", "pressure", "velocity", "wss", "o2"] as Mode[]).forEach((m) => on("m_" + m, () => { S.mode = m; shapeVessels(); controlsUi(); }));
(["solid", "ghost", "none"] as HeartView[]).forEach((h) => on("h_" + h, () => { S.heart = h; applyHeartView(); controlsUi(); }));
/** "Valves and defects": the structural props inside the heart. On, a solid heart becomes see-through so they show; off, it comes back. */
function setProps(on: boolean) {
  if (on === S.props) return;
  S.props = on;
  if (on) { heartBeforeProps = null; if (S.heart === "solid") { heartBeforeProps = "solid"; S.heart = "ghost"; } }
  else if (heartBeforeProps && S.heart === "ghost") { S.heart = heartBeforeProps; heartBeforeProps = null; }
  propsView.show(on); applyHeartView(); controlsUi();
}
on("propsbtn", () => setProps(!S.props));
on("flowbtn", () => { S.flow = !S.flow; points.visible = S.flow; shapeVessels(); controlsUi(); });
for (const k of Object.keys(VIEWS)) on(k, () => setView(k));
on("spin", () => { controls.autoRotate = !controls.autoRotate; controls.autoRotateSpeed = 1.2; $("spin").classList.toggle("on", controls.autoRotate); });

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = [0, 0];
renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const rc = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects([...built.map((b) => b.mesh), heartMesh])[0];
  S.selected = hit && hit.object !== heartMesh ? (hit.object.userData.segId as string) : "";
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

// ---------------------------------------------------------------- loop
const ecg = new EcgStrip($<HTMLCanvasElement>("ecg"), sim.stream);
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);
// ---------------------------------------------------------------- markers: the lesion, and the player's call
/** A floating label anchored to a point on a vessel: a bracket on the vessel, a leader line and a tag. */
interface Marker { el: HTMLElement; tag: HTMLElement; text: string; back: boolean; point: THREE.Vector3 }
function makeMarker(id: string): Marker {
  const el = document.createElement("div");
  el.id = id; el.hidden = true;
  el.innerHTML = '<i class="lz-ring"></i><i class="lz-line"></i><span class="lz-tag"></span>';
  view.append(el);
  return { el, tag: el.querySelector(".lz-tag") as HTMLElement, text: "", back: false, point: new THREE.Vector3() };
}
const lesionMarker = makeMarker("lesion"), callMarker = makeMarker("call");
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
function updateMarkers(dt: number) {
  const probe = (lzClock += dt) > 0.1;
  if (probe) lzClock = 0;
  const lb = (S.ds > 0 || S.occ) && !S.hide ? built.find((x) => x.seg.id === S.lesionSeg) : undefined;
  placeMarker(lesionMarker, lb, S.pos, `${S.occ ? "Occluded" : Math.round(S.ds * 100) + "% stenosis"} · ${lb?.seg.name ?? ""}`, 7, probe);
  const cb = G.call && G.phase !== "idle" ? built.find((x) => x.seg.id === G.call!.segId) : undefined;
  placeMarker(callMarker, cb, G.call?.pos ?? 0, "Your call", 0, probe);
}

let last = performance.now(), uiClock = 0, paintClock = 0;
/** Pause, slow motion and step-one-beat for the Simulator page (task P13); scales heartbeat time only, never the game. */
const playClock = new PlayClock();
let rstate: RhythmState | null = sim.rstate, circ: Circulation | null = sim.circ;
function frame(now: number) {
  const realDt = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = G.phase === "idle" ? playClock.advance(realDt, sim.t, () => sim.stream.beats.filter((b) => !b.pOnly).map((b) => b.t)) : realDt;
  flush();
  const inCase = G.phase === "play" || G.phase === "treat";
  if (inCase) G.clock += dt * S.speed;
  // The clinical clock: the simulator's runs at its time scale; a case's at the game's fixed rate; none once a case is over.
  const minutes = G.phase === "idle" ? dt * S.speed * INFARCT.minutesPerSecond : inCase ? dt * TREAT.minutesPerSecond : 0;
  sim.speed = S.speed; sim.patient = { rhythm: S.rhythm, bbb: S.bbb }; sim.support = T.support; sim.treated = T.treated; // shared: an AI's treatment and the panel's are one record
  sim.step(dt, { minutes });
  if (minutes > 0) manageStep(minutes, ischemicBurden(sites, sev));
  if (sim.analysis !== A) { A = sim.analysis; for (const b of built) b.blocked = blockedFlags(b.seg); shapeVessels(); } // perfusion pressure or demand moved
  rstate = sim.rstate; circ = sim.circ;
  const fx = sim.ecgInputs();
  ecg.step(dt, fx.injury, fx.tBoost, rstate.rhythm);
  ecg.draw();
  if (G.phase === "treat") treatStep(dt, minutes);
  if (S.flow) stepParticles(dt);
  if ((paintClock += dt) > 0.1) { paintClock = 0; paintMyocardium(); }
  if (S.mode === "o2" && (o2Clock += dt) > 0.5) { o2Clock = 0; const f = o2Now(), k = `${f.ready}|${f.arterial.toFixed(3)}`; if (k !== o2Key) { o2Key = k; shapeVessels(); } }
  if ((uiClock += dt) > 0.25) { uiClock = 0; liveUi(); }
  controls.update(); camera.updateMatrixWorld(); updateMarkers(dt); renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- game: find the culprit, one case a day
type Phase = "idle" | "play" | "treat" | "reveal";
/** The treatment phase as it runs: the clock, the baselines the infarct is judged against, and what was done. */
interface Treating extends TreatRecord { minutes: number; seconds: number; stableS: number; harmS: number; found: { result: string; pts: string; cls: string; total: number; distance: number } }
const G = {
  phase: "idle" as Phase, day: "", score: 0,
  clock: 0, // s of the patient's time since the occlusion
  call: null as Point | null, // where the player has pressed on the tree
  rv: null as boolean | null, // the second question: is the right ventricle involved
  target: "", // the day the front door is for: today, or an archive day from ?day=
  kase: null as Case | null, saved: null as null | { V: Variant; S: Partial<typeof S> },
  treat: null as Treating | null,
};
let o2Clock = 0, o2Key = "";
const LESION_KEYS = ["lesionSeg", "pos", "ds", "occ", "exert", "mode", "flow", "speed", "rhythm", "bbb", "posterior"] as const;
const LOCKED = ["m_pressure", "m_velocity", "m_wss", "m_o2", "flowbtn", "propsbtn", "s1", "s3", "s6", "postbtn"]; // displays that would show the lesion, the clock, and the leads
/** What the player did with a day's case, kept in this browser so the day is played once and can be looked at again. */
interface Played { total: number; distance: number; elapsed: number; call: Point | null; rv?: boolean | null; archive?: boolean; cls: string; result: string; why: string; treat?: TreatScore; treatWhy?: string }
const STORE = "corosim.daily";
let history: Record<string, Played> = {};
try { history = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { history = {}; }
const remember = (key: string, p: Played) => { history[key] = p; try { localStorage.setItem(STORE, JSON.stringify(history)); } catch { /* private window, blocked storage: the day just replays */ } };
const dayLabel = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); };
const callUi = () => {
  $("qcall").textContent = G.call ? `${tree.byId[G.call.segId].name}, ${Math.round(G.call.pos * 100)}% along` : "none yet";
  $("rv_yes").classList.toggle("on", G.rv === true); $("rv_no").classList.toggle("on", G.rv === false);
  ($("qlock") as HTMLButtonElement).disabled = !G.call || G.rv === null;
};
/** Days played on their own day, as case numbers (archive plays do not keep a streak alive). */
const liveDays = () => Object.entries(history).filter(([, p]) => !p.archive).map(([k]) => dayNumber(k));

/** A clean slate for a case: no ischemia carried over, pressure back at baseline. */
function resetPhysiology() {
  clearTreatment();
  sim.resetPhysiology();
}
/** Into the game: remember the simulator's state and lock the displays that would give the lesion away. */
function enterGame() {
  if (G.saved) return;
  setPhys(PHYS_REST); // every player gets the same patient: normal volume, no beta blocker
  G.saved = { V: { ...V }, S: Object.fromEntries(LESION_KEYS.map((k) => [k, S[k]])) };
  // pressure and velocity colouring and the flow particles would all show where the blood stops
  if (S.mode !== "real" && S.mode !== "anat") S.mode = "real";
  S.flow = false; points.visible = false; setProps(false); // the game hides the lesion; the defects stay out too
  S.speed = POINTS.speed; // one clock for every player
  S.posterior = true; // the back of the heart is in play
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = true;
  document.body.classList.add("game");
}
function loadCase(key: string) {
  const c = dailyCase(key);
  G.day = key; G.kase = c;
  Object.assign(V, c.variant); syncSelects();
  S.lesionSeg = c.lesion.segId; S.pos = c.lesion.pos; S.ds = c.lesion.ds; S.occ = !!c.lesion.occluded; S.exert = c.exert;
  S.rhythm = c.rhythm; S.bbb = c.bbb;
  pendingAnatomy = pendingLesion = false;
}
function gameStart() {
  const key = G.target || dayKey();
  if (history[key]) return gameReview(key);
  enterGame(); loadCase(key);
  G.clock = 0; G.score = 0; G.phase = "play"; G.call = null; G.rv = null; G.treat = null;
  S.hide = S.hideIsch = true; S.selected = "";
  resetPhysiology(); rebuildAnatomy();
  $("pick").style.display = "none";
  callUi(); controlsUi(); liveUi();
}
/** A day already played: the case again, revealed, with the call and the result as they were. */
function gameReview(key: string) {
  const p = history[key];
  enterGame(); loadCase(key);
  G.clock = p.elapsed; G.score = p.total; G.phase = "reveal"; G.call = p.call; G.rv = p.rv ?? null; G.treat = null;
  S.hide = S.hideIsch = false; S.selected = G.kase!.lesion.segId;
  resetPhysiology(); rebuildAnatomy();
  const res = $("qresult"); res.className = "q-result " + p.cls; res.innerHTML = p.result;
  $("qwhy").textContent = p.why; $("qtreatwhy").textContent = p.treatWhy ?? "";
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}
function gameAnswer(giveUp: boolean) {
  if (G.phase !== "play" || !G.kase) return;
  const truth = G.kase.lesion.segId, call = giveUp ? null : G.call;
  const rvT = rvInvolvement(G.kase), rv = !giveUp && G.rv !== null ? { answer: G.rv, truth: rvT.involved } : undefined;
  const sc = score(tree, call, { segId: truth, pos: G.kase.lesion.pos }, G.clock, rv);
  const verdict = call ? judge(tree, call.segId, truth) : "miss";
  G.score = sc.total; G.call = call;
  // show the lesion: the real lumen, the shaded vessels, the marker, the darkened muscle and the perfusion table
  S.hide = S.hideIsch = false; S.selected = truth;
  buildVessels(); initParticles(); paintMyocardium();
  const name = tree.byId[truth].name, chosen = call ? tree.byId[call.segId].name : "";
  const how = `${Math.round(sc.distance)} mm from the lesion along the tree, called at ${Math.round(G.clock)} s`;
  const rvLine = rv ? ` The right ventricle ${rvT.involved ? `was involved (${Math.round(rvT.fraction * 100)}% of it ischemic)` : `was spared (${Math.round(rvT.fraction * 100)}% ischemic)`}; you said ${rv.answer ? "yes" : "no"}.` : "";
  const pts = `location ${Math.round(sc.location)}${sc.floored ? " (territory floor)" : ""} × time ${sc.time.toFixed(2)}${rv ? ` ${sc.rv >= 0 ? "+" : "−"} ${Math.abs(sc.rv)} RV` : ""} = ${sc.total}`;
  const cls = sc.total >= 60 ? "vessel" : sc.total >= 20 ? "territory" : "miss";
  const result = !call ? `The culprit was the ${name}.${rvLine}`
    : verdict === "vessel" ? `On the ${name}, ${how}.${rvLine}`
    : verdict === "territory" ? `Right territory, wrong branch: you called the ${chosen}, ${how}.${rvLine}`
    : `Wrong territory: you called the ${chosen}, ${how}.${rvLine}`;
  // Now the patient: the infarct is judged against what immediate PCI, and no reperfusion at all, would leave from here.
  const lvAfter = (min: number) => lvInfarctSize(sites, Object.fromEntries(sites.map((x) => [x.key, stepNecrosis(nec[x.key] ?? 0, sev[x.key] ?? 0, min)])));
  G.treat = {
    minutes: 0, seconds: 0, stableS: 0, harmS: 0, harms: {}, steps: [],
    reperfusedBy: null, orderedAt: null, reperfusedAt: null, got: 0, best: lvAfter(PROCEDURE.pci.delayMin), worst: lvAfter(TREAT.capMinutes),
    found: { result, pts, cls, total: sc.total, distance: sc.distance },
  };
  G.phase = "treat";
  const res = $("qcallresult"); res.className = "q-result " + cls; res.innerHTML = `${result} <span class="pts">${pts} pts</span>`;
  setTab("support"); T.hint = false; manageSig = "";
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}
/** Each frame of the treatment phase: the clock, the pressure held, the harm done, and whether the phase is over. */
function treatStep(dt: number, minutes: number) {
  const R = G.treat;
  if (!R) return;
  R.minutes += minutes; R.seconds += dt;
  if (sim.map >= CIRC.shockMap) R.stableS += dt;
  const sit = situation();
  if (sit) {
    const a = assess(sit);
    if (!R.steps.length) R.steps = a.steps.map((x) => x.text); // what the guidelines would do, as the phase opens
    if (a.warnings.length) { R.harmS += dt; for (const w of a.warnings) R.harms[w.tag] = (R.harms[w.tag] ?? 0) + dt; }
  }
  if (R.reperfusedAt === null && reperfused()) R.reperfusedAt = R.minutes;
  if (R.minutes >= TREAT.capMinutes || (R.reperfusedAt !== null && R.minutes - R.reperfusedAt >= TREAT.settleMinutes)) gameTreatEnd();
}
/** The case is over: score the treatment, add it to the call, and show the whole debrief. */
function gameTreatEnd() {
  const R = G.treat;
  if (G.phase !== "treat" || !R || !G.kase) return;
  R.got = lvInfarctSize(sites, nec);
  for (const k of Object.keys(R.harms)) R.harms[k] /= Math.max(1e-9, R.seconds);
  const ts = treatScore(muscleSaved(R.got, R.best, R.worst), R.stableS / Math.max(1e-9, R.seconds), R.harmS / Math.max(1e-9, R.seconds));
  const total = R.found.total + ts.total;
  G.score = total; G.phase = "reveal";
  const findings = { ...fullFindings(G.kase), rhythm: rhythmLabel(ecg.rhythm(), rstate) };
  const pts = `<span class="pts">${R.found.pts} · treatment ${ts.total} (muscle ${ts.muscle}, pressure ${ts.hemo}) = ${total} pts</span>`;
  const result = `${R.found.result} ${pts}`;
  const cls = total >= MAX_SCORE * 0.55 ? "vessel" : total >= MAX_SCORE * 0.2 ? "territory" : "miss";
  const why = explain(tree, G.kase, findings), treatWhy = explainTreatment(R, ts);
  const res = $("qresult"); res.className = "q-result " + cls; res.innerHTML = result;
  $("qwhy").textContent = why; $("qtreatwhy").textContent = treatWhy;
  remember(G.day, { total, distance: R.found.distance, elapsed: G.clock, call: G.call, rv: G.rv, archive: G.day !== dayKey() || undefined, cls, result, why, treat: ts, treatWhy });
  controlsUi(); liveUi();
}
function gameQuit() {
  if (G.phase === "idle" || !G.saved) return;
  Object.assign(V, G.saved.V); Object.assign(S, G.saved.S); syncSelects();
  S.hide = S.hideIsch = false; S.selected = ""; G.phase = "idle"; G.kase = null; G.call = null; G.rv = null; G.treat = null; G.saved = null;
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = false;
  document.body.classList.remove("game");
  pendingAnatomy = pendingLesion = false;
  resetPhysiology(); rebuildAnatomy(); points.visible = S.flow;
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}
let inGame = false; // the page at /game
function gameUi() {
  $("quiz").dataset.phase = G.phase; document.body.dataset.game = G.phase;
  // idle: the front door over the blurred page; in a case: the panel in the rail
  $("qgate").hidden = !(inGame && G.phase === "idle"); $("quiz").hidden = !(inGame && G.phase !== "idle");
  document.body.classList.toggle("gated", inGame && G.phase === "idle");
  if (G.phase === "idle") {
    const today = dayKey(), key = G.target || today, n = dayNumber(key), archive = key !== today, p = history[key];
    $("qday").textContent = `${archive ? "Archive · " : ""}Case #${n} · ${dayLabel(key)}`;
    $("qdone").hidden = !p;
    if (p) $("qdone").textContent = `Played${archive ? "" : " today"}: ${p.total} of ${MAX_SCORE}.`;
    $("qstart").textContent = p ? "Look at this case again" : archive ? `Play case #${n}` : "Start today's case";
    // streak, and the last seven days as bars
    const s = streaks(liveDays(), dayNumber(today)), days = Object.keys(history).length, pts = Object.values(history).reduce((a, x) => a + x.total, 0);
    $("qstreak").textContent = days ? `Streak ${s.current} · best ${s.best} · ${days} day${days === 1 ? "" : "s"} played · ${pts} pts` : "No days played yet.";
    $("qstrip").innerHTML = Array.from({ length: 7 }, (_, i) => { const k = keyOfDay(n - 6 + i), q = history[k]; return `<i class="${q ? "on" : ""}${k === key ? " here" : ""}" style="height:${q ? Math.max(12, (100 * q.total) / MAX_SCORE) : 10}%" title="#${n - 6 + i}${q ? `: ${q.total}` : ""}"></i>`; }).join("");
    // the archive: the day before, the day after, and today
    const prev = $("qprev") as HTMLAnchorElement, next = $("qnext") as HTMLAnchorElement, tod = $("qtoday") as HTMLAnchorElement;
    prev.hidden = n <= 1; prev.href = `?day=${keyOfDay(n - 1)}`; prev.textContent = `← #${n - 1}`;
    next.hidden = !archive; next.href = `?day=${keyOfDay(n + 1)}`; next.textContent = `#${n + 1} →`;
    tod.hidden = !archive; tod.href = location.pathname;
    return;
  }
  $("qround").textContent = `Case #${dayNumber(G.day)}`;
  $("qclock").textContent = `${G.clock.toFixed(1)} s`;
  $("qscore").textContent = `${G.score} pts`;
  if (G.phase === "treat" && G.treat) {
    $("qclin").textContent = `${clinicalTime(G.treat.minutes)} of ${clinicalTime(TREAT.capMinutes)}`;
    $("qartery").textContent = T.pending ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}` : reperfused() ? `open (${G.treat.reperfusedBy})` : "closed";
    $("qartery").style.color = reperfused() ? "var(--ok)" : T.pending ? "var(--warn)" : "var(--bad)";
  }
}
on("qstart", gameStart);
on("rv_yes", () => { G.rv = true; callUi(); }); on("rv_no", () => { G.rv = false; callUi(); });
on("qlock", () => gameAnswer(false));
on("qreveal", () => gameAnswer(true));
on("qhand", gameTreatEnd);
on("qquit", gameQuit);

/** A spoiler-free line to paste anywhere: the case number, the score as a bar, how close and how soon. */
function shareText(): string {
  const p = history[G.day];
  if (!p) return "";
  const bar = "█".repeat(Math.round((10 * p.total) / MAX_SCORE)).padEnd(10, "░");
  const how = (p.call && Number.isFinite(p.distance) ? `${Math.round(p.distance)} mm from the lesion, called at ${Math.round(p.elapsed)} s` : p.call ? `called at ${Math.round(p.elapsed)} s` : "no call")
    + (p.treat ? ` · treatment ${p.treat.total}/${TREAT.muscle + TREAT.hemo}` : "");
  const s = streaks(liveDays(), dayNumber(dayKey()));
  const streak = !p.archive && s.current >= 2 ? `\n${s.current}-day streak` : "";
  const url = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/");
  return `CoroSim · Find the culprit #${dayNumber(G.day)}${p.archive ? " (archive)" : ""}\n${bar} ${p.total}/${MAX_SCORE}\n${how}${streak}\n${url}${p.archive ? `?day=${G.day}` : ""}`;
}
async function share() {
  const text = shareText(), btn = $("qshare") as HTMLButtonElement;
  if (!text) return;
  const done = (label: string) => { btn.textContent = label; btn.classList.add("done"); setTimeout(() => { btn.textContent = "Share your score"; btn.classList.remove("done"); }, 2500); };
  try {
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ text }); return done("Shared"); }
    await navigator.clipboard.writeText(text);
    done("Copied to clipboard");
  } catch {
    // the share sheet was dismissed, or the clipboard is blocked: show the text so it can be copied by hand
    const w = window.prompt("Copy your score:", text.replaceAll("\n", " · "));
    void w;
  }
}
on("qshare", share);

// ---------------------------------------------------------------- versions: the simulator alone, or with the game
/** The page at /game/ is the game version; anywhere else (/sim/) it is the plain simulator. The links between them
 *  and to the homepage are relative, so the site still works under any URL. */
/** The cath lab link opens the patient on screen (/cath/#s=…) when it is followed. In the game it stays plain: the angiogram would show the culprit. */
let cathBase = "./cath/";
/** The shared header and footer; its AI control runs the tools on the patient on screen (see runForAi). */
const shell = mountShell({ page: "sim", root: "../", ai: { run: (name, args) => runForAi(name, args), restore: (sc) => restoreFromServer(sc), version: "0.4.0" } });
/** The patient on screen: the simulator's scenario plus the structural sections of a shared link (heart, kind), which the Simulation does not keep. */
const currentPatient = () => joinPatient(sim.scenario(), bridgeOpts.patient);
function cathLinkUi() {
  const a = shell.menuLink("cath")!, b = $("openCath") as HTMLAnchorElement; // the page menu's link and the Reperfuse tab's
  const point = () => { a.href = b.href = inGame ? cathBase : `${cathBase}#s=${encodePatient(currentPatient())}`; };
  const row = mountCrossLinks($("xlinks"), "sim", "../", currentPatient, { skip: ["cath"], hidden: () => inGame }); // the other pages; the game shows none (they would reveal the culprit)
  addEventListener("hashchange", () => row.refresh());
  for (const el of [a, b]) for (const ev of ["pointerdown", "focus", "mouseenter", "contextmenu", "touchstart"]) el.addEventListener(ev, point);
  a.title = "Open this patient in the cath lab"; a.setAttribute("aria-label", "Open in cath lab");
}
function applyMode() {
  const game = /\/game(\/(index\.html)?)?$/.test(location.pathname); // /game, /game/ or /game/index.html
  const root = /\/(sim|game)\/(index\.html)?$/.test(location.pathname) ? "../" : "./"; // the site's root: the homepage
  cathBase = root + "cath/";
  shell.menuLink("cath")!.href = cathBase; ($("openCath") as HTMLAnchorElement).href = cathBase;
  $("openCath").hidden = game; // the game keeps the culprit hidden
  (document.querySelector(".q-plain") as HTMLAnchorElement).href = root + "sim/";
  inGame = game;
  G.target = parseDay(new URLSearchParams(location.search).get("day"), dayKey()) ?? dayKey();
  shell.setPage(game ? "game" : "sim");
  shell.ai.setHidden(game); // the game page has no AI line: an AI on the line could read the lesion
  document.title = game ? "CoroSim · Find the culprit" : "CoroSim";
  gameUi();
}

// ---------------------------------------------------------------- volume and drugs
// The reflexes themselves are not shown or controlled here: they are the physiology, and show up in rate and pressure.
const PHYS_REST = { bl: 0, bb: 0 };
const PHYS = { ...PHYS_REST };
const volumeSummary = () => [PHYS.bl > 0 ? `${PHYS.bl}% blood lost` : PHYS.bl < 0 ? `${-PHYS.bl}% volume overload` : "normal volume", PHYS.bb ? `beta blocker ${PHYS.bb}%` : ""].filter(Boolean).join(" · ");
function physUi() {
  $("blv").textContent = PHYS.bl === 0 ? "normal" : PHYS.bl > 0 ? `${PHYS.bl}% lost` : `${-PHYS.bl}% overload`;
  $("bbv").textContent = PHYS.bb ? PHYS.bb + "%" : "none";
  for (const k of Object.keys(PHYS) as (keyof typeof PHYS)[]) $<HTMLInputElement>(k).value = String(PHYS[k]);
  $("volumesum").textContent = volumeSummary();
}
function applyPhys() { sim.apply({ bloodLoss: PHYS.bl / 100, drugs: { betaBlocker: PHYS.bb / 100 } }); physUi(); }
const setPhys = (p: Partial<typeof PHYS>) => { Object.assign(PHYS, p); applyPhys(); };
for (const k of Object.keys(PHYS) as (keyof typeof PHYS)[]) range(k, (v) => setPhys({ [k]: v }));
on("x_bleed", () => setPhys({ bl: 20 })); on("x_reset", () => setPhys(PHYS_REST));

// ---------------------------------------------------------------- the simulation changed underneath the controls
/**
 * Bring every control and every mesh into line with the simulation after something other than the controls changed
 * it: a shared link, or an AI over the live connection. `reset` means the patient was replaced, so treatment starts over.
 */
function adoptSimState(reset: boolean) {
  if (reset) { clearTreatment(); manageSig = ""; }
  const n = sim.n, first = n.lesionSpecs[0];
  Object.assign(V, n.anatomy);
  extraLesions = n.lesionSpecs.slice(1);
  if (first) { S.lesionSeg = first.artery; S.occ = !!first.occluded; S.ds = first.occluded ? 0 : first.stenosis; S.pos = first.position; } else { S.ds = 0; S.occ = false; }
  S.exert = n.exertion; S.rhythm = sim.patient.rhythm; S.bbb = sim.patient.bbb;
  T.support = { ...sim.support }; // the frame loop hands this back to the simulation every frame
  T.treated = sim.treated; // a PCI, lysis or graft the AI ordered
  Object.assign(PHYS, { bl: Math.round(n.bloodLoss * 100), bb: Math.round(n.drugs.betaBlocker * 100) });
  $<HTMLInputElement>("pos").value = String(S.pos * 100); $<HTMLInputElement>("ds").value = String(S.ds * 100);
  $<HTMLInputElement>("nor").value = String(T.support.norepi * 100); $<HTMLInputElement>("dob").value = String(T.support.dobutamine * 100); $<HTMLInputElement>("pacerate").value = String(T.support.paceRate);
  physUi(); syncSelects();
  if (ecg.stream !== sim.stream || Math.abs(sim.t - ecg.t) > 1) { ecg.stream = sim.stream; ecg.reset(sim.t); } // a new patient, or time jumped
  tree = sim.tree; sites = sim.sites; A = sim.analysis;
  const sel = $<HTMLSelectElement>("lseg");
  sel.innerHTML = tree.segments.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
  if (!tree.byId[S.lesionSeg]) S.lesionSeg = "LAD";
  sel.value = S.lesionSeg;
  prepareMyocardium(); buildVessels(); initParticles(); points.visible = S.flow; buildGrafts();
  controlsUi(); liveUi();
}
/** Replace the patient with a scenario and settle it before anyone looks. */
function loadScenario(sc: Scenario): string[] {
  sim.reset(sc, { settled: true });
  sim.warmup(20);
  adoptSimState(true);
  return sim.warnings;
}
/** A link that opens this patient in the simulator: /sim/#s=…, from either page. */
const appLink = () => `${location.origin}${location.pathname.replace(/(sim|game)\/?(index\.html)?$/, "")}sim/#s=${encodeScenario(sim.scenario())}`;

// ---------------------------------------------------------------- connect your AI: a live MCP line to this page
/** Each tool call from the AI runs here, on the patient on screen; the controls then follow what it changed. */
function runForAi(name: string, args: Record<string, unknown>) {
  if (G.phase !== "idle") throw new Error("The user is in the middle of a Find the culprit case; the AI connection is paused until it ends.");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const stream = sim.stream, t0 = sim.t, sig = JSON.stringify(sim.scenario());
  const result = tool.run({ sim, appUrl: appLink().split("#")[0] }, args);
  if (sim.stream !== stream || sim.t !== t0 || JSON.stringify(sim.scenario()) !== sig) adoptSimState(sim.stream !== stream);
  shell.ai.live!.snapshot(sim.scenario());
  return result;
}
/** An AI changed the saved patient while this page was closed: pick up where it left off. */
function restoreFromServer(sc: Scenario) {
  if (G.phase !== "idle") return; // a game case owns the patient; the saved one waits for next time
  const w = loadScenario(sc);
  shell.ai.note("Picked up the patient your AI left while this page was closed" + (w.length ? ` (adjusted: ${w.join("; ")})` : "."));
}
// Keep the server's copy of this patient current as it is edited here, so the AI works on it with the page closed.
setInterval(() => { if (G.phase === "idle") shell.ai.live!.snapshot(sim.scenario()); }, 3000);

// Browsers restore form values on reload; force every control to match the model's starting state.
$<HTMLInputElement>("pos").value = String(S.pos * 100);
$<HTMLInputElement>("ds").value = String(S.ds * 100);
$<HTMLInputElement>("ex").value = String(S.exag);
physUi(); sim.warmup(20); ecg.reset(sim.t); // start with the reflexes already settled
resize(); setView("vAnt"); syncSelects(); rebuildAnatomy(); applyHeartView(); controlsUi(); liveUi(); applyMode();
/** Read by the bridge at each solve: a shared link's structural fields (heart lesions), which the Simulation does not keep. */
const bridgeOpts: { patient?: PatientSpec; solver?: BridgeSolver } = {};
let bridge: BridgeSource | null = null;
/** A #s= link opens that patient, on load and when a link is pasted into an open tab. */
function openShared() {
  const shared = !inGame && location.hash.match(/^#s=([\w-]+)/);
  if (!shared) return;
  try {
    const spec = decodePatient(shared[1]);
    bridgeOpts.patient = spec; bridge?.refresh(); propsView.setPatient(spec);
    const w = loadScenario(spec); if (w.length) console.warn("CoroSim: the shared patient was adjusted:", w.join("; ")); }
  catch (e) { console.warn("CoroSim: could not open the shared patient", e); }
}
openShared();
addEventListener("hashchange", openShared);
cathLinkUi();
// The panel workspace, below the main view; not in the game (inGame is set by cathLinkUi). Its source is the bridge over
// this page's Simulation, solving in a worker so the 3D view and ECG keep running (task P2b).
if (!inGame) {
  const ws = $("workspace"); (ws.parentElement as HTMLElement).hidden = false;
  bridgeOpts.solver = createWorkerSolver();
  bridge = new BridgeSource(sim, bridgeOpts);
  mountWorkspace(ws, [numbersPanel, tracesPanel, loopsPanel, rhcPanel, leftHeartCathPanel, jvpPanel, oxygenPanel], bridge, { clock: playClock });
}
void shell.ai.start();
/** Handle for scripts and browser-driving assistants: corosim.sim, corosim.load(scenario), corosim.live. */
(window as unknown as { corosim: object }).corosim = { sim, load: loadScenario, clock: playClock, live: shell.ai.live, account: shell.ai.account, refresh: () => { controlsUi(); liveUi(); } };
requestAnimationFrame(frame);
void LEADS;
