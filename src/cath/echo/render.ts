/**
 * Region ids to pixels. Speckle is attached to the tissue (it is read from the volume's own coordinates at the reference voxel, so it
 * moves with the wall), blood is dark with its own flickering noise, edges are enhanced along the beam, and gain rises with depth.
 * `shade` and `labelPlacements` are pure; `paint` puts them on a 2D canvas.
 */
import { ID, LABELS, isBlood, isSegment, type LabelKind } from "./ids";
import type { SliceResult } from "./slice";
import { SECTOR_HALF_ANGLE } from "./slice";
import type { Heart } from "./volume";

/** Small seeded generator so the same seed gives the same speckle (tests, and a stable look between sessions). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function gblur(arr: Float32Array, w: number, h: number, sx: number, sy: number, wrapX: boolean): Float32Array {
  const kern = (s: number): [number[], number] => { const r = Math.max(1, Math.ceil(s * 2.5)), K: number[] = []; let z = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); K.push(v); z += v; } return [K.map((v) => v / z), r]; };
  const [kx, rx] = kern(sx), [ky, ry] = kern(sy), tmp = new Float32Array(arr.length), out = new Float32Array(arr.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -rx; i <= rx; i++) { let xx = x + i; xx = wrapX ? (xx + w) % w : Math.min(w - 1, Math.max(0, xx)); a += arr[y * w + xx] * kx[i + rx]; } tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let j = -ry; j <= ry; j++) { const yy = Math.min(h - 1, Math.max(0, y + j)); a += tmp[yy * w + x] * ky[j + ry]; } out[y * w + x] = a; }
  return out;
}

/** Exponentiate a zero-mean field so speckle has the heavy bright tail of the real thing, normalised to mean 1. */
function lognorm(arr: Float32Array, k: number): Float32Array {
  let m = 0, v = 0;
  for (const x of arr) m += x; m /= arr.length;
  for (const x of arr) v += (x - m) ** 2; v = Math.sqrt(v / arr.length) || 1;
  const o = arr.map((x) => Math.exp(k * (x - m) / v));
  let z = 0; for (const x of o) z += x; z /= o.length;
  return o.map((x) => x / z);
}

const NRX = 16, NU = 720;

export interface Textures { tissue: Float32Array; blood: Float32Array; width: number; height: number }

/** Speckle for the wall (wrapped about the axis) and a noise field for everything else. */
export function makeTextures(width: number, height: number, seed = 1): Textures {
  const rnd = mulberry32(seed);
  const t = new Float32Array(NU * NRX).map(() => rnd()), b = new Float32Array(width * height).map(() => rnd());
  return { tissue: lognorm(gblur(t, NU, NRX, 1.1, 0.9, true), 0.40), blood: lognorm(gblur(b, width, height, 1.7, 1.0, false), 0.42), width, height };
}

export interface ShadeOptions {
  /** Increments each frame, so blood noise flickers. */
  frame?: number;
  /** Territory overlay: 17 dysfunction values 0..1 to tint the LV segments, or null for none. */
  territories?: ArrayLike<number> | null;
  /** Overall brightness multiplier. */
  gain?: number;
}

/** Intensity 0..1 of a region at one pixel, before edge enhancement and gain. `bg` is the noise value. */
function base(id: number, bg: number, tissue: number): number {
  if (id === 0) return 0.11 * (0.55 + 0.7 * bg);
  if (isBlood(id)) return 0.02 + 0.04 * bg * bg;
  if (id >= ID.MV && id <= ID.PV) return 0.62 + 0.2 * bg;
  if (isSegment(id)) return 0.21 * tissue;
  switch (id) {
    case ID.IAS: return 0.34 * (0.6 + 0.8 * bg);
    case ID.RVW: return 0.26 * (0.6 + 0.8 * bg);
    case ID.LAW: case ID.RAW: return 0.22 * (0.6 + 0.8 * bg);
    case ID.AOW: case ID.VW: return 0.28 * (0.6 + 0.8 * bg);
    case ID.PERI: return 0.38 * (0.6 + 0.8 * bg);
    case ID.PMAL: case ID.PMPM: return 0.26 * (0.6 + 0.8 * bg);
    default: return 0.2 * (0.6 + 0.8 * bg);
  }
}

/** Grey-scale image (RGBA bytes) of a slice. */
export function shade(heart: Heart, s: SliceResult, tex: Textures, o: ShadeOptions = {}): Uint8ClampedArray {
  const { width: W, height: H, mask, apexX, apexY } = s.grid, N = W * H, ids = s.ids, ref = s.ref;
  if (tex.width !== W || tex.height !== H) throw new Error("textures were made for another image size");
  const out = new Uint8ClampedArray(N * 4), Ib = new Float32Array(N), shift = ((o.frame ?? 0) * 7919) % N, gain = o.gain ?? 1;
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    const id = ids[k], bg = tex.blood[(k + shift) % N];
    let tissue = 0;
    if (id >= ID.SEG && ref[k] >= 0) { const vi = ref[k], f = Math.min(NRX - 1, ((heart.trn[vi] / 254) * NRX) | 0), uu = (heart.uq[vi] * 2.83 + heart.zq[vi] * 5) | 0; tissue = tex.tissue[f * NU + (((uu % NU) + NU) % NU)]; }
    Ib[k] = base(id, bg, tissue);
  }
  const terr = o.territories;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, p = k * 4;
    if (!mask[k]) { out[p + 3] = 255; continue; }
    const up = j > 0 ? Ib[k - W] : Ib[k], dn = j < H - 1 ? Ib[k + W] : Ib[k];
    let I = Ib[k] + 0.32 * Math.abs(dn - up);
    const depth = Math.hypot(i - apexX, j - apexY) / H;
    I *= (0.6 + 0.9 * depth) * (1 - Math.pow(Math.abs(Math.atan2(i - apexX, j - apexY)) / SECTOR_HALF_ANGLE, 7) * 0.8) * gain;
    const v = Math.pow(Math.min(1, Math.max(0, I)), 0.82) * 255;
    let r = v, g = v, b = v * 1.03;
    const id = ids[k];
    if (terr && isSegment(id)) { const t = Math.min(1, (terr[id - ID.SEG] ?? 0) * 1.6), al = 0.34; r = r * (1 - al) + (70 + 185 * t) * al; g = g * (1 - al) + (200 - 130 * t) * al; b = b * (1 - al) + (110 - 60 * t) * al; }
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
  }
  return out;
}

export interface LabelPlacement { id: number; text: string; kind: LabelKind; x: number; y: number; w: number; h: number }

/** Where each structure gets its name: the pixel of the region nearest its centroid, thin structures first, overlaps dropped. Pure given a text-width function. */
export function labelPlacements(s: SliceResult, textWidth: (t: string) => number = (t) => t.length * 6.5): LabelPlacement[] {
  const { width: W, height: H, mask } = s.grid, ids = s.ids;
  const cnt = new Float64Array(64), sx = new Float64Array(64), sy = new Float64Array(64);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (!mask[k]) continue; const id = ids[k]; if (id > 0 && id < 64) { cnt[id]++; sx[id] += i; sy[id] += j; } }
  const best: Record<number, [number, number, number]> = {};
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { // every pixel: a valve plane is only a pixel or two thick
    const k = j * W + i, id = ids[k];
    if (!mask[k] || id < 1 || id >= 64 || !cnt[id]) continue;
    const d = (i - sx[id] / cnt[id]) ** 2 + (j - sy[id] / cnt[id]) ** 2;
    if (!best[id] || d < best[id][0]) best[id] = [d, i, j];
  }
  const weight = (id: number) => cnt[id] * (LABELS[id]?.[1] === "x" ? 1e4 : 1); // valves first: they are thin and easily crowded out
  const order = Object.keys(best).map(Number).sort((a, b) => weight(b) - weight(a));
  const out: LabelPlacement[] = [];
  for (const id of order) {
    const lab = LABELS[id];
    if (!lab) continue;
    const minPx = lab[1] === "x" || lab[1] === "w" ? 18 : 90;
    if (cnt[id] < minPx) continue;
    const [, x, y] = best[id], w = textWidth(lab[0]) + 6, rx = x - w / 2, ry = y - 8;
    if (rx < 2 || rx + w > W - 2) continue;
    if (out.some((u) => rx < u.x + u.w && rx + w > u.x && ry < u.y + u.h && ry + 16 > u.y)) continue;
    out.push({ id, text: lab[0], kind: lab[1], x: rx, y: ry, w, h: 16 });
  }
  return out;
}

const LABEL_COLOUR: Record<LabelKind, string> = { c: "#8fd3ff", v: "#9be39b", x: "#ffe27a", w: "#ffb27a", s: "#ffb27a" };

export interface Overlay { title?: string; footer?: string; labels?: boolean }

/** Put a shaded slice on a canvas with its title, footer and labels. */
export function paint(ctx: CanvasRenderingContext2D, heart: Heart, s: SliceResult, tex: Textures, o: ShadeOptions & Overlay = {}) {
  const { width: W, height: H } = s.grid, img = new ImageData(shade(heart, s, tex, o) as Uint8ClampedArray<ArrayBuffer>, W, H);
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "rgba(235,235,225,.85)"; ctx.font = "13px ui-monospace,Menlo,monospace"; ctx.textBaseline = "alphabetic";
  if (o.title) ctx.fillText(o.title, 14, 24);
  if (o.footer) ctx.fillText(o.footer, 14, H - 14);
  if (o.labels) {
    ctx.font = "12px system-ui,sans-serif"; ctx.textBaseline = "middle";
    for (const l of labelPlacements(s, (t) => ctx.measureText(t).width)) {
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(l.x, l.y, l.w, l.h);
      ctx.fillStyle = LABEL_COLOUR[l.kind]; ctx.fillText(l.text, l.x + 3, l.y + 8);
    }
  }
}
