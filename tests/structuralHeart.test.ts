import { describe, it, expect } from "vitest";
import { heartSdf, heartSdfMorph, HeartMorph, meshHeart, meshVolumeMl, MorphPart, partsMorph, SurfaceMesh, unrotateHeart } from "../src/anatomy/heartSurface";
import { rotateHeart } from "../src/anatomy/tree";
import { V3 } from "../src/anatomy/curve";
import { assess, LESIONS } from "../src/sim/structural";
import { analyze } from "../src/physics/structural";
import { morphFor, quantize, satMap, tubeRadius } from "../src/structural/morph";

/** Number of separate pieces of a mesh: a vessel that does not touch the heart is a floating piece. */
function components(m: SurfaceMesh): number {
  const n = m.positions.length / 3, par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < m.indices.length; t += 3) { const a = find(m.indices[t]); par[find(m.indices[t + 1])] = a; par[find(m.indices[t + 2])] = find(a); }
  return new Set(Array.from({ length: n }, (_, i) => find(i))).size;
}
const present = (m: SurfaceMesh) => new Set<number>(Array.from(m.parts));
const STEP = 2.4;
/** Edges used by only one triangle: a closed surface has none. */
function openEdges(m: SurfaceMesh): number {
  const seen = new Map<number, number>(), n = m.positions.length / 3;
  for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)], key = Math.min(a, b) * n + Math.max(a, b);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let open = 0; for (const c of seen.values()) if (c === 1) open++;
  return open;
}
/** Distance from a point to the nearest part of a polyline's surface, via the engine's own SDF restricted to one part. */
const surface = (p: V3, m: HeartMorph, part: MorphPart) => partsMorph(p, m)[part];

describe("morphed heart", () => {
  it("with no morph the coronary-view heart is untouched, and a morph with no great vessels is the same heart", () => {
    // (the arch of the morphed heart is taller than the coronary views', so only the chambers and the root are compared)
    for (const p of [[20, -10, -5], [-25, 0, 20], [-28, 55, -4], [6, 58, -22], [1, 60, 1], [9, 66, 21], [-27, 26, -31]] as V3[])
      expect(heartSdfMorph(p, {})).toBeCloseTo(heartSdf(p), 6);
  });
  it("adds the pulmonary artery, both venae cavae and the pulmonary veins, in one piece with the heart", () => {
    const m = meshHeart(STEP, undefined, { greatVessels: true });
    for (const part of [MorphPart.PA, MorphPart.SVC, MorphPart.IVC, MorphPart.PV, MorphPart.LV, MorphPart.RV, MorphPart.RA, MorphPart.LA, MorphPart.Aorta]) expect(present(m).has(part)).toBe(true);
    expect(present(m).has(MorphPart.Duct)).toBe(false); expect(present(m).has(MorphPart.BT)).toBe(false);
    expect(components(m)).toBe(1);
  });
  it("draws a ductus or a BT shunt only when asked, attached at both ends", () => {
    for (const cfg of [{ ductRadius: 3.5 }, { btRadius: 3 }, { ductRadius: 2.5, btRadius: 2.5 }] as HeartMorph[]) {
      const m = meshHeart(STEP, undefined, { greatVessels: true, ...cfg });
      expect(present(m).has(MorphPart.Duct)).toBe(!!cfg.ductRadius); expect(present(m).has(MorphPart.BT)).toBe(!!cfg.btRadius);
      expect(components(m)).toBe(1);
    }
  });
  it("leaves the pulmonary artery or veins out at scale 0 and thins the artery below 1", () => {
    expect(present(meshHeart(STEP, undefined, { greatVessels: true, paScale: 0 })).has(MorphPart.PA)).toBe(false);
    expect(present(meshHeart(STEP, undefined, { greatVessels: true, pvScale: 0 })).has(MorphPart.PV)).toBe(false);
    const thin = meshHeart(STEP, undefined, { greatVessels: true, paScale: 0.45 }), full = meshHeart(STEP, undefined, { greatVessels: true });
    expect(meshVolumeMl(thin)).toBeLessThan(meshVolumeMl(full)); expect(components(thin)).toBe(1);
  });
  it("a bigger right atrium and a smaller ventricular mass change the volume the way the scales say", () => {
    const base = meshVolumeMl(meshHeart(STEP, undefined, { greatVessels: true }));
    expect(meshVolumeMl(meshHeart(STEP, undefined, { greatVessels: true, raScale: 1.8 }))).toBeGreaterThan(base + 8);
    expect(meshVolumeMl(meshHeart(STEP, undefined, { greatVessels: true, ventricleScale: 0.8 }))).toBeLessThan(base - 40);
  });
});

describe("the page's meshes", () => {
  const morphs: Record<string, HeartMorph> = {
    plain: { greatVessels: true }, tubes: { greatVessels: true, ductRadius: 3.5, btRadius: 4.95, paScale: 0.45 },
    big: { greatVessels: true, ventricleScale: 1.6, raScale: 1.6, laScale: 2, aortaScale: 1.4 }, small: { greatVessels: true, ventricleScale: 0.7, rvBulge: 0.3 },
  };
  for (const [name, cfg] of Object.entries(morphs)) for (const step of [2.8, 1.6]) it(`${name} at ${step} mm is one closed surface (no open ends, even when the heart grows)`, () => {
    const m = meshHeart(step, undefined, cfg);
    expect(openEdges(m)).toBe(0); expect(components(m)).toBe(1);
  }, 20000);
  it("the default heart is the one the simulator has always drawn", () => {
    const m = meshHeart(2.8);
    let h = 0; for (let i = 0; i < m.positions.length; i++) h = (h * 31 + Math.round(m.positions[i] * 100)) | 0;
    expect([m.positions.length / 3, m.indices.length, +meshVolumeMl(m).toFixed(3), h]).toEqual([7327, 43968, 455.558, 450692086]);
  });
  it("the BT shunt and the ductus each end inside the vessel they are meant to join, however thin the pulmonary artery (patient-frame points)", () => {
    const H = unrotateHeart;
    for (const pa of [1, 0.45]) {
      const cfg: HeartMorph = { greatVessels: true, paScale: pa, btRadius: tubeRadius(3.5), ductRadius: tubeRadius(3.5) };
      expect(surface(H([-46, 52, -70]), cfg, MorphPart.PA)).toBeLessThan(0); // the BT shunt's pulmonary end is on the right pulmonary artery's centreline
      expect(surface(H([-46, 52, -70]), cfg, MorphPart.BT)).toBeLessThan(0);
      expect(surface(H([-38, 70, -54]), cfg, MorphPart.BT)).toBeLessThan(0); expect(surface(H([-38, 70, -54]), cfg, MorphPart.Aorta)).toBeLessThan(0); // and its other end is in the arch
      expect(surface(H([4, 58, -56]), cfg, MorphPart.Duct)).toBeLessThan(0); expect(surface(H([4, 58, -56]), cfg, MorphPart.PA)).toBeLessThan(2); // the duct starts on the left pulmonary artery
      expect(surface(H([-16, 56, -80]), cfg, MorphPart.Duct)).toBeLessThan(0); expect(surface(H([-16, 56, -80]), cfg, MorphPart.DAO)).toBeLessThan(0); // and ends in the descending aorta
    }
  });
  it("the vessels sit where they do in a patient: arch above the pulmonary bifurcation, right pulmonary artery behind the ascending aorta, duct from the left pulmonary artery back to the aorta, venae cavae upright", () => {
    const cfg: HeartMorph = { greatVessels: true, ductRadius: 3 };
    const inside = (part: MorphPart, patient: V3) => surface(unrotateHeart(patient), cfg, part) < 0;
    expect(inside(MorphPart.Aorta, [-34, 76, -52])).toBe(true); // top of the arch...
    expect(inside(MorphPart.PA, [-14, 56, -34])).toBe(true); // ...20 mm above the bifurcation
    expect(inside(MorphPart.PA, [-34, 76, -52])).toBe(false);
    expect(inside(MorphPart.PA, [-46, 52, -70])).toBe(true); expect(inside(MorphPart.Aorta, [-46, 52, -70])).toBe(false); // right pulmonary artery behind and below the aorta
    expect(inside(MorphPart.SVC, [-56, 70, -26])).toBe(true); expect(inside(MorphPart.IVC, [-55, -20, -29])).toBe(true); // straight up and straight down
    expect(rotateHeart(unrotateHeart([-38, 62, -42])).map(Math.round)).toEqual([-38, 62, -42]);
  });
  it("keeps the right pulmonary veins attached to the left atrium and clear of an enlarged right atrium", () => {
    for (const ra of [1, 1.3, 1.6]) {
      const cfg: HeartMorph = { greatVessels: true, raScale: ra }, root = unrotateHeart([-25, 30, -46]);
      expect(partsMorph(root, cfg)[MorphPart.LA]).toBeLessThan(0); // the end on the left atrium does not move
      const far = unrotateHeart([-58 - 6 * (ra - 1), 40, -66 - 12 * (ra - 1)]); // the free end of the upper right vein, moved back with the atrium
      expect(partsMorph(far, cfg)[MorphPart.PV]).toBeLessThan(0); expect(partsMorph(far, cfg)[MorphPart.RA]).toBeGreaterThan(0);
    }
  });
  it("a small right ventricle is drawn small: its free wall comes in toward the septum", () => {
    const free = unrotateHeart([-45, 5, 8]); // a point on the right ventricular free wall region
    const normal = heartSdfMorph(free, { greatVessels: true }), small = heartSdfMorph(free, { greatVessels: true, rvBulge: 0.4 }), big = heartSdfMorph(free, { greatVessels: true, rvBulge: 1.5 });
    expect(small).toBeGreaterThan(normal + 3); expect(big).toBeLessThan(normal);
    const vol = (cfg: HeartMorph) => meshVolumeMl(meshHeart(3.0, undefined, { greatVessels: true, ...cfg }));
    expect(vol({ rvBulge: 0.4 })).toBeLessThan(vol({}) - 40);
  });
  it("survives degenerate input: non-finite or tiny scales fall back instead of emptying the heart", () => {
    for (const cfg of [{ ventricleScale: NaN }, { raScale: NaN, rvBulge: NaN }, { aortaScale: 0 }, { paScale: NaN, pvScale: NaN, ventricleScale: -2 }] as HeartMorph[]) {
      const m = meshHeart(3.2, undefined, { greatVessels: true, ...cfg });
      expect(m.positions.length).toBeGreaterThan(3000); expect(Array.from(m.positions).every(Number.isFinite)).toBe(true);
    }
  }, 20000);
  it("quantizing a morph leaves it within a step of the original and makes nearby shapes identical", () => {
    const a = quantize({ ventricleScale: 1.073, raScale: 1.31 }), b = quantize({ ventricleScale: 1.079, raScale: 1.32 });
    expect(a).toEqual(b); expect(Math.abs(a.ventricleScale! - 1.073)).toBeLessThan(0.011);
  });
  it("every lesion at its defaults gets a finite morph, a finite colour source for every structure it draws, and a one-piece mesh", () => {
    for (const l of LESIONS) {
      const a = assess(l.id, {}, { waveform: false }), m = morphFor(a.spec, a.report), sat = satMap(a.report);
      for (const v of [m.ventricleScale, m.rvBulge, m.raScale, m.laScale, m.aortaScale, m.paScale]) expect(Number.isFinite(v)).toBe(true);
      expect(sat.DUCT).toBe(a.report.shunt.pda >= 0 ? a.report.saturation.AO : a.report.saturation.PA);
      const mesh = meshHeart(3.0, undefined, m);
      expect([l.id, openEdges(mesh), components(mesh)]).toEqual([l.id, 0, 1]);
    }
  }, 60000);
  it("degenerate reports do not empty the heart", () => {
    const r = analyze({}, { waveform: false }), bad = { ...r, maxVolume: { RA: NaN, LA: NaN, RV: 0, LV: 0 }, qp: NaN };
    const m = morphFor({}, bad);
    for (const v of [m.ventricleScale, m.rvBulge, m.raScale, m.laScale, m.paScale]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("shape from the solved lesion", () => {
  const morph = (id: Parameters<typeof assess>[0], v: Record<string, number> = {}) => { const a = assess(id, v, { waveform: false }); return morphFor(a.spec, a.report); };
  it("a normal heart is drawn at its own scale, adult or newborn", () => {
    for (const patient of ["adult", "neonate"] as const) {
      const spec = { patient }, m = morphFor(spec, analyze(spec, { waveform: false }));
      expect(m.ventricleScale).toBeCloseTo(1, 1); expect(m.raScale).toBeCloseTo(1, 1); expect(m.rvBulge).toBeCloseTo(1, 1); expect(m.aortaScale).toBeCloseTo(1, 1); expect(m.ductRadius).toBe(0);
    }
  });
  it("a small right ventricle is drawn small whatever the left ventricle does, and an overriding or leaking aorta is drawn large", () => {
    expect(morph("pa-ivs", { rv: 0.4, duct: 0, asd: 1 }).rvBulge!).toBeLessThan(0.9);
    expect(morph("tof").aortaScale!).toBeGreaterThan(1.1);
    expect(morph("ar", { severity: 1 }).aortaScale!).toBeGreaterThan(1.15);
  });
  it("Ebstein: a huge right atrium and a small right ventricle", () => {
    const m = morph("ebstein", { severity: 1 });
    expect(m.raScale!).toBeGreaterThan(1.3); expect(m.rvBulge!).toBeLessThan(0.9);
  });
  it("a PDA or BT shunt is drawn as a tube that grows with its size; pulmonary atresia gets a thin pulmonary artery", () => {
    expect(morph("pda", { diameter: 6 }).ductRadius!).toBeGreaterThan(morph("pda", { diameter: 2 }).ductRadius!);
    expect(morph("pda").btRadius).toBe(0);
    expect(morph("pa-vsd", { duct: 0, bt: 3.5 }).btRadius!).toBeGreaterThan(0);
    expect(morph("pa-vsd").paScale!).toBeLessThan(0.6);
    expect(tubeRadius(0)).toBe(0);
  });
  it("a heart loaded with extra pulmonary flow has a wider pulmonary artery, and a left heart loaded by a VSD or PDA a bigger left atrium", () => {
    expect(morph("vsd", { diameter: 7 }).paScale!).toBeGreaterThan(morph("vsd", { diameter: 2 }).paScale!);
    expect(morph("pda", { diameter: 6, pvri: 1.5 }).laScale!).toBeGreaterThan(1.03);
  });
  it("tetralogy: a thin pulmonary artery when the outflow is tight", () => {
    const m = morph("tof");
    expect(m.paScale!).toBeLessThan(0.8);
  });
});
