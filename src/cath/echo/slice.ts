/**
 * The slicer: a view, an omniplane angle and a moment of the cardiac cycle in, a map of region ids out. No canvas, no pixels, no randomness.
 *
 * The image is a sector fan: apex near the top centre, ±SECTOR_HALF_ANGLE (rad) either side of the beam, depth `view.depth` cm at the bottom.
 * Each pixel is a point in the heart frame (cm). The LV is sampled by reference position through the wall motion (motion.ts); valve
 * leaflets are thin cones around each valve's axis; vessels the mesh lacks come from procedural.ts.
 */
import { ID, isLeftVentricle } from "./ids";
import type { Cycle, MotionField } from "./motion";
import { DIASTOLE } from "./motion";
import { capHit } from "./procedural";
import { planeBasis, type View } from "./views";
import { D2R } from "./vec";
import type { Heart, Vec3 } from "./volume";

export const SECTOR_HALF_ANGLE = 0.62;

export interface SliceGrid {
  width: number; height: number;
  /** Sample point in the heart frame (cm), 3 floats per pixel. */
  xyz: Float32Array;
  /** 1 inside the sector. */
  mask: Uint8Array;
  /** Pixels per cm. */
  ppc: number;
  /** Sector apex in pixels. */
  apexX: number; apexY: number;
}

/** The sample positions of a view at an omniplane angle (the geometry; independent of the cardiac cycle, so a caller may cache it). */
export function sliceGrid(view: View, ang: number, width: number, height: number): SliceGrid {
  const { b, hh } = planeBasis(view, ang), apexX = width / 2, apexY = -height * 0.02, ppc = (height * 0.97) / view.depth;
  const xyz = new Float32Array(width * height * 3), mask = new Uint8Array(width * height), P = view.P;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const k = j * width + i, xa = i - apexX, ya = j - apexY, rho = Math.hypot(xa, ya), a = Math.atan2(xa, ya);
    mask[k] = Math.abs(a) < SECTOR_HALF_ANGLE && rho > height * 0.02 && rho < height * 0.97 ? 1 : 0;
    const r = rho / ppc, c = Math.cos(a), s = Math.sin(a);
    xyz[k * 3] = P[0] + r * (c * b[0] + s * hh[0]);
    xyz[k * 3 + 1] = P[1] + r * (c * b[1] + s * hh[1]);
    xyz[k * 3 + 2] = P[2] + r * (c * b[2] + s * hh[2]);
  }
  return { width, height, xyz, mask, ppc, apexX, apexY };
}

export interface SliceResult {
  grid: SliceGrid;
  /** Region id per pixel (0 where nothing is; also 0 outside the sector, see grid.mask). */
  ids: Uint8Array;
  /** Voxel the tissue at each pixel was read from (−1 if none): where a wall pixel's speckle lives. */
  ref: Int32Array;
}

const UPSTREAM: Record<number, number> = { [ID.MV]: ID.LA, [ID.TV]: ID.RA, [ID.AV]: ID.LVOT, [ID.PV]: ID.RVOT };
const VALVES = ["MV", "TV", "AV", "PV"] as const;
const VALVE_OPEN: Record<(typeof VALVES)[number], keyof Cycle> = { MV: "mvOpen", TV: "tvOpen", AV: "avOpen", PV: "pvOpen" };

export interface SliceState {
  cycle?: Cycle;
  /** Wall motion; omitted means the LV is still. */
  motion?: MotionField;
}

/** Cut the heart. */
export function sliceHeart(heart: Heart, grid: SliceGrid, state: SliceState = {}): SliceResult {
  const { width, height, xyz, mask } = grid, N = width * height;
  const ids = new Uint8Array(N), ref = new Int32Array(N).fill(-1);
  const cycle = state.cycle ?? DIASTOLE, motion = state.motion, sys = cycle.sys;
  const V = heart.meta.valves, UT = heart.meta.u_table, L = heart.lvLength, label = heart.label, trn = heart.trn;
  const pap = heart.procedural.papillary;
  const open = VALVES.map((n) => cycle[VALVE_OPEN[n]] as boolean);
  for (let k = 0; k < N; k++) {
    if (!mask[k]) continue;
    const x = xyz[k * 3], y = xyz[k * 3 + 1], z = xyz[k * 3 + 2];
    let id = 0, vi = -1, rx = x, ry = y, rz = z, mm = 0;
    // left ventricle: the end-diastolic volume, read at the reference position of this point
    const r2 = x * x + y * y;
    if (motion && r2 < 20 && z < 0.7 && z > -L - 1) {
      const r = Math.sqrt(r2), psi = Math.atan2(y, x);
      let pd = psi / D2R; if (pd < 0) pd += 360;
      const ui = Math.round(UT[Math.min(71, (pd / 5) | 0)] + 180), zf = Math.max(0, Math.min(1, (z + L) / L));
      mm = sys * motion.peak(Math.min(360, Math.max(0, ui)), zf);
      const cp = Math.cos(psi), sp = Math.sin(psi);
      let w = 1;
      for (let it = 0; it < 2; it++) {
        const r0 = r / (1 - mm * w), z0 = z / (1 - 0.3 * mm), j = heart.index(cp * r0, sp * r0, z0);
        if (j >= 0 && isLeftVentricle(label[j])) {
          vi = j; rx = cp * r0; ry = sp * r0; rz = z0;
          const rho = trn[j] / 254;
          w = label[j] >= ID.SEG ? 1 - 0.55 * (rho > 1 ? 0 : rho) : 1; // the wall moves less toward the epicardium
        } else { vi = -1; break; }
      }
    }
    if (vi < 0) { vi = heart.index(x, y, z); rx = x; ry = y; rz = z; }
    id = vi >= 0 ? label[vi] : 0;
    // valve leaflets: thin cones about the valve axis while open
    let leaf = 0;
    for (let q = 0; q < 4; q++) {
      const nm = VALVES[q], v = V[nm], ox = x - v.c[0], oy = y - v.c[1], oz = z - v.c[2];
      if (Math.abs(ox) > v.R + 0.6 || Math.abs(oy) > v.R + 0.6 || Math.abs(oz) > v.R + 1.5) continue;
      const h = ox * v.n[0] + oy * v.n[1] + oz * v.n[2], px = ox - h * v.n[0], py = oy - h * v.n[1], pz = oz - h * v.n[2], rho = Math.hypot(px, py, pz);
      if (nm === "MV" || nm === "TV") { if (open[q] && h > 0 && h < 1.2 && Math.abs(rho - v.R * 0.95 * (1 - 0.62 * h / 1.2)) < 0.09) { leaf = ID[nm]; break; } }
      else if (open[q] && h > 0 && h < 0.9 && Math.abs(rho - v.R) < 0.08) { leaf = ID[nm]; break; }
    }
    if (leaf) id = leaf;
    else if (id >= ID.MV && id <= ID.PV) { // valve plane: shown while closed, blood while open
      if (open[id === ID.MV ? 0 : id === ID.TV ? 1 : id === ID.AV ? 2 : 3]) id = UPSTREAM[id];
    } else if (id === 0 || id === ID.PERI) {
      const hit = capHit(heart.procedural, x, y, z);
      if (hit) id = hit[0];
    }
    // papillary muscles ride with the contracting wall
    if (id === ID.LV && pap.length) {
      for (let q = 0; q < pap.length; q++) {
        const p = pap[q], cx0 = Math.cos(p.psi) * p.r, cy0 = Math.sin(p.psi) * p.r, dx = rx - cx0, dy = ry - cy0, dz = rz - p.z;
        const rad = dx * Math.cos(p.psi) + dy * Math.sin(p.psi), tan = -dx * Math.sin(p.psi) + dy * Math.cos(p.psi);
        if ((rad * rad) / 0.30 + (tan * tan) / 0.30 + (dz * dz) / 1.5 < 1) id = p.id;
      }
    }
    ids[k] = id; ref[k] = vi;
  }
  return { grid, ids, ref };
}

/** Pixel count per region id inside the sector. */
export function idCounts(s: SliceResult): Map<number, number> {
  const m = new Map<number, number>();
  for (let k = 0; k < s.ids.length; k++) if (s.grid.mask[k] && s.ids[k]) m.set(s.ids[k], (m.get(s.ids[k]) ?? 0) + 1);
  return m;
}

/** Centroid in pixels of a region (or of a set of ids), or null if absent. */
export function centroid(s: SliceResult, ...which: number[]): { x: number; y: number; n: number } | null {
  let sx = 0, sy = 0, n = 0;
  const w = s.grid.width, set = new Set(which);
  for (let k = 0; k < s.ids.length; k++) if (s.grid.mask[k] && set.has(s.ids[k])) { sx += k % w; sy += (k / w) | 0; n++; }
  return n ? { x: sx / n, y: sy / n, n } : null;
}
