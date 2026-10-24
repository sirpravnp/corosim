import { describe, it, expect } from "vitest";
import { dirToScene, heartToScene, propsForPatient, propsToScene, sceneToHeart } from "../src/sim/simProps";
import { rotateHeart } from "../src/anatomy/tree";
import { heartSdfMorph } from "../src/anatomy/heartSurface";
import type { V3 } from "../src/anatomy/curve";
import type { PatientSpec } from "../src/sim/patient";

const vsd: PatientSpec = { kind: "adult", heart: { vsd: { diameterMm: 8 } } };
const severeAs: PatientSpec = { kind: "adult", heart: { valves: { av: { open: 0.2 } } } };
const tris = (t: { indices: number[] }) => t.indices.length / 3;
const av = (p: PatientSpec | undefined) => propsForPatient(p).props.valves.find((v) => v.name === "AV")!;

describe("spec to props for the simulator's heart", () => {
  it("a normal heart (no heart section) has valve annuli, no jets, no holes", () => {
    const { props } = propsForPatient({ kind: "adult" });
    expect(props.valves.map((v) => v.name).sort()).toEqual(["AV", "MV", "PVL", "TV"]);
    for (const v of props.valves) { expect(v.open).toBe(1); expect(tris(v.tri)).toBeGreaterThan(0); }
    expect(props.jets).toEqual([]);
    expect(tris(props.septum)).toBeGreaterThan(100);
    expect(propsForPatient(undefined).props.jets).toEqual([]);
  });
  it("a VSD cuts a hole in the septum and has a jet across it", () => {
    const n = propsForPatient({ kind: "adult" }).props, { props } = propsForPatient(vsd);
    expect(tris(props.septum)).toBeLessThan(tris(n.septum));
    const jet = props.jets.find((j) => j.label === "VSD jet")!;
    expect(jet).toBeTruthy();
    expect(jet.node).toBe("LV"); // adult: left to right
    expect(heartSdfMorph(jet.from, {})).toBeLessThan(0.5); // starts inside the drawn heart
  });
  it("severe aortic stenosis narrows the aortic annulus's opening and gives a stenosis jet, the other valves unchanged", () => {
    const normal = av({ kind: "adult" }), sev = av(severeAs), n = propsForPatient({ kind: "adult" }).props, s = propsForPatient(severeAs).props;
    expect(normal.open).toBe(1);
    expect(sev.open).toBeLessThan(0.5);
    expect(tris(sev.tri)).toBeGreaterThan(tris(normal.tri)); // leaflets fill the rest of the ring
    expect(s.jets.some((j) => j.label === "Aortic stenosis jet")).toBe(true);
    for (const name of ["MV", "TV", "PVL"] as const) expect(s.valves.find((v) => v.name === name)!.open).toBe(n.valves.find((v) => v.name === name)!.open);
  });
});

describe("heart frame to the simulator's scene", () => {
  const pts: V3[] = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10], [-27, 54, -6], [7, 47, 0]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  it("is the rotation the heart mesh itself gets, and it inverts", () => {
    for (const p of pts) {
      expect(heartToScene(p)).toEqual(rotateHeart(p));
      const b = sceneToHeart(heartToScene(p));
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(p[i], 9);
    }
  });
  it("keeps lengths and angles (a rotation: no scale, no translation), so a direction maps like a point", () => {
    expect(heartToScene([0, 0, 0])).toEqual([0, 0, 0]);
    const a: V3 = [3, 4, 5], b: V3 = [-1, 2, 7];
    expect(dot(dirToScene(a), dirToScene(b))).toBeCloseTo(dot(a, b), 9);
    expect(Math.hypot(...dirToScene(a))).toBeCloseTo(Math.hypot(...a), 9);
  });
  it("the heart's base axis (+y) stays mostly up in the scene but is tilted, as the mesh's is", () => {
    const up = heartToScene([0, 1, 0]);
    expect(up[1]).toBeGreaterThan(0.5);
    expect(up[1]).toBeLessThan(0.999);
  });
  it("propsToScene moves every prop point with the mesh's rotation and leaves indices, labels and lengths alone", () => {
    const { props } = propsForPatient(vsd), s = propsToScene(props);
    expect(s.septum.indices).toEqual(props.septum.indices);
    const i = 3 * Math.floor(props.septum.positions.length / 6), p: V3 = [props.septum.positions[i], props.septum.positions[i + 1], props.septum.positions[i + 2]];
    expect([s.septum.positions[i], s.septum.positions[i + 1], s.septum.positions[i + 2]]).toEqual(rotateHeart(p));
    expect(s.jets.map((j) => j.label)).toEqual(props.jets.map((j) => j.label));
    expect(s.jets[0].dir).toEqual(rotateHeart(props.jets[0].dir));
    expect(s.jets[0].length).toBe(props.jets[0].length);
    expect(s.valves[0].center).toEqual(rotateHeart(props.valves[0].center));
  });
});
