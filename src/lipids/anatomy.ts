import { coreColor } from "./glyphs";
import { rnd } from "./molecules";
import { P } from "./paint";

/**
 * Drawing primitives for the stage's anatomy: cells with uneven outlines, nuclei with chromatin and a nucleolus, organelles, vessel
 * walls with endothelial cells, red cells, smooth muscle, sarcomeres and fat cells. Everything is drawn in the theme's neutral tones
 * at low contrast so the lipoproteins stay the brightest things on the stage; stored lipid uses the thermal ramp like the particles.
 * Seeds keep each drawing stable from frame to frame.
 */

type Pt = [number, number];
const TAU = Math.PI * 2;

/** Run a drawing with a temporary global alpha. */
export function alpha(a: number, f: () => void) { const c = P.ctx; c.save(); c.globalAlpha *= a; f(); c.restore(); }

/** A closed outline around (cx, cy) with a gently uneven edge, as cells and nuclei have. */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, amp = 0.08, rot = 0): Path2D {
  const R = rnd(seed), ph = [R() * TAU, R() * TAU, R() * TAU], k = [2 + ((R() * 2) | 0), 3 + ((R() * 2) | 0), 5], p = new Path2D(), n = 56;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU, w = 1 + amp * (Math.sin(k[0] * a + ph[0]) * 0.6 + Math.sin(k[1] * a + ph[1]) * 0.3 + Math.sin(k[2] * a + ph[2]) * 0.1);
    const x = Math.cos(a) * rx * w, y = Math.sin(a) * ry * w, X = cx + x * cr - y * sr, Y = cy + x * sr + y * cr;
    if (i) p.lineTo(X, Y); else p.moveTo(X, Y);
  }
  p.closePath();
  return p;
}
/** A smooth closed curve through points (quadratic through midpoints). */
export function smooth(pts: Pt[], closed = true): Path2D {
  const p = new Path2D(), n = pts.length, mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!closed) { p.moveTo(...pts[0]); for (let i = 1; i < n - 1; i++) { const m = mid(pts[i], pts[i + 1]); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); } p.lineTo(...pts[n - 1]); return p; }
  const s = mid(pts[n - 1], pts[0]); p.moveTo(...s);
  for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  p.closePath();
  return p;
}
export function paint(p: Path2D, fill: string | null, fa: number, stroke: string | null, sa: number, lw = 1) {
  const c = P.ctx;
  if (fill) alpha(fa, () => { c.fillStyle = fill; c.fill(p); });
  if (stroke) alpha(sa, () => { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(p); });
}
/** Faint dots inside a path, for cytoplasm and connective tissue. */
export function speckle(p: Path2D, x0: number, y0: number, w: number, h: number, n: number, seed: number, a = 0.22, color = P.muted) {
  const c = P.ctx, R = rnd(seed);
  c.save(); c.clip(p); c.fillStyle = color; c.globalAlpha = a;
  for (let i = 0; i < n; i++) c.fillRect(x0 + R() * w, y0 + R() * h, 1, 1);
  c.restore();
}

/** A nucleus: envelope, chromatin flecks and a nucleolus. */
export function nucleus(x: number, y: number, rx: number, ry: number, seed: number, rot = 0) {
  const p = blob(x, y, rx, ry, seed, 0.06, rot);
  paint(p, P.muted, 0.14, P.muted, 0.6, 1);
  speckle(p, x - rx, y - ry, rx * 2, ry * 2, Math.round(rx * ry * 0.35), seed + 1, 0.45);
  const R = rnd(seed + 2), r = Math.min(rx, ry) * 0.24;
  if (r > 1.5) paint(blob(x + (R() - 0.5) * rx * 0.6, y + (R() - 0.5) * ry * 0.6, r, r, seed + 3, 0.1), P.muted, 0.45, null, 0);
}
/** A red cell: face-on, a disc with a pale center; tilted toward edge-on, a pinched dumbbell. */
export function redCell(x: number, y: number, r: number, rot = 0, edge = 0) {
  const c = P.ctx, ry = r * (1 - 0.72 * edge);
  c.save(); c.translate(x, y); c.rotate(rot);
  const outer = new Path2D();
  if (edge > 0.6) {
    const w = r, h = ry, pinch = h * 0.45;
    outer.moveTo(-w, 0); outer.bezierCurveTo(-w, -h * 1.1, -w * 0.3, -pinch, 0, -pinch); outer.bezierCurveTo(w * 0.3, -pinch, w, -h * 1.1, w, 0);
    outer.bezierCurveTo(w, h * 1.1, w * 0.3, pinch, 0, pinch); outer.bezierCurveTo(-w * 0.3, pinch, -w, h * 1.1, -w, 0); outer.closePath();
    paint(outer, P.muted, 0.2, P.muted, 0.55, 1);
  } else {
    outer.ellipse(0, 0, r, ry, 0, 0, TAU);
    paint(outer, P.muted, 0.2, P.muted, 0.55, 1);
    const inner = new Path2D(); inner.ellipse(0, 0, r * 0.45, ry * 0.45, 0, 0, TAU);
    paint(inner, P.stage, 0.55, P.muted, 0.18, 1);
  }
  c.restore();
}
/** A mitochondrion: a capsule with cristae folding in from the inner membrane. */
export function mito(x: number, y: number, len: number, w: number, rot: number) {
  const c = P.ctx; c.save(); c.translate(x, y); c.rotate(rot);
  const p = new Path2D(); p.roundRect(-len / 2, -w / 2, len, w, w / 2);
  paint(p, P.muted, 0.1, P.muted, 0.55, 1);
  alpha(0.45, () => { c.strokeStyle = P.muted; c.lineWidth = 0.8; c.beginPath(); for (let i = -len / 2 + w * 0.5, k = 0; i < len / 2 - w * 0.4; i += w * 0.55, k++) { c.moveTo(i, k % 2 ? -w / 2 + 1 : w / 2 - 1); c.lineTo(i, k % 2 ? w * 0.15 : -w * 0.15); } c.stroke(); });
  c.restore();
}
/** Rough ER: parallel wavy cisternae studded with ribosomes. */
export function roughER(x: number, y: number, w: number, n: number, seed: number) {
  const c = P.ctx, R = rnd(seed);
  for (let k = 0; k < n; k++) {
    const yy = y + k * 7, ph = R() * TAU, path = new Path2D();
    for (let i = 0; i <= 24; i++) { const xx = x + (i / 24) * w, dy = Math.sin(ph + (i / 24) * 5) * 2.2; if (i) path.lineTo(xx, yy + dy); else path.moveTo(xx, yy + dy); }
    paint(path, null, 0, P.muted, 0.5, 1);
    alpha(0.5, () => { c.fillStyle = P.muted; for (let i = 0; i < 12; i++) { const t = R(), xx = x + t * w, dy = Math.sin(ph + t * 5) * 2.2; c.fillRect(xx, yy + dy + (R() < 0.5 ? -2.5 : 1.5), 1.2, 1.2); } });
  }
}
/** Golgi: stacked curved cisternae with vesicles budding at the rims. */
export function golgi(x: number, y: number, w: number, n = 4) {
  const c = P.ctx;
  alpha(0.55, () => {
    c.strokeStyle = P.muted; c.lineWidth = 1.4;
    for (let k = 0; k < n; k++) { const ww = w * (1 - k * 0.12); c.beginPath(); c.ellipse(x, y + k * 5, ww / 2, 7, 0, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); }
    c.lineWidth = 0.9; for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + s * (w / 2 + 3 + k * 2), y - 3 + k * 6, 1.8, 0, TAU); c.stroke(); }
  });
}
/** Microvilli along a membrane at y, pointing up (dir -1) or down (dir 1). */
export function microvilli(x0: number, x1: number, y: number, h: number, step: number, dir: -1 | 1, w = 3) {
  const c = P.ctx, p = new Path2D();
  for (let x = x0 + step / 2; x < x1; x += step) { p.moveTo(x - w / 2, y); p.lineTo(x - w / 2, y + dir * (h - w / 2)); p.arc(x, y + dir * (h - w / 2), w / 2, dir < 0 ? Math.PI : 0, dir < 0 ? 0 : Math.PI, false); p.lineTo(x + w / 2, y); }
  alpha(1, () => { c.fillStyle = P.stage2; c.fill(p); });
  paint(p, null, 0, P.muted, 0.6, 0.9);
}
/**
 * An endothelial lining whose luminal surface is at y; the cells extend away from the lumen (dir = side the lumen is on: -1 above,
 * 1 below). Flattened cells with junctions, a nucleus bulging into the lumen in each, and optional gaps (fenestrae) at given x.
 */
export function endothelium(x0: number, x1: number, y: number, dir: -1 | 1, seed: number, o: { t?: number; cell?: number; gaps?: number[]; gap?: number } = {}) {
  const c = P.ctx, t = o.t ?? 5, cell = o.cell ?? 150, gapW = o.gap ?? 9, R = rnd(seed), out = -dir;
  const band = new Path2D(); band.rect(x0, Math.min(y, y + out * t), x1 - x0, t);
  alpha(1, () => { c.fillStyle = P.stage2; c.fill(band); });
  for (let x = x0 - R() * cell; x < x1; x += cell * (0.8 + R() * 0.4)) {
    const nx = x + cell * (0.35 + R() * 0.3), ny = y + dir * 3.5;
    const bulge = new Path2D(); bulge.ellipse(nx, y + dir * 1, cell * 0.16, 6, 0, dir < 0 ? Math.PI : 0, dir < 0 ? TAU : Math.PI);
    alpha(1, () => { c.fillStyle = P.stage2; c.fill(bulge); }); paint(bulge, null, 0, P.muted, 0.6, 1);
    nucleus(nx, ny + out * 0.5, cell * 0.11, 3.2, (R() * 1e6) | 0);
    alpha(0.6, () => { c.strokeStyle = P.muted; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3, y + out * t); c.stroke(); });
  }
  alpha(0.75, () => { c.strokeStyle = P.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.globalAlpha = 0.35; c.beginPath(); c.moveTo(x0, y + out * t); c.lineTo(x1, y + out * t); c.stroke(); });
  if (o.gaps) for (const g of o.gaps) { c.save(); c.fillStyle = P.stage; c.fillRect(g - gapW / 2, Math.min(y, y + out * t) - 1, gapW, t + 2); c.restore(); }
}
/** A spindle-shaped smooth muscle cell with an elongated nucleus. */
export function smoothMuscle(x: number, y: number, len: number, th: number, rot: number, seed: number) {
  const c = P.ctx; c.save(); c.translate(x, y); c.rotate(rot);
  const p = new Path2D(); p.moveTo(-len / 2, 0); p.quadraticCurveTo(0, -th, len / 2, 0); p.quadraticCurveTo(0, th, -len / 2, 0); p.closePath();
  paint(p, P.muted, 0.09, P.muted, 0.45, 1);
  nucleus(0, 0, len * 0.16, th * 0.22, seed);
  c.restore();
}
/** The internal elastic lamina: a bright, tightly waved double line. */
export function elasticLamina(x0: number, x1: number, y: number) {
  const c = P.ctx;
  alpha(0.6, () => { c.strokeStyle = P.ink; c.lineWidth = 1.1; for (const dy of [0, 3]) { c.beginPath(); for (let x = x0; x <= x1; x += 4) c.lineTo(x, y + dy + Math.sin(x / 9) * 2.4); c.stroke(); } });
}
/** Wavy collagen fibers in connective tissue. */
export function collagen(x0: number, y0: number, w: number, h: number, n: number, seed: number) {
  const c = P.ctx, R = rnd(seed);
  alpha(0.22, () => {
    c.strokeStyle = P.muted; c.lineWidth = 1;
    for (let i = 0; i < n; i++) { const yy = y0 + R() * h, xx = x0 + R() * w, len = 40 + R() * 90, ph = R() * TAU; c.beginPath(); for (let k = 0; k <= 12; k++) { const t = k / 12; c.lineTo(xx + t * len, yy + Math.sin(ph + t * 7) * 2.5 + t * (R() - 0.5) * 6); } c.stroke(); }
  });
}
/** A fat cell from its outline: a thin rim of cytoplasm, one large lipid droplet (thermal ramp: it is triglyceride) and a flattened nucleus pressed to the edge. */
export function adipocyte(poly: Pt[], seed: number) {
  const n = poly.length, cx = poly.reduce((a, p) => a + p[0], 0) / n, cy = poly.reduce((a, p) => a + p[1], 0) / n;
  paint(smooth(poly), P.stage2, 1, P.muted, 0.6, 1);
  const inner = poly.map(([x, y]) => [cx + (x - cx) * 0.84, cy + (y - cy) * 0.84] as Pt), drop = smooth(inner);
  paint(drop, coreColor(0.93), 0.26, coreColor(0.93), 0.45, 1);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  speckle(drop, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 120, seed + 4, 0.3, coreColor(0.6));
  const R = rnd(seed + 9), k = (R() * n) | 0, a = poly[k], b = poly[(k + 1) % n], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nx = cx + (mx - cx) * 0.92, ny = cy + (my - cy) * 0.92;
  nucleus(nx, ny, 12, 3.4, seed + 5, Math.atan2(b[1] - a[1], b[0] - a[0]));
}
/** A muscle fiber seen lengthwise: myofibrils with banded sarcomeres, mitochondria between them, nuclei at the edge. */
export function muscleFiber(x0: number, y0: number, w: number, h: number, seed: number) {
  const c = P.ctx, R = rnd(seed), outline = new Path2D(); outline.roundRect(x0, y0, w, h, 6);
  paint(outline, P.stage2, 1, P.muted, 0.6, 1);
  c.save(); c.clip(outline);
  const rows = Math.max(3, Math.floor(h / 26)), fh = h / rows;
  for (let r = 0; r < rows; r++) {
    const fy = y0 + r * fh + 3, fhh = fh - 9;
    alpha(0.09, () => { c.fillStyle = P.muted; for (let x = x0 + 4; x < x0 + w; x += 16) c.fillRect(x + 4, fy, 8, fhh); });
    alpha(0.32, () => { c.strokeStyle = P.muted; c.lineWidth = 1; for (let x = x0 + 4; x < x0 + w; x += 16) { c.beginPath(); c.moveTo(x, fy); c.lineTo(x, fy + fhh); c.stroke(); } });
    if (r < rows - 1 && r % 2 === 0) for (let x = x0 + 30 + R() * 40; x < x0 + w - 30; x += 70 + R() * 60) mito(x, fy + fhh + 3, 20 + R() * 8, 5, 0);
  }
  c.restore();
  for (let k = 0; k < 3; k++) nucleus(x0 + w * (0.2 + 0.3 * k + R() * 0.08), y0 + 4, 16, 3.4, seed + 20 + k);
}
/** A faint hexagonal lobule pattern with central veins, for the liver at organ scale. */
export function lobules(clip: Path2D, x0: number, y0: number, w: number, h: number, s: number) {
  const c = P.ctx; c.save(); c.clip(clip);
  alpha(0.3, () => {
    c.strokeStyle = P.muted; c.lineWidth = 0.8;
    const dx = s * 1.5, dy = s * Math.sqrt(3);
    for (let i = 0, x = x0; x < x0 + w + s; x += dx, i++) for (let y = y0 + (i % 2 ? dy / 2 : 0); y < y0 + h + s; y += dy) {
      c.beginPath(); for (let k = 0; k <= 6; k++) { const a = (k / 6) * TAU; c.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } c.stroke();
      c.beginPath(); c.arc(x, y, 1.4, 0, TAU); c.stroke();
    }
  });
  c.restore();
}
/** A vessel drawn as a tube along a polyline: wall, lumen, and an optional dotted wall for lymphatics. */
export function tube(pts: Pt[], w: number, o: { lymph?: boolean; wall?: number } = {}) {
  const c = P.ctx, path = new Path2D();
  pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  c.save(); c.lineJoin = "round"; c.lineCap = "round";
  c.strokeStyle = P.muted; c.globalAlpha = o.lymph ? 0.35 : 0.55; c.lineWidth = w + (o.wall ?? 2.2) * 2; if (o.lymph) c.setLineDash([3, 3]); c.stroke(path); c.setLineDash([]);
  c.globalAlpha = 1; c.strokeStyle = P.stage; c.lineWidth = w; c.stroke(path);
  c.restore();
}
