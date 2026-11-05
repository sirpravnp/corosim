import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { V3 } from "../anatomy/curve";
import { meshHeart, Part } from "../anatomy/heartSurface";
import { rotateHeart } from "../anatomy/tree";
import { Pose, SECTOR, toPatient } from "./poses";
import { ProbeControls, ProbePreset, controlsFromPose, poseFromControls, projectOntoChest, slideProbe, snapPose, tiltProbe, twistProbe } from "./probe";

/**
 * The simulator's own 3D heart (the same surface the main page draws) as a translucent shell, the probe, and the imaging sector as a fan
 * in the probe's plane. Everything is in the patient frame (x left, y up, z anterior), mm, so the scene needs no axis swap.
 * Like the simulator's heart: drag anywhere to turn the heart, scroll to zoom. On the probe itself, drag to slide it on the schematic
 * chest, shift-drag to tilt, scroll to roll the index mark. Picking a view flies the probe and the camera there.
 */
const PART_COLOR: Record<Part, number> = { [Part.LV]: 0xb24a3f, [Part.RV]: 0x4f7fb5, [Part.RA]: 0x7aa6d4, [Part.LA]: 0xd98a6e, [Part.Aorta]: 0xe3b35c };
const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);
const asV3 = (p: THREE.Vector3): V3 => [p.x, p.y, p.z];

export class EchoScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  private controls?: OrbitControls;
  private poseGroup = new THREE.Group();
  private centre: THREE.Vector3;
  private current: Pose | null = null;
  private presets: ProbePreset[] = [];
  private dragging = false;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane();
  private hit = new THREE.Vector3();
  private mode: "slide" | "tilt" = "slide";
  private lastY = 0;
  private anim: { t0: number; ms: number; from: ProbeControls; to: ProbePreset; camFrom: THREE.Vector3; camTo: THREE.Vector3; tgtFrom: THREE.Vector3; tgtTo: THREE.Vector3 } | null = null;
  /** Fires after a drag or scroll changes the pose; `viewId` is set when the pose snaps to a preset. */
  onPoseChange: ((pose: Pose, viewId: string | null) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(this.renderer.domElement);
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    const m = meshHeart(), n = m.positions.length / 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set(rotateHeart([m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]]), 3 * i);
      nor.set(rotateHeart([m.normals[3 * i], m.normals[3 * i + 1], m.normals[3 * i + 2]]), 3 * i);
      c.setHex(PART_COLOR[m.parts[i] as Part]); col.set([c.r, c.g, c.b], 3 * i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const heart = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.4, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    heart.renderOrder = 1;
    this.centre = v(toPatient([0, 0, 0]));
    const key = new THREE.DirectionalLight(0xfff4ea, 1.6); key.position.set(120, 160, 220);
    this.scene.add(heart, new THREE.AmbientLight(0xffffff, 0.3), key, this.poseGroup);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.camera.position.copy(this.centre).addScaledVector(new THREE.Vector3(0, 0, 1), 460);
    this.initControls();
    this.bindPointer();
    this.renderer.setAnimationLoop((now) => { this.step(now); this.controls?.update(); this.renderer.render(this.scene, this.camera); });
  }

  /** Standard views the drag snap can pull toward. */
  setPresets(presets: ProbePreset[]) { this.presets = presets; }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Same controls as the simulator's heart pane: left drag turns it, wheel zooms. The probe's own drag is handled in bindPointer. */
  private initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.enablePan = false; this.controls.minDistance = 220; this.controls.maxDistance = 900;
    this.controls.target.copy(this.centre); this.controls.update();
  }

  /** Where the camera should sit to look square onto a pose's imaging plane from the front, and what it should look at. */
  private framing(p: Pose) {
    const beam = v(p.beam).normalize(), lat = v(p.lateral).normalize();
    const n = beam.clone().cross(lat).normalize(); if (n.z < 0) n.negate();
    const target = v(p.probe).addScaledVector(beam, 70).add(this.centre).multiplyScalar(0.5);
    return { target, camera: target.clone().addScaledVector(n, 480) };
  }

  /** Snap or fly to a calibrated view: the probe glides along the chest while the camera turns to face the plane. */
  goTo(preset: ProbePreset, animate = true) {
    const f = this.framing(preset.pose);
    if (!animate || !this.current) {
      this.anim = null;
      this.setPose(preset.pose);
      this.camera.position.copy(f.camera); this.controls?.target.copy(f.target); this.controls?.update();
      return;
    }
    this.anim = { t0: performance.now(), ms: 520, from: controlsFromPose(this.current), to: preset,
      camFrom: this.camera.position.clone(), camTo: f.camera, tgtFrom: this.controls!.target.clone(), tgtTo: f.target };
  }

  private step(now: number) {
    const a = this.anim; if (!a) return;
    const k = Math.min(1, (now - a.t0) / a.ms), e = k * k * (3 - 2 * k);
    if (k >= 1) {
      this.anim = null;
      this.setPose(a.to.pose);
      this.onPoseChange?.(a.to.pose, a.to.id);
    } else {
      const mix = (p: V3, q: V3): V3 => [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e, p[2] + (q[2] - p[2]) * e];
      const c = a.to.controls, f = a.from;
      const pose = poseFromControls({ yaw: f.yaw + (c.yaw - f.yaw) * e, pitch: f.pitch + (c.pitch - f.pitch) * e, depth: f.depth + (c.depth - f.depth) * e,
        beamLocal: mix(f.beamLocal, c.beamLocal), lateralLocal: mix(f.lateralLocal, c.lateralLocal) });
      this.setPose(pose);
      this.onPoseChange?.(pose, null);
    }
    this.camera.position.lerpVectors(a.camFrom, a.camTo, e);
    this.controls?.target.lerpVectors(a.tgtFrom, a.tgtTo, e);
  }

  /** Draw the probe and sector for a pose. The camera is left where it is (see `goTo`). */
  setPose(p: Pose) {
    this.current = p;
    for (const o of [...this.poseGroup.children]) { this.poseGroup.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    const probe = v(p.probe), beam = v(p.beam).normalize(), lat = v(p.lateral).normalize(), mk = v(p.marker).normalize();
    // Fan: a triangle fan from the probe, spanning +-halfAngle from the beam in the image plane, to `depth`.
    const steps = 32, pts = [probe.clone()];
    for (let i = 0; i <= steps; i++) {
      const a = -SECTOR.halfAngle + (2 * SECTOR.halfAngle * i) / steps;
      pts.push(probe.clone().addScaledVector(beam, Math.cos(a) * p.depth).addScaledVector(lat, Math.sin(a) * p.depth));
    }
    const idx: number[] = []; for (let i = 1; i <= steps; i++) idx.push(0, i, i + 1);
    const fan = new THREE.BufferGeometry().setFromPoints(pts); fan.setIndex(idx);
    const fanMesh = new THREE.Mesh(fan, new THREE.MeshBasicMaterial({ color: 0x35d0c8, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    fanMesh.renderOrder = 2;
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts.slice(1), probe, pts[1]]), new THREE.LineBasicMaterial({ color: 0x35d0c8 }));
    edge.renderOrder = 3;
    // Probe: a block whose long side runs along the beam, with a bright dot on the index-mark side.
    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 34), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 }));
    body.setRotationFromMatrix(new THREE.Matrix4().makeBasis(lat, beam.clone().cross(lat).normalize(), beam));
    body.position.copy(probe).addScaledVector(beam, -17);
    body.name = "probe-body";
    const mark = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4d }));
    mark.position.copy(probe).addScaledVector(beam, -3).addScaledVector(mk, 10);
    const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([probe.clone().addScaledVector(beam, -34), probe.clone().addScaledVector(beam, -110)]), new THREE.LineBasicMaterial({ color: 0xf4f1ea }));
    // A fatter invisible handle along the probe, so it is easy to grab at this scale.
    const grab = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 80, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    grab.name = "probe-grab";
    grab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), beam);
    grab.position.copy(probe).addScaledVector(beam, -30);
    this.poseGroup.add(fanMesh, edge, body, mark, cable, grab);
  }

  private setPointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private overProbe(e: PointerEvent | WheelEvent): boolean {
    if (!this.current) return false;
    this.setPointer(e as PointerEvent);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.poseGroup.children.filter((o) => o.name.startsWith("probe-")), false).length > 0;
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    // Capture phase: decide before OrbitControls sees the press, so a press on the probe moves the probe and anything else turns the heart.
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.overProbe(e)) return;
      this.anim = null;
      this.dragging = true;
      this.mode = e.shiftKey ? "tilt" : "slide";
      this.lastY = e.clientY;
      if (this.controls) this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), v(this.current!.probe));
      e.preventDefault(); e.stopPropagation();
    }, true);
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging) { el.style.cursor = this.overProbe(e) ? "grab" : ""; return; }
      if (!this.current) return;
      el.style.cursor = "grabbing";
      let next: Pose;
      if (this.mode === "tilt") {
        next = tiltProbe(this.current, (e.clientY - this.lastY) * 0.006);
        this.lastY = e.clientY;
      } else {
        this.setPointer(e);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.hit)) return;
        next = slideProbe(this.current, projectOntoChest(asV3(this.hit)));
      }
      this.setPose(next);
      this.onPoseChange?.(next, null);
    });
    const endDrag = (e: PointerEvent) => {
      if (!this.dragging || !this.current) return;
      this.dragging = false;
      if (this.controls) this.controls.enabled = true;
      el.style.cursor = "";
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const snapped = snapPose(this.current, this.presets);
      this.setPose(snapped.pose);
      this.onPoseChange?.(snapped.pose, snapped.id);
    };
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    // Scroll over the probe rolls the index mark; anywhere else it zooms, as on the simulator.
    el.addEventListener("wheel", (e) => {
      if (!this.overProbe(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const next = twistProbe(this.current!, e.deltaY * 0.004);
      this.setPose(next);
      this.onPoseChange?.(next, null);
    }, { passive: false, capture: true });
  }
}
