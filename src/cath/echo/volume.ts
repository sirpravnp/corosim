/**
 * The heart volume: a 1 mm label grid of an average four-chamber adult heart, baked from the open mesh of
 * Rodero C, Strocchi M, Marciniak M, et al., "Linking statistical shape models and simulated function in the healthy adult human heart",
 * PLoS Comput Biol 17(4): e1008851 (2021), CC BY 4.0, data at Zenodo 10.5281/zenodo.4593739. The average shape, not a patient.
 *
 * File layout of heart.bin.gz once inflated: four planes of nx*ny*nz bytes, x-major then y then z:
 *   label (region id, see ids.ts), trn (0..254 transmural position of a wall voxel, endocardium to epicardium),
 *   uq (angle about the long axis, quantised), zq (height along it, quantised); the last two give speckle a place to stay on the tissue.
 * Heart frame, cm: x lateral, y anterior, z toward the base, origin at the centre of the LV base, long axis along z.
 */
import type { Procedural } from "./procedural";
import { buildProcedural } from "./procedural";

export type Vec3 = [number, number, number];

export interface Valve { c: Vec3; n: Vec3; R: number }
export interface Ostium { c: Vec3; n: Vec3; r: number }
export interface Tube { vc: Vec3; u: Vec3; end: Vec3; r: number; rwall: number }

/** heart.json */
export interface HeartMeta {
  shape: [number, number, number];
  origin_mm: Vec3;
  valves: Record<"MV" | "TV" | "AV" | "PV", Valve>;
  ostia: Record<"LAA" | "LUPV" | "LLPV" | "RLPV" | "RUPV" | "SVC" | "IVC", Ostium>;
  tubes: { ao: Tube; pa: Tube };
  /** Angle (degrees, −180..180) of the septum-anterior coordinate at each of 72 five-degree steps of the geometric angle about the axis. */
  u_table: number[];
  sign: number;
  lv_apex_cm: Vec3;
  centroids: Record<"LV" | "RV" | "RA" | "LA", Vec3>;
}

export interface Heart {
  meta: HeartMeta;
  nx: number; ny: number; nz: number;
  /** Corner of the grid, mm. */
  lo: Vec3;
  label: Uint8Array; trn: Uint8Array; uq: Uint8Array; zq: Uint8Array;
  /** Flat voxel index of a point in cm, or −1 outside the grid. */
  index(x: number, y: number, z: number): number;
  /** Region id at a point in cm (0 outside or in no region). */
  idAt(x: number, y: number, z: number): number;
  procedural: Procedural;
  /** LV length from the base plane to the apex, cm. */
  lvLength: number;
}

/** Bytes of the inflated file for a given shape. */
export const heartBytes = (shape: readonly number[]) => shape[0] * shape[1] * shape[2] * 4;

/** Index an inflated heart.bin by heart.json (what Node tests call after zlib.gunzipSync). */
export function indexHeart(raw: Uint8Array, meta: HeartMeta): Heart {
  const [nx, ny, nz] = meta.shape, n = nx * ny * nz;
  if (raw.length !== heartBytes(meta.shape)) throw new Error(`heart volume is ${raw.length} bytes, expected ${heartBytes(meta.shape)}`);
  const lo = meta.origin_mm;
  const index = (x: number, y: number, z: number) => {
    const i = Math.round(x * 10 - lo[0]), j = Math.round(y * 10 - lo[1]), k = Math.round(z * 10 - lo[2]);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (i * ny + j) * nz + k;
  };
  const label = raw.subarray(0, n);
  const heart: Heart = {
    meta, nx, ny, nz, lo, label, trn: raw.subarray(n, 2 * n), uq: raw.subarray(2 * n, 3 * n), zq: raw.subarray(3 * n, 4 * n),
    index, idAt: (x, y, z) => { const i = index(x, y, z); return i < 0 ? 0 : label[i]; },
    procedural: undefined as unknown as Procedural, lvLength: -meta.lv_apex_cm[2],
  };
  heart.procedural = buildProcedural(heart);
  return heart;
}

/** Inflate heart.bin.gz in the browser (or Node 18+) with DecompressionStream. */
export async function inflate(gz: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([gz as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Some servers (Vite's dev server among them) send a .gz file with Content-Encoding: gzip, so the browser has already inflated it: accept either form. */
export async function decodeHeart(bytes: Uint8Array, meta: HeartMeta): Promise<Heart> {
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return indexHeart(gzipped ? await inflate(bytes) : bytes, meta);
}

/** For a build that inlines the volume as base64 (the in-chat viewer has no network). */
export async function decodeHeartBase64(b64: string, meta: HeartMeta): Promise<Heart> {
  return decodeHeart(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), meta);
}

/** Fetch and decode from the site's own assets. */
export async function loadHeart(binUrl: string, meta: HeartMeta): Promise<Heart> {
  const r = await fetch(binUrl);
  if (!r.ok) throw new Error(`could not load ${binUrl}: ${r.status}`);
  return decodeHeart(new Uint8Array(await r.arrayBuffer()), meta);
}

/** Voxel counts per region id (tests, and a quick look at what the volume holds). */
export function regionCounts(heart: Heart): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < heart.label.length; i++) { const id = heart.label[i]; m.set(id, (m.get(id) ?? 0) + 1); }
  return m;
}
