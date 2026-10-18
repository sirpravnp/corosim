import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HeartMorph, meshHeart, MorphPart, SurfaceMesh } from "../anatomy/heartSurface";
import { rotateHeart } from "../anatomy/tree";
import { V3 } from "../anatomy/curve";
import { NodeName } from "../physics/structural";
import { quantize } from "./morph";
import type { MeshRequest } from "./meshWorker";
import type { Jet, Props, Tri } from "./props";

/**
 * The 3D heart of the structural page: the simulator's procedural heart reshaped for a lesion (heartSurface.ts, `HeartMorph`) with
 * the great vessels added, each structure coloured by the oxygen saturation of the blood in it (blue = desaturated, red = saturated,
 * grey = no blood reaches it). Meshes are built in a worker: a coarse one is drawn at once while a slider moves, a fine one a moment
 * after it stops; finished meshes are kept, so sliding back to a shape already seen is instant.
 */
export const VIEWS: Record<string, [number, number, number]> = {
  anterior: [0, 30, 330], left: [330, 25, 10], posterior: [0, 30, -330], right: [-330, 25, 10], superior: [0, 330, 40],
};
export type SatMap = Partial<Record<NodeName | "DUCT", number>>;
/** Which solved node's blood fills each structure. */
export const PART_NODE: Record<MorphPart, NodeName | "DUCT"> = {
  [MorphPart.LV]: "LV", [MorphPart.RV]: "RV", [MorphPart.RA]: "RA", [MorphPart.LA]: "LA", [MorphPart.Aorta]: "AO", [MorphPart.PA]: "PA",
  [MorphPart.SVC]: "SVC", [MorphPart.IVC]: "IVC", [MorphPart.PV]: "PV", [MorphPart.Duct]: "DUCT", [MorphPart.BT]: "AO", [MorphPart.DAO]: "DAO",
};
export const SAT_RANGE = { lo: 0.6, hi: 0.98 };
const BLUE = new THREE.Color(0x3a56c4), RED = new THREE.Color(0xc8352c), GREY = new THREE.Color(0x777777);
/** Saturation 60% (blue) to 98% (red); NaN (no blood reaches it) is grey. */
export function satColor(sat: number, out = new THREE.Color()): THREE.Color {
  if (!Number.isFinite(sat)) return out.copy(GREY);
  return out.copy(BLUE).lerp(RED, Math.min(1, Math.max(0, (sat - SAT_RANGE.lo) / (SAT_RANGE.hi - SAT_RANGE.lo))));
}
/** CSS gradient of the same colours, sampled through three.js so the legend matches the mesh (which blends in linear light). */
export function legendGradient(): string {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => `${satColor(SAT_RANGE.lo + t * (SAT_RANGE.hi - SAT_RANGE.lo)).getStyle()} ${t * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const COARSE = 2.8, FINE = 1.6, FINE_DELAY = 300, CACHE_MAX = 16;

export class StructuralHeartView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.3, sheenColor: new THREE.Color(0xffc9b8), sheenRoughness: 0.6 });
  private mesh: THREE.Mesh | null = null;
  private back: THREE.Mesh | null = null; // the same shell seen from inside, so a cut shows walls instead of nothing
  private backMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8a8a8a, roughness: 0.75, side: THREE.BackSide });
  private propsGroup = new THREE.Group();
  private propMaterials: THREE.Material[] = [];
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  private cut = 0; // 0 = whole heart, 1 = cut well past the middle
  private parts: ArrayLike<number> = [];
  private sat: SatMap = {};
  private dirty = true;
  private userMoved = false;
  private viewName = "anterior";
  // meshing
  private worker: Worker | null = null;
  private busy = false;
  private running: number | null = null;
  private queued: MeshRequest | null = null;
  private counter = 0;
  private asked = new Map<number, { key: string; step: number }>();
  private shownFine = false;
  private fineTimer = 0;
  private cache = new Map<string, SurfaceMesh>();
  private wanted = "";

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.material.clippingPlanes = [this.plane]; this.backMaterial.clippingPlanes = [this.plane];
    host.prepend(this.renderer.domElement);
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.renderer.domElement.style.touchAction = "pan-y"; // one finger still scrolls the page; a horizontal drag turns the heart
    this.controls.addEventListener("start", () => { this.userMoved = true; });
    this.controls.addEventListener("change", () => { this.dirty = true; if (this.cut > 0) this.alignCut(); });
    const key = new THREE.DirectionalLight(0xfff4ea, 1.6); key.position.set(120, 160, 220);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5); fill.position.set(-180, -40, 120);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-60, 90, -220);
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.15), this.group);
    this.group.add(this.propsGroup);
    try {
      this.worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<{ id: number; mesh: SurfaceMesh }>) => this.arrived(e.data.id, e.data.mesh);
      this.worker.onerror = () => this.workerFailed();
    } catch { this.worker = null; }
    new ResizeObserver(() => { this.resize(); if (!this.userMoved) this.fit(); }).observe(host);
    this.resize();
    const loop = () => { if (this.controls.update() || this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** The sphere the camera frames: the chambers, aorta and pulmonary artery, with a margin. The cavae and veins run off the edge rather than shrinking everything to fit their tips. */
  private fitSphere(): THREE.Sphere {
    const pos = this.mesh!.geometry.attributes.position as THREE.BufferAttribute, core = (part: number) => part <= MorphPart.Aorta || part === MorphPart.PA || part === MorphPart.DAO;
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0; for (let i = 0; i < pos.count; i++) if (core(this.parts[i])) { c.add(v.fromBufferAttribute(pos, i)); n++; }
    if (!n) { this.mesh!.geometry.computeBoundingSphere(); return this.mesh!.geometry.boundingSphere!; }
    c.divideScalar(n);
    let r = 0; for (let i = 0; i < pos.count; i++) if (core(this.parts[i])) r = Math.max(r, v.fromBufferAttribute(pos, i).distanceTo(c));
    return new THREE.Sphere(c, r * 1.1);
  }

  /** For debugging in the console: where the camera is and what it is fitted to. */
  debug() { return { cam: this.camera.position.toArray(), target: this.controls.target.toArray(), sphere: this.mesh ? this.fitSphere() : null, aspect: this.camera.aspect, near: this.camera.near, far: this.camera.far, userMoved: this.userMoved, cut: this.cut, plane: this.plane.constant }; }

  /** Face the heart from a named side, fitted to the canvas. */
  view(name: string) { this.viewName = name; this.userMoved = false; this.fit(true); }

  /** Place the camera on `dir` so every core vertex (chambers, aorta, pulmonary artery) is inside the frame: the target is the midpoint of what the camera sees, the distance the least that fits it. */
  private fit(resetDirection = false) {
    if (!this.mesh) return;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov), tanV = Math.tan(vFov / 2), tanH = tanV * this.camera.aspect;
    const dir = resetDirection || this.camera.position.distanceTo(this.controls.target) < 1
      ? new THREE.Vector3(...(VIEWS[this.viewName] ?? VIEWS.anterior)).normalize()
      : this.camera.position.clone().sub(this.controls.target).normalize();
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, dir).normalize(), upv = new THREE.Vector3().crossVectors(dir, right);
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3(), core: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i += 3) if (this.parts[i] <= MorphPart.Aorta || this.parts[i] === MorphPart.PA || this.parts[i] === MorphPart.DAO) core.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    if (!core.length) return;
    const centre = this.fitSphere().center.clone();
    let dist = 1;
    for (let pass = 0; pass < 3; pass++) { // moving the target changes what is seen at the edges, so a few passes settle it
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; dist = 1;
      for (const c of core) {
        v.copy(c).sub(centre); const depth = v.dot(dir);
        dist = Math.max(dist, depth + Math.abs(v.dot(upv)) / tanV, depth + Math.abs(v.dot(right)) / tanH);
        const d = Math.max(1, dist), sx = v.dot(right) / (d - depth), sy = v.dot(upv) / (d - depth);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      centre.addScaledVector(right, ((x0 + x1) / 2) * dist).addScaledVector(upv, ((y0 + y1) / 2) * dist);
    }
    // one more exact distance from the final target
    dist = 1;
    for (const c of core) { v.copy(c).sub(centre); const depth = v.dot(dir); dist = Math.max(dist, depth + Math.abs(v.dot(upv)) / tanV, depth + Math.abs(v.dot(right)) / tanH); }
    dist *= 1.05;
    const radius = this.fitSphere().radius;
    dist = Math.max(dist, radius * 1.2); // never inside the heart
    this.controls.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(dir, dist);
    this.camera.near = Math.max(1, dist - radius * 1.6); this.camera.far = dist + radius * 3; this.camera.updateProjectionMatrix();
    this.controls.update(); this.alignCut(); this.dirty = true;
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true;
  }

  /** New shape and new blood: a coarse mesh now, a fine one once the sliders have been still for a moment. */
  update(morph: HeartMorph, sat: SatMap) {
    this.sat = sat;
    const q = quantize(morph), key = JSON.stringify(q);
    this.wanted = key; this.shownFine = false;
    clearTimeout(this.fineTimer);
    const fine = this.cache.get(`${key}|${FINE}`);
    if (fine) { this.show(fine); this.shownFine = true; return; }
    const coarse = this.cache.get(`${key}|${COARSE}`);
    if (coarse) this.show(coarse); else this.request(COARSE, q, key);
    this.fineTimer = window.setTimeout(() => this.request(FINE, q, key), FINE_DELAY);
  }
  /** Slide the cutting plane through the heart, from the side the camera is on (0 = no cut). */
  setCut(k: number) { this.cut = Math.min(1, Math.max(0, k)); this.alignCut(); }
  /** The plane faces the camera, so whatever side you look from, the near part is the part cut away. */
  private alignCut() {
    const open = this.cut > 0;
    if (this.back) this.back.visible = open; this.propsGroup.visible = open;
    if (!this.mesh) return;
    const s = this.fitSphere(), dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.plane.normal.copy(dir).negate(); // keeps what is behind the plane: dot(n, p) + c >= 0 with n = -dir
    this.plane.constant = open ? dir.dot(s.center) + s.radius * (1 - 1.9 * this.cut) : 1e6;
    this.dirty = true;
  }

  /** The septa, valves and jets for the cutaway, in the heart frame. */
  setProps(props: Props | null, sat: SatMap) {
    for (const c of [...this.propsGroup.children]) { this.propsGroup.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    for (const m of this.propMaterials) m.dispose();
    this.propMaterials = [];
    if (!props) { this.dirty = true; return; }
    const material = (color: number, opacity = 1) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.7, side: THREE.DoubleSide, transparent: opacity < 1, opacity, clippingPlanes: [this.plane] });
      this.propMaterials.push(m); return m;
    };
    const tri = (t: Tri, m: THREE.Material) => {
      if (!t.indices.length) return;
      const pos = new Float32Array(t.positions.length);
      for (let i = 0; i < t.positions.length; i += 3) pos.set(rotateHeart([t.positions[i], t.positions[i + 1], t.positions[i + 2]] as V3), i);
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(t.indices); g.computeVertexNormals();
      this.propsGroup.add(new THREE.Mesh(g, m));
    };
    tri(props.septum, material(0xd7948a)); tri(props.atrialSeptum, material(0xe3a79d, 0.92));
    for (const v of props.valves) tri(v.tri, material(0xe6d8bd));
    for (const j of props.jets) this.propsGroup.add(this.jetMesh(j, sat, material));
    this.dirty = true;
  }
  private jetMesh(j: Jet, sat: SatMap, material: (c: number, o?: number) => THREE.Material) {
    const node = j.node, s = this.sat[node] ?? sat[node] ?? NaN, col = satColor(s);
    const m = material(col.getHex(), 0.88);
    const dir = new THREE.Vector3(...rotateHeart(j.dir as V3)).normalize(), from = new THREE.Vector3(...rotateHeart(j.from as V3));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(j.radius, j.length, 20, 1, true), m);
    cone.position.copy(from).addScaledVector(dir, j.length / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()); // apex at the orifice, widening downstream
    return cone;
  }

  /** Recolour for new saturations without rebuilding the shape. */
  recolor(sat: SatMap) { this.sat = sat; this.paint(); }

  private same(id: number | null, key: string, step: number) { const a = id === null ? undefined : this.asked.get(id); return !!a && a.key === key && a.step === step; }
  private request(step: number, morph: HeartMorph, key: string) {
    if (this.same(this.running, key, step) || this.same(this.queued?.id ?? null, key, step)) return; // already on its way
    const req: MeshRequest = { id: ++this.counter, step, morph };
    this.asked.set(req.id, { key, step });
    if (!this.worker) { this.finish(req.id, () => meshHeart(step, undefined, morph)); return; }
    if (this.busy) {
      // one job waits at most; the newest replaces it, except that a coarse request never replaces the fine one for the same shape
      const q = this.queued, qa = q ? this.asked.get(q.id) : undefined;
      if (q && qa && qa.key === key && qa.step === FINE && step === COARSE) { this.asked.delete(req.id); return; }
      if (q) this.asked.delete(q.id);
      this.queued = req; return;
    }
    this.busy = true; this.running = req.id; this.worker.postMessage(req);
  }
  /** Build on this thread (no worker, or it failed) and take the result. */
  private finish(id: number, make: () => SurfaceMesh) {
    try { this.arrived(id, make()); } catch { this.asked.delete(id); }
  }
  private arrived(id: number, mesh: SurfaceMesh) {
    this.busy = false; this.running = null;
    const a = this.asked.get(id); this.asked.delete(id);
    if (a) {
      this.cache.delete(`${a.key}|${a.step}`); this.cache.set(`${a.key}|${a.step}`, mesh); // most recently built last
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      // drawn only if it is still the shape on the sliders, and a coarse mesh never replaces the fine one already up
      if (a.key === this.wanted && (a.step === FINE || !this.shownFine)) { this.show(mesh); this.shownFine = a.step === FINE; }
    }
    const next = this.queued; this.queued = null;
    if (!next) return;
    if (this.worker) { this.busy = true; this.running = next.id; this.worker.postMessage(next); }
    else this.finish(next.id, () => meshHeart(next.step, undefined, next.morph));
  }
  /** The worker died: drop what it held, build on this thread from now on, and ask again for what is wanted. */
  private workerFailed() {
    this.worker?.terminate(); this.worker = null; this.busy = false;
    if (this.running !== null) this.asked.delete(this.running);
    this.running = null;
    const next = this.queued; this.queued = null;
    if (next) this.finish(next.id, () => meshHeart(next.step, undefined, next.morph));
    else if (this.wanted && !this.shownFine) this.request(FINE, JSON.parse(this.wanted), this.wanted);
  }

  private show(m: SurfaceMesh) {
    const n = m.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(rotateHeart([m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]] as V3), 3 * i);
      nor.set(rotateHeart([m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]] as V3), 3 * i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    this.parts = m.parts;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.back) this.group.remove(this.back);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.back = new THREE.Mesh(geo, this.backMaterial);
    this.group.add(this.mesh, this.back);
    this.alignCut();
    this.paint();
    if (!this.userMoved) this.fit();
  }

  private paint() {
    if (!this.mesh) return;
    const ca = this.mesh.geometry.attributes.color as THREE.BufferAttribute, c = new THREE.Color(), cache = new Map<number, THREE.Color>();
    const colorOf = (part: number) => {
      let col = cache.get(part);
      if (!col) { col = satColor(this.sat[PART_NODE[part as MorphPart]] ?? NaN); cache.set(part, col); }
      return col;
    };
    for (let i = 0; i < this.parts.length; i++) {
      c.copy(colorOf(this.parts[i]));
      const g = 0.93 + 0.07 * Math.sin(i * 12.9898); // faint grain so flat regions do not look painted
      ca.setXYZ(i, c.r * g, c.g * g, c.b * g);
    }
    ca.needsUpdate = true; this.dirty = true;
  }
}
