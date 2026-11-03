import * as THREE from "three";
import { satColor } from "../structural/heartView";
import { propsForPatient, propsToScene } from "./simProps";
import type { SimProps } from "./simProps";
import type { PropsReply, PropsRequest } from "./propsWorker";
import type { PatientSpec } from "./patient";
import type { Jet, Tri } from "../structural/props";
import type { V3 } from "../anatomy/curve";

/**
 * The structural props drawn inside the Simulator's heart (task P11): septa, valve annuli, jets, as on the structural page's
 * cutaway. Built (src/sim/simProps.ts) once per patient, in a worker, only after the toggle is first turned on; the meshes are
 * made from the result in the scene frame and added to `parent` (the heart group), so they move with the heart.
 */
export class SimPropsView {
  private group = new THREE.Group();
  private materials: THREE.Material[] = [];
  private worker: Worker | null = null;
  private nextId = 1;
  private wantedId = 0;
  private sig = "";        // the patient the current (or pending) props are for; "" = none yet
  private shown = false;
  private patient: PatientSpec | undefined;

  constructor(parent: THREE.Object3D) {
    this.group.visible = false;
    parent.add(this.group);
    try {
      this.worker = new Worker(new URL("./propsWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<PropsReply>) => { if (e.data.id === this.wantedId && "result" in e.data) this.build(e.data.result); };
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; this.sig = ""; if (this.shown) this.request(); };
    } catch { this.worker = null; }
  }

  /** The patient on screen changed (a shared link, later the playground). The props follow if they are on, else when they are turned on. */
  setPatient(p: PatientSpec | undefined) {
    this.patient = p;
    if (this.shown) this.request();
  }
  show(on: boolean) {
    this.shown = on; this.group.visible = on;
    if (on) this.request();
  }

  private request() {
    const sig = JSON.stringify(this.patient ?? null);
    if (sig === this.sig) return;
    this.sig = sig;
    const id = this.wantedId = this.nextId++;
    if (this.worker) { this.worker.postMessage({ id, patient: this.patient } satisfies PropsRequest); return; }
    setTimeout(() => { if (id === this.wantedId) this.build(propsForPatient(this.patient)); }, 0); // no worker: one pause, once per patient
  }

  private build(r: SimProps) {
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    for (const m of this.materials) m.dispose();
    this.materials = [];
    const p = propsToScene(r.props);
    const material = (color: number, opacity = 1) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.7, side: THREE.DoubleSide, transparent: opacity < 1, opacity });
      this.materials.push(m); return m;
    };
    const tri = (t: Tri, m: THREE.Material) => {
      if (!t.indices.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(t.positions), 3)); g.setIndex(t.indices); g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, m));
    };
    tri(p.septum, material(0xd7948a)); tri(p.atrialSeptum, material(0xe3a79d, 0.92));
    for (const v of p.valves) tri(v.tri, material(0xe6d8bd));
    for (const j of p.jets) this.group.add(this.jet(j, r, material));
  }
  private jet(j: Jet, r: SimProps, material: (c: number, o?: number) => THREE.Material) {
    const dir = new THREE.Vector3(...(j.dir as V3)).normalize(), from = new THREE.Vector3(...(j.from as V3));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(j.radius, j.length, 20, 1, true), material(satColor(r.sat[j.node] ?? NaN).getHex(), 0.88));
    cone.position.copy(from).addScaledVector(dir, j.length / 2);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()); // apex at the orifice, widening downstream
    return cone;
  }
  /** For checks in the browser: how many meshes are drawn. */
  count() { return this.group.children.length; }
}
