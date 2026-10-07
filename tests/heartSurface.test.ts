import { describe, it, expect } from "vitest";
import { heartSdf, meshHeart, meshVolumeMl, partAt, Part, projectToEpicardium, ventricles, latitude, AV_GROOVE_LAT } from "../src/anatomy/heartSurface";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { HEART } from "../src/config/tree";
import { V3 } from "../src/anatomy/curve";

const mesh = meshHeart();

describe("external cardiac anatomy", () => {
  it("contains every chamber and the aorta at its expected location", () => {
    const cases: [V3, Part][] = [
      [[20, -10, -5], Part.LV], [[-25, 0, 20], Part.RV], [[-28, 55, -4], Part.RA], [[6, 58, -22], Part.LA], [[1, 70, 1], Part.Aorta],
    ];
    for (const [p, part] of cases) { expect(heartSdf(p)).toBeLessThan(0); expect(partAt(p)).toBe(part); }
  });
  it("leaves out the pulmonary vessels and venae cavae, which would hide the coronaries", () => {
    for (const p of [[9, 66, 21], [26, 82, -4], [-24, 84, -7], [-27, 26, -31], [32, 64, -31]] as V3[]) expect(heartSdf(p)).toBeGreaterThan(0);
  });
  it("has both appendages: right anterior to the root, left on the left side", () => {
    expect(heartSdf([-20, 61, 15])).toBeLessThan(0);
    expect(heartSdf([27, 59, 3])).toBeLessThan(0);
  });
  it("closes the aorta with a rounded end inside the meshed region (no clipped opening)", () => {
    expect(heartSdf([30, 76, -45])).toBeLessThan(0);
    expect(heartSdf([30, 76, -72])).toBeGreaterThan(0);
  });
  it("cuts grooves into the ventricles where the arteries run", () => {
    const { a: A, b: B, c: C } = HEART.radii;
    const onEllipsoid = (l: number, p: number): V3 => [A * Math.cos(p) * Math.sin(l), B * Math.sin(p), C * Math.cos(p) * Math.cos(l)];
    // AV groove (RCA course, right side) and anterior interventricular groove (LAD course)
    expect(ventricles(onEllipsoid(-1.5, AV_GROOVE_LAT))).toBeGreaterThan(2);
    expect(ventricles(onEllipsoid(0.28, 0.0))).toBeGreaterThan(1.5);
    // free wall away from any groove stays close to the reference surface
    expect(Math.abs(ventricles(onEllipsoid(1.4, 0.1)))).toBeLessThan(1.5);
    expect(latitude([0, 0, 0])).toBe(0);
  });
  it("tapers to an apex well below the base", () => {
    expect(heartSdf([0, -70, 0])).toBeGreaterThan(0);
    expect(heartSdf([0, -55, 4])).toBeLessThan(0);
  });
});

describe("surface mesh", () => {
  it("sits on the implicit surface (every vertex within 0.3 mm)", () => {
    for (let v = 0; v < mesh.positions.length; v += 3) expect(Math.abs(heartSdf([mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]))).toBeLessThan(0.3);
  });
  it("is closed and outward-facing with an adult-heart-sized volume", () => {
    const edges = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t + e], b = mesh.indices[t + ((e + 1) % 3)], k = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    const odd = [...edges.values()].filter((c) => c !== 2).length;
    expect(odd / edges.size).toBeLessThan(0.001); // surface nets can pinch at a few thin junctions
    const ml = meshVolumeMl(mesh);
    expect(ml).toBeGreaterThan(350); expect(ml).toBeLessThan(1000);
  });
  it("labels a substantial area for every structure", () => {
    const counts = new Array(5).fill(0);
    mesh.parts.forEach((p) => counts[p]++);
    for (const c of counts) expect(c).toBeGreaterThan(500);
  });
});

describe("coronaries on the new surface", () => {
  it("projected arteries lie on the ventricular epicardium, offset by the requested height", () => {
    const t = buildTree(TYPICAL);
    for (const seg of t.segments) {
      if (seg.id === "LM") continue;
      const from = seg.parent ? 0 : Math.floor(seg.heartSamples.length * 0.3);
      for (const p of seg.heartSamples.slice(from)) {
        if (p[1] > 46) continue; // ostial stretch near the aortic root blends off the wall by design
        // inside a concave groove the far wall curves toward the lifted point, so allow 0.5 mm
        expect(Math.abs(ventricles(projectToEpicardium(p, 0.6).pos) - 0.6)).toBeLessThan(0.5);
      }
    }
  });
});
