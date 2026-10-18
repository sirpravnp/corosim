import * as THREE from "three";
import { LEAD_AXES, LeadName, Vec3 } from "../config/ecg";

/**
 * The leads as they look at the heart: each lead is an axis through the heart's centre, its positive pole labelled.
 * The six limb leads lie in the frontal plane (the hexaxial wheel), V1–V6 (and V7–V9) in the horizontal plane. A gold
 * arrow is the heart's electrical vector at this instant, with its recent path (the vectorcardiogram loop); a lead
 * records upward when the arrow points toward its positive pole, and the marker on the selected lead shows how far.
 */
const LIMB: LeadName[] = ["I", "II", "III", "aVR", "aVL", "aVF"];
const CHEST: LeadName[] = ["V1", "V2", "V3", "V4", "V5", "V6"];
const BACK: LeadName[] = ["V7", "V8", "V9"];
const LENGTH = 92, VEC_SCALE = 48, TRAIL = 220;
/** ECG frame (x left, y feet, z anterior) to the scene (x left, y up, z anterior). */
const toScene = (v: Vec3) => new THREE.Vector3(v[0], -v[1], v[2]);

function label(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "700 40px -apple-system, Helvetica, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,.65)"; g.strokeText(text, 64, 32);
  g.fillStyle = color; g.fillText(text, 64, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(16, 8, 1); s.renderOrder = 10;
  return s;
}

interface Axis { lead: LeadName; group: THREE.Group; pos: THREE.ArrowHelper; neg: THREE.Line; tag: THREE.Sprite; dir: THREE.Vector3 }

export type LeadSet = "limb" | "chest" | "all";

export class LeadAxes {
  readonly root = new THREE.Group();
  private axes: Axis[] = [];
  private vec: THREE.ArrowHelper;
  private trail: THREE.Line;
  private trailPts = new Float32Array(TRAIL * 3);
  private trailN = 0;
  private marker: THREE.Mesh;
  private planes: { frontal: THREE.Mesh; horizontal: THREE.Mesh };
  selected: LeadName = "II";
  set: LeadSet = "all";
  posterior = false;

  constructor() {
    const mkPlane = (rotX: number, color: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(LENGTH, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = rotX; this.root.add(m); return m;
    };
    this.planes = { frontal: mkPlane(0, 0x6aa7ff), horizontal: mkPlane(-Math.PI / 2, 0xffb36a) };
    for (const lead of [...LIMB, ...CHEST, ...BACK]) {
      const dir = toScene(LEAD_AXES[lead]).normalize(), chest = !LIMB.includes(lead);
      const color = chest ? 0xffb36a : 0x6aa7ff;
      const group = new THREE.Group();
      const pos = new THREE.ArrowHelper(dir, new THREE.Vector3(), LENGTH, color, 9, 5);
      const negGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-LENGTH * 0.8)]);
      const neg = new THREE.Line(negGeo, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.45 }));
      neg.computeLineDistances();
      const tag = label(lead, chest ? "#ffcf9e" : "#a9ccff");
      tag.position.copy(dir.clone().multiplyScalar(LENGTH + 9));
      for (const o of [pos.line, pos.cone]) { (o.material as THREE.Material).depthTest = false; (o.material as THREE.Material).transparent = true; o.renderOrder = 5; }
      (neg.material as THREE.Material).depthTest = false; neg.renderOrder = 5;
      group.add(pos, neg, tag);
      this.root.add(group);
      this.axes.push({ lead, group, pos, neg, tag, dir });
    }
    this.vec = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xf2c14e, 8, 5);
    for (const o of [this.vec.line, this.vec.cone]) { (o.material as THREE.Material).depthTest = false; o.renderOrder = 8; }
    const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.BufferAttribute(this.trailPts, 3)); tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.6, depthTest: false }));
    this.trail.renderOrder = 7;
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.marker.renderOrder = 9;
    this.root.add(this.vec, this.trail, this.marker);
    this.restyle();
  }

  /** Show, hide and highlight the axes for the current lead set and selection. */
  restyle() {
    for (const a of this.axes) {
      const limb = LIMB.includes(a.lead), back = BACK.includes(a.lead);
      const visible = (this.set === "all" || (this.set === "limb") === limb) && (!back || this.posterior);
      a.group.visible = visible || a.lead === this.selected;
      const sel = a.lead === this.selected, op = sel ? 1 : 0.42;
      for (const o of [a.pos.line, a.pos.cone]) (o.material as THREE.MeshBasicMaterial).opacity = op;
      a.pos.setLength(sel ? LENGTH * 1.08 : LENGTH, sel ? 12 : 9, sel ? 7 : 5);
      (a.neg.material as THREE.LineDashedMaterial).opacity = sel ? 0.8 : 0.3;
      a.tag.scale.set(sel ? 22 : 15, sel ? 11 : 7.5, 1);
      a.tag.material.opacity = sel ? 1 : 0.75;
    }
    this.planes.frontal.visible = this.set !== "chest";
    this.planes.horizontal.visible = this.set !== "limb";
  }

  select(lead: LeadName) { this.selected = lead; this.restyle(); }

  /** The heart vector now (mV, ECG frame). */
  update(v: Vec3) {
    const s = toScene(v).multiplyScalar(VEC_SCALE), len = s.length();
    this.vec.visible = len > 1.5;
    if (len > 1e-6) { this.vec.setDirection(s.clone().normalize()); this.vec.setLength(Math.max(len, 0.01), Math.min(8, len * 0.4), Math.min(5, len * 0.25)); }
    // the loop: shift in the newest point
    this.trailPts.copyWithin(3, 0, (TRAIL - 1) * 3);
    this.trailPts[0] = s.x; this.trailPts[1] = s.y; this.trailPts[2] = s.z;
    this.trailN = Math.min(TRAIL, this.trailN + 1);
    this.trail.geometry.setDrawRange(0, this.trailN);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    // where the vector falls on the selected lead: its projection (what that lead is writing now)
    const a = this.axes.find((x) => x.lead === this.selected)!;
    this.marker.position.copy(a.dir).multiplyScalar(s.dot(a.dir));
  }

  clearTrail() { this.trailN = 0; this.trail.geometry.setDrawRange(0, 0); }
}
