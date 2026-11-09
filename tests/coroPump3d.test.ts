// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildCoroPumpMesh, placementFor, coroPumpAnchors, coroPumpLook, type PumpAnchors } from "../src/page/coroPump3d";
import { Part, partAt, heartSdf, unrotateHeart } from "../src/anatomy/heartSurface";
import { COROPUMP_CONSOLE } from "../src/config/devices";
import type { CoroPumpPosition } from "../src/config/devices";
import type { V3 } from "../src/anatomy/curve";

const v3 = (a: V3) => new THREE.Vector3(...a);
const anchors: PumpAnchors = coroPumpAnchors();
const axis = v3(anchors.avCenter).sub(v3(anchors.lvApex)).normalize(); // apex to valve, render frame
/** World position of a named child of the built pump after the placement pose. */
function placed(position: CoroPumpPosition, name: string, model: "2.5" | "CP" | "5.5" = "CP"): THREE.Vector3 {
  const g = buildCoroPumpMesh(model), { pose } = placementFor(position, anchors);
  g.updateMatrixWorld(true);
  const c = g.getObjectByName(name)!;
  return c.getWorldPosition(new THREE.Vector3()).applyMatrix4(pose);
}
const above = (p: THREE.Vector3) => p.clone().sub(v3(anchors.avCenter)).dot(axis); // mm above the valve plane along the long axis
const inHeartFrame = (p: THREE.Vector3): V3 => unrotateHeart([p.x, p.y, p.z]);

describe("buildCoroPumpMesh", () => {
  it("builds pigtail tip, inlet cage, motor housing, outlet and catheter", () => {
    const g = buildCoroPumpMesh("CP");
    for (const n of ["pigtail", "inlet", "motor", "outlet", "catheter"]) expect(g.getObjectByName(n), n).toBeTruthy();
  });
  it("makes the 2.5 thinner than the 5.5", () => {
    const width = (m: "2.5" | "5.5") => new THREE.Box3().setFromObject(buildCoroPumpMesh(m).getObjectByName("motor")!).getSize(new THREE.Vector3()).x;
    expect(width("2.5")).toBeLessThan(width("5.5"));
  });
  it("is neutral gray with no emissive glow", () => {
    buildCoroPumpMesh("CP").traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m) return;
      expect(m.emissiveIntensity === 0 || m.emissive.getHex() === 0).toBe(true);
      const c = m.color; expect(Math.abs(c.r - c.g) + Math.abs(c.g - c.b)).toBeLessThan(0.02);
    });
  });
});

describe("placementFor", () => {
  it("correct places the inlet inside the LV and the outlet above the valve", () => {
    const inlet = placed("correct", "inlet"), outlet = placed("correct", "outlet");
    expect(partAt(inHeartFrame(inlet))).toBe(Part.LV);
    expect(heartSdf(inHeartFrame(inlet))).toBeLessThan(0);
    expect(above(inlet)).toBeLessThan(-20);
    expect(above(outlet)).toBeGreaterThan(0);
  });
  it("aortic places the inlet above the valve", () => {
    expect(above(placed("aortic", "inlet"))).toBeGreaterThan(0);
  });
  it("deep places the inlet within 5 mm of the apical wall", () => {
    expect(placed("deep", "inlet").distanceTo(v3(anchors.lvApex))).toBeLessThanOrEqual(5);
    expect(above(placed("deep", "outlet"))).toBeLessThan(0); // pushed in: the outlet stays in the ventricle
  });
});

describe("coroPumpLook", () => {
  const r = (o: object) => ({ on: true, suctionLevel: 0, ...o });
  it("is hidden when the pump is off or there is no pump", () => {
    expect(coroPumpLook(r({ on: false }), false).visible).toBe(false);
    expect(coroPumpLook(null, false).visible).toBe(false);
  });
  it("is gray while suction is at or below the alarm level and amber above it", () => {
    expect(coroPumpLook(r({ suctionLevel: COROPUMP_CONSOLE.alarmLevel }), false)).toMatchObject({ visible: true, amber: false });
    expect(coroPumpLook(r({ suctionLevel: COROPUMP_CONSOLE.alarmLevel + 0.01 }), false)).toMatchObject({ visible: true, amber: true });
  });
  it("not drawn while document.body has the case-no-3d class", () => {
    const body = { classList: { contains: (c: string) => c === "case-no-3d" } } as unknown as HTMLElement;
    expect(coroPumpLook(r({}), stageHidden(body)).visible).toBe(false);
  });
});
import { stageHidden } from "../src/page/coroPump3d";
