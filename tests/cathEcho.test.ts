import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ID, NSEG, SEG17, isSegment } from "../src/cath/echo/ids";
import { heartBytes, indexHeart, regionCounts, type Heart, type HeartMeta } from "../src/cath/echo/volume";
import { VIEW_COUNT, buildViews, type View } from "../src/cath/echo/views";
import { centroid, idCounts, sliceGrid, sliceHeart } from "../src/cath/echo/slice";
import { DIASTOLE, beatClockFromSim, cycleAt, motionField, normalMotion } from "../src/cath/echo/motion";
import { labelPlacements, makeTextures, shade } from "../src/cath/echo/render";
import { echoModel } from "../src/sim/cath";
import { Simulation } from "../src/sim/simulation";

const dir = new URL("../src/cath/data/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("heart.json", dir), "utf8")) as HeartMeta;
const raw = new Uint8Array(gunzipSync(readFileSync(new URL("heart.bin.gz", dir))));
let heart: Heart, views: View[];
beforeAll(() => { heart = indexHeart(raw, meta); views = buildViews(heart); });

const settled = (sc: object) => { const s = new Simulation({ ...sc, seed: 7 }); s.reset({ ...sc, seed: 7 }, { settled: true }); return s; };
const seg = (name: string) => SEG17.indexOf(name);

describe("heart volume", () => {
  it("has the size heart.json says, and refuses a file of another size", () => {
    expect(raw.length).toBe(heartBytes(meta.shape));
    expect(() => indexHeart(raw.subarray(0, raw.length - 1), meta)).toThrow();
  });
  it("holds every chamber, valve plane, wall and all 17 segments", () => {
    const c = regionCounts(heart);
    for (const id of [ID.LV, ID.RV, ID.RA, ID.LA, ID.AOROOT, ID.PA, ID.MV, ID.AV, ID.TV, ID.PV, ID.IAS, ID.RVW, ID.LAW, ID.RAW, ID.AOW, ID.PERI, ID.VW]) expect(c.get(id) ?? 0, `id ${id}`).toBeGreaterThan(500);
    for (let i = 0; i < NSEG; i++) expect(c.get(ID.SEG + i) ?? 0, SEG17[i]).toBeGreaterThan(1000);
  });
  it("puts the valve centres, vessel openings and apex inside the grid, valve axes unit length", () => {
    for (const [k, v] of Object.entries(meta.valves)) { expect(heart.index(...v.c), k).toBeGreaterThanOrEqual(0); expect(Math.abs(v.n[0] ** 2 + v.n[1] ** 2 + v.n[2] ** 2 - 1), k).toBeLessThan(1e-6); }
    for (const [k, o] of Object.entries(meta.ostia)) expect(heart.index(...o.c), k).toBeGreaterThanOrEqual(0);
    expect(heart.index(...meta.lv_apex_cm)).toBeGreaterThanOrEqual(0);
    for (const k of ["LV", "RV", "RA", "LA"] as const) expect(heart.index(...meta.centroids[k]), k).toBeGreaterThanOrEqual(0);
  });
  it("has an LV cavity volume and wall mass in the human range", () => {
    const c = regionCounts(heart), mlPerVoxel = 0.001; // 1 mm³
    const edv = (c.get(ID.LV) ?? 0) * mlPerVoxel;
    let wall = 0; for (let i = 0; i < NSEG; i++) wall += c.get(ID.SEG + i) ?? 0;
    const massG = wall * mlPerVoxel * 1.05;
    expect(edv).toBeGreaterThan(90); expect(edv).toBeLessThan(220);
    expect(massG).toBeGreaterThan(90); expect(massG).toBeLessThan(220);
  });
  it("keeps the right heart to the patient's right of the left heart", () => {
    const L = meta.centroids;
    expect(L.RV[0]).toBeLessThan(L.LV[0]); expect(L.RA[0]).toBeLessThan(L.LA[0]);
  });
});

describe("views", () => {
  it("are the 23 standard ones, with unique ids and names and teaching text", () => {
    expect(views.length).toBe(VIEW_COUNT);
    expect(new Set(views.map((v) => v.id)).size).toBe(VIEW_COUNT);
    expect(new Set(views.map((v) => v.name)).size).toBe(VIEW_COUNT);
    for (const v of views) { expect(v.purpose.length, v.id).toBeGreaterThan(10); expect(v.expects.length, v.id).toBeGreaterThan(0); expect(v.depth).toBeGreaterThan(5); }
    expect(views.filter((v) => v.group === "ME").length).toBe(12);
    expect(views.filter((v) => v.group === "TG").length).toBe(6);
  });
  it("every view shows the structures it is for", () => {
    for (const v of views) {
      const counts = idCounts(sliceHeart(heart, sliceGrid(v, v.ang, 300, 300)));
      for (const id of v.expects) expect(counts.get(id) ?? 0, `${v.id} should show id ${id}`).toBeGreaterThan(30);
    }
  });
  it("four-chamber: LV, RV, LA, RA, both AV valves and the septum, with the right heart image-left", () => {
    const v = views.find((x) => x.id === "me-4ch")!, s = sliceHeart(heart, sliceGrid(v, v.ang, 400, 400));
    const at = (...ids: number[]) => centroid(s, ...ids)!;
    for (const id of [ID.LV, ID.RV, ID.LA, ID.RA, ID.MV, ID.TV]) expect(at(id), `id ${id}`).not.toBeNull();
    expect(at(ID.RV).x).toBeLessThan(at(ID.LV).x);
    expect(at(ID.RA).x).toBeLessThan(at(ID.LA).x);
    expect(at(ID.TV).x).toBeLessThan(at(ID.MV).x);
    expect(at(ID.LV).y).toBeGreaterThan(at(ID.LA).y); // atria on top, near the probe
    expect(at(ID.IAS).x).toBeLessThan(at(ID.LA).x);
    // the septal wall lies between the ventricles
    const septal = at(...[...Array(NSEG).keys()].filter((i) => /septal/.test(SEG17[i])).map((i) => ID.SEG + i));
    expect(septal.x).toBeGreaterThan(at(ID.RV).x); expect(septal.x).toBeLessThan(at(ID.LV).x);
  });
  it("long-axis views show the aortic valve, the root and the LA", () => {
    for (const id of ["me-lax", "me-av-lax", "dtg-lax"]) {
      const v = views.find((x) => x.id === id)!, c = idCounts(sliceHeart(heart, sliceGrid(v, v.ang, 300, 300)));
      expect(c.get(ID.AV) ?? 0, id).toBeGreaterThan(30); expect(c.get(ID.AOROOT) ?? 0, id).toBeGreaterThan(30);
    }
  });
  it("transgastric short-axis: a ring of six basal or six mid segments, septum image-left", () => {
    for (const [id, level] of [["tg-basal", 0], ["tg-mid", 6]] as const) {
      const v = views.find((x) => x.id === id)!, s = sliceHeart(heart, sliceGrid(v, v.ang, 400, 400)), c = idCounts(s);
      const present = [...Array(NSEG).keys()].filter((i) => (c.get(ID.SEG + i) ?? 0) > 150);
      expect(present.sort((a, b) => a - b), id).toEqual([0, 1, 2, 3, 4, 5].map((i) => i + level));
      const sept = centroid(s, ID.SEG + level + 2, ID.SEG + level + 3)!, lat = centroid(s, ID.SEG + level + 0, ID.SEG + level + 5)!;
      expect(sept.x, id).toBeLessThan(lat.x);
    }
  });
  it("the ascending aorta short-axis is a round lumen, the descending a long tube in its long-axis", () => {
    const sax = idCounts(sliceHeart(heart, sliceGrid(views.find((x) => x.id === "me-asc-sax")!, 0, 300, 300)));
    expect(sax.get(ID.ASCAO) ?? 0).toBeGreaterThan(1000);
    const lax = idCounts(sliceHeart(heart, sliceGrid(views.find((x) => x.id === "dao-lax")!, 90, 300, 300)));
    expect(lax.get(ID.DAO) ?? 0).toBeGreaterThan(sax.get(ID.ASCAO) ?? 0);
  });
  it("turning the omniplane changes the cut (four-chamber at 0° and 90° are different views)", () => {
    const v = views.find((x) => x.id === "me-4ch")!;
    const a = idCounts(sliceHeart(heart, sliceGrid(v, 0, 200, 200))), b = idCounts(sliceHeart(heart, sliceGrid(v, 90, 200, 200)));
    expect((a.get(ID.RV) ?? 0)).toBeGreaterThan(5 * (b.get(ID.RV) ?? 0));
  });
  it("cuts 400 x 400 fast enough to animate", () => {
    const v = views.find((x) => x.id === "me-4ch")!, g = sliceGrid(v, 0, 400, 400), m = normalMotion();
    sliceHeart(heart, g, { motion: m });
    const t0 = performance.now(); for (let i = 0; i < 5; i++) sliceHeart(heart, g, { motion: m, cycle: cycleAt({ since: 0.2, rr: 0.8, pvc: false }) });
    expect((performance.now() - t0) / 5).toBeLessThan(120); // about 25 ms on a laptop; loose for shared CI
  });
});

describe("cardiac cycle from the beat stream", () => {
  it("reads the phase of the last beat from the sim's own stream", () => {
    const sim = settled({}); sim.warmup(20);
    const c = beatClockFromSim(sim as never);
    expect(c.since).toBeGreaterThanOrEqual(0); expect(c.since).toBeLessThanOrEqual(c.rr + 1e-9);
    expect(c.rr).toBeGreaterThan(0.4); expect(c.rr).toBeLessThan(1.5);
    const before = c.since; sim.warmup(0.05);
    const after = beatClockFromSim(sim as never);
    expect(Math.abs(after.since - (before + 0.05)) < 1e-6 || after.since < before).toBe(true); // moves on, or a new beat began
  });
  it("follows an irregular stream: a premature beat shortens the cycle and is flagged", () => {
    const stream = { beats: [{ t: 0, rr: 0.8 }, { t: 0.8, rr: 0.8 }, { t: 1.3, rr: 0.5, pvc: true }, { t: 2.3, rr: 1.0 }] };
    expect(beatClockFromSim({ t: 1.4, stream })).toMatchObject({ pvc: true });
    expect(beatClockFromSim({ t: 1.4, stream }).rr).toBeCloseTo(1.0, 6);
    expect(beatClockFromSim({ t: 1.0, stream }).rr).toBeCloseTo(0.5, 6);
    expect(beatClockFromSim({ t: 1.0, stream: { beats: [{ t: 0.9, rr: 0.8, pOnly: true }, ...stream.beats] } }).since).toBeCloseTo(0.2, 6); // P-only beats do not contract
  });
  it("opens the aortic valve in early systole and the mitral valve in diastole, with contraction peaking between", () => {
    const rr = 0.8, at = (since: number) => cycleAt({ since, rr, pvc: false });
    expect(at(0.1)).toMatchObject({ avOpen: true, mvOpen: false });
    expect(at(0.6)).toMatchObject({ avOpen: false, mvOpen: true });
    expect(at(0.26).sys).toBeGreaterThan(0.9); expect(at(0.7).sys).toBeLessThan(0.3);
    expect(at(0.0).sys).toBeLessThan(0.1);
  });
});

describe("echoModel: ischemia to wall motion", () => {
  const motionOf = (sc: object) => { const m = echoModel(settled(sc)); return (n: string) => m.segments[seg(n)].motion; };
  it("normal heart: every segment normal, EF and HR from the sim", () => {
    const sim = settled({}), m = echoModel(sim);
    expect(m.segments.length).toBe(17);
    expect(m.segments.every((s) => s.score === 1)).toBe(true);
    expect(m.scoreIndex).toBe(1);
    expect(m.ef).toBeCloseTo(sim.state().ventricle.ejectionFraction, 1);
  });
  it("LAD occlusion: anterior, anteroseptal and apical segments akinetic, inferior ones normal", () => {
    const sc = { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] }, mo = motionOf(sc);
    for (const n of ["basal anterior", "mid anterior", "basal anteroseptal", "mid anteroseptal", "apical anterior", "apical septal", "apex"]) expect(mo(n), n).toBe("akinetic");
    for (const n of ["basal inferior", "mid inferior", "basal inferolateral", "mid inferolateral", "basal inferoseptal", "mid inferoseptal"]) expect(mo(n), n).toBe("normal");
    expect(mo("mid anterolateral")).toBe("hypokinetic"); // shared with the circumflex
    expect(echoModel(settled(sc)).ef).toBeLessThan(0.5);
  });
  it("RCA occlusion: the reverse (inferior and inferoseptal akinetic, anterior normal)", () => {
    const mo = motionOf({ lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] });
    for (const n of ["basal inferior", "mid inferior"]) expect(mo(n), n).toBe("akinetic");
    for (const n of ["basal inferoseptal", "mid inferoseptal"]) expect(mo(n), n).not.toBe("normal"); // mostly RCA, shared with the LAD septals
    for (const n of ["basal anterior", "mid anterior", "basal anterolateral", "mid anteroseptal", "apex", "apical anterior"]) expect(mo(n), n).toBe("normal");
  });
  it("circumflex occlusion: the lateral wall", () => {
    const mo = motionOf({ lesions: [{ artery: "LCX", occluded: true, position: 0.3 }] });
    expect(mo("basal inferolateral")).toBe("akinetic"); expect(mo("mid inferolateral")).toBe("akinetic");
    expect(mo("basal anterolateral")).toBe("hypokinetic");
    for (const n of ["basal anterior", "mid anteroseptal", "mid inferior", "apex"]) expect(mo(n), n).toBe("normal");
  });
  it("a late scar bulges outward (dyskinetic); an ischemic segment does not", () => {
    const sc = { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] }, sim = settled(sc);
    for (const k of Object.keys(sim.sev)) sim.scar[k] = 1;
    expect(echoModel(sim).segments[seg("mid anterior")].motion).toBe("dyskinetic");
    expect(echoModel(settled(sc)).segments[seg("mid anterior")].bulge).toBe(0);
  });
});

describe("wall motion in the image", () => {
  const view = () => views.find((v) => v.id === "tg-mid")!;
  const lvArea = (field: ReturnType<typeof motionField>, sys: number) => {
    const c = idCounts(sliceHeart(heart, sliceGrid(view(), 0, 300, 300), { motion: field, cycle: { ...DIASTOLE, sys } }));
    return (c.get(ID.LV) ?? 0) + (c.get(ID.PMAL) ?? 0) + (c.get(ID.PMPM) ?? 0);
  };
  const flat = (v: number) => new Float32Array(NSEG).fill(v);
  it("a normal LV cavity shrinks in systole; a fully akinetic one does not", () => {
    const normal = normalMotion(0.62), dead = motionField(flat(1), flat(0), 0.62);
    expect(lvArea(normal, 1)).toBeLessThan(0.8 * lvArea(normal, 0));
    expect(lvArea(dead, 1)).toBeGreaterThan(0.93 * lvArea(dead, 0));
  });
  it("a dyskinetic LV gets bigger in systole", () => {
    expect(lvArea(motionField(flat(1), flat(1), 0.62), 1)).toBeGreaterThan(lvArea(motionField(flat(1), flat(0), 0.62), 1));
  });
  it("an akinetic wall holds still while its neighbours move (reference-position sampling)", () => {
    // anterior segments dead, the rest normal: the anterior wall stays, the inferior wall comes in
    const d = new Float32Array(NSEG); for (const n of ["basal anterior", "mid anterior", "apical anterior"]) d[seg(n)] = 1;
    const f = motionField(d, flat(0), 0.62), g = sliceGrid(view(), 0, 300, 300);
    const a = sliceHeart(heart, g, { motion: f, cycle: { ...DIASTOLE, sys: 0 } }), b = sliceHeart(heart, g, { motion: f, cycle: { ...DIASTOLE, sys: 1 } });
    const c = centroid(a, ID.LV, ID.PMAL, ID.PMPM)!;
    const radius = (s: typeof a, id: number) => { let sum = 0, n = 0; for (let k = 0; k < s.ids.length; k++) if (s.ids[k] === id) { sum += Math.hypot((k % 300) - c.x, ((k / 300) | 0) - c.y); n++; } return sum / n; };
    const move = (name: string) => Math.abs(radius(a, ID.SEG + seg(name)) - radius(b, ID.SEG + seg(name)));
    const ant = "mid anterior", inf = "mid inferior";
    expect(move(inf)).toBeGreaterThan(5); expect(move(ant)).toBeLessThan(0.35 * move(inf));
  });
});

describe("render", () => {
  it("is deterministic for a seed and shows speckle in the wall but a dark blood pool", () => {
    const v = views.find((x) => x.id === "tg-mid")!, s = sliceHeart(heart, sliceGrid(v, 0, 200, 200)), t = makeTextures(200, 200, 3);
    const a = shade(heart, s, t), b = shade(heart, s, makeTextures(200, 200, 3));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    let wall = 0, nw = 0, blood = 0, nb = 0;
    for (let k = 0; k < s.ids.length; k++) { if (!s.grid.mask[k]) continue; const g = a[k * 4]; if (isSegment(s.ids[k])) { wall += g; nw++; } else if (s.ids[k] === ID.LV) { blood += g; nb++; } }
    expect(wall / nw).toBeGreaterThan(2 * (blood / nb));
  });
  it("tints the segments when territories are on, and only them", () => {
    const v = views.find((x) => x.id === "tg-mid")!, s = sliceHeart(heart, sliceGrid(v, 0, 200, 200)), t = makeTextures(200, 200, 3);
    const plain = shade(heart, s, t), tinted = shade(heart, s, t, { territories: new Float32Array(NSEG).fill(1) });
    let changedWall = 0, changedOther = 0;
    for (let k = 0; k < s.ids.length; k++) { if (!s.grid.mask[k]) continue; const d = Math.abs(plain[k * 4 + 1] - tinted[k * 4 + 1]); if (d > 8) { if (isSegment(s.ids[k])) changedWall++; else changedOther++; } }
    expect(changedWall).toBeGreaterThan(1000); expect(changedOther).toBe(0);
  });
  it("labels the four chambers and both AV valves of the four-chamber view without overlaps, inside the image", () => {
    const v = views.find((x) => x.id === "me-4ch")!, s = sliceHeart(heart, sliceGrid(v, 0, 400, 400)), L = labelPlacements(s);
    const names = L.map((l) => l.text);
    for (const n of ["LV", "RV", "LA", "RA", "MV", "TV"]) expect(names, n).toContain(n);
    for (const a of L) { expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x + a.w).toBeLessThanOrEqual(400); for (const b of L) if (a !== b) expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false); }
  });
});
