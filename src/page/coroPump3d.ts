// The CoroPump in the 3D heart: a mesh built from primitives, a pose from its position, and the look from the console readout.
// Pure of the page except `mountCoroPump`, so the geometry and placement are unit tested. Units are mm, as the heart is.
import * as THREE from "three";
import { rotateHeart } from "../anatomy/tree";
import type { V3 } from "../anatomy/curve";
import { COROPUMP_CONSOLE } from "../config/devices";
import type { CoroPumpModelName, CoroPumpPosition } from "../config/devices";

/** Pump local frame: +y runs from the pigtail tip toward the catheter, tip at the origin. Positions along it (mm). [assumed schematic] */
const INLET_Y = 6, OUTLET_Y = INLET_Y + 38, MOTOR_Y = OUTLET_Y + 14, CATHETER_Y = MOTOR_Y + 12;
/** Housing diameter (mm) per model: 12 F, 14 F, 19 F class. */
const MOTOR_D: Record<CoroPumpModelName, number> = { "2.5": 4, CP: 4.7, "5.5": 6.3 };
const GRAY = 0x8a8a86, DARK = 0x4a4a47, AMBER = 0xe0a447;

const mat = (hex: number) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.2, emissive: 0x000000, emissiveIntensity: 0 });
const named = <T extends THREE.Object3D>(o: T, name: string, y: number): T => { o.name = name; o.position.y = y; return o; };

/** The pump as a group: pigtail tip, inlet cage, cannula, outlet ports, motor housing and catheter, tip at the origin, axis +y. */
export function buildCoroPumpMesh(model: CoroPumpModelName): THREE.Group {
  const d = MOTOR_D[model], g = new THREE.Group(); g.name = "coroPump";
  const body = mat(GRAY), dark = mat(DARK);
  const pigtail = named(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.45, 8, 20, Math.PI * 1.5), dark), "pigtail", 2.6);
  pigtail.rotation.set(0, 0, Math.PI / 2);
  const inlet = named(new THREE.Mesh(new THREE.CylinderGeometry(d * 0.5, d * 0.5, 9, 14, 1, true), dark), "inlet", INLET_Y); // slotted cage, drawn open
  const cannula = named(new THREE.Mesh(new THREE.CylinderGeometry(d * 0.42, d * 0.42, OUTLET_Y - INLET_Y, 14), body), "cannula", (INLET_Y + OUTLET_Y) / 2);
  const outlet = named(new THREE.Mesh(new THREE.CylinderGeometry(d * 0.5, d * 0.5, 7, 14, 1, true), dark), "outlet", OUTLET_Y);
  const motor = named(new THREE.Mesh(new THREE.CylinderGeometry(d * 0.5, d * 0.5, 14, 18), body), "motor", MOTOR_Y);
  const catheter = named(new THREE.Mesh(new THREE.CylinderGeometry(d * 0.3, d * 0.3, 60, 10), body), "catheter", CATHETER_Y + 30);
  g.add(pigtail, inlet, cannula, outlet, motor, catheter);
  return g;
}

/** Fixed points of the anatomy, patient (render) frame, mm. `descAorta` is where the catheter leaves the heart's picture. */
export interface PumpAnchors { avCenter: V3; lvApex: V3; descAorta: V3 }
/** Aortic valve center, the inner apical wall of the LV and the start of the descending aorta, from the heart's own layout (heart frame, rotated). */
export function coroPumpAnchors(): PumpAnchors {
  return { avCenter: rotateHeart([8, 46, 0]), lvApex: rotateHeart([8, -56, 0]), descAorta: rotateHeart([30, 76, -45]) };
}

const V = (a: V3) => new THREE.Vector3(...a);
/** Where the pump's tip goes and which way it points, for each position (the pose is the group's matrix). */
export function placementFor(position: CoroPumpPosition, anchors: PumpAnchors): { pose: THREE.Matrix4 } {
  const apex = V(anchors.lvApex), av = V(anchors.avCenter), axis = av.clone().sub(apex).normalize();
  // distance of the inlet along the axis, from the valve plane (negative: in the LV)
  const inletFromValve = position === "correct" ? -35 : position === "aortic" ? 4 : av.clone().sub(apex).length() * -1 + 4; // deep: 4 mm off the apical wall
  const inlet = av.clone().addScaledVector(axis, inletFromValve);
  const tip = inlet.addScaledVector(axis, -INLET_Y);
  const pose = new THREE.Matrix4().compose(tip, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis), new THREE.Vector3(1, 1, 1));
  return { pose };
}

/** The 3D stage is hidden in a running case (and its debrief); the pump is a free-play view. */
export function stageHidden(body: Pick<HTMLElement, "classList">): boolean {
  return body.classList.contains("case-no-3d") || body.classList.contains("case-bare");
}
/** What to draw: visible only for a running pump on a shown stage; amber only while suction is above the console's alarm level. */
export function coroPumpLook(r: { on: boolean; suctionLevel: number } | null, hiddenStage: boolean): { visible: boolean; amber: boolean } {
  const visible = !!r && r.on && !hiddenStage;
  return { visible, amber: visible && r!.suctionLevel > COROPUMP_CONSOLE.alarmLevel };
}

// ---------------------------------------------------------------- mounting (page only)
export interface CoroPumpMount { update(r: { on: boolean; model: string; position: string; suctionLevel: number } | null): void }
/** Hang the pump from `parent` (the heart-frame group); `update` rebuilds only when the model changes and re-poses only when the position does. */
export function mountCoroPump(parent: THREE.Object3D, body: Pick<HTMLElement, "classList"> = document.body): CoroPumpMount {
  const anchors = coroPumpAnchors();
  let model: string | null = null, position: string | null = null, group: THREE.Group | null = null, amber: boolean | null = null;
  return {
    update(r) {
      const look = coroPumpLook(r, stageHidden(body));
      if (!look.visible) { if (group) group.visible = false; return; }
      if (r!.model !== model) {
        if (group) { parent.remove(group); group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); }
        group = buildCoroPumpMesh(r!.model as CoroPumpModelName); parent.add(group); model = r!.model; position = null; amber = null;
      }
      group!.visible = true;
      if (r!.position !== position) {
        position = r!.position;
        group!.matrixAutoUpdate = false; group!.matrix.copy(placementFor(position as CoroPumpPosition, anchors).pose); group!.matrixWorldNeedsUpdate = true;
      }
      if (look.amber !== amber) {
        amber = look.amber; const motor = group!.getObjectByName("motor") as THREE.Mesh, cannula = group!.getObjectByName("cannula") as THREE.Mesh;
        for (const m of [motor, cannula]) (m.material as THREE.MeshStandardMaterial).color.setHex(amber ? AMBER : GRAY);
      }
    },
  };
}
