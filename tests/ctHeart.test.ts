import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CT, ahaSegment, ctHeartFromBytes, ctLandmarks, ctToHeart, heartToCt, labelAt, place, sampleField } from "../src/anatomy/ctHeart";
import { LANDMARKS_HEART_FRAME as L, toPatient } from "../src/echo/poses";
import type { V3 } from "../src/anatomy/curve";

/**
 * The CT-derived heart as a model, before anything images it: normal adult chamber sizes, one connected pool per chamber (after
 * scripts/cath/repair-heart.py), distance fields that agree with the labels, and a placement in the heart frame that puts every
 * chamber where it belongs. scripts/anatomy/validate-ct-heart.py checks the same anatomy in more depth against scipy.
 */
const h = ctHeartFromBytes(new Uint8Array(gunzipSync(readFileSync("src/cath/data/heart.bin.gz"))), JSON.parse(readFileSync("src/cath/data/heart.json", "utf8")));
const residual = place(h, { apex: L.apex, mv: L.mitral, av: L.aortic, tv: L.tricuspid });
const count = (pred: (l: number) => boolean) => { let n = 0; for (const l of h.labels) if (pred(l)) n++; return n; };

describe("CT heart anatomy", () => {
  it("has normal adult end-diastolic chamber volumes and LV mass", () => {
    const ml = (l: number) => count((x) => x === l) / 1000;
    expect(ml(CT.LV)).toBeGreaterThan(90); expect(ml(CT.LV)).toBeLessThan(170);
    expect(ml(CT.RV)).toBeGreaterThan(100); expect(ml(CT.RV)).toBeLessThan(200);
    expect(ml(CT.LA)).toBeGreaterThan(30); expect(ml(CT.LA)).toBeLessThan(90);
    expect(ml(CT.RA)).toBeGreaterThan(40); expect(ml(CT.RA)).toBeLessThan(110);
    const mass = (count((x) => x >= 40 && x <= 56) / 1000) * 1.05;
    expect(mass).toBeGreaterThan(90); expect(mass).toBeLessThan(220);
  });
  it("maps every LV-wall label to one of the 17 AHA segments", () => {
    const seen = new Set<number>();
    for (let l = 40; l <= 56; l++) seen.add(ahaSegment(l));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  });
});

describe("CT heart distance fields", () => {
  it("are negative inside blood and the heart, positive outside, and agree with the labels at voxel centres", () => {
    let agreeBlood = 0, agreeBody = 0, n = 0;
    const isBlood = (l: number) => [1, 2, 3, 4, 7, 17, 20, 21, 22, 23].includes(l);
    for (let i = 3; i < h.nx - 3; i += 4) for (let j = 3; j < h.ny - 3; j += 4) for (let k = 3; k < h.nz - 3; k += 4) {
      const c: V3 = [i + h.origin[0], j + h.origin[1], k + h.origin[2]], l = labelAt(h, c);
      const b = sampleField(h, h.blood, c), o = sampleField(h, h.body, c);
      if (Math.abs(b) > 1) { n++; if ((b < 0) === isBlood(l)) agreeBlood++; }
      if (Math.abs(o) > 1) { if ((o < 0) === (l !== 0 && l !== CT.PERICARDIUM)) agreeBody++; }
    }
    expect(agreeBlood / n).toBeGreaterThan(0.999);
    expect(agreeBody / n).toBeGreaterThan(0.99);
  });
  it("change by about 1 mm per mm across a surface (a true distance, not a step)", () => {
    // walk from the LV cavity centre toward the free wall: the blood field should rise roughly linearly through zero
    const c: V3 = [h.meta.centroids.LV[0] * 10, h.meta.centroids.LV[1] * 10, h.meta.centroids.LV[2] * 10];
    let prev = sampleField(h, h.blood, c), slopes: number[] = [];
    for (let t = 1; t < 40; t++) { const v = sampleField(h, h.blood, [c[0] + t, c[1], c[2]]); if (Math.abs(v) < 4) slopes.push(v - prev); prev = v; }
    const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
    expect(mean).toBeGreaterThan(0.6); expect(mean).toBeLessThan(1.2);
  });
});

describe("CT heart placement in the heart frame", () => {
  it("is a rigid map with a reflection (the CT frame is left-handed) and round-trips points", () => {
    const R = h.R, det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    expect(det).toBeCloseTo(-1, 6);
    const p: V3 = [12, -30, 7], q = heartToCt(h, ctToHeart(h, p));
    for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(p[i], 9);
    expect(residual).toBeLessThan(20); // the CT ventricle is shorter than the schematic one; the fit is rigid
  });
  it("puts every chamber where it belongs in the patient", () => {
    const P = (c: number[]) => toPatient(ctToHeart(h, [c[0] * 10, c[1] * 10, c[2] * 10]));
    const m = h.meta.centroids, lv = P(m.LV), rv = P(m.RV), la = P(m.LA), ra = P(m.RA);
    const lm = ctLandmarks(h), apex = toPatient(ctToHeart(h, lm.apex)), mv = toPatient(ctToHeart(h, lm.mv)), ao = P(h.meta.tubes.ao.end);
    expect(rv[2]).toBeGreaterThan(lv[2]);                         // RV anterior to LV
    expect(rv[0]).toBeLessThan(lv[0]);                            // and to its right
    expect(la[2]).toBeLessThan(Math.min(lv[2], rv[2], ra[2]));    // LA the most posterior chamber
    expect(ra[0]).toBeLessThan(la[0]);                            // RA right of LA
    expect((la[1] + ra[1]) / 2).toBeGreaterThan((lv[1] + rv[1]) / 2); // atria above the ventricles
    expect(apex[0]).toBeGreaterThan(mv[0]); expect(apex[2]).toBeGreaterThan(mv[2]); expect(apex[1]).toBeLessThan(mv[1]); // apex left, anterior, down
    expect(ao[2]).toBeGreaterThan(la[2]);                         // aortic root anterior to the LA
  });
});
