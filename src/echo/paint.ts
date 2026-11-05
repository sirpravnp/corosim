import { V3, add, mul } from "../anatomy/curve";
import { Part, PART_NAMES } from "../anatomy/heartSurface";
import { WALL_MM } from "./wall";
import { stylizeRaster } from "./look";
import { Tissue, classifyEcho, isSolidTissue } from "./tissue";
import { Pose, SECTOR, toHeart } from "./poses";
import { EchoSlice, SliceLabel, SliceSample, sampleSlice } from "./slice";

/**
 * Ideal labeled slice and stylized teaching echo. Both rasterize the scan sector pixel-by-pixel from the schematic heart
 * field (probe at the top center, depth down) so chambers read as solid regions. The two panes share one framing, chosen
 * from where the heart actually lies in the plane, so they show the same plane at the same scale.
 * The ideal pane is grayscale only (color is reserved for physiology elsewhere on the site): mid-gray myocardium, near-black
 * blood, a light hairline at endocardial and epicardial edges, no speckle. Overlays (fan outline, depth ticks, index dot,
 * labels with leader lines) are drawn on the destination canvas at full resolution, not in the low-resolution raster.
 */

export { WALL_MM };
export const SHORT_NAMES: Record<Part, string> = {
  [Part.LV]: "LV",
  [Part.RV]: "RV",
  [Part.RA]: "RA",
  [Part.LA]: "LA",
  [Part.Aorta]: "Ao",
};

const DRAFT_H = 180;
const FULL_H = 320;
/** Default canvas aspect (width over height) when the page gives none. */
const DEFAULT_ASPECT = 0.9;
/** Fraction of the canvas height that the fan radius occupies (room below the arc; a smaller value lets a laterally wide heart fill the narrow canvas). */
const FAN_FILL = 0.86;
/** Target share of the fan height taken by the heart. */
const HEART_FRACTION = 0.7;
const HEART_MARGIN = 0.97;

/** Grayscale 0..1 for one stylized sample: bright walls, darker chambers, depth falloff, speckle. */
export function echoGray(sdf: number, depth: number, depthMax: number, speckle: number): number {
  const wall = Math.exp(-Math.abs(sdf) * 0.55);
  const inside = sdf < 0 ? 0.22 + 0.18 * Math.min(1, -sdf / 8) : 0.04;
  const gain = Math.exp(-1.1 * (depth / Math.max(1, depthMax)));
  const near = Math.exp(-depth / 18) * 0.12;
  const base = (inside + 0.75 * wall + near) * gain;
  return Math.max(0, Math.min(1, base + (speckle - 0.5) * 0.16 * (0.35 + wall)));
}

/** Shared framing of both panes: how deep the fan is drawn, in mm, plus what the heart occupies. The apex stays at top center. */
export interface Frame {
  /** Fan radius shown, mm. */
  depth: number;
  /** Heart extent along the beam, mm (0 when the plane misses the heart). */
  minDepth: number;
  maxDepth: number;
  /** Largest lateral distance of any heart sample from the beam, mm. */
  maxLateral: number;
  /** Heart height over fan height (0 when empty). */
  heartFraction: number;
  /** Width over height of the canvas the frame was fit for. */
  aspect: number;
  /** True when the plane holds no heart and the default framing is used. */
  empty: boolean;
}

/** Pixels per mm for a canvas of height `h` under `frame`. */
export const pxPerMm = (frame: Frame, h: number) => (h * FAN_FILL) / frame.depth;

/**
 * Choose the displayed depth so the heart fills about 70 percent of the fan height, then grow it if needed so no heart
 * sample touches the arc or leaves the canvas sideways. The apex stays at top center, so scale (depth) is the only
 * freedom; the fan itself cannot be shifted. Pure: takes samples, no canvas.
 */
export function fitFrame(
  samples: Pick<SliceSample, "depth" | "lateral" | "part">[],
  pose: Pick<Pose, "depth">,
  aspect = DEFAULT_ASPECT,
): Frame {
  let minD = Infinity, maxD = -Infinity, maxLat = 0, maxR = 0, n = 0;
  for (const s of samples) {
    if (s.part === null) continue;
    n += 1;
    minD = Math.min(minD, s.depth);
    maxD = Math.max(maxD, s.depth);
    maxLat = Math.max(maxLat, Math.abs(s.lateral));
    maxR = Math.max(maxR, Math.hypot(s.depth, s.lateral));
  }
  if (n === 0) {
    return { depth: pose.depth, minDepth: 0, maxDepth: 0, maxLateral: 0, heartFraction: 0, aspect, empty: true };
  }
  const height = maxD - minD;
  const depth = Math.max(
    height / HEART_FRACTION,
    maxR / HEART_MARGIN,
    (maxLat * 2 * FAN_FILL) / (0.98 * aspect),
  );
  return { depth, minDepth: minD, maxDepth: maxD, maxLateral: maxLat, heartFraction: height / depth, aspect, empty: false };
}

/** Frame for a pose: samples the plane a little deeper than the pose reaches so a heart that runs past it still fits. */
export function frameFor(pose: Pose, aspect = DEFAULT_ASPECT): Frame {
  const deep: Pose = { ...pose, depth: pose.depth * 1.6 };
  return fitFrame(sampleSlice(deep, { rays: 81, steps: 110 }).samples, pose, aspect);
}

export interface Raster {
  w: number;
  h: number;
  px: number;
  /** Part index, -1 outside heart, -2 outside sector. */
  part: Int8Array;
  /** 1 = anything the beam reflects from (wall, septum, leaflet, papillary muscle, pericardium), 0 = blood / outside. */
  wall: Uint8Array;
  /** `Tissue` of each pixel; Outside where the pixel is outside the heart or the sector. */
  tissue: Uint8Array;
  sdf: Float32Array;
  labels: SliceLabel[];
}

/** An anchor for a label: a point inside the chamber's cavity, in mm from the probe. */
export interface Anchor {
  part: Part;
  short: string;
  depth: number;
  lateral: number;
}

let offIdeal: HTMLCanvasElement | null = null;
let offStyle: HTMLCanvasElement | null = null;
const offscreen = (which: "ideal" | "style", w: number, h: number) => {
  let c = which === "ideal" ? offIdeal : offStyle;
  if (!c) {
    c = document.createElement("canvas");
    if (which === "ideal") offIdeal = c; else offStyle = c;
  }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
};

/** Classify every sector pixel into part + sdf, hollow out chambers past wall thickness, find cavity anchors for labels. */
export function rasterize(pose: Pose, w: number, h: number, frame: Frame = frameFor(pose, w / h)): Raster {
  const part = new Int8Array(w * h), wall = new Uint8Array(w * h), tissue = new Uint8Array(w * h), sdfArr = new Float32Array(w * h);
  part.fill(-2);
  sdfArr.fill(1e3);
  const px = pxPerMm(frame, h);
  const half = SECTOR.halfAngle;
  const cav: { x: number; y: number }[][] = [[], [], [], [], []];

  for (let py = 0; py < h; py++) {
    for (let x = 0; x < w; x++) {
      const depth = py / px;
      const lateral = (x - w / 2) / px;
      const r = Math.hypot(depth, lateral);
      if (r > frame.depth || Math.abs(Math.atan2(lateral, depth)) > half) continue;
      const point = add(pose.probe, add(mul(pose.beam, depth), mul(pose.lateral, lateral))) as V3;
      const hit = classifyEcho(toHeart(point));
      const i = py * w + x;
      sdfArr[i] = hit.sdf;
      tissue[i] = hit.tissue;
      part[i] = hit.part ?? -1;
      wall[i] = isSolidTissue(hit.tissue) ? 1 : 0;
      if (hit.tissue === Tissue.Blood && hit.part !== null) cav[hit.part].push({ x, y: py });
    }
  }

  const labels: SliceLabel[] = [];
  for (const a of anchorsFromCavities(cav, px, w)) {
    labels.push({ part: a.part, name: PART_NAMES[a.part], depth: a.depth, lateral: a.lateral });
  }
  return { w, h, px, part, wall, tissue, sdf: sdfArr, labels };
}

/** For each chamber with cavity pixels: the cavity pixel nearest to the centroid (the centroid itself can sit in a wall or outside a C shape). */
function anchorsFromCavities(cav: { x: number; y: number }[][], px: number, w: number): Anchor[] {
  const out: Anchor[] = [];
  cav.forEach((pts, p) => {
    if (pts.length === 0) return;
    let cx = 0, cy = 0;
    for (const q of pts) { cx += q.x; cy += q.y; }
    cx /= pts.length; cy /= pts.length;
    let best = pts[0], bd = Infinity;
    for (const q of pts) {
      const d = (q.x - cx) ** 2 + (q.y - cy) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    out.push({ part: p as Part, short: SHORT_NAMES[p as Part], depth: best.y / px, lateral: (best.x - w / 2) / px });
  });
  return out;
}

/** Label anchors of a raster, in mm. Each lies on a cavity pixel of its own chamber. */
export function labelAnchors(raster: Raster): Anchor[] {
  return raster.labels.map((l) => ({ part: l.part, short: SHORT_NAMES[l.part], depth: l.depth, lateral: l.lateral }));
}

export interface LabelPlacement {
  part: Part;
  text: string;
  /** Leader start, inside the cavity, canvas px. */
  ax: number;
  ay: number;
  /** Leader end, in the margin outside the fan, canvas px. */
  lx: number;
  ly: number;
  side: "left" | "right";
}

const LABEL_GAP = 15;
const LABEL_END = 22;

/**
 * Put each label in a margin column outside the fan (the upper corners lie outside the 45 degree fan), left column for
 * structures left of the beam, right column for the rest, stacked so they do not overlap. The leader end is always
 * outside the sector. Pure: canvas size and frame in, positions out.
 */
export function layoutLabels(anchors: Anchor[], frame: Frame, cw: number, ch: number): LabelPlacement[] {
  const px = pxPerMm(frame, ch);
  const cx = cw / 2;
  const reach = cx - LABEL_END;
  const yMax = Math.max(LABEL_GAP, reach - 6);
  const out: LabelPlacement[] = [];
  for (const side of ["left", "right"] as const) {
    const col = anchors
      .filter((a) => (side === "left" ? a.lateral < 0 : a.lateral >= 0))
      .map((a) => ({ a, ax: cx + a.lateral * px, ay: a.depth * px }))
      .sort((p, q) => p.ay - q.ay);
    const ys: number[] = [];
    col.forEach((c, i) => ys.push(Math.max(i === 0 ? 12 : ys[i - 1] + LABEL_GAP, Math.min(c.ay, yMax))));
    for (let i = ys.length - 1; i >= 0; i--) {
      const cap = i === ys.length - 1 ? yMax : ys[i + 1] - LABEL_GAP;
      ys[i] = Math.min(ys[i], cap);
    }
    col.forEach((c, i) => out.push({
      part: c.a.part, text: c.a.short, ax: c.ax, ay: c.ay,
      lx: side === "left" ? LABEL_END : cw - LABEL_END, ly: ys[i], side,
    }));
  }
  return out;
}

/** True when canvas point (x, y) lies inside the fan under `frame`. */
export function insideFan(x: number, y: number, frame: Frame, cw: number, ch: number): boolean {
  const px = pxPerMm(frame, ch);
  const lat = (x - cw / 2) / px, d = y / px;
  return d >= 0 && Math.hypot(d, lat) <= frame.depth && Math.abs(Math.atan2(lat, d)) <= SECTOR.halfAngle + 1e-9;
}

const FAN_STROKE = "#9a9a9a";
const TICK_STROKE = "#9a9a9a";
const LABEL_FILL = "#d6d6d6";
const FONT = "500 11px Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif";

/** Fan outline, depth ticks every 20 mm along the left edge, and the index dot at the upper left. */
function drawFan(g: CanvasRenderingContext2D, frame: Frame, cw: number, ch: number) {
  const px = pxPerMm(frame, ch);
  const half = SECTOR.halfAngle, R = frame.depth * px, cx = cw / 2;
  g.save();
  g.lineWidth = 1;
  g.strokeStyle = FAN_STROKE;
  g.beginPath();
  g.moveTo(cx, 0.5);
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = -half + (2 * half * i) / steps;
    g.lineTo(cx + Math.sin(a) * R, Math.cos(a) * R);
  }
  g.closePath();
  g.stroke();

  // Depth ticks: at depth d along the beam, on the left edge of the fan (clamped into the canvas when the edge leaves it).
  g.strokeStyle = TICK_STROKE;
  g.fillStyle = TICK_STROKE;
  g.font = FONT;
  g.textAlign = "left";
  g.textBaseline = "middle";
  for (let d = 20; d < frame.depth * Math.cos(half); d += 20) {
    const y = Math.round(d * px) + 0.5;
    const edge = cx - d * Math.tan(half) * px;
    const x = Math.max(2, edge);
    const major = d % 40 === 0;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (major ? 8 : 5), y);
    g.stroke();
    if (major) g.fillText(String(d), x + 11, y);
  }

  // Index mark: small dot at the upper left of the fan.
  g.fillStyle = FAN_STROKE;
  g.beginPath();
  g.arc(cx - 10, 7, 2.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Short names with hairline leaders from a cavity point to the margin. No boxes, one size. */
function drawLabels(g: CanvasRenderingContext2D, placements: LabelPlacement[], cw: number) {
  g.save();
  g.font = FONT;
  g.textBaseline = "middle";
  g.lineWidth = 1;
  for (const p of placements) {
    g.strokeStyle = LABEL_FILL;
    g.beginPath();
    g.moveTo(p.ax, p.ay);
    g.lineTo(p.lx, p.ly);
    g.stroke();
    g.fillStyle = LABEL_FILL;
    g.beginPath();
    g.arc(p.ax, p.ay, 1.8, 0, Math.PI * 2);
    g.fill();
    g.textAlign = p.side === "left" ? "left" : "right";
    g.fillText(p.text, p.side === "left" ? 4 : cw - 4, p.ly);
  }
  g.restore();
}

/** Pixel gray values of the ideal pane, 0..255. Septum matches the wall; no speckle, no per-chamber hue. */
export const IDEAL_GRAY = { wall: 132, septum: 132, cavity: 10, tissue: 18, outside: 0, edge: 214, leaflet: 175, papillary: 150, pericardium: 205 };

/** Tissue kinds whose own gray is kept, instead of being overdrawn by the endocardial edge line. */
const KEEPS_OWN_GRAY = new Set<number>([Tissue.Leaflet, Tissue.Papillary, Tissue.Pericardium]);

function idealGray(tissue: number, part: number, solid: number): number {
  if (part === -2) return IDEAL_GRAY.outside;
  switch (tissue) {
    case Tissue.Pericardium: return IDEAL_GRAY.pericardium;
    case Tissue.Leaflet: return IDEAL_GRAY.leaflet;
    case Tissue.Papillary: return IDEAL_GRAY.papillary;
    case Tissue.Septum: return IDEAL_GRAY.septum;
    case Tissue.Myocardium: return IDEAL_GRAY.wall;
    case Tissue.Blood: return IDEAL_GRAY.cavity;
    default: return part === -1 ? IDEAL_GRAY.tissue : solid ? IDEAL_GRAY.wall : IDEAL_GRAY.cavity;
  }
}

function drawIdeal(g: CanvasRenderingContext2D, raster: Raster) {
  const { w, h, part, wall, sdf, tissue } = raster;
  const img = g.createImageData(w, h);
  const data = img.data;
  for (let i = 0; i < part.length; i++) {
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = idealGray(tissue[i], part[i], wall[i]);
    data[o + 3] = 255;
  }
  // Thin endocardium / epicardium lines only, not a chalk outline on every block.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, p = part[i];
      if (p < 0 || KEEPS_OWN_GRAY.has(tissue[i])) continue;
      const endo = wall[i] !== wall[i - 1] || wall[i] !== wall[i + 1] || wall[i] !== wall[i - w] || wall[i] !== wall[i + w];
      const epi = Math.abs(sdf[i]) < 0.9;
      const septum = wall[i] && (part[i - 1] !== p || part[i + 1] !== p || part[i - w] !== p || part[i + w] !== p);
      if (!endo && !epi && !septum) continue;
      const o = i * 4;
      data[o] = data[o + 1] = data[o + 2] = IDEAL_GRAY.edge;
    }
  }
  g.putImageData(img, 0, 0);
}

/** The stylized pane: the ultrasound look of `stylizeRaster` (see look.ts), `time` in seconds drifts the speckle. */
function drawStylized(g: CanvasRenderingContext2D, raster: Raster, time: number) {
  const { w, h } = raster;
  const img = g.createImageData(w, h);
  img.data.set(stylizeRaster(raster, time));
  g.putImageData(img, 0, 0);
}

/** Paint both live panes. Draft is a smaller grid while dragging; full after the probe settles. */
export function paintLive(
  ideal: HTMLCanvasElement,
  stylized: HTMLCanvasElement,
  pose: Pose,
  labels: boolean,
  quality: "draft" | "full" = "full",
  /** Seconds, drifts the speckle of the stylized pane; defaults to the wall clock. */
  time: number = performance.now() / 1000,
): EchoSlice {
  const aspect = ideal.width / Math.max(1, ideal.height);
  const h = quality === "draft" ? DRAFT_H : FULL_H;
  const w = Math.round(h * aspect);
  const frame = frameFor(pose, aspect);
  const raster = rasterize(pose, w, h, frame);
  const oi = offscreen("ideal", w, h);
  const os = offscreen("style", w, h);
  drawIdeal(oi.getContext("2d")!, raster);
  drawStylized(os.getContext("2d")!, raster, time);
  for (const [canvas, src, isIdeal] of [[ideal, oi, true], [stylized, os, false]] as const) {
    const g = canvas.getContext("2d")!;
    // Nearest-neighbor upscale keeps chamber edges crisp.
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#000";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(src, 0, 0, canvas.width, canvas.height);
    drawFan(g, frame, canvas.width, canvas.height);
    if (isIdeal && labels) drawLabels(g, layoutLabels(labelAnchors(raster), frame, canvas.width, canvas.height), canvas.width);
  }
  return { samples: [], labels: raster.labels };
}
