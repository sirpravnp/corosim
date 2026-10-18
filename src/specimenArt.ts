// Pictures of the day's heart, as the masks the stippler wants (see stipple.ts): the body of the heart, and the
// vessels on it. An animal's heart is a short list of shapes drawn on a 100 × 100 sheet; a human variant is the
// simulator's own coronary tree, projected onto the procedural heart it sits on; the textbook heart is the logo.
import { Variant, buildTree, diameterAt, rotateHeart } from "./anatomy/tree";
import { projectToEpicardium } from "./anatomy/heartSurface";
import { HEART_OUTLINE } from "./heartOutline";
import { Field, fieldFromLogo, fieldFromMasks, mask } from "./stipple";
import { Specimen } from "./specimens";

// ---------------------------------------------------------------- the drawing vocabulary
type Pt = [number, number];
/** A shape on the 100 × 100 sheet (y down): an ellipse (centre, radii, rotation in degrees clockwise), a tube along a
 *  smooth path through (x, y, radius) points, or a smooth closed blob through points. */
export type Prim = { e: [number, number, number, number, number?] } | { t: [number, number, number][] } | { b: Pt[] };
export interface Recipe { body: Prim[]; vessels: Prim[]; warm?: Prim[]; holes?: Prim[] } // warm: the path of the blood through chambers, cooler than the vessels

const E = (cx: number, cy: number, rx: number, ry: number, rot = 0): Prim => ({ e: [cx, cy, rx, ry, rot] });
const T = (...pts: [number, number, number][]): Prim => ({ t: pts });
const B = (...pts: Pt[]): Prim => ({ b: pts });
/** The same shape mirrored left to right about x = 50. */
const mirror = (p: Prim): Prim => "e" in p ? E(100 - p.e[0], p.e[1], p.e[2], p.e[3], -(p.e[4] ?? 0)) : "t" in p ? { t: p.t.map(([x, y, r]) => [100 - x, y, r] as [number, number, number]) } : { b: p.b.map(([x, y]) => [100 - x, y] as Pt) };
const both = (...ps: Prim[]) => ps.flatMap((p) => [p, mirror(p)]);

/** A mammal's heart: ventricles tapering to an apex, two atria, the great vessels, and the coronary arteries in their
 *  grooves. `w` and `h` stretch the ventricles; `big` thickens the great vessels; the apex is a point, or two (bifid). */
function mammal(o: { w?: number; h?: number; big?: number; apex?: "point" | "bifid"; lean?: number } = {}): Recipe {
  const w = o.w ?? 1, h = o.h ?? 1, g = o.big ?? 1, lean = o.lean ?? 15;
  const base = 62 - 30 * h, ay = 62 + 28 * h - 6; // where the great vessels leave, and the apex
  const bifid = o.apex === "bifid";
  return {
    body: [
      bifid ? E(50, 55, 25 * w, 26 * h, lean) : E(50, 62, 25 * w, 30 * h, lean),
      ...(bifid ? [T([36, 68, 13 * w], [31, 85, 8]), T([62, 68, 13 * w], [66, 86, 8])] : [T([43, 70, 14 * w], [39, 92, 2.2])]),
      E(31, base + 6, 10, 9, -20), E(70, base + 7, 9, 7, 30),
    ],
    vessels: [
      T([47, base + 10, 3.8 * g], [47, base - 8, 3.8 * g], [53, base - 18, 3.6 * g], [64, base - 20, 3.4 * g], [72, base - 12, 3.2 * g]), // aorta
      T([55, base + 10, 3.1 * g], [58, base - 2, 3.1 * g], [66, base - 6, 2.9 * g], [78, base - 4, 2.6 * g]), // pulmonary trunk
      T([31, base + 10, 2.8 * g], [29, base - 8, 2.8 * g], [29, base - 20, 2.6 * g]), // vena cava
      T([57, base + 8, 1.7], [55, ay - 40, 1.6], [49, ay - 22, 1.5], [43, ay - 8, 1.3], [40, ay, 1]), // LAD
      T([55, base + 16, 1], [65, base + 28, 1], [69, base + 42, 0.9]), // diagonal
      T([59, base + 7, 1.6], [69, base + 14, 1.5], [72, base + 28, 1.3], [70, base + 40, 1]), // circumflex
      T([46, base + 7, 1.8], [35, base + 15, 1.7], [29, base + 30, 1.5], [32, ay - 14, 1.2]), // RCA
      T([30, base + 30, 1], [37, ay - 8, 0.9]), // marginal
    ],
  };
}

export const ANIMALS: Record<string, Recipe> = {
  giraffe: mammal({ w: 0.78, h: 1.14, big: 0.9, lean: 10 }),
  "blue-whale": mammal({ w: 1.12, h: 0.92, big: 1.3, lean: 8 }),
  elephant: mammal({ w: 1.06, h: 1, apex: "bifid", lean: 4 }),
  pig: mammal({ w: 0.95, h: 1, lean: 20 }),

  // two chambers in a row, seen from the side: sinus venosus, a large thin-walled atrium over the thick ventricle, the
  // bulbus arteriosus at its tip, then the ventral aorta and its gill arteries; the blood's one path runs through them
  fish: {
    body: [B([22, 62], [46, 44], [66, 52], [64, 80], [44, 85]), E(66, 40, 16, 13, -15), E(84, 46, 7, 9), E(17, 61, 8, 8)],
    warm: [T([84, 46, 1.8], [70, 40, 2], [58, 48, 2.2], [46, 64, 2.4], [30, 62, 2.4], [17, 61, 2.6])],
    vessels: [
      T([17, 61, 3.4], [9, 66, 3.2], [3, 72, 2.8]),
      T([9, 66, 1.8], [4, 58, 1.6], [2, 48, 1.3]), T([8, 68, 1.8], [2, 64, 1.6]), T([6, 70, 1.8], [2, 80, 1.6]), T([4, 72, 1.8], [8, 84, 1.5], [14, 92, 1.3]),
      T([84, 52, 3], [90, 64, 2.8], [97, 76, 2.6]), T([85, 40, 3], [92, 30, 2.8], [98, 20, 2.6]),
      T([46, 54, 1.7], [50, 66, 1.6], [52, 78, 1.4]),
    ],
  },

  // two atria over one ventricle, a conus arteriosus that divides into three arches on each side
  frog: {
    body: [B([40, 56], [60, 56], [62, 70], [50, 91], [38, 70]), E(33, 46, 12, 10, -15), E(67, 46, 12, 10, 15), E(50, 40, 8, 6)],
    vessels: [
      T([50, 58, 4.8], [50, 42, 4.6], [50, 28, 4.2]),
      ...both(
        T([50, 28, 3.4], [38, 18, 3], [24, 16, 2.8], [14, 26, 2.6], [12, 42, 2.4]),
        T([47, 26, 2.2], [43, 12, 2], [41, 3, 1.8]),
        T([40, 56, 1.4], [40, 70, 1.3], [44, 82, 1.2]),
      ),
    ],
  },

  // two ventricles side by side and two aortas that cross at their base, where a small opening joins them
  crocodile: {
    body: [E(36, 68, 14, 19, 8), E(60, 66, 16, 22, -8), E(30, 42, 10, 9), E(68, 42, 11, 9), T([50, 82, 12], [50, 93, 3])],
    vessels: [
      T([60, 52, 3.8], [55, 38, 3.6], [47, 26, 3.4], [35, 17, 3.2], [24, 22, 3], [20, 36, 3]),
      T([40, 52, 3.8], [45, 38, 3.6], [53, 26, 3.4], [65, 17, 3.2], [76, 22, 3], [80, 36, 3]),
      T([36, 54, 2.8], [33, 40, 2.6], [36, 30, 2.4]),
      T([50, 58, 1.8], [50, 74, 1.6], [50, 88, 1.3]),
    ],
  },

  // a compact cone, pointed at the apex, with short stout vessels
  hummingbird: {
    body: [B([28, 46], [66, 44], [74, 62], [58, 84], [50, 97], [42, 84], [26, 62]), E(33, 42, 10, 8, -10), E(66, 42, 10, 8, 10)],
    vessels: [
      T([50, 46, 4.4], [50, 32, 4.3], [42, 20, 4], [28, 24, 3.6]),
      T([60, 46, 3.6], [64, 32, 3.5], [76, 24, 3.2]),
      T([58, 44, 2.2], [56, 60, 2], [52, 78, 1.7], [50, 90, 1.3]),
      T([44, 46, 2.2], [32, 56, 2], [32, 72, 1.7]),
    ],
  },

  // a long, narrow ventricle, two atria, and two aortic arches that join behind
  python: {
    body: [E(50, 66, 11, 28), E(40, 36, 9, 8), E(60, 36, 9, 8), T([50, 86, 8], [50, 98, 2.5])],
    vessels: [
      T([54, 40, 3.6], [62, 30, 3.5], [70, 18, 3.3], [70, 4, 3]), T([46, 40, 3.6], [38, 30, 3.5], [30, 18, 3.3], [30, 4, 3]),
      T([50, 42, 3], [50, 22, 3], [50, 4, 2.6]),
      T([50, 56, 1.8], [50, 72, 1.6], [50, 90, 1.3]),
    ],
  },

  // three hearts: a systemic heart between two branchial hearts, with the gills' vessels
  octopus: {
    body: [E(50, 50, 14, 12), E(18, 62, 9, 8, 10), E(82, 62, 9, 8, -10)],
    vessels: [
      T([50, 40, 4.6], [50, 22, 4.6], [50, 5, 4]), T([50, 60, 4.6], [50, 78, 4.6], [50, 95, 4]),
      ...both(
        T([18, 70, 3], [10, 80, 2.6], [8, 94, 2.2]),
        T([25, 58, 3], [34, 52, 3], [38, 50, 3]),
        T([26, 68, 2], [30, 80, 1.8], [34, 90, 1.5]),
        T([16, 54, 2], [10, 46, 1.8], [8, 34, 1.5]),
      ),
    ],
  },

  // no single heart: a vessel along the back and one along the belly, joined by five pairs of muscular arches
  earthworm: {
    body: [],
    vessels: [
      T([38, 2, 3.2], [38, 98, 3]), T([62, 2, 3.2], [62, 98, 3]),
      ...[0, 1, 2, 3, 4].map((i) => T([38, 16 + 9 * i, 2.2], [50, 11 + 9 * i, 3.2], [62, 16 + 9 * i, 2.2])),
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => [T([38, 64 + 6.5 * i, 1.8], [30, 66 + 6.5 * i, 1.3]), T([62, 64 + 6.5 * i, 1.8], [70, 66 + 6.5 * i, 1.3])]),
    ],
  },

  // a tube along the back, swelling into a chamber in each segment, with the muscles that hold it
  insect: {
    body: [...[0, 1, 2, 3, 4].flatMap((i) => [B([50, 12 + 17 * i], [24, 24 + 17 * i], [22, 30 + 17 * i], [50, 18 + 17 * i]), B([50, 12 + 17 * i], [76, 24 + 17 * i], [78, 30 + 17 * i], [50, 18 + 17 * i])])],
    vessels: [T([50, 2, 2.4], [50, 98, 2.4]), ...[0, 1, 2, 3, 4].map((i) => T([50, 14 + 17 * i, 5.6], [50, 17 + 17 * i, 5.6]))],
  },

  // a U-shaped tube, which pumps one way and then the other, inside its sac
  "sea-squirt": {
    body: [E(50, 56, 36, 32)],
    vessels: [T([30, 12, 2.4], [30, 30, 3.4], [22, 48, 4.4], [30, 68, 5.2], [50, 78, 5.6], [70, 68, 5.2], [78, 48, 4.4], [70, 30, 3.4], [70, 12, 2.4])],
  },
};

// ---------------------------------------------------------------- drawing
const sheet = (n: number) => { const c = document.createElement("canvas"); c.width = c.height = n; return c; };
const alpha = (c: HTMLCanvasElement, n: number) => { const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, n, n).data; return mask(n, (i) => d[4 * i + 3] > 110); };

/** Points of a smooth (Catmull–Rom) curve through `pts`, as many as `per` steps between each pair. */
function spline<T extends number[]>(pts: T[], per: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as T);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function paint(g: CanvasRenderingContext2D, p: Prim, k: number) {
  if ("e" in p) { g.beginPath(); g.ellipse(p.e[0] * k, p.e[1] * k, p.e[2] * k, p.e[3] * k, ((p.e[4] ?? 0) * Math.PI) / 180, 0, 6.2832); g.fill(); }
  else if ("t" in p) { g.beginPath(); for (const [x, y, r] of spline(p.t, 12)) { g.moveTo((x + r) * k, y * k); g.arc(x * k, y * k, r * k, 0, 6.2832); } g.fill(); }
  else { g.beginPath(); const q = spline([...p.b, p.b[0], p.b[1], p.b[2]].map(([x, y]) => [x, y]), 10); q.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.closePath(); g.fill(); }
}

/** An animal's heart as masks on an n × n raster, centred and scaled by the stippler's own fit afterwards. */
export function animalField(r: Recipe, n: number): Field {
  const k = n / 100, body = sheet(n), vess = sheet(n), warm = sheet(n), bg = body.getContext("2d")!, vg = vess.getContext("2d")!, wg = warm.getContext("2d")!;
  bg.fillStyle = vg.fillStyle = wg.fillStyle = "#fff";
  for (const p of r.body) paint(bg, p, k);
  for (const p of r.vessels) { paint(vg, p, k); paint(bg, p, k); }
  for (const p of r.warm ?? []) { paint(wg, p, k); paint(bg, p, k); }
  if (r.holes) { bg.globalCompositeOperation = "destination-out"; for (const p of r.holes) paint(bg, p, k); }
  return fieldFromMasks(n, alpha(body, n), [[alpha(vess, n), 1], [alpha(warm, n), 0.55]]);
}

// ---------------------------------------------------------------- a human heart, from the simulator's own anatomy
/** The coronary tree of `v`, seen from the front through the heart, on the heart's silhouette. The arteries that make
 *  the variant what it is (`feature`) run hottest and thickest, the rest of the near side cooler, and those round the
 *  back cooler still. Nothing of the simulation changes; this only reads it. */
export function humanField(v: Variant, feature: string[], n: number): Field {
  const tree = buildTree(v), poly = HEART_OUTLINE;
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = (0.9 * n) / Math.max(x1 - x0, y1 - y0), ox = n / 2 - ((x0 + x1) / 2) * s, oy = n / 2 + ((y0 + y1) / 2) * s;
  const X = (x: number) => ox + x * s, Y = (y: number) => oy - y * s; // x to the patient's left, which is the viewer's right; y up
  const body = sheet(n), hot = sheet(n), near = sheet(n), far = sheet(n);
  const bg = body.getContext("2d")!, hg = hot.getContext("2d")!, ng = near.getContext("2d")!, fg = far.getContext("2d")!;
  bg.fillStyle = hg.fillStyle = ng.fillStyle = fg.fillStyle = "#fff";
  paint(bg, { b: poly.map(([x, y]) => [X(x), Y(y)] as Pt) }, 1);
  for (const seg of tree.segments) {
    const featured = feature.includes(seg.id), m = Math.max(24, Math.round(seg.length / 1.2));
    for (let i = 0; i <= m; i++) {
      const u = i / m, placed = projectToEpicardium(seg.curve.at(u), 0.6), q = rotateHeart(placed.pos), nrm = rotateHeart(placed.n);
      const d = 1000 * diameterAt(tree, seg, u * seg.length); // lumen diameter, mm
      const r = (featured ? Math.max(2.1, 0.5 * d * 3) : Math.max(0.8, 0.5 * d * 1.8)) * s;
      const g = featured ? hg : nrm[2] > -0.15 ? ng : fg; // the feature; or facing the viewer; or round the back
      g.beginPath(); g.arc(X(q[0]), Y(q[1]), r, 0, 6.2832); g.fill();
      bg.beginPath(); bg.arc(X(q[0]), Y(q[1]), r, 0, 6.2832); bg.fill();
    }
  }
  return fieldFromMasks(n, alpha(body, n), [[alpha(hot, n), 1], [alpha(near, n), 0.78], [alpha(far, n), 0.46]]);
}

/** Whether the heart of the day is drawn from the logo's artwork, which the page must load first. */
export const usesLogo = (sp: Specimen) => !sp.variant && !ANIMALS[sp.id];

/** The picture of a heart of the day, on an n × n raster. `logo` is the textbook heart's artwork. */
export function fieldFor(sp: Specimen, n: number, logo: HTMLImageElement): Field {
  if (sp.variant) return humanField(sp.variant, sp.feature ?? [], n);
  const recipe = ANIMALS[sp.id];
  return recipe ? animalField(recipe, n) : fieldFromLogo(logo, n);
}
