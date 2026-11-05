import { Part } from "../anatomy/heartSurface";
import { Pose, SECTOR } from "./poses";
import { EchoSlice, sampleSlice } from "./slice";

/**
 * Draws the ideal labeled slice and the stylized teaching echo into canvases. Both use the same
 * sector layout (probe at the top, depth down) so they line up with each other and with the real
 * reference clip. The stylized image is not a claim of realistic ultrasound.
 */

/** Flat chamber fills for the ideal slice (dark field outside). */
const PART_FILL: Record<Part, string> = {
  [Part.LV]: "#8a3d36",
  [Part.RV]: "#3f6a96",
  [Part.RA]: "#6a8fb5",
  [Part.LA]: "#b87962",
  [Part.Aorta]: "#c9a05a",
};

/** Interactive sample density: fine enough to read chambers, cheap enough to follow the probe. */
export const LIVE_SAMPLE = { rays: 37, steps: 44 };

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

function sectorToPixel(depth: number, lateral: number, pose: Pose, w: number, h: number): { x: number; y: number; scale: number } {
  const scale = (h * 0.92) / pose.depth;
  return { x: w / 2 + lateral * scale, y: depth * scale, scale };
}

function inSector(depth: number, lateral: number, pose: Pose): boolean {
  if (depth < 0) return false;
  const r = Math.hypot(depth, lateral);
  if (r > pose.depth) return false;
  return Math.abs(Math.atan2(lateral, depth)) <= SECTOR.halfAngle + 1e-6;
}

/** Paint the ideal cross-section; labels are optional. */
export function paintIdeal(canvas: HTMLCanvasElement, pose: Pose, slice: EchoSlice, labels: boolean) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#05060a";
  g.fillRect(0, 0, w, h);
  // Sector outline.
  const scale = (h * 0.92) / pose.depth;
  g.beginPath();
  g.moveTo(w / 2, 0);
  for (const sign of [-1, 1]) {
    const a = sign * SECTOR.halfAngle;
    g.lineTo(w / 2 + Math.sin(a) * pose.depth * scale, Math.cos(a) * pose.depth * scale);
  }
  g.closePath();
  g.fillStyle = "#0b0d14";
  g.fill();
  g.strokeStyle = "#2b2f45";
  g.lineWidth = 1;
  g.stroke();

  const cell = Math.max(2, Math.ceil(scale * pose.depth / Math.max(1, Math.sqrt(slice.samples.length))));
  for (const s of slice.samples) {
    if (s.part === null || !inSector(s.depth, s.lateral, pose)) continue;
    const { x, y } = sectorToPixel(s.depth, s.lateral, pose, w, h);
    g.fillStyle = PART_FILL[s.part];
    g.fillRect(x - cell / 2, y - cell / 2, cell + 0.5, cell + 0.5);
  }
  // Hairline wall where the field crosses zero.
  g.fillStyle = "#f4f1ea";
  for (const s of slice.samples) {
    if (!inSector(s.depth, s.lateral, pose) || Math.abs(s.sdf) >= 1.2) continue;
    const { x, y } = sectorToPixel(s.depth, s.lateral, pose, w, h);
    g.fillRect(x - 0.6, y - 0.6, 1.4, 1.4);
  }

  if (labels) {
    g.font = "600 11px Hanken Grotesk, Helvetica Neue, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const label of slice.labels) {
      const { x, y } = sectorToPixel(label.depth, label.lateral, pose, w, h);
      g.fillStyle = "rgba(5,6,10,0.72)";
      const tw = g.measureText(label.name).width;
      g.fillRect(x - tw / 2 - 4, y - 8, tw + 8, 16);
      g.fillStyle = "#f4f1ea";
      g.fillText(label.name, x, y);
    }
  }
}

/** Paint the stylized teaching echo for the same sector. */
export function paintStylized(canvas: HTMLCanvasElement, pose: Pose, slice: EchoSlice) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(w, h);
  const data = img.data;
  const scale = (h * 0.92) / pose.depth;
  const cell = Math.max(2, Math.ceil(scale * pose.depth / Math.max(1, Math.sqrt(slice.samples.length))));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = 255;
  }
  for (const s of slice.samples) {
    if (!inSector(s.depth, s.lateral, pose)) continue;
    const { x, y } = sectorToPixel(s.depth, s.lateral, pose, w, h);
    const gray = Math.round(255 * echoGray(s.sdf, s.depth, pose.depth, hash(s.depth, s.lateral)));
    const x0 = Math.max(0, Math.floor(x - cell / 2)), x1 = Math.min(w, Math.ceil(x + cell / 2));
    const y0 = Math.max(0, Math.floor(y - cell / 2)), y1 = Math.min(h, Math.ceil(y + cell / 2));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const o = (py * w + px) * 4;
      data[o] = data[o + 1] = data[o + 2] = gray;
    }
  }
  g.putImageData(img, 0, 0);
  // Sector edge.
  g.beginPath();
  g.moveTo(w / 2, 0);
  for (const sign of [-1, 1]) {
    const a = sign * SECTOR.halfAngle;
    g.lineTo(w / 2 + Math.sin(a) * pose.depth * scale, Math.cos(a) * pose.depth * scale);
  }
  g.closePath();
  g.strokeStyle = "#2b2f45";
  g.lineWidth = 1;
  g.stroke();
}

/** Sample and paint both live panes for a pose. */
export function paintLive(ideal: HTMLCanvasElement, stylized: HTMLCanvasElement, pose: Pose, labels: boolean): EchoSlice {
  const slice = sampleSlice(pose, LIVE_SAMPLE);
  paintIdeal(ideal, pose, slice, labels);
  paintStylized(stylized, pose, slice);
  return slice;
}
