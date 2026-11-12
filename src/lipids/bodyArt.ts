import { coreColor } from "./glyphs";
import { rnd } from "./molecules";
import { P } from "./paint";
import { alpha, blob, paint, smooth } from "./anatomy";

/**
 * The whole body's organs and vessels, drawn as anatomy rather than icons. Volume comes from stipple, as on the home page's
 * thermogram: dots thicken away from a light at the upper left, so each organ reads as a solid. Arteries have thick walls, veins
 * are wider with thin walls, capillary beds branch inside the tissue, and lymphatics are beaded with valves.
 */

type Pt = [number, number];
const TAU = Math.PI * 2;
/** Light from the upper left and toward the viewer. */
const LIGHT = (() => { const v = [-0.55, -0.6, 0.58], n = Math.hypot(...v); return v.map((x) => x / n); })();

/**
 * Stipple a path as if it were a rounded solid of center (cx, cy) and radii (rx, ry): the shadowed side gets more dots. `n` is the
 * number of candidate dots per 1,000 px² of the box.
 */
export function shade(path: Path2D, cx: number, cy: number, rx: number, ry: number, seed: number, n = 9, a = 0.5, rot = 0) {
  const c = P.ctx, R = rnd(seed), d = P.dpr, cr = Math.cos(-rot), sr = Math.sin(-rot);
  const ext = Math.max(rx, ry) * 1.25, N = Math.round(((4 * ext * ext) / 1000) * n * 7);
  c.save(); c.fillStyle = P.muted; c.globalAlpha = a;
  for (let i = 0; i < N; i++) {
    const x = cx + (R() * 2 - 1) * ext, y = cy + (R() * 2 - 1) * ext, keep = R();
    if (!c.isPointInPath(path, x * d, y * d)) continue;
    const dx = x - cx, dy = y - cy, u = (dx * cr - dy * sr) / rx, v = (dx * sr + dy * cr) / ry, q = Math.min(1, u * u + v * v), z = Math.sqrt(1 - q);
    const lum = Math.max(0, u * LIGHT[0] + v * LIGHT[1] + z * LIGHT[2]), dark = 1 - lum;
    if (keep < 0.03 + 0.75 * dark ** 1.8 + (q > 0.9 ? 0.2 : 0)) c.fillRect(x, y, 1.1, 1.1);
  }
  c.restore();
}

/** A vessel along a polyline. Arteries: narrow, thick walled. Veins: wider, thin walled. */
export function vessel(pts: Pt[], w: number, kind: "artery" | "vein" | "portal", mini = false) {
  const c = P.ctx, path = smooth(pts, false), wall = mini ? 0.8 : kind === "artery" ? 1.8 : 1, ww = kind === "artery" ? w * 0.8 : w * 1.1;
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  c.strokeStyle = P.muted; c.globalAlpha = kind === "artery" ? 0.7 : 0.42; c.lineWidth = ww + wall * 2; c.stroke(path);
  c.globalAlpha = 1; c.strokeStyle = P.stage; c.lineWidth = ww; c.stroke(path);
  if (!mini && kind === "artery") { c.strokeStyle = P.muted; c.globalAlpha = 0.22; c.lineWidth = 1; c.setLineDash([1, 3]); c.stroke(path); c.setLineDash([]); }
  c.restore();
}

/** A lymphatic: thin and beaded, with a valve pinch every so often; lymph nodes as small beans with a hilum. */
export function lymphatic(pts: Pt[], w: number, nodes: Pt[], mini = false) {
  const c = P.ctx, path = smooth(pts, false);
  c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = P.muted; c.globalAlpha = 0.5; c.lineWidth = w + 2; c.setLineDash(mini ? [2, 2] : [5, 2.5]); c.stroke(path);
  c.setLineDash([]); c.globalAlpha = 1; c.strokeStyle = P.stage; c.lineWidth = Math.max(1, w - 1); c.stroke(path); c.restore();
  if (mini) return;
  for (const [x, y] of nodes) {
    const b = blob(x, y, 9, 6, (x * 31) | 0, 0.1, 0.4); paint(b, P.stage2, 1, P.muted, 0.7, 1); shade(b, x, y, 9, 6, (y * 13) | 0, 30, 0.5, 0.4);
    alpha(0.7, () => { c.strokeStyle = P.muted; c.lineWidth = 1; c.beginPath(); c.arc(x + 6, y - 1, 2.2, 1.6, 4.6); c.stroke(); });
  }
}

/** A capillary bed: a fine branching tree from the arterial end to the venous end, clipped to the tissue. */
export function capillaryBed(clip: Path2D, from: Pt, to: Pt, seed: number, spread: number) {
  const c = P.ctx, R = rnd(seed);
  c.save(); c.clip(clip); c.strokeStyle = P.muted; c.lineCap = "round";
  const grow = (x: number, y: number, a: number, len: number, lw: number, depth: number) => {
    if (depth > 5 || len < 4) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    c.globalAlpha = 0.25 + 0.08 * (5 - depth); c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo((x + x2) / 2 + (R() - 0.5) * len * 0.4, (y + y2) / 2 + (R() - 0.5) * len * 0.4, x2, y2); c.stroke();
    for (const s of [-1, 1]) grow(x2, y2, a + s * (0.35 + R() * 0.45), len * (0.62 + R() * 0.18), Math.max(0.6, lw * 0.7), depth + 1);
  };
  const a1 = Math.atan2(to[1] - from[1], to[0] - from[0]);
  grow(from[0], from[1], a1 + 0.5, spread, 1.6, 0); grow(from[0], from[1], a1 - 0.5, spread * 0.9, 1.6, 0);
  grow(to[0], to[1], a1 + Math.PI + 0.5, spread, 1.6, 0); grow(to[0], to[1], a1 + Math.PI - 0.5, spread * 0.9, 1.6, 0);
  c.restore();
}

// ---------------------------------------------------------------- organs

/** Outlines only, for drawing and for the hover highlight. Muscle and fat are spindle and pad around their body ellipses. */
export function musclePath(cx: number, cy: number, rx: number, ry: number, rot: number) {
  const L = Math.max(rx, ry) * 1.05, Wd = Math.min(rx, ry) * 0.62, m = new DOMMatrix().translate(cx, cy).rotate((rot * 180) / Math.PI), local = new Path2D(), p = new Path2D();
  local.moveTo(0, -L); local.bezierCurveTo(Wd * 1.25, -L * 0.55, Wd * 1.2, L * 0.45, 0, L); local.bezierCurveTo(-Wd * 1.2, L * 0.45, -Wd * 1.25, -L * 0.55, 0, -L); local.closePath();
  p.addPath(local, m); return { p, m, L, Wd };
}
export const fatPath = (cx: number, cy: number, rx: number, ry: number, mini: boolean) => blob(cx, cy, rx, ry, 21, mini ? 0.08 : 0.12);
export function coilPath(X: (x: number) => number, Y: (y: number) => number, bw: number, bh: number) {
  const cx = X(0.535), cy = Y(0.85), w = bw * 0.19, h = bh * 0.15, pts: Pt[] = [], rows = 4, R = rnd(77);
  for (let r = 0; r < rows; r++) {
    const yy = cy - h / 2 + (r + 0.5) * (h / rows), dir = r % 2 ? -1 : 1;
    for (let i = 0; i <= 8; i++) { const t = i / 8, xx = cx + dir * (t - 0.5) * w; pts.push([xx, yy + Math.sin(t * TAU * 1.5 + r) * h * 0.06 + (R() - 0.5) * 2]); }
  }
  return smooth(pts, false);
}

/**
 * Liver outline from the front, in body fractions: the large right lobe on the viewer's left, a domed upper surface under the
 * diaphragm, the left lobe tapering across the midline, and the sharp inferior margin with the gallbladder notch.
 */
export const LIVER: Pt[] = [[0.567, 0.488], [0.535, 0.458], [0.485, 0.443], [0.44, 0.447], [0.43, 0.455], [0.415, 0.446], [0.36, 0.436], [0.295, 0.442], [0.245, 0.468], [0.212, 0.52], [0.214, 0.585], [0.238, 0.638], [0.278, 0.668], [0.325, 0.67], [0.355, 0.655], [0.372, 0.643], [0.42, 0.603], [0.48, 0.557], [0.535, 0.518]];

export const liverPath = (X: (x: number) => number, Y: (y: number) => number) => smooth(LIVER.map(([x, y]) => [X(x), Y(y)] as Pt));
export function liver(X: (x: number) => number, Y: (y: number) => number, bw: number, bh: number, mini: boolean) {
  const c = P.ctx, out = liverPath(X, Y);
  paint(out, P.stage2, 1, P.muted, 0.75, mini ? 0.8 : 1.2);
  if (mini) return out;
  // gallbladder under the right lobe's margin, cystic duct curving up into the hilum
  const gb = blob(X(0.356), Y(0.678), bw * 0.013, bh * 0.032, 4, 0.06, 0.5); paint(gb, P.stage2, 1, P.muted, 0.7, 1); shade(gb, X(0.356), Y(0.678), bw * 0.013, bh * 0.032, 5, 26, 0.55, 0.5);
  shade(out, X(0.33), Y(0.52), bw * 0.16, bh * 0.13, 6, 10, 0.55);
  // falciform ligament dividing the right and left lobes, ending at the notch with the round ligament
  alpha(0.55, () => { c.strokeStyle = P.muted; c.lineWidth = 1; c.beginPath(); c.moveTo(X(0.43), Y(0.455)); c.bezierCurveTo(X(0.425), Y(0.5), X(0.415), Y(0.56), X(0.412), Y(0.61)); c.stroke(); c.lineWidth = 2; c.beginPath(); c.moveTo(X(0.412), Y(0.605)); c.lineTo(X(0.41), Y(0.625)); c.stroke(); });
  // a few lobules glimpsed through the capsule
  c.save(); c.clip(out); alpha(0.08, () => {
    c.strokeStyle = P.muted; c.lineWidth = 0.8; const s = Math.max(8, bw * 0.011), dx = s * 1.5, dy = s * Math.sqrt(3);
    for (let i = 0, x = X(0.2); x < X(0.58); x += dx, i++) for (let y = Y(0.43) + (i % 2 ? dy / 2 : 0); y < Y(0.68); y += dy) { c.beginPath(); for (let k = 0; k <= 6; k++) { const a = (k / 6) * TAU; c.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } c.stroke(); }
  }); c.restore();
  return out;
}

/**
 * The heart from the front, apex down and to the viewer's right. One silhouette (right atrium on the left border, right ventricle
 * in front, left ventricle forming the apex), the left atrial appendage peeking out under the pulmonary trunk, the great vessels
 * above, and the coronary arteries in their grooves. Unit coordinates scaled by s.
 */
const HEART_BODY: Pt[] = [[-0.55, -0.46], [-0.74, -0.3], [-0.82, -0.02], [-0.76, 0.3], [-0.6, 0.48], [-0.25, 0.6], [0.2, 0.64], [0.6, 0.6], [0.92, 0.46], [0.94, 0.2], [0.8, -0.12], [0.6, -0.34], [0.42, -0.5], [0.12, -0.52], [-0.2, -0.5]];
const LAA: Pt[] = [[0.5, -0.36], [0.62, -0.5], [0.82, -0.46], [0.9, -0.3], [0.78, -0.2], [0.62, -0.26]];
/** The heart's silhouette alone, for the thermogram. */
export const heartPath = (x: number, y: number, s: number) => { const p = new Path2D(); p.addPath(smooth(HEART_BODY), new DOMMatrix().translate(x, y).scale(s)); return p; };
export function heart(x: number, y: number, s: number, mini: boolean) {
  const c = P.ctx, m = new DOMMatrix().translate(x, y).scale(s), T = (pts: Pt[]) => { const p = new Path2D(); p.addPath(smooth(pts), m); return p; };
  const pt = (u: number, v: number): Pt => [x + u * s, y + v * s];
  // behind the heart: the descending aorta and the right pulmonary artery
  if (!mini) {
    vessel([pt(0.62, -0.95), pt(0.66, -0.6), pt(0.62, -0.2)], s * 0.24, "artery");
    vessel([pt(0.18, -0.82), pt(-0.3, -0.86)], s * 0.16, "artery");
  }
  // superior vena cava into the right atrium; the aortic arch with its three branches
  vessel([pt(-0.5, -0.3), pt(-0.52, -0.8), pt(-0.53, -1.25)], s * 0.28, "vein", mini);
  if (!mini) for (const [u, v, du, dv] of [[-0.12, -1.12, -0.12, -0.42], [0.12, -1.24, 0.0, -0.4], [0.34, -1.22, 0.14, -0.38]] as const) vessel([pt(u, v), pt(u + du, v + dv)], s * 0.1, "artery");
  vessel([pt(-0.08, -0.4), pt(-0.12, -0.95), pt(0.05, -1.22), pt(0.38, -1.26), pt(0.6, -1.08), pt(0.62, -0.92)], s * 0.26, "artery", mini);
  const body = T(HEART_BODY), laa = T(LAA);
  paint(laa, P.stage2, 1, P.muted, 0.7, mini ? 0.8 : 1);
  paint(body, P.stage2, 1, P.muted, 0.8, mini ? 0.8 : 1.3);
  // pulmonary trunk in front of the aorta, from the right ventricle's outflow up and to the viewer's right
  vessel([pt(0.2, -0.42), pt(0.28, -0.66), pt(0.44, -0.74)], s * 0.22, "artery", mini);
  if (mini) return body;
  shade(body, x + 0.08 * s, y + 0.05 * s, s * 0.88, s * 0.58, 7, 14, 0.6);
  shade(laa, x + 0.7 * s, y - 0.34 * s, s * 0.2, s * 0.14, 8, 30, 0.45);
  // coronary arteries in their grooves: the right coronary in the AV groove, the LAD down the interventricular groove with diagonals
  const groove = (pts: Pt[], lw: number, a: number) => alpha(a, () => { c.strokeStyle = P.ink; c.lineWidth = lw; c.lineCap = "round"; const p = new Path2D(); p.addPath(smooth(pts, false), m); c.stroke(p); });
  groove([[-0.08, -0.42], [-0.42, -0.36], [-0.56, 0.0], [-0.5, 0.36], [-0.3, 0.55]], 1.3, 0.55);
  groove([[0.3, -0.46], [0.36, -0.1], [0.46, 0.25], [0.62, 0.56]], 1.4, 0.6);
  for (const [u, v] of [[0.36, -0.1], [0.43, 0.15]] as const) groove([[u, v], [u + 0.22, v + 0.08], [u + 0.36, v + 0.2]], 0.9, 0.45);
  groove([[0.4, -0.44], [0.72, -0.18], [0.86, 0.12]], 1.0, 0.4); // circumflex toward the left border
  return body;
}

/** The small intestine as a coil of loops in the frame of the colon. Returns the coil's centerline for the highlight. */
export function bowel(X: (x: number) => number, Y: (y: number) => number, bw: number, bh: number, mini: boolean): Path2D {
  const c = P.ctx;
  // colon: ascending, transverse and descending, with haustra
  const colon: Pt[] = [[X(0.42), Y(0.975)], [X(0.414), Y(0.82)], [X(0.43), Y(0.73)], [X(0.535), Y(0.715)], [X(0.64), Y(0.73)], [X(0.658), Y(0.82)], [X(0.652), Y(0.975)]];
  const cp = smooth(colon, false), cw = (mini ? 5 : 15);
  c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = P.muted; c.globalAlpha = 0.55; c.lineWidth = cw + 3; c.stroke(cp); c.globalAlpha = 1; c.strokeStyle = P.stage2; c.lineWidth = cw; c.stroke(cp); c.restore();
  if (!mini) alpha(0.45, () => { c.strokeStyle = P.muted; c.lineWidth = 1; c.setLineDash([1.5, 7]); c.lineCap = "round"; c.lineWidth = cw - 2; c.stroke(cp); c.setLineDash([]); });
  // small bowel: a serpentine coil, four rows with U-turns
  const sp = coilPath(X, Y, bw, bh), tw = mini ? 4 : 12;
  c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = P.muted; c.globalAlpha = 0.65; c.lineWidth = tw + 3; c.stroke(sp); c.globalAlpha = 1; c.strokeStyle = P.stage2; c.lineWidth = tw; c.stroke(sp);
  if (!mini) { c.strokeStyle = P.muted; c.globalAlpha = 0.35; c.lineWidth = 1; c.setLineDash([1, 3.5]); c.stroke(sp); c.setLineDash([]); }
  c.restore();
  return sp;
}

/** A fat pad: lobules of fat in fibrous septa, with honeycomb cells inside. */
export function fatPad(cx: number, cy: number, rx: number, ry: number, mini: boolean): Path2D {
  const c = P.ctx, out = fatPath(cx, cy, rx, ry, mini);
  paint(out, P.stage2, 1, P.muted, 0.6, mini ? 0.8 : 1.2);
  if (mini) return out;
  c.save(); c.clip(out);
  const r0 = Math.max(5, rx * 0.075);
  for (let i = -12, row = 0; i <= 12; i++, row++) for (let j = -12; j <= 12; j++) {
    const x = cx + j * r0 * 2 + (row % 2) * r0, y = cy + i * r0 * 1.75, cell = new Path2D(); cell.arc(x, y, r0 * 0.9, 0, TAU);
    paint(cell, coreColor(0.93), 0.08, P.muted, 0.22, 0.7);
  }
  // fibrous septa dividing lobules
  const R = rnd(22); alpha(0.55, () => { c.strokeStyle = P.muted; c.lineWidth = 1.2; for (let k = 0; k < 5; k++) { const a = R() * TAU; c.beginPath(); c.moveTo(cx + Math.cos(a) * rx * 0.1, cy + Math.sin(a) * ry * 0.1); c.quadraticCurveTo(cx + Math.cos(a + 0.4) * rx * 0.6, cy + Math.sin(a + 0.4) * ry * 0.6, cx + Math.cos(a) * rx * 1.2, cy + Math.sin(a) * ry * 1.2); c.stroke(); } });
  c.restore();
  shade(out, cx, cy, rx, ry, 23, 14, 0.5);
  return out;
}

/** A skeletal muscle: a spindle belly with tendons at both ends and fascicles running its length. */
export function muscle(cx: number, cy: number, rx: number, ry: number, rot: number, mini: boolean): Path2D {
  const c = P.ctx, { p: belly, m, L, Wd } = musclePath(cx, cy, rx, ry, rot);
  // tendons
  c.save(); c.setTransform(c.getTransform().multiply(m)); c.strokeStyle = P.ink; c.globalAlpha = 0.5; c.lineCap = "round";
  c.lineWidth = mini ? 1.5 : 4; c.beginPath(); c.moveTo(0, -L * 0.92); c.lineTo(0, -L * 1.35); c.moveTo(0, L * 0.92); c.lineTo(0, L * 1.32); c.stroke(); c.restore();
  paint(belly, P.stage2, 1, P.muted, 0.65, mini ? 0.8 : 1.2);
  if (mini) return belly;
  c.save(); c.clip(belly); c.setTransform(c.getTransform().multiply(m));
  alpha(0.4, () => { c.strokeStyle = P.muted; c.lineWidth = 0.9; for (let u = -1; u <= 1.001; u += 0.12) { c.beginPath(); c.moveTo(0, -L); c.bezierCurveTo(u * Wd * 1.25, -L * 0.55, u * Wd * 1.2, L * 0.45, 0, L); c.stroke(); } });
  c.restore();
  shade(belly, cx, cy, Wd, L, 24, 14, 0.5, rot);
  return belly;
}
