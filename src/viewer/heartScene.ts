import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { rotateHeart, diameterAt, Segment } from "../anatomy/tree";
import { meshHeart, projectToEpicardium, septalDistance, latitude, AV_GROOVE_LAT, Part } from "../anatomy/heartSurface";
import { V3 } from "../anatomy/curve";
import { Simulation } from "../sim/simulation";

/**
 * The 3D heart for the in-chat viewer: chambers and great vessels, coronary arteries with the lesion's real lumen,
 * and ventricular muscle that darkens where it is ischemic and darker still where it has infarcted. Adapted from the
 * main app's renderer, but driven only by a Simulation, with none of the app's controls.
 */
const v3 = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const ARTERY = new THREE.Color(0xc2392f), ARTERY_DEEP = new THREE.Color(0x8a221d), BLOCKED = new THREE.Color(0x6b6b6b);
const PART_COLOR: Record<Part, THREE.Color> = {
  [Part.LV]: new THREE.Color(0x7c2a24), [Part.RV]: new THREE.Color(0x82302a), [Part.RA]: new THREE.Color(0x70282a), [Part.LA]: new THREE.Color(0x732b2b),
  [Part.Aorta]: new THREE.Color(0xd2a08f),
};
const FAT = new THREE.Color(0xc9a564), DUSKY = new THREE.Color(0x3f3150), SCAR = new THREE.Color(0x2a2230);
const NB = 4, M = 18, EXAG = 2.5;
const TARGET = new THREE.Vector3(-6, 14, -4);
export const VIEWS: Record<string, [number, number, number]> = {
  anterior: [0, 30, 330], left: [320, 25, 10], posterior: [0, 30, -330], inferior: [20, -320, 90], right: [-320, 25, 10],
};

interface Vessel { seg: Segment; mesh: THREE.Mesh }

export class HeartScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private heartGeo = new THREE.BufferGeometry();
  private hRef: V3[] = [];
  private hPart: Uint8Array;
  private fatK = new Float32Array(0); private grain = new Float32Array(0); private cover = new Float32Array(0);
  private bedIdx = new Int16Array(0); private bedW = new Float32Array(0);
  private vessels: Vessel[] = [];
  private vesselGroup = new THREE.Group();
  private vesselMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.18 });

  constructor(private host: HTMLElement, private sim: Simulation) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(this.renderer.domElement);
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    const key = new THREE.DirectionalLight(0xfff4ea, 1.6); key.position.set(120, 160, 220);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5); fill.position.set(-180, -40, 120);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-60, 90, -220);
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.15), this.group);

    const m = meshHeart(), n = m.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p: V3 = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
      this.hRef.push(p);
      pos.set(rotateHeart(p), 3 * i);
      nor.set(rotateHeart([m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]]), 3 * i);
    }
    this.hPart = m.parts;
    this.heartGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.heartGeo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    this.heartGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.heartGeo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const heartMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.35, sheenColor: new THREE.Color(0xffc9b8), sheenRoughness: 0.6 });
    this.group.add(new THREE.Mesh(this.heartGeo, heartMat), this.vesselGroup);
    this.view("anterior");
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  /** Closer than the full app: the chat panel is small, and the wall that darkens should be easy to see. */
  view(name: keyof typeof VIEWS | string) { this.camera.position.set(...(VIEWS[name] ?? VIEWS.anterior)).multiplyScalar(0.72).add(TARGET); this.controls.target.copy(TARGET); }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** The anatomy or lesions changed: recompute the muscle's bed weights and rebuild the arteries. */
  rebuild() { this.prepare(); this.buildVessels(); this.paint(); }

  private isVentricle(i: number) { return this.hPart[i] === Part.LV || this.hPart[i] === Part.RV; }

  private prepare() {
    const { tree, sites } = this.sim, n = this.hRef.length;
    this.fatK = new Float32Array(n); this.grain = new Float32Array(n); this.cover = new Float32Array(n);
    this.bedIdx = new Int16Array(n * NB); this.bedW = new Float32Array(n * NB);
    const vs: { p: V3; w: number }[] = [];
    for (const seg of tree.segments) {
      const main = ["LAD", "LCX", "RCA", "PDA_R", "PDA_L", "LM"].includes(seg.id);
      for (let i = 0; i < seg.heartSamples.length; i += 3) vs.push({ p: projectToEpicardium(seg.heartSamples[i], 0).pos, w: main ? 4.2 : 2.6 });
    }
    const bedPos = sites.map((s) => { const [segId, k] = s.key.split("#"), sg = tree.byId[segId]; return projectToEpicardium(sg.curve.at(k === "end" ? 1 : sg.taps[+k].pos), 0).pos; });
    for (let i = 0; i < n; i++) {
      const p = this.hRef[i];
      this.grain[i] = 0.92 + 0.08 * Math.sin(p[0] * 0.21 + Math.sin(p[1] * 0.13) * 3) * Math.sin(p[2] * 0.19 + p[1] * 0.07);
      if (!this.isVentricle(i)) continue;
      let f = 0;
      for (const v of vs) { const d2 = (p[0] - v.p[0]) ** 2 + (p[1] - v.p[1]) ** 2 + (p[2] - v.p[2]) ** 2; f = Math.max(f, Math.exp(-d2 / (v.w * v.w))); }
      f = Math.max(f, 0.65 * Math.exp(-(((latitude(p) - AV_GROOVE_LAT) / 0.06) ** 2)));
      f = Math.max(f, 0.45 * Math.exp(-((septalDistance(p) / 4.5) ** 2)) * (p[1] < 50 ? 1 : 0));
      this.fatK[i] = Math.min(0.72, f * 0.78);
      const near = bedPos.map((b, j) => ({ j, d2: (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2 })).sort((a, b) => a.d2 - b.d2).slice(0, NB);
      let sum = 0;
      near.forEach((e, k) => { const w = Math.exp(-e.d2 / (22 * 22)); this.bedIdx[i * NB + k] = e.j; this.bedW[i * NB + k] = w; sum += w; });
      this.cover[i] = Math.min(1, sum * 1.6);
      for (let k = 0; k < NB; k++) this.bedW[i * NB + k] /= sum || 1;
    }
  }

  /** Muscle colour from the simulation: dusky where ischemic, darker where infarcted. */
  paint() {
    const { sites, sev, scar } = this.sim;
    const ca = this.heartGeo.attributes.color as THREE.BufferAttribute, c = new THREE.Color();
    for (let i = 0; i < this.hRef.length; i++) {
      c.copy(PART_COLOR[this.hPart[i] as Part]).multiplyScalar(this.grain[i]);
      if (this.isVentricle(i)) {
        let isch = 0, dead = 0;
        for (let k = 0; k < NB; k++) { const s = sites[this.bedIdx[i * NB + k]]; if (!s) continue; const w = this.bedW[i * NB + k]; isch += w * (sev[s.key] ?? 0); dead += w * (scar[s.key] ?? 0); }
        isch *= this.cover[i]; dead *= this.cover[i];
        c.lerp(DUSKY, 0.75 * isch); c.lerp(SCAR, 0.8 * dead);
        c.lerp(FAT, this.fatK[i] * (1 - 0.4 * Math.max(isch, dead)));
      }
      ca.setXYZ(i, c.r, c.g, c.b);
    }
    ca.needsUpdate = true;
  }

  private buildVessels() {
    for (const v of this.vessels) { this.vesselGroup.remove(v.mesh); v.mesh.geometry.dispose(); }
    this.vessels = [];
    const { tree, analysis } = this.sim;
    for (const seg of tree.segments) {
      const r = analysis.cond.seg[seg.id], n = r.s.length, L = seg.length, ph = hash(seg.id) * 6.283;
      const placed = r.s.map((s) => projectToEpicardium(seg.curve.at(s / L), 0.6));
      const base = placed.map((q) => v3(rotateHeart(q.pos))), out = placed.map((q) => v3(rotateHeart(q.n)));
      const dMax = Math.max(...r.d) * 1000, amp = 0.22 + 0.4 * (1 - Math.min(1, dMax / 3.5));
      const ctr = base.map((b, i) => {
        const s = r.s[i], t = base[Math.min(n - 1, i + 1)].clone().sub(base[Math.max(0, i - 1)]).normalize();
        const side = new THREE.Vector3().crossVectors(t, out[i]).normalize();
        const wig = smooth(s / 10) * smooth((L - s) / 6) * amp * (Math.sin((6.283 * s) / 23.1 + ph) + 0.55 * Math.sin((6.283 * s) / 11.7 + 2.3 * ph));
        return b.clone().addScaledVector(side, wig);
      });
      // blocked: beyond this segment's own occlusion, or the whole segment if an ancestor is occluded upstream of it
      let wholly = false, up: Segment | null = seg.parent ? tree.byId[seg.parent] : null, at = seg.attach * (up ? up.length : 0);
      while (up) { const bf = analysis.cond.seg[up.id].blockedFrom; if (bf !== null && bf < at) { wholly = true; break; } at = up.attach * (up.parent ? tree.byId[up.parent].length : 0); up = up.parent ? tree.byId[up.parent] : null; }
      const pos = new Float32Array(n * (M + 1) * 3), col = new Float32Array(n * (M + 1) * 3), c = new THREE.Color();
      let nv = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const s = r.s[i], t = ctr[Math.min(n - 1, i + 1)].clone().sub(ctr[Math.max(0, i - 1)]).normalize();
        nv = (i === 0 ? out[0].clone() : nv.clone()).sub(t.clone().multiplyScalar((i === 0 ? out[0] : nv).dot(t))).normalize();
        const bin = new THREE.Vector3().crossVectors(t, nv).normalize();
        const tip = Math.sqrt(Math.max(0, Math.min(1, (L - s) / 3.5))), flare = 1 + 0.28 * Math.exp(-s / 2.2);
        const R = (r.d[i] / 2) * 1000 * flare * tip * EXAG, lift = R * 0.6;
        const cx = ctr[i].x + out[i].x * lift, cy = ctr[i].y + out[i].y * lift, cz = ctr[i].z + out[i].z * lift;
        const blocked = wholly || (r.blockedFrom !== null && s > r.blockedFrom);
        c.copy(blocked ? BLOCKED : ARTERY).lerp(ARTERY_DEEP, blocked ? 0.2 : 0.35 * (1 - r.d[i] / Math.max(...r.d)));
        if (!blocked && r.d[i] < 0.6 * diameterAt(tree, seg, s)) c.lerp(new THREE.Color(0xf2c14e), 0.55); // a narrowing shows up
        for (let j = 0; j <= M; j++) {
          const th = (j / M) * Math.PI * 2, cs = Math.cos(th) * R, sn = Math.sin(th) * R, o = (i * (M + 1) + j) * 3;
          pos[o] = cx + nv.x * cs + bin.x * sn; pos[o + 1] = cy + nv.y * cs + bin.y * sn; pos[o + 2] = cz + nv.z * cs + bin.z * sn;
          col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        }
      }
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.vesselMat);
      this.vesselGroup.add(mesh); this.vessels.push({ seg, mesh });
    }
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}
