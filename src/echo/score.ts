import { MorphPart, Part } from "../anatomy/heartSurface";
import { Tissue } from "./tissue";
import { Pose } from "./poses";
import { rasterize } from "./paint";

/**
 * Automated judge of a probe pose: how well the slice it cuts matches a textbook description of a view. Pure and deterministic.
 * A spec lists what must be present, what must be absent, which structures sit nearer the probe than which, how much of the
 * fan the heart may fill, and how centered it sits. Every number in VIEW_SPECS marked "guess" is the author's estimate from
 * standard echo teaching, not a measurement; tune them against the calibrated poses, not the other way round.
 */

/** The slice of a Raster the scorer reads. A Raster satisfies it; tests build synthetic ones. */
export interface RasterLike {
  w: number;
  h: number;
  px: number;
  /** Part index (a `Part`), -1 outside the heart, -2 outside the sector. */
  part: Int8Array;
  /** `Tissue` per pixel. */
  tissue: Uint8Array;
}

/** A selector: pixels with this part and/or this tissue (both when both are given). Fractions are of fan pixels. */
interface Sel { part?: Part; tissue?: Tissue }

export interface ViewSpec {
  id: string;
  present: (Sel & { minFrac: number; weight: number })[];
  absent: (Sel & { maxFrac: number; weight: number })[];
  /** Parts listed nearest-first along the axis: "depth" is down the beam, "lateral" is left to right in the image. */
  order?: { by: "depth" | "lateral"; parts: Part[]; weight: number }[];
  /** Allowed range of heart pixels over fan pixels. */
  fill: [number, number];
  /** Weight of the term rewarding a heart centroid on the fan's center line. */
  centered: number;
  /** Shape quality: how the chambers look, not only which ones are present. Optional so older specs keep working. */
  shape?: ShapeSpec;
}

/**
 * Shape terms, all measured on blood-pool pixels of a chamber. Angles are of the chamber's long axis from the image's horizontal, folded
 * to 0..90 degrees (0 = lies across the image, 90 = runs straight down the beam). Elongation is the ratio of the principal axes (1 = round).
 */
export interface ShapeSpec {
  /** The LV cavity's size, orientation and elongation. */
  lv?: { minFrac: number; axisDeg?: [number, number]; elong?: [number, number]; weight: number };
  /** Each listed chamber's blood should be one connected region: the largest piece is at least `minLargest` of its blood pixels. */
  oneBlob?: { parts: Part[]; minLargest: number; weight: number };
  /** Heart pixels touching the fan's edge or the image border, as a fraction of heart pixels (a clipped heart is a bad frame). */
  clipped?: { maxFrac: number; weight: number };
}

const { LV, RV, RA, LA, Aorta } = Part;

/** Weight given to the fill term in every spec. */
const FILL_WEIGHT = 1;

/*
 * Numbers marked "guess" are estimates. Fractions are of fan pixels; the fan is a 90 degree sector, and the framing fits the
 * heart to roughly 70 percent of its height, so a 0.04 fraction is a modest but unmistakable region.
 * Part has no IVC or valve entries: valves are Tissue.Leaflet, and the IVC reads as RA blood (or Part.RA wall) here.
 */
export const VIEW_SPECS: Record<string, ViewSpec> = {
  // Parasternal long axis: RV nearest the probe, then septum, LV; aorta and LA to the far (lateral) side; mitral and aortic leaflets; no RA, no tricuspid.
  plax: {
    id: "plax",
    present: [
      { part: RV, minFrac: 0.04, weight: 1 },              // guess
      { part: LV, minFrac: 0.12, weight: 2 },              // guess
      { part: LA, minFrac: 0.04, weight: 1.5 },            // guess
      { part: Aorta, minFrac: 0.02, weight: 1.5 },         // guess
      { tissue: Tissue.Septum, minFrac: 0.01, weight: 1 }, // guess
      { tissue: Tissue.Leaflet, minFrac: 0.003, weight: 1 }, // guess: mitral plus aortic
    ],
    absent: [{ part: RA, maxFrac: 0.01, weight: 1.5 }],    // guess
    order: [
      { by: "depth", parts: [RV, LV], weight: 1.5 },
      { by: "depth", parts: [RV, LA], weight: 1 },
      { by: "lateral", parts: [LV, LA], weight: 1 },       // LA/aorta on the far side of the mitral/aortic plane
    ],
    fill: [0.3, 0.75], centered: 0.5,                      // guess
    shape: { lv: { minFrac: 0.08, axisDeg: [0, 40], elong: [1.7, 3.5], weight: 4 }, oneBlob: { parts: [LV, LA, RV], minLargest: 0.9, weight: 1.5 }, clipped: { maxFrac: 0.06, weight: 2 } },
  },
  // Parasternal short axis at papillary level: round LV with two papillary muscles, RV crescent anterior (nearer the probe), no atria.
  psaxPM: {
    id: "psaxPM",
    present: [
      { part: LV, minFrac: 0.15, weight: 2.5 },            // guess
      { part: RV, minFrac: 0.03, weight: 1.5 },            // guess
      { tissue: Tissue.Papillary, minFrac: 0.006, weight: 1.5 }, // guess: two small heads
      { tissue: Tissue.Septum, minFrac: 0.01, weight: 1 }, // guess
    ],
    absent: [
      { part: LA, maxFrac: 0.01, weight: 1.5 },
      { part: RA, maxFrac: 0.01, weight: 1.5 },
      { part: Aorta, maxFrac: 0.01, weight: 1 },
    ],
    order: [{ by: "depth", parts: [RV, LV], weight: 1.5 }],
    fill: [0.2, 0.6], centered: 1,                         // guess
    shape: { lv: { minFrac: 0.1, elong: [1, 1.3], weight: 4 }, oneBlob: { parts: [LV, RV], minLargest: 0.9, weight: 1.5 }, clipped: { maxFrac: 0.06, weight: 2 } },
  },
  // Subcostal four-chamber: all four chambers, septum, both AV valves; apex toward one side of the image.
  subcostal: {
    id: "subcostal",
    present: [
      { part: LV, minFrac: 0.06, weight: 1.5 },            // guess
      { part: RV, minFrac: 0.06, weight: 1.5 },
      { part: LA, minFrac: 0.03, weight: 1.5 },
      { part: RA, minFrac: 0.03, weight: 1.5 },
      { tissue: Tissue.Septum, minFrac: 0.01, weight: 1 },
      { tissue: Tissue.Leaflet, minFrac: 0.003, weight: 1 }, // both AV valves
    ],
    absent: [{ part: Aorta, maxFrac: 0.02, weight: 1 }],   // guess: a little root may show
    order: [{ by: "lateral", parts: [RV, LV], weight: 1 }], // guess: apex to one side; direction depends on the index mark
    fill: [0.3, 0.8], centered: 0.5,                       // guess
    shape: { lv: { minFrac: 0.05, axisDeg: [0, 45], elong: [1.4, 3.2], weight: 3 }, oneBlob: { parts: [LV, RV, LA, RA], minLargest: 0.85, weight: 1.5 }, clipped: { maxFrac: 0.08, weight: 2 } },
  },
  // Apical four-chamber: apex at the top (ventricles nearest the probe, atria deepest), all four chambers, both AV valves.
  a4c: {
    id: "a4c",
    present: [
      { part: LV, minFrac: 0.06, weight: 1.5 }, { part: RV, minFrac: 0.05, weight: 1.5 },
      { part: LA, minFrac: 0.03, weight: 1.5 }, { part: RA, minFrac: 0.03, weight: 1.5 },
      { tissue: Tissue.Septum, minFrac: 0.01, weight: 1 }, { tissue: Tissue.Leaflet, minFrac: 0.003, weight: 1 },
    ],
    absent: [{ part: Aorta, maxFrac: 0.02, weight: 1 }],
    order: [
      { by: "depth", parts: [LV, LA], weight: 1.5 }, { by: "depth", parts: [RV, RA], weight: 1.5 },
      { by: "lateral", parts: [RV, LV], weight: 1 },       // guess: standard display has RV on the image left
    ],
    fill: [0.3, 0.8], centered: 0.5,                       // all guesses
    shape: { lv: { minFrac: 0.05, axisDeg: [55, 90], elong: [1.6, 3.5], weight: 3 }, oneBlob: { parts: [LV, RV, LA, RA], minLargest: 0.85, weight: 1.5 }, clipped: { maxFrac: 0.08, weight: 2 } },
  },
  // Apical two-chamber: LV and LA only; no RV, no RA, no tricuspid.
  a2c: {
    id: "a2c",
    present: [
      { part: LV, minFrac: 0.1, weight: 2.5 }, { part: LA, minFrac: 0.03, weight: 2 },
      { tissue: Tissue.Leaflet, minFrac: 0.002, weight: 1 },
    ],
    absent: [{ part: RV, maxFrac: 0.01, weight: 2 }, { part: RA, maxFrac: 0.01, weight: 2 }, { part: Aorta, maxFrac: 0.01, weight: 1 }],
    order: [{ by: "depth", parts: [LV, LA], weight: 1.5 }],
    fill: [0.2, 0.6], centered: 0.7,                       // all guesses
    shape: { lv: { minFrac: 0.08, axisDeg: [55, 90], elong: [1.6, 3.5], weight: 3 }, oneBlob: { parts: [LV, LA], minLargest: 0.9, weight: 1.5 }, clipped: { maxFrac: 0.08, weight: 2 } },
  },
  // Apical three-chamber: LV, LA and aorta (outflow tract); RV mostly absent.
  a3c: {
    id: "a3c",
    present: [
      { part: LV, minFrac: 0.1, weight: 2 }, { part: LA, minFrac: 0.03, weight: 1.5 }, { part: Aorta, minFrac: 0.02, weight: 2 },
      { tissue: Tissue.Leaflet, minFrac: 0.003, weight: 1 },
    ],
    absent: [{ part: RA, maxFrac: 0.01, weight: 1.5 }, { part: RV, maxFrac: 0.03, weight: 1 }],
    order: [{ by: "depth", parts: [LV, LA], weight: 1 }],
    fill: [0.2, 0.6], centered: 0.6,                       // all guesses
    shape: { lv: { minFrac: 0.08, axisDeg: [55, 90], elong: [1.6, 3.5], weight: 3 }, oneBlob: { parts: [LV, LA, Aorta], minLargest: 0.85, weight: 1.5 }, clipped: { maxFrac: 0.08, weight: 2 } },
  },
  // Parasternal short axis at the mitral valve: LV ring with the fish-mouth leaflets, RV crescent anterior.
  psaxMV: {
    id: "psaxMV",
    present: [
      { part: LV, minFrac: 0.1, weight: 2 }, { part: RV, minFrac: 0.03, weight: 1.5 },
      { tissue: Tissue.Leaflet, minFrac: 0.01, weight: 2.5 }, // guess: the fish-mouth opening
    ],
    absent: [{ part: RA, maxFrac: 0.01, weight: 1 }, { part: Aorta, maxFrac: 0.01, weight: 1 }],
    order: [{ by: "depth", parts: [RV, LV], weight: 1.5 }],
    fill: [0.2, 0.6], centered: 1,                         // all guesses
  },
  // Parasternal short axis at the aortic valve: cusps in the middle, RA (tricuspid side), RV outflow and LA around it.
  psaxAV: {
    id: "psaxAV",
    present: [
      { part: Aorta, minFrac: 0.03, weight: 2.5 }, { tissue: Tissue.Leaflet, minFrac: 0.004, weight: 2 },
      { part: RA, minFrac: 0.02, weight: 1 }, { part: RV, minFrac: 0.03, weight: 1.5 }, { part: LA, minFrac: 0.03, weight: 1.5 },
    ],
    absent: [{ part: LV, maxFrac: 0.03, weight: 1 }],
    order: [{ by: "depth", parts: [RV, Aorta, LA], weight: 1.5 }],
    fill: [0.25, 0.7], centered: 1,                        // all guesses
  },
  // Subcostal IVC: the inferior vena cava entering the right atrium, little of the left heart.
  ivc: {
    id: "ivc",
    present: [{ part: RA, minFrac: 0.06, weight: 2 }, { part: MorphPart.IVC as number as Part, minFrac: 0.012, weight: 3 }],
    absent: [{ part: LV, maxFrac: 0.02, weight: 1.5 }, { part: LA, maxFrac: 0.02, weight: 1 }],
    fill: [0.1, 0.6], centered: 0.5,                       // all guesses
  },
  // Parasternal short axis at the apex: a small round LV cavity, a sliver of RV in front, nothing else.
  psaxApex: {
    id: "psaxApex",
    present: [{ part: LV, minFrac: 0.08, weight: 2.5 }, { part: RV, minFrac: 0.02, weight: 1 }],
    absent: [{ part: LA, maxFrac: 0.005, weight: 1.5 }, { part: RA, maxFrac: 0.005, weight: 1.5 }, { part: Aorta, maxFrac: 0.005, weight: 1 }],
    order: [{ by: "depth", parts: [RV, LV], weight: 1.5 }],
    fill: [0.15, 0.7], centered: 1,                        // all guesses
    shape: { lv: { minFrac: 0.06, elong: [1, 1.5], weight: 3 }, oneBlob: { parts: [LV], minLargest: 0.9, weight: 1 }, clipped: { maxFrac: 0.08, weight: 2 } },
  },
  // Apical five-chamber: the four-chamber view tilted up to bring in the LV outflow and the aortic valve.
  a5c: {
    id: "a5c",
    present: [
      { part: LV, minFrac: 0.05, weight: 1.5 }, { part: RV, minFrac: 0.01, weight: 1 }, { part: LA, minFrac: 0.02, weight: 1 },
      { part: RA, minFrac: 0.02, weight: 1 }, { part: Aorta, minFrac: 0.004, weight: 2 }, { tissue: Tissue.Leaflet, minFrac: 0.002, weight: 1 },
    ],
    absent: [],
    order: [{ by: "depth", parts: [LV, LA], weight: 1.5 }],
    fill: [0.2, 0.8], centered: 0.5,                       // all guesses
  },
  // RV inflow: right ventricle and right atrium with the tricuspid valve between them; no left heart.
  rvInflow: {
    id: "rvInflow",
    present: [{ part: RV, minFrac: 0.12, weight: 2 }, { part: RA, minFrac: 0.06, weight: 2 }, { tissue: Tissue.Leaflet, minFrac: 0.002, weight: 1 }],
    absent: [{ part: LV, maxFrac: 0.02, weight: 2 }, { part: LA, maxFrac: 0.01, weight: 1.5 }],
    order: [{ by: "depth", parts: [RV, RA], weight: 1.5 }],
    fill: [0.25, 0.85], centered: 0.5,                     // all guesses
  },
  // Suprasternal long axis: the aortic arch across the top of the image, the left atrium under it; no left ventricle.
  suprasternal: {
    id: "suprasternal",
    present: [{ part: Aorta, minFrac: 0.05, weight: 3 }, { part: MorphPart.DAO as number as Part, minFrac: 0.01, weight: 1.5 }, { part: LA, minFrac: 0.02, weight: 1 }],
    absent: [{ part: LV, maxFrac: 0.02, weight: 2 }],
    order: [{ by: "depth", parts: [Aorta, LA], weight: 1.5 }],
    fill: [0.1, 0.8], centered: 0.3,                       // all guesses
  },
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 1 inside [lo, hi], falling linearly to 0 over `soft` outside it. */
const band = (v: number, lo: number, hi: number, soft: number) => v >= lo && v <= hi ? 1 : clamp01(1 - (v < lo ? lo - v : v - hi) / soft);

export interface BlobStats { count: number; largest: number; cx: number; cy: number; axisDeg: number; elong: number }

/** Connected pieces (4-neighborhood) of one chamber's blood pixels; centroid, orientation and elongation of the largest piece. */
export function blobStats(r: RasterLike, part: Part): BlobStats {
  const { w, h } = r, n = w * h, seen = new Uint8Array(n);
  let count = 0, largest = 0, best: number[] = [];
  const stack: number[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (seen[i0] || r.part[i0] !== part || r.tissue[i0] !== Tissue.Blood) continue;
    const piece: number[] = [];
    stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % w;
      piece.push(i);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || seen[j] || r.part[j] !== part || r.tissue[j] !== Tissue.Blood) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    count += piece.length;
    if (piece.length > largest) { largest = piece.length; best = piece; }
  }
  if (largest === 0) return { count: 0, largest: 0, cx: 0, cy: 0, axisDeg: 0, elong: 1 };
  let mx = 0, my = 0;
  for (const i of best) { mx += i % w; my += (i / w) | 0; }
  mx /= largest; my /= largest;
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of best) { const dx = (i % w) - mx, dy = ((i / w) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= largest; syy /= largest; sxy /= largest;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = Math.abs((0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI); // 0 = horizontal, folded to 0..90 (the sign is dropped)
  return { count, largest, cx: mx, cy: my, axisDeg: ang, elong: Math.sqrt(l1 / l2) };
}

function matches(r: RasterLike, s: Sel, i: number): boolean {
  if (s.part !== undefined && r.part[i] !== s.part) return false;
  if (s.tissue !== undefined && r.tissue[i] !== s.tissue) return false;
  return true;
}

/** Score a raster against a spec: weighted mean of term scores in 0..1, plus the per-term detail. */
export function scoreRaster(r: RasterLike, spec: ViewSpec): { score: number; detail: Record<string, number> } {
  const n = r.w * r.h;
  let fan = 0, heart = 0, hx = 0;
  // Per-part pixel counts and centroids.
  const cnt = [0, 0, 0, 0, 0], cx = [0, 0, 0, 0, 0], cy = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = r.part[i];
    if (p === -2) continue;
    fan++;
    if (p < 0) continue;
    heart++;
    const x = i % r.w, y = (i - x) / r.w;
    hx += x;
    if (p < 5) { cnt[p]++; cx[p] += x; cy[p] += y; }
  }
  const detail: Record<string, number> = {};
  let sum = 0, wsum = 0;
  const add = (key: string, v: number, w: number) => {
    detail[key] = v;
    sum += v * w; wsum += w;
  };
  const name = (s: Sel) => [s.part !== undefined ? Part[s.part] : "", s.tissue !== undefined ? Tissue[s.tissue] : ""].filter(Boolean).join("+");
  const frac = (s: Sel) => {
    if (fan === 0) return 0;
    let c = 0;
    for (let i = 0; i < n; i++) if (r.part[i] !== -2 && matches(r, s, i)) c++;
    return c / fan;
  };

  for (const t of spec.present) add(`present ${name(t)}`, clamp01(frac(t) / t.minFrac), t.weight);
  for (const t of spec.absent) {
    const f = frac(t);
    add(`absent ${name(t)}`, f <= t.maxFrac ? 1 : clamp01(1 - (f - t.maxFrac) / (t.maxFrac + 0.03)), t.weight);
  }
  for (const o of spec.order ?? []) {
    const key = `order ${o.by} ${o.parts.map((p) => Part[p]).join("<")}`;
    const dim = o.by === "depth" ? r.h : r.w;
    const margin = 0.06 * dim; // a centroid gap of this many pixels counts as fully ordered
    let v = 1;
    for (let k = 0; k + 1 < o.parts.length; k++) {
      const a = o.parts[k], b = o.parts[k + 1];
      if (cnt[a] === 0 || cnt[b] === 0) { v = 0; break; }
      const ca = (o.by === "depth" ? cy[a] : cx[a]) / cnt[a], cb = (o.by === "depth" ? cy[b] : cx[b]) / cnt[b];
      v = Math.min(v, clamp01(0.5 + (cb - ca) / (2 * margin)));
    }
    add(key, v, o.weight);
  }
  const hf = fan === 0 ? 0 : heart / fan;
  const [lo, hi] = spec.fill;
  add("fill", hf >= lo && hf <= hi ? 1 : hf < lo ? clamp01(hf / lo) : clamp01(1 - (hf - hi) / Math.max(hi, 0.1)), FILL_WEIGHT);
  if (spec.centered > 0) add("centered", heart === 0 ? 0 : clamp01(1 - Math.abs(hx / heart - (r.w - 1) / 2) / (r.w / 4)), spec.centered);

  const sh = spec.shape;
  if (sh?.lv) {
    const b = blobStats(r, LV), f = fan === 0 ? 0 : b.largest / fan, t = sh.lv;
    let v = clamp01(f / t.minFrac);
    if (t.axisDeg) v = Math.min(v, band(b.axisDeg, t.axisDeg[0], t.axisDeg[1], 30));
    if (t.elong) v = Math.min(v, band(b.elong, t.elong[0], t.elong[1], 0.8));
    add("shape LV", b.largest === 0 ? 0 : v, t.weight);
    detail["LV axis deg"] = b.axisDeg; detail["LV elong"] = b.elong;
  }
  if (sh?.oneBlob) {
    for (const p of sh.oneBlob.parts) {
      const b = blobStats(r, p);
      add(`oneBlob ${Part[p]}`, b.count === 0 ? 0 : clamp01((b.largest / b.count - 0.5) / (sh.oneBlob.minLargest - 0.5)), sh.oneBlob.weight);
    }
  }
  if (sh?.clipped) {
    let edge = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (r.part[i] < 0) continue;
      let touches = false;
      for (let dy = -2; dy <= 2 && !touches; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= r.w || yy >= r.h || r.part[yy * r.w + xx] === -2) { touches = true; break; }
      }
      if (touches) edge++;
    }
    const f = heart === 0 ? 1 : edge / heart;
    add("clipped", f <= sh.clipped.maxFrac ? 1 : clamp01(1 - (f - sh.clipped.maxFrac) / 0.25), sh.clipped.weight);
  }

  return { score: wsum > 0 ? sum / wsum : 0, detail };
}

/** Rasterize a pose at low resolution and score it. */
export function scorePose(pose: Pose, spec: ViewSpec, res: [number, number] = [90, 100]): number {
  return scoreRaster(rasterize(pose, res[0], res[1]), spec).score;
}
