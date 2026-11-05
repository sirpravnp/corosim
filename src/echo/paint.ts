import { V3, add, mul } from "../anatomy/curve";
import { Part, PART_NAMES, classifyHeart } from "../anatomy/heartSurface";
import { Pose, SECTOR, toHeart } from "./poses";
import { EchoSlice, SliceLabel } from "./slice";

/**
 * Ideal labeled slice and stylized teaching echo. Both rasterize the scan sector pixel-by-pixel
 * from the schematic heart field (probe at the top, depth down) so chambers read as solid regions.
 */

/** Wall fill (myocardium) — same hues as the 3D heart shell. */
const WALL_RGB: Record<Part, [number, number, number]> = {
  [Part.LV]: [178, 74, 63],
  [Part.RV]: [79, 127, 181],
  [Part.RA]: [122, 166, 212],
  [Part.LA]: [217, 138, 110],
  [Part.Aorta]: [227, 179, 92],
};
/** Blood pool inside each chamber (darker than the wall). */
const CAVITY_RGB: Record<Part, [number, number, number]> = {
  [Part.LV]: [42, 18, 16],
  [Part.RV]: [18, 32, 48],
  [Part.RA]: [28, 40, 54],
  [Part.LA]: [48, 28, 24],
  [Part.Aorta]: [48, 36, 18],
};
/** Approximate wall thickness by part, mm. The SDF is solid, so depth past this is drawn as cavity. */
const WALL_MM: Record<Part, number> = {
  [Part.LV]: 9,
  [Part.RV]: 3.5,
  [Part.RA]: 2.5,
  [Part.LA]: 2.5,
  [Part.Aorta]: 2.8,
};

const DRAFT = { w: 160, h: 180 };
const FULL = { w: 280, h: 320 };

const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** Grayscale 0..1 for one stylized sample: bright walls, darker chambers, depth falloff, speckle. */
export function echoGray(sdf: number, depth: number, depthMax: number, speckle: number): number {
  const wall = Math.exp(-Math.abs(sdf) * 0.55);
  const inside = sdf < 0 ? 0.22 + 0.18 * Math.min(1, -sdf / 8) : 0.04;
  const gain = Math.exp(-1.1 * (depth / Math.max(1, depthMax)));
  const near = Math.exp(-depth / 18) * 0.12;
  const base = (inside + 0.75 * wall + near) * gain;
  return Math.max(0, Math.min(1, base + (speckle - 0.5) * 0.16 * (0.35 + wall)));
}

interface Raster {
  w: number;
  h: number;
  /** Part index, -1 outside heart, -2 outside sector. */
  part: Int8Array;
  /** 1 = myocardium wall, 0 = cavity / outside. */
  wall: Uint8Array;
  sdf: Float32Array;
  labels: SliceLabel[];
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

/** Classify every sector pixel into part + sdf, hollow out chambers past wall thickness, label cavities. */
function rasterize(pose: Pose, w: number, h: number): Raster {
  const part = new Int8Array(w * h), wall = new Uint8Array(w * h), sdfArr = new Float32Array(w * h);
  part.fill(-2);
  sdfArr.fill(1e3);
  const scale = (h * 0.92) / pose.depth;
  const half = SECTOR.halfAngle;
  const sums = new Map<Part, { n: number; depth: number; lateral: number }>();

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const depth = py / scale;
      const lateral = (px - w / 2) / scale;
      if (depth < 0) continue;
      const r = Math.hypot(depth, lateral);
      if (r > pose.depth || Math.abs(Math.atan2(lateral, depth)) > half) continue;
      const point = add(pose.probe, add(mul(pose.beam, depth), mul(pose.lateral, lateral))) as V3;
      const hit = classifyHeart(toHeart(point));
      const i = py * w + px;
      sdfArr[i] = hit.sdf;
      if (hit.part === null) { part[i] = -1; continue; }
      part[i] = hit.part;
      // Solid SDF: a band near the surface is wall; deeper is the blood pool.
      const isWall = hit.sdf > -WALL_MM[hit.part];
      wall[i] = isWall ? 1 : 0;
      if (!isWall) {
        const g = sums.get(hit.part) ?? { n: 0, depth: 0, lateral: 0 };
        g.n += 1; g.depth += depth; g.lateral += lateral;
        sums.set(hit.part, g);
      }
    }
  }

  const labels: SliceLabel[] = [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([p, g]) => ({
      part: p,
      name: PART_NAMES[p],
      depth: g.depth / g.n,
      lateral: g.lateral / g.n,
    }));
  return { w, h, part, wall, sdf: sdfArr, labels };
}

function strokeSector(g: CanvasRenderingContext2D, pose: Pose, w: number, h: number) {
  const scale = (h * 0.92) / pose.depth;
  g.beginPath();
  g.moveTo(w / 2, 0);
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const a = -SECTOR.halfAngle + (2 * SECTOR.halfAngle * i) / steps;
    g.lineTo(w / 2 + Math.sin(a) * pose.depth * scale, Math.cos(a) * pose.depth * scale);
  }
  g.closePath();
  g.strokeStyle = "#2b2f45";
  g.lineWidth = 1;
  g.stroke();
}

function drawIdeal(g: CanvasRenderingContext2D, pose: Pose, raster: Raster, labels: boolean) {
  const { w, h, part, wall, sdf } = raster;
  const img = g.createImageData(w, h);
  const data = img.data;
  for (let i = 0; i < part.length; i++) {
    const o = i * 4, p = part[i];
    data[o + 3] = 255;
    if (p === -2) { data[o] = 5; data[o + 1] = 6; data[o + 2] = 10; continue; }
    if (p === -1) { data[o] = 11; data[o + 1] = 13; data[o + 2] = 20; continue; }
    const rgb = wall[i] ? WALL_RGB[p as Part] : CAVITY_RGB[p as Part];
    data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
  }
  // Thin endocardium / epicardium lines only — not a chalk outline on every block.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, p = part[i];
      if (p < 0) continue;
      const endo = wall[i] !== wall[i - 1] || wall[i] !== wall[i + 1] || wall[i] !== wall[i - w] || wall[i] !== wall[i + w];
      const epi = Math.abs(sdf[i]) < 0.9;
      const septum = wall[i] && (part[i - 1] !== p || part[i + 1] !== p || part[i - w] !== p || part[i + w] !== p);
      if (!endo && !epi && !septum) continue;
      const o = i * 4;
      data[o] = 232; data[o + 1] = 228; data[o + 2] = 220;
    }
  }
  g.putImageData(img, 0, 0);
  strokeSector(g, pose, w, h);
  if (!labels) return;
  const scale = (h * 0.92) / pose.depth;
  g.font = "600 11px Hanken Grotesk, Helvetica Neue, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const label of raster.labels) {
    const x = w / 2 + label.lateral * scale, y = label.depth * scale;
    const tw = g.measureText(label.name).width;
    g.fillStyle = "rgba(5,6,10,0.78)";
    g.fillRect(x - tw / 2 - 4, y - 8, tw + 8, 16);
    g.fillStyle = "#f4f1ea";
    g.fillText(label.name, x, y);
  }
}

function drawStylized(g: CanvasRenderingContext2D, pose: Pose, raster: Raster) {
  const { w, h, part, wall, sdf } = raster;
  const img = g.createImageData(w, h);
  const data = img.data;
  const scale = (h * 0.92) / pose.depth;
  for (let i = 0; i < part.length; i++) {
    const o = i * 4;
    data[o + 3] = 255;
    if (part[i] === -2) { data[o] = data[o + 1] = data[o + 2] = 0; continue; }
    const y = (i / w) | 0, x = i - y * w;
    const depth = y / scale, lateral = (x - w / 2) / scale;
    // Myocardium (wall band) bright; cavity dark; outside the heart mostly black.
    const sdfForGray = part[i] < 0 ? Math.max(sdf[i], 4) : wall[i] ? 0 : -14;
    const gray = Math.round(255 * echoGray(sdfForGray, depth, pose.depth, hash(depth, lateral)));
    data[o] = data[o + 1] = data[o + 2] = gray;
  }
  g.putImageData(img, 0, 0);
  strokeSector(g, pose, w, h);
}

/** Paint both live panes. Draft is a smaller grid while dragging; full after the probe settles. */
export function paintLive(
  ideal: HTMLCanvasElement,
  stylized: HTMLCanvasElement,
  pose: Pose,
  labels: boolean,
  quality: "draft" | "full" = "full",
): EchoSlice {
  const size = quality === "draft" ? DRAFT : FULL;
  const raster = rasterize(pose, size.w, size.h);
  const oi = offscreen("ideal", size.w, size.h);
  const os = offscreen("style", size.w, size.h);
  drawIdeal(oi.getContext("2d")!, pose, raster, labels);
  drawStylized(os.getContext("2d")!, pose, raster);
  for (const [canvas, src] of [[ideal, oi], [stylized, os]] as const) {
    const g = canvas.getContext("2d")!;
    // Nearest-neighbor upscale keeps chamber edges crisp.
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#05060a";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(src, 0, 0, canvas.width, canvas.height);
  }
  return { samples: [], labels: raster.labels };
}
