import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { V3 } from "../anatomy/curve";
import { meshHeart, Part } from "../anatomy/heartSurface";
import { rotateHeart } from "../anatomy/tree";
import { Pose, SECTOR, toPatient } from "./poses";

/**
 * The simulator's own 3D heart (the same surface the main page draws) as a translucent shell, the probe, and the imaging sector as a fan
 * in the probe's plane. Everything is in the patient frame (x left, y up, z anterior), mm, so the scene needs no axis swap.
 */
const PART_COLOR: Record<Part, number> = { [Part.LV]: 0xb24a3f, [Part.RV]: 0x4f7fb5, [Part.RA]: 0x7aa6d4, [Part.LA]: 0xd98a6e, [Part.Aorta]: 0xe3b35c };
const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

export class EchoScene {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  private controls?: OrbitControls;
  private pose = new THREE.Group();
  private centre: THREE.Vector3;

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
    this.scene.add(heart, new THREE.AmbientLight(0xffffff, 0.3), key, this.pose);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.frame(this.centre, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 460);
    this.renderer.setAnimationLoop(() => { this.controls?.update(); this.renderer.render(this.scene, this.camera); });
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame(target: THREE.Vector3, from: THREE.Vector3, up: THREE.Vector3, distance: number) {
    this.controls?.dispose();
    this.camera.up.copy(up);
    this.camera.position.copy(target).addScaledVector(from, distance);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.enablePan = false; this.controls.minDistance = 220; this.controls.maxDistance = 900;
    this.controls.target.copy(target); this.controls.update();
  }

  /** Draw the probe and sector for a pose and square the camera onto the imaging plane; null shows the bare heart from the front. */
  setPose(p: Pose) {
    for (const o of [...this.pose.children]) { this.pose.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
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
    const mark = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4d }));
    mark.position.copy(probe).addScaledVector(beam, -3).addScaledVector(mk, 10);
    const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([probe.clone().addScaledVector(beam, -34), probe.clone().addScaledVector(beam, -110)]), new THREE.LineBasicMaterial({ color: 0xf4f1ea }));
    this.pose.add(fanMesh, edge, body, mark, cable);
    // Camera square onto the imaging plane, probe at the top as on the screen of the machine, the anterior face of the plane toward us.
    const n = beam.clone().cross(lat).normalize(); if (n.z < 0) n.negate();
    // Aim between the middle of the sector and the heart's centre, so the heart and the fan both fit.
    this.frame(probe.clone().addScaledVector(beam, 70).add(this.centre).multiplyScalar(0.5), n, beam.clone().negate(), 480);
  }
}
