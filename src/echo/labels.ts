import { MorphPart } from "../anatomy/heartSurface";
import { Tissue } from "./tissue";
import type { Raster } from "./paint";
import type { Pose } from "./poses";
import type { V3 } from "../anatomy/curve";

/**
 * Structure labels for an echo image, from the classified anatomy of the plane (a `Raster`): every blood pool the plane cuts (the four
 * chambers, the aortic root, the descending aorta, the pulmonary artery, the venae cavae, the pulmonary veins) and pericardial fluid.
 *
 * A structure is labeled only where the plane shows a real cut of it: its largest connected piece must be big enough to read as that
 * structure on screen (a sliver at the edge of the sector, or a chamber just grazed, is left unlabeled, as a sonographer would). The label
 * sits at the point of that piece farthest from its edges (its widest part), so it can never land on a wall or in a neighboring cavity.
 */
export interface StructureLabel { text: string; name: string; depth: number; lateral: number }

const LABELS: Record<number, { text: string; name: string; minArea: number }> = {
  [MorphPart.LV]: { text: "LV", name: "Left ventricle", minArea: 120 },
  [MorphPart.RV]: { text: "RV", name: "Right ventricle", minArea: 100 },
  [MorphPart.RA]: { text: "RA", name: "Right atrium", minArea: 100 },
  [MorphPart.LA]: { text: "LA", name: "Left atrium", minArea: 100 },
  [MorphPart.Aorta]: { text: "Ao", name: "Aorta", minArea: 50 },
  [MorphPart.DAO]: { text: "DAo", name: "Descending aorta", minArea: 50 },
  [MorphPart.PA]: { text: "PA", name: "Pulmonary artery", minArea: 50 },
  [MorphPart.SVC]: { text: "SVC", name: "Superior vena cava", minArea: 40 },
  [MorphPart.IVC]: { text: "IVC", name: "Inferior vena cava", minArea: 40 },
  [MorphPart.PV]: { text: "PV", name: "Pulmonary vein", minArea: 30 },
};
/** Pericardial fluid has no part of its own; it gets this key. */
const EFFUSION = 100;
LABELS[EFFUSION] = { text: "PE", name: "Pericardial effusion", minArea: 60 };
/** The label needs this much room: the piece's widest point must be at least this far (mm) from its edge. */
const MIN_INRADIUS = 2.5;

/**
 * `ctx`, when given, names the outflow tracts: a small cut of the LV whose widest point lies within 22 mm of the aortic valve (`av`, in
 * the patient frame) is the LV outflow tract, and of the RV within 22 mm of the pulmonary valve (`pv`) the RV outflow tract, as in a
 * short axis at the base; not the ventricle's body.
 */
export function structureLabels(r: Raster, ctx?: { pose: Pose; av: V3; pv?: V3 }): StructureLabel[] {
  const { w, h, px } = r, n = w * h, key = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (r.tissue[i] === Tissue.Blood && r.part[i] >= 0 && LABELS[r.part[i]]) key[i] = r.part[i];
    else if (r.tissue[i] === Tissue.Fluid) key[i] = EFFUSION;
  }
  // connected pieces of each structure (4-neighbour), keeping each structure's largest
  const comp = new Int32Array(n).fill(-1), best = new Map<number, { id: number; size: number }>(), stack: number[] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (key[s] < 0 || comp[s] >= 0) continue;
    let size = 0; stack.push(s); comp[s] = id;
    while (stack.length) {
      const i = stack.pop()!; size++;
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && comp[j] < 0 && key[j] === key[s]) { comp[j] = id; stack.push(j); }
      }
    }
    const b = best.get(key[s]);
    if (!b || size > b.size) best.set(key[s], { id, size });
    id++;
  }
  // distance to the piece's edge (chamfer 3-4, two passes), in pixels; the label goes where it is largest
  const out: StructureLabel[] = [];
  const dist = new Float32Array(n);
  for (const [k, b] of best) {
    const spec = LABELS[k], area = b.size / (px * px);
    if (area < spec.minArea) continue;
    const inside = (i: number) => comp[i] === b.id;
    for (let i = 0; i < n; i++) dist[i] = inside(i) ? 1e9 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!dist[i]) continue;
      let d = dist[i];
      if (x === 0 || y === 0 || x === w - 1) d = Math.min(d, 3);
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) { d = Math.min(d, dist[i - w] + 3); if (x > 0) d = Math.min(d, dist[i - w - 1] + 4); if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 4); }
      dist[i] = d;
    }
    let bi = -1, bd = 0;
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!dist[i]) continue;
      let d = dist[i];
      if (x === w - 1 || y === h - 1) d = Math.min(d, 3);
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < h - 1) { d = Math.min(d, dist[i + w] + 3); if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 4); if (x > 0) d = Math.min(d, dist[i + w - 1] + 4); }
      dist[i] = d;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bi < 0 || bd / 3 / px < MIN_INRADIUS) continue;
    const x = bi % w, y = (bi - x) / w, depth = (y + 0.5) / px, lateral = (x + 0.5 - w / 2) / px;
    // the outflow tracts: a small cut of a ventricle close to its semilunar valve
    const near = (v: V3 | undefined) => { if (!v || !ctx) return false; const P = ctx.pose, q = [0, 1, 2].map((a) => P.probe[a] + P.beam[a] * depth + P.lateral[a] * lateral); return Math.hypot(q[0] - v[0], q[1] - v[1], q[2] - v[2]) < 22; };
    if (k === MorphPart.LV && area < 700 && near(ctx?.av)) { out.push({ text: "LVOT", name: "LV outflow tract", depth, lateral }); continue; }
    if (k === MorphPart.RV && area < 700 && near(ctx?.pv)) { out.push({ text: "RVOT", name: "RV outflow tract", depth, lateral }); continue; }
    out.push({ text: spec.text, name: spec.name, depth, lateral });
  }
  return out;
}
