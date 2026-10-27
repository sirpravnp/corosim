// ---------------------------------------------------------------- helpers
import * as THREE from "three";
import { rotateHeart, Segment, diameterAt } from "../anatomy/tree";
import { Branch, buildBranches, tierOf, branchTierCount } from "../anatomy/branches";
import { BRANCHES } from "../config/tree";
import { projectToEpicardium } from "../anatomy/heartSurface";
import { V3 } from "../anatomy/curve";
import { o2Legend, vesselO2Color } from "../sim/o2View";
import { tree, A, $, MMHG, S, T } from "./state";
import { heartGroup, camera, controls } from "./scene";
import { o2Now, paintMyocardium } from "./heart3d";

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const VIRIDIS = ["#440154", "#3b528b", "#21908d", "#5dc863", "#fde725"], MAGMA = ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"];
const ramp = (stops: string[], t: number) => { t = Math.min(1, Math.max(0, t)) * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(t)); return new THREE.Color(stops[k]).lerp(new THREE.Color(stops[k + 1]), t - k); };
const lg = (v: number, lo: number, hi: number) => (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
const GROUP_COLOR: Record<string, number> = { LAD: 0x1f5fa8, LCx: 0x2e7d4f, RCA: 0xc77c00 };
const ARTERY = new THREE.Color(0xc2392f), ARTERY_DEEP = new THREE.Color(0x8a221d), ARTERY_EMPTY = new THREE.Color(0x3d2530), GRAY = new THREE.Color(0x9a9a9a);

// ---------------------------------------------------------------- vessels
export interface Built { seg: Segment; mesh: THREE.Mesh; ctr: THREE.Vector3[]; out: THREE.Vector3[]; nrm: THREE.Vector3[]; bin: THREE.Vector3[]; rad: number[]; d: number[]; blocked: boolean[] }
export let built: Built[] = [];
export const vesselGroup = new THREE.Group(); heartGroup.add(vesselGroup);
const M = 22;
const vesselMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: new THREE.Color(0xffd0c8) });

export function blockedFlags(seg: Segment): boolean[] {
  const r = A.cond.seg[seg.id];
  let wholly = false, up: Segment | null = seg.parent ? tree.byId[seg.parent] : null, at = seg.attach * (up ? up.length : 0);
  while (up) { const bf = A.cond.seg[up.id].blockedFrom; if (bf !== null && bf < at) { wholly = true; break; } at = up.attach * (up.parent ? tree.byId[up.parent].length : 0); up = up.parent ? tree.byId[up.parent] : null; }
  return r.s.map((s) => wholly || (r.blockedFrom !== null && s > r.blockedFrom));
}

/** Tube along each vessel: lumen from the physics, plus display-only tortuosity, ostial flare and a tapered tip. */
export function buildVessels() {
  for (const b of built) { vesselGroup.remove(b.mesh); b.mesh.geometry.dispose(); }
  built = [];
  if (bset) { vesselGroup.remove(bset.mesh); bset.mesh.geometry.dispose(); bset = null; }
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
  buildBranchMesh();
  shapeVessels();
}
/** Slight fullness of a parent at each branch take-off (the carina), taps and child segments alike: up to ~12 % over ~2 mm. Display only. */
function bifurcationBulge(seg: Segment, s: number) {
  let k = 0;
  for (const t of seg.taps) k = Math.max(k, Math.exp(-(((s - t.pos * seg.length) / 1.8) ** 2)));
  for (const c of seg.children) { const sb = tree.byId[c].attach * seg.length; if (sb < seg.length - 1) k = Math.max(k, Math.exp(-(((s - sb) / 1.8) ** 2))); }
  return 0.12 * k;
}
/** Ring radii (mm) from the physics' lumen at each sample, with the ostial flare, tapered tip and a slight ripple. */
export function lumen(b: Built) {
  const seg = b.seg, r = A.cond.seg[seg.id], L = seg.length, ph = hash(seg.id) * 6.283;
  b.d = S.hide ? r.s.map((s) => diameterAt(tree, seg, s)) : r.d; // a hidden lesion must not pinch the tube
  b.rad = r.s.map((s, i) => {
    const flare = (1 + 0.28 * Math.exp(-s / 2.2)) * (1 + bifurcationBulge(seg, s));
    const tip = Math.sqrt(Math.max(0, Math.min(1, (L - s) / 3.5))); // hemispherical close-off at the distal end
    const ripple = 1 + 0.025 * Math.sin((6.283 * s) / 13.3 + ph * 1.7) + 0.015 * Math.sin((6.283 * s) / 4.1 + ph);
    return (b.d[i] / 2) * 1000 * flare * tip * ripple;
  });
}

export function shapeVessels() {
  const c = new THREE.Color(), o2f = S.mode === "o2" ? o2Now() : null;
  for (const b of built) {
    const r = A.cond.seg[b.seg.id], n = r.s.length;
    const col = (segCol[b.seg.id] = segCol[b.seg.id]?.length === n * 3 ? segCol[b.seg.id] : new Float32Array(n * 3));
    const pa = b.mesh.geometry.attributes.position as THREE.BufferAttribute, ca = b.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const dMax = Math.max(...b.d);
    for (let i = 0; i < n; i++) {
      const R = b.rad[i] * S.exag;
      const lift = R * 0.6; // arteries sit in the epicardial fat, mostly above the muscle
      const cx = b.ctr[i].x + b.out[i].x * lift, cy = b.ctr[i].y + b.out[i].y * lift, cz = b.ctr[i].z + b.out[i].z * lift;
      const blocked = b.blocked[i] && !S.hide;
      if (S.mode === "real" || S.mode === "isch") { c.copy(ARTERY).lerp(ARTERY_DEEP, 0.35 * (1 - b.d[i] / dMax)); if (blocked) c.lerp(ARTERY_EMPTY, 0.75); } // beyond an occlusion the vessel is empty: dark, not just a deeper red
      else if (S.mode === "anat") c.setHex(GROUP_COLOR[b.seg.group]);
      else if (S.mode === "o2") vesselO2Color(o2f!, c);
      else if (blocked) c.copy(GRAY);
      else if (S.mode === "pressure") c.copy(ramp(VIRIDIS, (r.P[i] / MMHG - 20) / 70));
      else if (S.mode === "velocity") c.copy(ramp(MAGMA, lg(r.v[i], 0.01, 4)));
      else c.copy(ramp(MAGMA, lg(r.wss[i], 0.1, 1000)));
      if (S.selected === b.seg.id) c.lerp(new THREE.Color(0xffffff), 0.35);
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; // the side branches take the parent's final colour at their take-off
      for (let j = 0; j <= M; j++) {
        const th = (j / M) * Math.PI * 2, cs = Math.cos(th) * R, sn = Math.sin(th) * R, o = i * (M + 1) + j;
        pa.setXYZ(o, cx + b.nrm[i].x * cs + b.bin[i].x * sn, cy + b.nrm[i].y * cs + b.bin[i].y * sn, cz + b.nrm[i].z * cs + b.bin[i].z * sn);
        ca.setXYZ(o, c.r, c.g, c.b);
      }
    }
    pa.needsUpdate = true; ca.needsUpdate = true; b.mesh.geometry.computeVertexNormals();
  }
  shapeBranches();
  vesselMat.transparent = S.flow; vesselMat.opacity = S.flow ? 0.42 : 1; vesselMat.depthWrite = !S.flow; vesselMat.needsUpdate = true;
  legend(); paintMyocardium();
}

// ---------------------------------------------------------------- side branches and septal perforators
// All display branches (anatomy/branches.ts) are ONE mesh: tube rings of MB sides, laid out sorted by level-of-detail tier so that a
// draw range drops the finest tiers without touching the buffers. The mesh is rebuilt with the main tubes (the layout is deterministic,
// so a rebuild reproduces it exactly) and re-shaped by shapeVessels: radius scale, the parent's colour and blocked state at the take-off.
const MB = 7;
interface BranchSet {
  list: Branch[]; ring0: number[]; face0: number[]; tierEnd: number[]; shown: number;
  ctr: Float32Array; out: Float32Array; nrm: Float32Array; bin: Float32Array; rad: Float32Array; mesh: THREE.Mesh;
}
let bset: BranchSet | null = null;
let branchCache: { tree: unknown; list: Branch[] } | null = null;
const segCol: Record<string, Float32Array> = {}; // each main segment's final colour per sample, written by shapeVessels
export const branchMesh = () => bset?.mesh;

function buildBranchMesh() {
  if (!branchCache || branchCache.tree !== tree) branchCache = { tree, list: buildBranches(tree).sort((a, b) => tierOf(a) - tierOf(b)) };
  const list = branchCache.list, N = list.reduce((a, b) => a + b.pts.length, 0);
  const ctr = new Float32Array(3 * N), out = new Float32Array(3 * N), nrm = new Float32Array(3 * N), bin = new Float32Array(3 * N), rad = new Float32Array(N);
  const ring0: number[] = [], face0: number[] = [], idx: number[] = [], tierEnd = [0, 0, 0];
  let r = 0;
  const t = new THREE.Vector3(), nv = new THREE.Vector3(), bi = new THREE.Vector3();
  for (const b of list) {
    const n = b.pts.length, P = b.pts.map((p) => v3(rotateHeart(p))), O = b.nrm.map((p) => v3(rotateHeart(p)));
    const sArc = [0];
    for (let i = 1; i < n; i++) sArc.push(sArc[i - 1] + P[i].distanceTo(P[i - 1]));
    ring0.push(r); face0.push(idx.length / 3);
    for (let i = 0; i < n; i++) {
      t.copy(P[Math.min(n - 1, i + 1)]).sub(P[Math.max(0, i - 1)]).normalize();
      if (i === 0) nv.copy(O[0]);
      nv.addScaledVector(t, -nv.dot(t)).normalize(); // parallel-transported frame, as the main tubes
      bi.crossVectors(t, nv).normalize();
      const o = 3 * (r + i);
      ctr[o] = P[i].x; ctr[o + 1] = P[i].y; ctr[o + 2] = P[i].z; out[o] = O[i].x; out[o + 1] = O[i].y; out[o + 2] = O[i].z;
      nrm[o] = nv.x; nrm[o + 1] = nv.y; nrm[o + 2] = nv.z; bin[o] = bi.x; bin[o + 1] = bi.y; bin[o + 2] = bi.z;
      // a flare where it joins its parent and a rounded tip, like the main vessels
      rad[r + i] = (b.d[i] / 2) * (1 + 0.35 * Math.exp(-sArc[i] / 1.5)) * Math.sqrt(Math.max(0, Math.min(1, (sArc[n - 1] - sArc[i]) / 1.5)));
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < MB; j++) { const a = (r + i) * (MB + 1) + j, c = a + MB + 1; idx.push(a, a + 1, c, c, a + 1, c + 1); }
    r += n; tierEnd[tierOf(b)] = idx.length;
  }
  for (let k = 1; k < 3; k++) tierEnd[k] = Math.max(tierEnd[k], tierEnd[k - 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * (MB + 1) * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * (MB + 1) * 3), 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, vesselMat);
  mesh.frustumCulled = false; // the buffers are re-shaped in place; the heart is always in view anyway
  vesselGroup.add(mesh);
  bset = { list, ring0, face0, tierEnd, shown: -1, ctr, out, nrm, bin, rad, mesh };
}

/** Re-shape the branch tubes: radius scale, parent colour at the take-off, collapsed where the parent is hidden. */
function shapeBranches() {
  if (!bset) return;
  const { list, ring0, ctr, out, nrm, bin, rad, mesh } = bset;
  const pa = mesh.geometry.attributes.position as THREE.BufferAttribute, ca = mesh.geometry.attributes.color as THREE.BufferAttribute;
  const bySeg: Record<string, Built> = {};
  for (const b of built) bySeg[b.seg.id] = b;
  list.forEach((br, bi) => {
    const pb = bySeg[br.segId], col = segCol[br.segId];
    const n = br.pts.length, r0 = ring0[bi];
    if (!pb || !col) return;
    const rs = A.cond.seg[br.segId].s, s = br.u * pb.seg.length;
    let k = Math.min(rs.length - 2, bsearch(rs, s)); if (s - rs[k] > rs[k + 1] - s) k++;
    // beyond an occlusion the parent is dark and collapsed; its branches follow (colour from the parent, and a thinner tube)
    const mult = !pb.mesh.visible ? 0 : pb.blocked[k] && !S.hide ? 0.85 : 1;
    for (let i = 0; i < n; i++) {
      const o = 3 * (r0 + i), R = rad[r0 + i] * S.exag * mult, lift = br.septal ? 0 : R * 0.6; // perforators stay sunk
      const cx = ctr[o] + out[o] * lift, cy = ctr[o + 1] + out[o + 1] * lift, cz = ctr[o + 2] + out[o + 2] * lift;
      for (let j = 0; j <= MB; j++) {
        const th = (j / MB) * Math.PI * 2, cs = Math.cos(th) * R, sn = Math.sin(th) * R, v = (r0 + i) * (MB + 1) + j;
        pa.setXYZ(v, cx + nrm[o] * cs + bin[o] * sn, cy + nrm[o + 1] * cs + bin[o + 1] * sn, cz + nrm[o + 2] * cs + bin[o + 2] * sn);
        ca.setXYZ(v, col[3 * k], col[3 * k + 1], col[3 * k + 2]);
      }
    }
  });
  pa.needsUpdate = true; ca.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere();
  bset.shown = -1; updateBranchLod();
}

/** Draw only the tiers the radius scale and the camera distance justify (rule in anatomy/branches.ts, branchTierCount), with a little hysteresis. */
export function updateBranchLod() {
  if (!bset) return;
  const dist = camera.position.distanceTo(controls.target), want = branchTierCount(S.exag, dist);
  let cur = bset.shown;
  if (cur < 0) cur = want;
  else if (want > cur && branchTierCount(S.exag, dist * 1.06) >= want) cur = want;
  else if (want < cur && branchTierCount(S.exag, dist * 0.94) <= want) cur = want;
  if (cur !== bset.shown) { bset.shown = cur; bset.mesh.geometry.setDrawRange(0, bset.tierEnd[cur - 1]); }
}

/** The segment a pick belongs to: a side branch selects its parent segment (the merged mesh finds it from the face hit). */
export function segIdOfHit(h: { object: THREE.Object3D; faceIndex?: number | null }): string {
  if (bset && h.object === bset.mesh && h.faceIndex != null) {
    let lo = 0, hi = bset.face0.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bset.face0[m] <= h.faceIndex) lo = m; else hi = m - 1; }
    return bset.list[lo].segId;
  }
  return h.object.userData.segId as string;
}

function legend() {
  $("legend2").hidden = S.mode !== "o2";
  const bar = $("bar");
  const set = (g: string, a: string, m: string, z: string) => { bar.style.background = g; $("l0").textContent = a; $("lmid").textContent = m; $("l1").textContent = z; };
  if (S.mode === "real") set("linear-gradient(90deg,#8e3a33 0 50%,#4e3a5a 50%)", "Myocardium", "", "Ischemic");
  else if (S.mode === "isch") set(`linear-gradient(90deg,${MAGMA.join(",")})`, "Perfused", "", "Ischemic or infarcted");
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
export const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x7a0f0f, size: 1.4, sizeAttenuation: true }));
vesselGroup.add(points);
export function initParticles() {
  const N = built.length * PER;
  pu = new Float32Array(N); pa2 = new Float32Array(N); pb2 = new Float32Array(N); pSeg = [];
  for (let i = 0; i < N; i++) { pu[i] = Math.random(); const r = Math.sqrt(Math.random()) * 0.8, th = Math.random() * 6.283; pa2[i] = r * Math.cos(th); pb2[i] = r * Math.sin(th); pSeg.push(Math.floor(i / PER)); }
  pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
}
const bsearch = (xs: number[], x: number) => { let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; } return lo; };
export function stepParticles(dt: number) {
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

/** A hand-sewn graft: from the aortic root to the vessel just beyond the lesion. */
const graftGroup = new THREE.Group(); heartGroup.add(graftGroup);
const graftMat = new THREE.MeshStandardMaterial({ color: 0xcbb393, roughness: 0.55, metalness: 0.0 });
export function buildGrafts() {
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
