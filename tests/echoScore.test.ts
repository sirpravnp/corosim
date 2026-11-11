import { describe, it, expect } from "vitest";
import { Part } from "../src/anatomy/heartSurface";
import { Tissue } from "../src/echo/tissue";
import { buildPoses } from "../src/echo/poses";
import { RasterLike, ViewSpec, VIEW_SPECS, scorePose, scoreRaster } from "../src/echo/score";
import { controlsFromPose, poseFromControls, twistProbe } from "../src/echo/probe";
import { tuneView } from "../src/echo/tune";
import { installCtHeartNode } from "../src/echo/ctNode";

// the echo images the CT heart in production; these tests check that path
installCtHeartNode();

const W = 40, H = 40;
/** Synthetic raster: whole image is fan; rect regions painted with a part. */
function make(regions: { part: Part; x0: number; x1: number; y0: number; y1: number; tissue?: Tissue }[]): RasterLike {
  const part = new Int8Array(W * H).fill(-1), tissue = new Uint8Array(W * H);
  for (const g of regions) for (let y = g.y0; y < g.y1; y++) for (let x = g.x0; x < g.x1; x++) {
    part[y * W + x] = g.part; tissue[y * W + x] = g.tissue ?? Tissue.Blood;
  }
  return { w: W, h: H, px: 1, part, tissue };
}
const spec: ViewSpec = {
  id: "t",
  present: [{ part: Part.LV, minFrac: 0.1, weight: 1 }, { part: Part.RV, minFrac: 0.1, weight: 1 }],
  absent: [{ part: Part.RA, maxFrac: 0.01, weight: 1 }],
  order: [{ by: "depth", parts: [Part.RV, Part.LV], weight: 1 }],
  fill: [0.3, 0.9], centered: 0,
};
const good = () => make([
  { part: Part.RV, x0: 10, x1: 30, y0: 4, y1: 14 },
  { part: Part.LV, x0: 10, x1: 30, y0: 18, y1: 34 },
]);

describe("scoreRaster on synthetic rasters", () => {
  it("scores a raster with everything required near 1", () => {
    expect(scoreRaster(good(), spec).score).toBeGreaterThan(0.95);
  });
  it("scores a missing required part clearly lower", () => {
    const r = make([{ part: Part.LV, x0: 10, x1: 30, y0: 18, y1: 34 }]);
    expect(scoreRaster(r, spec).score).toBeLessThan(scoreRaster(good(), spec).score - 0.2);
  });
  it("penalizes a forbidden part", () => {
    const r = make([
      { part: Part.RV, x0: 10, x1: 30, y0: 4, y1: 14 }, { part: Part.LV, x0: 10, x1: 30, y0: 18, y1: 34 },
      { part: Part.RA, x0: 0, x1: 10, y0: 4, y1: 34 },
    ]);
    expect(scoreRaster(r, spec).score).toBeLessThan(scoreRaster(good(), spec).score - 0.1);
  });
  it("rewards the right depth order and punishes the reverse", () => {
    const rev = make([
      { part: Part.LV, x0: 10, x1: 30, y0: 4, y1: 14 }, { part: Part.RV, x0: 10, x1: 30, y0: 18, y1: 34 },
    ]);
    const a = scoreRaster(good(), spec), b = scoreRaster(rev, spec);
    expect(a.detail["order depth RV<LV"]).toBeGreaterThan(0.9);
    expect(b.detail["order depth RV<LV"]).toBeLessThan(0.1);
    expect(a.score).toBeGreaterThan(b.score);
  });
  it("lowers the score when the heart fills too little or too much of the fan", () => {
    const small = make([{ part: Part.RV, x0: 0, x1: 8, y0: 0, y1: 8 }, { part: Part.LV, x0: 10, x1: 18, y0: 0, y1: 8 }]);
    const noFill = { ...spec, fill: [0, 1] as [number, number] };
    expect(scoreRaster(small, spec).detail.fill).toBeLessThan(0.5);
    expect(scoreRaster(small, noFill).detail.fill).toBe(1);
    const tight = { ...spec, fill: [0.05, 0.2] as [number, number] };
    expect(scoreRaster(good(), tight).detail.fill).toBeLessThan(0.7);
  });
  it("is deterministic and bounded", () => {
    const a = scoreRaster(good(), spec), b = scoreRaster(good(), spec);
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(1);
  });
});

const poses = buildPoses();
const ids = Object.keys(poses);

describe("view specs", () => {
  it("covers every existing pose and the planned views", () => {
    for (const id of ids) expect(VIEW_SPECS[id]?.id, id).toBe(id);
  });
});

/** Turn the image plane about the beam by `deg` (rolling the index mark): a large, clearly wrong pose. Sliding the probe instead keeps
 *  its local beam, and on a real heart a four-chamber view slid along the chest is still a four-chamber view. */
const rotated = (id: string, deg: number) => twistProbe(poses[id], (deg * Math.PI) / 180);

describe("scorePose on the calibrated poses", () => {
  const check = (id: string) => {
    const s = scorePose(poses[id], VIEW_SPECS[id]);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s, `${id} is a good ${id}`).toBeGreaterThan(0.8);
    expect(s).toBeGreaterThanOrEqual(scorePose(rotated(id, 40), VIEW_SPECS[id]));
  };
  it.each(ids)("%s scores above 0.8 and at least as high as the same plane turned 40 degrees", check);
});

describe("tuneView", () => {
  const c = controlsFromPose(poses.plax);
  const off = poseFromControls({ ...c, yaw: c.yaw + (20 * Math.PI) / 180, pitch: c.pitch + 0.15, depth: c.depth });
  it("improves a displaced PLAX pose, deterministically", () => {
    const s0 = scorePose(off, VIEW_SPECS.plax);
    const a = tuneView(VIEW_SPECS.plax, off, { iterations: 8, seed: 3 });
    const b = tuneView(VIEW_SPECS.plax, off, { iterations: 8, seed: 3 });
    expect(a.score).toBeGreaterThan(s0);
    expect(a).toEqual(b);
    expect(a.evals).toBeGreaterThan(1);
  }, 60000);
});

import { blobStats, scoreRaster as scoreR, VIEW_SPECS as SPECS } from "../src/echo/score";
import { Part as P } from "../src/anatomy/heartSurface";
import { Tissue as T } from "../src/echo/tissue";


/** A synthetic fan-less raster with one LV blood ellipse (semi-axes ax, ay in pixels, centered) and nothing else. */
function ellipse(ax: number, ay: number, w = 90, h = 100) {
  const part = new Int8Array(w * h).fill(-1), tissue = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - w / 2) / ax, dy = (y - h / 2) / ay;
    if (dx * dx + dy * dy <= 1) { part[y * w + x] = P.LV; tissue[y * w + x] = T.Blood; }
  }
  return { w, h, px: 1, part, tissue };
}

describe("shape terms", () => {
  it("measures a horizontal ellipse as horizontal and elongated, and a circle as round", () => {
    const flat = blobStats(ellipse(30, 12), P.LV), round = blobStats(ellipse(20, 20), P.LV);
    expect(flat.axisDeg).toBeLessThan(10);
    expect(flat.elong).toBeGreaterThan(2);
    expect(round.elong).toBeLessThan(1.15);
  });
  it("rewards an elongated horizontal LV in a long-axis spec and punishes a vertical one", () => {
    const spec = { ...SPECS.plax, present: [], absent: [], order: [], centered: 0, fill: [0, 1] as [number, number], shape: { lv: { minFrac: 0.05, axisDeg: [0, 40] as [number, number], elong: [1.7, 3.5] as [number, number], weight: 1 } } };
    const flat = scoreR(ellipse(30, 14), spec).score, tall = scoreR(ellipse(14, 30), spec).score, round = scoreR(ellipse(20, 20), spec).score;
    expect(flat).toBeGreaterThan(0.9);
    expect(tall).toBeLessThan(flat - 0.3);
    expect(round).toBeLessThan(flat);
  });
  it("punishes a chamber split into pieces", () => {
    const r = ellipse(30, 14);
    for (let y = 0; y < r.h; y++) { r.part[y * r.w + 45] = P.RV; r.tissue[y * r.w + 45] = T.Myocardium; r.part[y * r.w + 44] = -1; r.part[y * r.w + 46] = -1; }
    const spec = { ...SPECS.plax, present: [], absent: [], order: [], centered: 0, fill: [0, 1] as [number, number], shape: { oneBlob: { parts: [P.LV], minLargest: 0.9, weight: 1 } } };
    expect(scoreR(ellipse(30, 14), spec).score).toBeGreaterThan(0.95);
    expect(scoreR(r, spec).score).toBeLessThan(0.9);
  });
  it("punishes a heart clipped by the fan edge", () => {
    const r = ellipse(30, 14);
    for (let x = 0; x < r.w; x++) for (let y = 0; y < 50; y++) r.part[y * r.w + x] = -2; // a wall of fan-exterior pixels next to the chamber
    const spec = { ...SPECS.plax, present: [], absent: [], order: [], centered: 0, fill: [0, 1] as [number, number], shape: { clipped: { maxFrac: 0.05, weight: 1 } } };
    expect(scoreR(ellipse(30, 14), spec).score).toBeGreaterThan(0.95);
    expect(scoreR(r, spec).score).toBeLessThan(0.8);
  });
});
