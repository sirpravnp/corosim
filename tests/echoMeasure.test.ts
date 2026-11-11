import { describe, it, expect } from "vitest";
import { installCtHeartNode } from "../src/echo/ctNode";
import { buildPoses } from "../src/echo/poses";
import { CASE_BY_ID } from "../src/echo/cases";
import { beatOf, EchoBeat } from "../src/echo/beat";
import { mLineFor, mmode, mmodeMeasures, simpsonBiplane } from "../src/echo/measure";

/**
 * 2D and M-mode measurements on the simulated anatomy, against the structural engine's own volumes. Simpson's biplane, the guideline
 * method, should read back the engine's EF; M-mode should give normal linear dimensions and, in a regional infarct, the underestimate a
 * single basal line is known for.
 */
installCtHeartNode();
const poses = buildPoses();
const beats: Record<string, EchoBeat> = {};
const beat = (id: string) => (beats[id] ??= beatOf(CASE_BY_ID[id]!));

describe("Simpson's biplane EF", () => {
  it.each(["normal", "ant-mi", "lvh", "as", "dcm"])("%s: within 8 points of the engine's EF", (id) => {
    const s = simpsonBiplane(beat(id), poses);
    expect(Math.abs(s.ef - 100 * beat(id).lvEf), `${id} echo ${s.ef.toFixed(0)} engine ${(100 * beat(id).lvEf).toFixed(0)}`).toBeLessThan(8);
  });
  it("hcm: within 10 points (a small cavity that nearly closes at end-systole is the hardest to trace, on a real scan too)", () => {
    const s = simpsonBiplane(beat("hcm"), poses);
    expect(Math.abs(s.ef - 100 * beat("hcm").lvEf)).toBeLessThan(10);
  });
  it("orders the volumes: a dilated LV is far larger than a normal one, a hypertrophied one smaller", () => {
    const n = simpsonBiplane(beat("normal"), poses).edv;
    expect(simpsonBiplane(beat("dcm"), poses).edv).toBeGreaterThan(1.6 * n);
    expect(simpsonBiplane(beat("hcm"), poses).edv).toBeLessThan(0.8 * n);
  });
});

describe("M-mode", () => {
  it("gives normal linear dimensions in a normal heart (LVIDd 38 to 58 mm, posterior wall 6 to 12 mm, FS 25 to 45 %)", () => {
    const m = mmodeMeasures(beat("normal"), poses.plax, mLineFor(poses.plax).lineAngle);
    expect(m.diastole.lvid).toBeGreaterThan(38); expect(m.diastole.lvid).toBeLessThan(58);
    expect(m.diastole.lvpw).toBeGreaterThan(6); expect(m.diastole.lvpw).toBeLessThan(12);
    expect(m.fs).toBeGreaterThan(25); expect(m.fs).toBeLessThan(45);
  });
  it("thick walls in hypertensive LVH; a large, poorly shortening LV in dilated cardiomyopathy", () => {
    const l = mmodeMeasures(beat("lvh"), poses.plax, mLineFor(poses.plax).lineAngle), d = mmodeMeasures(beat("dcm"), poses.plax, mLineFor(poses.plax).lineAngle);
    expect(l.diastole.ivs).toBeGreaterThan(13); expect(l.diastole.lvpw).toBeGreaterThan(12);
    expect(d.diastole.lvid).toBeGreaterThan(58); expect(d.fs).toBeLessThan(18);
  });
  it("in an anterior infarct, Teichholz from one basal line reads differently from Simpson's: lower, as the line misses the akinetic apex", () => {
    const m = mmodeMeasures(beat("ant-mi"), poses.plax, mLineFor(poses.plax).lineAngle), s = simpsonBiplane(beat("ant-mi"), poses);
    expect(m.ef).toBeLessThan(s.ef);
  });
  it("draws a strip of the requested size whose walls move: the image changes between end-diastole and end-systole", () => {
    const b = beat("normal"), mm = mmode(b, poses.plax, mLineFor(poses.plax).lineAngle, 150, { beats: 1, perBeat: 24 });
    expect(mm.columns).toBe(24); expect(mm.img.length).toBe(mm.columns * mm.samples);
    let diff = 0;
    for (let j = 0; j < mm.samples; j++) diff += Math.abs(mm.img[j * mm.columns + b.ed] - mm.img[j * mm.columns + b.es]);
    expect(diff / mm.samples).toBeGreaterThan(0.02);
  });
});
