// The three.js scene of the 3D view: renderer, camera, orbit controls, lights and the group every heart-frame object hangs from.
// ---------------------------------------------------------------- renderer
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SimPropsView } from "../sim/propsView";
import { $ } from "./state";

export const view = $("view");
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.prepend(renderer.domElement);
export const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
export const camera = new THREE.PerspectiveCamera(34, 1, 1, 3000);
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Camera targets the middle of the whole heart, ventricles to great vessels.
const TARGET = new THREE.Vector3(-6, 14, -4);
export const VIEWS: Record<string, [number, number, number]> = {
  vAnt: [0, 30, 330], vLeft: [320, 25, 10], vPost: [0, 30, -330], vInf: [20, -320, 90], vRight: [-320, 25, 10],
};
export const setView = (id: string) => { camera.position.set(...VIEWS[id]).add(TARGET); controls.target.copy(TARGET); for (const k in VIEWS) $(k).classList.toggle("on", k === id); };
export const key = new THREE.DirectionalLight(0xfff4ea, 1.6); key.position.set(120, 160, 220); scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5); fill.position.set(-180, -40, 120); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-60, 90, -220); scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

export const heartGroup = new THREE.Group(); scene.add(heartGroup);
export const propsView = new SimPropsView(heartGroup); // built when the toggle is first on, for the patient of a shared link
/** One raycaster for the whole view: picking (controls.ts) and the marker occlusion probe (markers.ts). */
export const ray = new THREE.Raycaster();

export function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view);
