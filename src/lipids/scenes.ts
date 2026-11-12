import { Delaunay } from "d3-delaunay";
import { coreColor } from "./glyphs";
import { rnd } from "./molecules";
import { Lane, Mover, P, Particle, Ring, feedAll, lerp, moveFlow, nearest, pick, prefillAll, rand } from "./paint";
import { adipocyte, alpha, blob, collagen, elasticLamina, endothelium, golgi, lobules, microvilli, mito, muscleFiber, nucleus, paint, redCell, roughER, smooth, smoothMuscle, speckle, tube } from "./anatomy";

/**
 * The six views on the stage. The whole body shows circulation without receptor detail; each zoom view shows one place where
 * lipoproteins are made, changed or removed, drawn as tissue: cells with nuclei and organelles, vessel walls in their layers.
 * Counts and event rates come from the model's snapshot (P.snap), so a drug turned on changes every view and the labs together.
 * Each view's anatomy is static and drawn once into a cached layer; only particles, proteins and blood cells move.
 */
export interface Scene {
  id: string; name: string; note: string; caption: string; key: string[];
  init(): void; step(dt: number): void; draw(dt: number): void;
  region?(x: number, y: number): string | null;
}

type Pt = [number, number];
const TAU = Math.PI * 2;
/** A hover name for a piece of anatomy (not in the key). */
const anat = (x: number, y: number, r: number, label: string) => P.reg(x, y, r, "anat", label);
/** Blood cells drifting with the flow, re-entering on the left. */
interface Cell { x: number; y: number; v: number; rot: number; spin: number; edge: number; r: number; fixed?: boolean }
function bloodCells(n: number, y0: number, y1: number, v: [number, number], r: [number, number]): Cell[] {
  return Array.from({ length: n }, () => ({ x: rand(0, P.W), y: rand(y0, y1), v: rand(...v), rot: rand(0, TAU), spin: rand(-0.35, 0.35), edge: rand(0, 0.5), r: rand(...r) }));
}
function moveCells(cs: Cell[], dt: number, y0: number, y1: number) {
  for (const c of cs) { c.x += c.v * dt; c.rot += c.spin * dt; c.edge = c.fixed ? c.edge : 0.1 + 0.45 * Math.abs(Math.sin(c.rot * 0.6)); if (c.x > P.W + 40) { c.x = -40; c.y = rand(y0, y1); } }
}
function drawCells(cs: Cell[]) { for (const c of cs) { redCell(c.x, c.y, c.r, c.rot, c.edge); anat(c.x, c.y, c.r, "Red cell, for scale: about 7,500 nm across"); } }

// ================================================================== whole body
interface Loop { pts: Pt[]; bed?: number[]; liver?: number[]; lymph?: boolean; px: Pt[]; cum: number[]; len: number }
const BODY = {
  liver: [[0.6, 0.15], [0.68, 0.1], [0.84, 0.075], [0.95, 0.11], [0.965, 0.2], [0.9, 0.3], [0.8, 0.37], [0.7, 0.385], [0.625, 0.33]] as Pt[],
  heart: [0.47, 0.47] as Pt, adip: [0.12, 0.68, 0.085, 0.14], musc: [0.88, 0.74, 0.085, 0.13],
  gut: [[0.4, 0.8], [0.44, 0.74], [0.5, 0.76], [0.54, 0.82], [0.5, 0.88], [0.44, 0.86], [0.46, 0.8], [0.52, 0.8], [0.58, 0.86], [0.62, 0.8]] as Pt[],
  aorta: [0.34, 0.505] as Pt,
};
const mkLoop = (pts: Pt[], o: Partial<Loop> = {}): Loop => ({ pts, px: [], cum: [], len: 0, ...o });
const LOOPS: Record<string, Loop> = {
  adip: mkLoop([[0.47, 0.47], [0.36, 0.5], [0.24, 0.56], [0.15, 0.6], [0.08, 0.68], [0.12, 0.78], [0.2, 0.74], [0.3, 0.62], [0.42, 0.54], [0.47, 0.47]], { bed: [3, 4, 5] }),
  musc: mkLoop([[0.47, 0.47], [0.58, 0.52], [0.72, 0.6], [0.83, 0.65], [0.93, 0.72], [0.88, 0.82], [0.78, 0.76], [0.64, 0.63], [0.52, 0.54], [0.47, 0.47]], { bed: [3, 4, 5] }),
  gut: mkLoop([[0.47, 0.47], [0.475, 0.6], [0.47, 0.72], [0.5, 0.78], [0.56, 0.76], [0.62, 0.64], [0.68, 0.48], [0.74, 0.34], [0.8, 0.24], [0.74, 0.16], [0.62, 0.2], [0.53, 0.32], [0.47, 0.47]], { bed: [3], liver: [7, 8, 9] }),
  lymph: mkLoop([[0.43, 0.84], [0.37, 0.76], [0.33, 0.64], [0.32, 0.46], [0.37, 0.38], [0.44, 0.4], [0.47, 0.47]], { lymph: true }),
};
function layoutLoop(L: Loop) {
  L.px = L.pts.map(([x, y]) => [x * P.W, y * P.H]); L.cum = [0];
  for (let i = 1; i < L.px.length; i++) L.cum.push(L.cum[i - 1] + Math.hypot(L.px[i][0] - L.px[i - 1][0], L.px[i][1] - L.px[i - 1][1]));
  L.len = L.cum[L.cum.length - 1];
}
function posOn(L: Loop, s: number) {
  let i = 1; while (i < L.cum.length - 1 && L.cum[i] < s) i++;
  const t = (s - L.cum[i - 1]) / (L.cum[i] - L.cum[i - 1] || 1), a = L.px[i - 1], b = L.px[i];
  return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), seg: i - 1, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
/** The heart in outline: base up and to the right, apex down and to the left, as on a chest film. */
const HEART: Pt[] = [[-0.55, -0.55], [0, -0.72], [0.6, -0.6], [0.86, -0.15], [0.62, 0.35], [0.18, 0.72], [-0.22, 1.02], [-0.6, 0.62], [-0.86, 0.02]];
function heartPath(x: number, y: number, s: number): Path2D {
  const p = new Path2D(); p.addPath(smooth(HEART), new DOMMatrix().translate(x, y).rotate(18).scale(s)); return p;
}
function bodyPaths(bx: number, by: number, bw: number, bh: number) {
  const X = (x: number) => bx + x * bw, Y = (y: number) => by + y * bh, ell = (e: number[]) => { const p = new Path2D(); p.ellipse(X(e[0]), Y(e[1]), e[2] * bw, e[3] * bh, 0, 0, TAU); return p; };
  return { X, Y, liver: smooth(BODY.liver.map(([x, y]) => [X(x), Y(y)])), adip: ell(BODY.adip), musc: ell(BODY.musc), heart: heartPath(X(BODY.heart[0]), Y(BODY.heart[1]), bh * 0.085) };
}
/** The whole body's anatomy; `mini` draws it small, without tissue texture, as the "where am I" inset of the zoom views. */
function drawBodyBase(bx: number, by: number, bw: number, bh: number, mini: boolean) {
  const c = P.ctx, b = bodyPaths(bx, by, bw, bh), { X, Y } = b, k = mini ? 0.32 : 1;
  // liver: lobules at organ scale, a gallbladder under its edge
  paint(b.liver, P.stage2, 1, P.muted, 0.6, 1);
  if (!mini) {
    lobules(b.liver, X(0.58), Y(0.06), bw * 0.4, bh * 0.34, Math.max(9, bw * 0.014));
    paint(blob(X(0.74), Y(0.385), bw * 0.018, bh * 0.022, 4), P.stage2, 1, P.muted, 0.6, 1);
  }
  // capillary beds: packed fat cells, and muscle fibers
  paint(b.adip, P.stage2, 1, P.muted, 0.55, 1); paint(b.musc, P.stage2, 1, P.muted, 0.55, 1);
  if (!mini) {
    c.save(); c.clip(b.adip);
    const r0 = Math.max(6, bw * 0.009), cx = X(BODY.adip[0]), cy = Y(BODY.adip[1]);
    for (let i = -8, row = 0; i <= 8; i++, row++) for (let j = -10; j <= 10; j++) {
      const x = cx + j * r0 * 2 + (row % 2) * r0, y = cy + i * r0 * 1.75, cell = new Path2D(); cell.arc(x, y, r0 * 0.92, 0, TAU);
      paint(cell, coreColor(0.93), 0.12, P.muted, 0.4, 0.8);
    }
    c.restore();
    c.save(); c.clip(b.musc); c.translate(X(BODY.musc[0]), Y(BODY.musc[1])); c.rotate(-0.5);
    alpha(0.45, () => { c.strokeStyle = P.muted; c.lineWidth = 1; for (let y = -bh * 0.2; y < bh * 0.2; y += 6) { c.beginPath(); c.moveTo(-bw * 0.12, y); c.lineTo(bw * 0.12, y + Math.sin(y) * 2); c.stroke(); } });
    c.restore();
  }
  // small intestine: a coiled tube with a wall
  const gut = BODY.gut.map(([x, y]) => [X(x), Y(y)] as Pt);
  tube(gut, 15 * k, { wall: 1.6 });
  if (!mini) alpha(0.45, () => { const p = smooth(gut, false); c.strokeStyle = P.muted; c.setLineDash([2, 4]); c.lineWidth = 1; c.stroke(p); c.setLineDash([]); });
  // vessels as tubes: aorta widest, lymphatics dotted, with two lymph nodes
  for (const [name, L] of Object.entries(LOOPS)) tube(L.pts.map(([x, y]) => [X(x), Y(y)]), (L.lymph ? 4 : name === "gut" ? 8 : 7) * k, { lymph: L.lymph, wall: mini ? 0.8 : 1.6 });
  tube([LOOPS.adip.pts[0], LOOPS.adip.pts[1], LOOPS.adip.pts[2]].map(([x, y]) => [X(x), Y(y)]), 10 * k, { wall: mini ? 0.8 : 2 });
  if (!mini) for (const i of [2, 4]) { const [x, y] = LOOPS.lymph.pts[i]; paint(blob(X(x) + 6, Y(y), 8, 5, 10 + i, 0.12, 0.4), P.stage2, 1, P.muted, 0.6, 1); }
  // heart over the vessels
  paint(b.heart, P.stage2, 1, P.muted, 0.7, 1);
  if (!mini) {
    const hx = X(BODY.heart[0]), hy = Y(BODY.heart[1]), s = bh * 0.085;
    speckle(b.heart, hx - s, hy - s, s * 2, s * 2, 140, 7, 0.3);
    alpha(0.5, () => { c.save(); c.translate(hx, hy); c.rotate((18 * Math.PI) / 180); c.strokeStyle = P.muted; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-0.7 * s, -0.25 * s); c.quadraticCurveTo(0, -0.05 * s, 0.75 * s, -0.25 * s); c.stroke(); // atrioventricular groove
      c.beginPath(); c.moveTo(0.05 * s, -0.1 * s); c.quadraticCurveTo(-0.05 * s, 0.4 * s, -0.4 * s, 0.85 * s); c.stroke(); // interventricular groove
      c.restore(); });
  }
}
function drawBodyHighlight(bx: number, by: number, bw: number, bh: number, hi: string | null, mini: boolean) {
  if (!hi) return;
  const c = P.ctx, b = bodyPaths(bx, by, bw, bh), lw = mini ? 1.5 : 2;
  c.save(); c.strokeStyle = P.ink; c.lineWidth = lw;
  if (hi === "liver") c.stroke(b.liver);
  if (hi === "cap") { c.stroke(b.adip); c.stroke(b.musc); }
  if (hi === "gut") { const p = new Path2D(); BODY.gut.forEach(([x, y], i) => (i ? p.lineTo(b.X(x), b.Y(y)) : p.moveTo(b.X(x), b.Y(y)))); c.lineWidth = (mini ? 6 : 19); c.globalAlpha = 0.35; c.lineJoin = "round"; c.lineCap = "round"; c.stroke(p); }
  if (hi === "plasma") { c.globalAlpha = 0.7; for (const L of Object.values(LOOPS)) { if (L.lymph) continue; const p = new Path2D(); L.pts.forEach(([x, y], i) => (i ? p.lineTo(b.X(x), b.Y(y)) : p.moveTo(b.X(x), b.Y(y)))); c.lineWidth = mini ? 1 : 1.5; c.stroke(p); } }
  c.restore();
  const ax = b.X(BODY.aorta[0]), ay = b.Y(BODY.aorta[1]), as = mini ? 4 : 9;
  c.save(); c.strokeStyle = hi === "artery" ? P.ink : P.muted; c.lineWidth = hi === "artery" ? 2 : 1; c.strokeRect(ax - as, ay - as, as * 2, as * 2); c.restore();
}
/** The inset map in a zoom view. */
export function drawBody(bx: number, by: number, bw: number, bh: number, mini: boolean, hi: string | null) {
  if (mini) { P.cached("bodymini", () => drawBodyBase(bx, by, bw, bh, true)); drawBodyHighlight(bx, by, bw, bh, hi, true); return; }
  P.cached("body", () => drawBodyBase(bx, by, bw, bh, false)); drawBodyHighlight(bx, by, bw, bh, hi, false);
}

class BodyScene implements Scene {
  id = "body"; name = "Whole body";
  note = "Lipoproteins circulating without receptor detail. Click the liver, a capillary bed, the gut, a vessel or the aortic wall marker to zoom in.";
  caption = "Figure 1. The whole body. Chylomicrons leave the gut by the lymph, VLDL leaves the liver, both shrink in the capillary beds, and the liver takes remnants and LDL back.";
  key = ["CM", "CMR", "VLDL", "IDL", "LDL", "LPA", "HDL", "lymph", "artmark"];
  ps: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; hover: string | null = null;
  init() {
    for (const L of Object.values(LOOPS)) layoutLoop(L);
    this.ps = []; this.acc = {}; this.rings = [];
    const T = P.counts(1);
    for (const c of ["VLDL", "LDL", "HDL", "LPA", "CM"] as const) for (let i = 0; i < Math.round(T[c]); i++) this.spawn(c, true);
  }
  spawn(c: "VLDL" | "LDL" | "HDL" | "LPA" | "CM", anywhere = false) {
    const loop = c === "CM" ? "lymph" : anywhere ? pick(["adip", "musc", "gut"]) : "gut", L = LOOPS[loop];
    const s = anywhere ? Math.random() * L.len : c === "CM" ? 0 : L.cum[9];
    const p = P.particle(c, 0, 0, { loop, s, off: rand(-2.5, 2.5), sp: rand(70, 100), pass: -1 });
    if (anywhere && c === "LDL") p.tg = 0.13;
    this.ps.push(p);
  }
  step(dt: number) {
    const T = P.counts(1), n: Record<string, number> = {};
    for (const p of this.ps) n[p.c] = (n[p.c] ?? 0) + 1;
    this.acc.v = (this.acc.v ?? 0) + (T.VLDL / 14) * dt; while (this.acc.v >= 1) { this.acc.v--; this.spawn("VLDL"); }
    this.acc.cm = (this.acc.cm ?? 0) + (T.CM / 16) * dt; while (this.acc.cm >= 1) { this.acc.cm--; this.spawn("CM"); }
    for (const c of ["LDL", "HDL", "LPA"] as const) if ((n[c] ?? 0) < T[c] * 0.85 && Math.random() < 1.2 * dt) this.spawn(c);
    for (const p of this.ps) {
      p.age += dt; p.s! += p.sp! * dt * (P.W / 1000);
      if (p.s! >= LOOPS[p.loop!].len) { p.loop = pick(["adip", "musc", "gut", "gut", "musc"]); p.s = 0; p.pass!++; }
      const L = LOOPS[p.loop!], q = posOn(L, p.s!);
      p.x = q.x + Math.cos(q.ang + 1.57) * p.off!; p.y = q.y + Math.sin(q.ang + 1.57) * p.off!;
      const floor = p.b48 ? 0.5 : 0.13;
      if (L.bed?.includes(q.seg) && p.tg > floor && (p.c === "VLDL" || p.c === "IDL" || p.c === "CM")) { p.tg = Math.max(floor, p.tg - dt * 0.2 * Math.min(2, P.snap.lipolysis)); p.c = P.classOf(p); }
      if (L.liver?.includes(q.seg) && p.lp !== p.pass) {
        p.lp = p.pass;
        const k = p.c, ratio = (n[k] ?? 0) / Math.max(1, (T as Record<string, number>)[k] ?? 1);
        const pr = k === "LDL" ? 0.4 * ratio : k === "IDL" ? 0.55 : k === "CMR" ? 0.85 : k === "LPA" ? 0.3 * ratio : k === "HDL" ? 0.25 * ratio : 0;
        if (Math.random() < Math.min(0.95, pr)) { p.gone = true; P.ring(this.rings, p.x, p.y, P.radius(p, 0.8)); }
      }
      if (p.age > 140) p.gone = true;
    }
    this.ps = this.ps.filter((p) => !p.gone);
  }
  draw(dt: number) {
    const { W, H } = P;
    drawBody(0, 0, W, H, false, this.hover);
    P.label("Liver", W * 0.82, H * 0.2, { a: "center" }); P.label("Heart", W * 0.47 + H * 0.1, H * 0.47 + H * 0.1, { s: 12 });
    P.label("Adipose capillaries", W * 0.12, H * 0.68 + H * 0.14 + 18, { a: "center", s: 12 }); P.label("Muscle capillaries", W * 0.88, H * 0.74 - H * 0.13 - 8, { a: "center", s: 12 });
    P.label("Small intestine", W * 0.51, H * 0.95, { a: "center", s: 12 }); P.mono("lymph, thoracic duct", W * 0.3, H * 0.6, { a: "right" });
    P.mono("portal vein", W * 0.66, H * 0.6); P.mono("hepatic vein", W * 0.56, H * 0.2, { a: "right" }); P.mono("aortic wall", W * BODY.aorta[0] - 12, H * BODY.aorta[1] - 14, { a: "center" });
    P.reg(W * BODY.aorta[0], H * BODY.aorta[1], 10, "artmark", "Aortic wall: click to zoom");
    for (const p of this.ps) P.drawParticle(p, 0.75, false);
    this.rings = P.drawRings(this.rings, dt);
  }
  region(x: number, y: number): string | null {
    const X = x / P.W, Y = y / P.H, e = (b: number[]) => ((X - b[0]) / b[2]) ** 2 + ((Y - b[1]) / b[3]) ** 2 < 1.2;
    if (Math.hypot(X - BODY.aorta[0], Y - BODY.aorta[1]) < 0.03) return "artery";
    if (X > 0.6 && X < 0.97 && Y > 0.07 && Y < 0.39) return "liver";
    if (e(BODY.adip) || e(BODY.musc)) return "cap";
    if (X > 0.38 && X < 0.64 && Y > 0.72 && Y < 0.92) return "gut";
    for (const L of Object.values(LOOPS)) for (let i = 1; i < L.px.length; i++) {
      const a = L.px[i - 1], b = L.px[i], t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)));
      if (Math.hypot(x - lerp(a[0], b[0], t), y - lerp(a[1], b[1], t)) < 9) return "plasma";
    }
    return null;
  }
}

// ================================================================== plasma
interface Cetp { x: number; y: number; st: "free" | "toHDL" | "carry"; tgt?: Particle }
class PlasmaScene implements Scene, Lane {
  id = "plasma"; name = "Plasma";
  note = "A medium vein cut lengthwise: smooth muscle and the elastic lamina in the wall, endothelium lining the lumen. CETP shuttles cholesterol ester from HDL to ApoB particles and triglyceride back.";
  caption = "Figure 1. Plasma in a vessel. Particle numbers follow the model's concentrations; CETP stops when obicetrapib is on. Cells are drawn at a reduced scale.";
  key = ["VLDL", "IDL", "LDL", "LPA", "HDL", "CM", "CETP", "LCAT", "apoB100", "apoE", "apoCII", "apoCIII", "apoAI", "apoa", "RBC", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; rbc: Cell[] = []; cetp: Cetp[] = [];
  wbc = { x: 0, y: 0 }; plt: { x: number; y: number; v: number; rot: number }[] = []; streak = 0;
  geo() { return { t: P.H * 0.13, b: P.H * 0.87 }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.rings = [];
    prefillAll(this, 1, g.t + 10, g.b - 10, 70);
    this.rbc = bloodCells(9, g.t + 30, g.b - 30, [40, 70], [17, 21]);
    this.plt = Array.from({ length: 6 }, () => ({ x: rand(0, P.W), y: rand(g.t + 20, g.b - 20), v: rand(45, 70), rot: rand(0, TAU) }));
    this.wbc = { x: rand(0, P.W), y: g.b - 26 };
    this.cetp = Array.from({ length: 6 }, () => ({ x: rand(0, P.W), y: rand(g.t + 20, g.b - 20), st: "free" as const }));
  }
  step(dt: number) {
    const g = this.geo(); feedAll(this, 1, g.t + 10, g.b - 10, 70, dt); moveFlow(this, dt);
    moveCells(this.rbc, dt, g.t + 30, g.b - 30);
    for (const q of this.plt) { q.x += q.v * dt; q.rot += dt; if (q.x > P.W + 10) { q.x = -10; q.y = rand(g.t + 20, g.b - 20); } }
    this.wbc.x += 12 * dt; if (this.wbc.x > P.W + 40) this.wbc.x = -40; // a neutrophil rolling slowly along the wall
    this.streak = (this.streak + dt * 60) % 40;
    const blocked = P.has("obi");
    for (const c of this.cetp) {
      if (blocked || c.st === "free") {
        c.x += 60 * dt; c.y = Math.max(g.t + 12, Math.min(g.b - 12, c.y + rand(-1, 1) * 20 * dt)); if (c.x > P.W + 20) c.x = -20;
        if (!blocked && Math.random() < 0.8 * dt) { const h = this.flow.filter((p) => p.c === "HDL" && Math.abs(p.x - c.x) < 160 && Math.abs(p.y - c.y) < 120); if (h.length) { c.tgt = pick(h); c.st = "toHDL"; } }
        continue;
      }
      const t = c.tgt;
      if (!t || t.gone || t.x > P.W + 20) { c.st = "free"; continue; }
      const dx = t.x - c.x, dy = t.y - c.y, d = Math.hypot(dx, dy);
      if (d < 7) {
        if (c.st === "toHDL") { const b = this.flow.filter((p) => (p.c === "VLDL" || p.c === "LDL" || p.c === "IDL") && Math.abs(p.x - c.x) < 220); if (b.length) { c.tgt = pick(b); c.st = "carry"; } else c.st = "free"; }
        else { if (t.c === "VLDL" || t.c === "IDL") { t.tg = Math.max(0.3, t.tg - 0.03); t.c = P.classOf(t); } P.ring(this.rings, c.x, c.y, 3); c.st = "free"; }
      } else { c.x += (dx / d) * 150 * dt; c.y += (dy / d) * 150 * dt; }
    }
  }
  wall() {
    const g = this.geo(), { W, H } = P;
    for (const [y0, y1, s] of [[0, g.t - 14, 1], [g.b + 14, H, 2]] as const) {
      const band = new Path2D(); band.rect(0, y0, W, y1 - y0); paint(band, P.stage2, 1, null, 0);
      const R = rnd(40 + s);
      for (let row = 0, y = y0 + 9; y < y1 - 4; y += 15, row++) for (let x = (row % 2) * 30 - 20; x < W + 40; x += 64 + R() * 14) smoothMuscle(x, y + R() * 4, 54, 11, (R() - 0.5) * 0.15, (R() * 1e6) | 0);
    }
    elasticLamina(0, W, g.t - 12); elasticLamina(0, W, g.b + 10);
    endothelium(0, W, g.t, 1, 11, { t: 5, cell: 170 }); endothelium(0, W, g.b, -1, 12, { t: 5, cell: 170 });
    P.label("Vessel lumen", 12, g.t + 24); P.mono("flow →", W - 12, g.t + 22, { a: "right" });
    P.mono("smooth muscle (media)", 12, 14); P.mono("internal elastic lamina, endothelium", 12, g.b + 30);
  }
  draw(dt: number) {
    const g = this.geo(), c = P.ctx, { W } = P;
    P.cached("plasma", () => this.wall());
    alpha(0.12, () => { c.strokeStyle = P.muted; c.setLineDash([14, 26]); c.lineDashOffset = -this.streak; c.lineWidth = 1; for (let y = g.t + 40; y < g.b - 20; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } c.setLineDash([]); });
    drawCells(this.rbc);
    for (const q of this.plt) { const p = new Path2D(); p.ellipse(q.x, q.y, 4.5, 2.2, q.rot, 0, TAU); paint(p, P.muted, 0.3, P.muted, 0.6, 0.8); anat(q.x, q.y, 5, "Platelet"); }
    const wb = blob(this.wbc.x, this.wbc.y, 22, 20, 77, 0.12); paint(wb, P.stage2, 1, P.muted, 0.6, 1); speckle(wb, this.wbc.x - 22, this.wbc.y - 20, 44, 40, 90, 78, 0.35);
    for (const [dx, dy] of [[-8, -4], [0, 3], [8, -3]]) nucleus(this.wbc.x + dx, this.wbc.y + dy, 5.5, 4.5, 80 + dx);
    anat(this.wbc.x, this.wbc.y, 20, "Neutrophil rolling on the endothelium");
    for (const p of this.flow) P.drawParticle(p, 1.25, true);
    const blocked = P.has("obi");
    for (const t of this.cetp) {
      P.sign("CETP", t.x, t.y, 15, 0, blocked ? "CETP blocked by obicetrapib" : "CETP: moves CE from HDL to ApoB particles, TG back", blocked ? 0.4 : 1);
      if (blocked) P.drugMark("small", t.x + 9, t.y - 8, "Obicetrapib");
      if (t.st === "carry") P.dot(t.x, t.y + 6, 2.2, coreColor(0.1));
    }
    this.rings = P.drawRings(this.rings, dt);
  }
}

// ================================================================== liver
interface Slot { x: number; type: "LDLR" | "LRP1" | "SRB1"; away: number }
class LiverScene implements Scene, Lane {
  id = "liver"; name = "Liver";
  note = "A sinusoid over a plate of two hepatocytes. Particles small enough pass the fenestrae into the space of Disse, dock on LDLR, LRP1 or SR-B1 on the microvilli, and are taken in. Receptors return to the surface unless PCSK9 rode in with them.";
  caption = "Figure 1. The liver. Docking happens at the rate the model's receptor-mediated uptake sets; the receptors shown follow its surface LDLR.";
  key = ["LDL", "IDL", "VLDL", "CMR", "LPA", "HDL", "LDLR", "LRP1", "SRB1", "PCSK9", "SREBP2", "HMGCR", "ACL", "MTP", "ABCG58", "fenestra", "mAb", "siRNA", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; anim: Mover[] = []; pc: Mover[] = []; ab: { x: number; y: number; v: number }[] = [];
  slots: Slot[] = []; order: Slot[] = []; gaps: number[] = []; rbc: Cell[] = [];
  geo() {
    const { W, H } = P;
    return { sT: H * 0.05, sB: H * 0.27, mem: H * 0.37, split: W * 0.56, golgi: { x: W * 0.25, y: H * 0.47 }, er: { x: W * 0.04, y: H * 0.5 }, canal: { x: W * 0.56, y: H * 0.66 } };
  }
  /** Each hepatocyte has its own endosome and lysosome. */
  organelles(x: number) { const { W, H } = P; return x < W * 0.56 ? { endo: { x: W * 0.42, y: H * 0.52 }, lyso: { x: W * 0.47, y: H * 0.63 } } : { endo: { x: W * 0.66, y: H * 0.52 }, lyso: { x: W * 0.72, y: H * 0.63 } }; }
  init() {
    const g = this.geo(), NS = 22;
    this.flow = []; this.acc = {}; this.rings = []; this.anim = []; this.pc = []; this.ab = [];
    prefillAll(this, 0.45, g.sT + 10, g.sB - 10, 60, ["CM"]);
    this.rbc = bloodCells(4, g.sT + 22, g.sB - 22, [40, 60], [15, 18]);
    this.slots = Array.from({ length: NS }, (_, i) => ({ x: P.W * (0.05 + (0.9 * i) / (NS - 1)), type: [3, 11, 18].includes(i) ? "LRP1" : [7, 15].includes(i) ? "SRB1" : "LDLR", away: 0 }));
    const ld = this.slots.filter((s) => s.type === "LDLR"), R = rnd(3);
    this.order = ld.map((s) => ({ s, k: R() })).sort((a, b) => a.k - b.k).map((o) => o.s);
    // fenestrae in sieve plates of three
    this.gaps = []; for (let x = 40; x < P.W; x += 96) this.gaps.push(x - 11, x, x + 11);
  }
  visible() { return this.order.slice(0, Math.min(this.order.length, Math.round(P.snap.receptors * 8))); }
  tagged(vis: Slot[], s: Slot) { const i = vis.indexOf(s); return i >= 0 && (i * 0.618) % 1 < P.snap.pcsk9Share; }
  gapNear(x: number) { return this.gaps.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), this.gaps[0]); }
  dock(p: Particle, slot: Slot, vis: Slot[]) {
    const g = this.geo(), gx = this.gapNear(slot.x), tagged = slot.type === "LDLR" && this.tagged(vis, slot), y = g.mem - P.radius(p, 1.15) - 21;
    const { endo, lyso } = this.organelles(slot.x);
    p.gone = true; slot.away = 99;
    this.anim.push(P.mover(p.x, p.y, [{ x: gx, y: g.sB + 4, d: 0.5 }, { x: slot.x, y, d: 0.5 }, { x: slot.x, y, d: 0.35 }, { x: endo.x + rand(-6, 6), y: endo.y + rand(-6, 6), d: 1.0 }], {
      p, slot, tagged, rec: false,
      onWay: (m, i) => { if (i === 3) m.rec = true; },
      onEnd: (m) => {
        P.ring(this.rings, m.x, m.y, 5);
        const back = tagged ? [{ x: lyso.x, y: lyso.y, d: 0.8 }] : [{ x: slot.x, y: g.mem + 12, d: 1.0 }];
        this.anim.push(P.mover(m.x, m.y, back, { recOnly: true, type: slot.type, tagged, onEnd: () => { slot.away = tagged ? 4 : 0; } }));
      },
    }));
  }
  step(dt: number) {
    const g = this.geo(), s = P.snap;
    feedAll(this, 0.45, g.sT + 10, g.sB - 10, 60, dt, ["CM"]); moveFlow(this, dt); moveCells(this.rbc, dt, g.sT + 22, g.sB - 22);
    const vis = this.visible(), inReach = (p: Particle) => !p.hold && !p.gone && p.x > P.W * 0.1 && p.x < P.W * 0.9;
    this.acc.ev = (this.acc.ev ?? 0) + Math.min(3.5, 0.9 * s.uptake) * dt;
    while (this.acc.ev >= 1) {
      this.acc.ev--;
      const cand = this.flow.filter((p) => (p.c === "LDL" || p.c === "IDL") && inReach(p)), free = vis.filter((q) => q.away <= 0);
      if (cand.length && free.length) { const p = pick(cand); this.dock(p, nearest(free, p.x), vis); }
    }
    this.acc.lrp = (this.acc.lrp ?? 0) + ((0.5 * s.idlClearance) / 0.16) * dt;
    while (this.acc.lrp >= 1) {
      this.acc.lrp--;
      const cand = this.flow.filter((p) => (p.c === "CMR" || p.c === "IDL") && inReach(p)), free = this.slots.filter((q) => q.type === "LRP1" && q.away <= 0);
      if (cand.length && free.length) { const p = pick(cand); this.dock(p, nearest(free, p.x), vis); }
    }
    // HDL hands CE over at SR-B1 and goes back into the sinusoid
    this.acc.sr = (this.acc.sr ?? 0) + 0.4 * dt;
    while (this.acc.sr >= 1) {
      this.acc.sr--;
      const cand = this.flow.filter((p) => p.c === "HDL" && inReach(p) && p.x < P.W * 0.8), free = this.slots.filter((q) => q.type === "SRB1" && q.away <= 0);
      if (!cand.length || !free.length) continue;
      const p = pick(cand), sl = pick(free), gx = this.gapNear(sl.x); sl.away = 99; p.hold = 999;
      this.anim.push(P.mover(p.x, p.y, [{ x: gx, y: g.sB + 4, d: 0.5 }, { x: sl.x, y: g.mem - 25, d: 0.5 }, { x: sl.x, y: g.mem - 25, d: 0.5 }, { x: gx, y: g.sB - 10, d: 0.6 }], {
        p, onWay: (_m, i) => { if (i === 3) this.anim.push(P.mover(sl.x, g.mem + 4, [{ x: sl.x + rand(-20, 20), y: P.H * 0.55, d: 1.2 }], { ce: true })); },
        onEnd: (m) => { sl.away = 0; p.hold = 0; p.x = m.x; p.y = m.y; },
      }));
    }
    // VLDL and Lp(a) leave the Golgi, cross the space of Disse and join the sinusoid
    this.acc.v = (this.acc.v ?? 0) + ((0.45 * s.rates.vldl) / 1.6) * dt;
    this.acc.lpa = (this.acc.lpa ?? 0) + Math.min(0.6, (0.08 * s.lpa) / 20) * dt;
    for (const [k, c] of [["v", "VLDL"], ["lpa", "LPA"]] as const) while (this.acc[k] >= 1) {
      this.acc[k]--;
      const p = P.particle(c, g.golgi.x, g.golgi.y, { y0: g.sT + 10, y1: g.sB - 10, vmax: 60 }), ex = P.W * rand(0.12, 0.34), gx = this.gapNear(ex);
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: p.y, d: 0.8 }, { x: ex, y: g.mem + 10, d: 1.0 }, { x: ex, y: g.mem - 12, d: 0.4 }, { x: gx, y: g.sB + 2, d: 0.5 }, { x: gx + 10, y: g.sB - 14, d: 0.4 }], {
        p, sec: true, onEnd: (m) => { p.x = m.x; p.y = m.y; p.hold = 0; this.flow.push(p); },
      }));
    }
    // free PCSK9 in the space of Disse follows the model
    const pcT = Math.min(16, Math.round(s.pcsk9 * 9));
    if (this.pc.length < pcT && Math.random() < 2 * dt) { const ex = P.W * rand(0.1, 0.4); this.pc.push(P.mover(g.golgi.x, g.golgi.y, [{ x: ex, y: g.mem + 8, d: 1.0 }, { x: ex, y: rand(g.sB + 8, g.mem - 30), d: 0.5 }], { drift: rand(-20, 20) })); }
    if (this.pc.length > pcT && Math.random() < 2 * dt) { const q = this.pc.shift()!; if (s.rates.kab) P.ring(this.rings, q.x, q.y, 4); }
    for (const q of this.pc) { if (!q.done) P.stepMover(q, dt); else { q.x += (q.drift as number) * dt; if (q.x < 10 || q.x > P.W - 10) q.drift = -(q.drift as number); } }
    const abT = s.rates.kab ? 8 : 0;
    while (this.ab.length < abT) this.ab.push({ x: rand(20, P.W - 20), y: rand(g.sB + 8, g.mem - 30), v: rand(-15, 15) });
    if (this.ab.length > abT) this.ab.length = abT;
    for (const a of this.ab) { a.x += a.v * dt; if (a.x < 10 || a.x > P.W - 10) a.v *= -1; }
    for (const q of this.slots) if (q.away > 0 && q.away < 50) q.away -= dt;
    for (const a of this.anim) P.stepMover(a, dt);
    this.anim = this.anim.filter((a) => !a.done);
  }
  /** The static tissue: hepatocyte plate with organelles, space of Disse with a stellate cell, the sinusoid's lining and a Kupffer cell. */
  tissue() {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    // the next hepatocyte plate above the sinusoid
    const top = new Path2D(); top.rect(0, 0, W, g.sT - 5); paint(top, P.stage2, 1, null, 0); speckle(top, 0, 0, W, g.sT, W * 0.3, 5, 0.25);
    // two hepatocytes and their lateral membrane
    const cells = new Path2D(); cells.rect(0, g.mem, W, H - g.mem); paint(cells, P.stage2, 1, null, 0);
    speckle(cells, 0, g.mem, W, H - g.mem, W * 1.4, 6, 0.2);
    alpha(0.7, () => { c.strokeStyle = P.muted; c.lineWidth = 1.2; c.beginPath(); for (let y = g.mem; y <= H; y += 6) c.lineTo(g.split + Math.sin(y / 23) * 5, y); c.stroke(); });
    // bile canaliculus between them, sealed by tight junctions, lined by microvilli
    const cn = new Path2D(); cn.arc(g.canal.x, g.canal.y, 11, 0, TAU); paint(cn, P.stage, 1, P.muted, 0.8, 1.2);
    alpha(0.6, () => { c.strokeStyle = P.muted; c.lineWidth = 1; for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; c.beginPath(); c.moveTo(g.canal.x + Math.cos(a) * 11, g.canal.y + Math.sin(a) * 11); c.lineTo(g.canal.x + Math.cos(a) * 6.5, g.canal.y + Math.sin(a) * 6.5); c.stroke(); } c.lineWidth = 3; for (const dy of [-16, 16]) { c.beginPath(); c.moveTo(g.canal.x - 2, g.canal.y + dy); c.lineTo(g.canal.x + 2, g.canal.y + dy); c.stroke(); } });
    P.mono("bile canaliculus", g.canal.x + 18, g.canal.y + 26);
    // organelles: rough ER and Golgi (VLDL assembly), mitochondria, endosomes, lysosomes, nuclei, smooth ER (cholesterol synthesis)
    roughER(g.er.x, g.er.y, W * 0.15, 5, 21); P.mono("rough ER", g.er.x, g.er.y + 46);
    golgi(g.golgi.x, g.golgi.y, W * 0.07, 4); P.mono("Golgi", g.golgi.x, g.golgi.y + 34, { a: "center" });
    const R = rnd(31);
    for (const [x, y, a] of [[0.08, 0.72, 0.3], [0.17, 0.66, -0.4], [0.36, 0.47, 0.2], [0.5, 0.76, 1.2], [0.62, 0.44, -0.2], [0.78, 0.47, 0.4], [0.93, 0.56, 1.4], [0.66, 0.84, 0.1], [0.9, 0.9, -0.6], [0.44, 0.88, 0.5]] as const) mito(W * x, H * y, 24 + R() * 6, 7.5, a);
    for (const x of [0.42, 0.66]) { const e = blob(W * x, H * 0.52, 17, 15, (x * 1000) | 0, 0.08); paint(e, P.stage, 0.35, P.muted, 0.7, 1); }
    for (const x of [0.47, 0.72]) { const l = blob(W * x, H * 0.63, 12, 11, (x * 100) | 0, 0.1); paint(l, P.muted, 0.28, P.muted, 0.6, 1); speckle(l, W * x - 12, H * 0.63 - 12, 24, 24, 40, 9, 0.5); }
    P.mono("endosome", W * 0.42, H * 0.52 + 30, { a: "center" }); P.mono("lysosome", W * 0.47, H * 0.63 + 25, { a: "center" });
    nucleus(W * 0.3, H * 0.72, H * 0.075, H * 0.07, 41); nucleus(W * 0.82, H * 0.72, H * 0.075, H * 0.07, 42);
    alpha(0.45, () => { c.strokeStyle = P.muted; c.lineWidth = 1; for (let k = 0; k < 4; k++) { c.beginPath(); for (let x = W * 0.05; x < W * 0.45; x += 6) c.lineTo(x, H * 0.885 + k * 5 + Math.sin(x / 13 + k) * 1.6); c.stroke(); } });
    P.mono("smooth ER", W * 0.05, H * 0.97);
    // the cell membrane facing the space of Disse, with microvilli
    microvilli(0, W, g.mem, 8, 9, -1, 3);
    P.line(0, g.mem, W, g.mem, P.ink, 1.3);
    // space of Disse: collagen and a stellate cell holding vitamin A droplets
    collagen(0, g.sB + 6, W, g.mem - g.sB - 14, 14, 51);
    const st = blob(W * 0.3, (g.sB + g.mem) / 2 - 2, 46, 6, 52, 0.15); paint(st, P.stage2, 1, P.muted, 0.6, 1);
    nucleus(W * 0.3 - 18, (g.sB + g.mem) / 2 - 2, 9, 3.5, 53);
    for (let k = 0; k < 4; k++) P.dot(W * 0.3 + 2 + k * 8, (g.sB + g.mem) / 2 - 2, 2.4, coreColor(0.75));
    // sinusoid lining: fenestrated endothelium on both sides, a Kupffer cell against it
    endothelium(0, W, g.sT, 1, 61, { t: 4, cell: 190, gaps: [], gap: 7 });
    endothelium(0, W, g.sB, -1, 62, { t: 4, cell: 190, gaps: this.gaps, gap: 7 });
    const kx = W * 0.64, ky = g.sB - 15, ku = blob(kx, ky, 34, 12, 71, 0.18); paint(ku, P.stage2, 1, P.muted, 0.7, 1); speckle(ku, kx - 34, ky - 12, 68, 24, 50, 72, 0.4); nucleus(kx - 6, ky, 9, 6, 73);
    P.label("Sinusoid", 12, g.sT + 20); P.mono("portal blood →", W - 12, g.sT + 18, { a: "right" });
    P.mono("space of Disse", 12, g.sB + 20); P.label("Hepatocyte", 12, g.mem + 26); P.label("Hepatocyte", g.split + 14, g.mem + 26);
  }
  draw(dt: number) {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    P.cached("liver", () => this.tissue());
    for (const x of this.gaps) P.reg(x, g.sB, 4, "fenestra", "Fenestra, about 100 nm: chylomicrons are too large to pass");
    anat(W * 0.64, g.sB - 15, 20, "Kupffer cell: the liver's resident macrophage"); anat(W * 0.3, (g.sB + g.mem) / 2, 18, "Stellate cell: stores vitamin A in lipid droplets");
    anat(g.canal.x, g.canal.y, 11, "Bile canaliculus: bile and biliary cholesterol leave here"); anat(g.golgi.x, g.golgi.y, 20, "Golgi: VLDL is finished and secreted");
    drawCells(this.rbc);
    P.sign("ABCG58", g.canal.x - 20, g.canal.y, 15, Math.PI / 2, "ABCG5/G8: sterol out into bile");
    // nucleus signs
    P.sign("SREBP2", W * 0.82, H * 0.72 - 8, 20, 0, "SREBP-2: low liver sterol switches on the LDLR and PCSK9 genes"); P.mono("LDLR, PCSK9 genes", W * 0.82, H * 0.72 + 14, { a: "center" });
    if (P.has("incl")) { P.drugMark("siRNA", W * 0.82 + H * 0.075 + 14, H * 0.7, "Inclisiran (siRNA) silences PCSK9 mRNA", 18); P.mono("PCSK9 mRNA cut", W * 0.82, H * 0.72 + H * 0.075 + 16, { a: "center", c: P.ink }); }
    const lomi = P.has("lomi");
    P.sign("MTP", g.er.x + W * 0.075, g.er.y - 10, 18, 0, lomi ? "MTP blocked by lomitapide" : "MTP: loads triglyceride onto ApoB-100 to make VLDL", lomi ? 0.35 : 1);
    if (lomi) P.drugMark("small", g.er.x + W * 0.075 + 12, g.er.y - 20, "Lomitapide blocks MTP");
    if (P.has("olpa")) P.drugMark("siRNA", g.golgi.x + 30, g.golgi.y + 8, "Olpasiran (siRNA) silences apo(a): less Lp(a) made", 16);
    // cholesterol synthesis on the smooth ER
    const sy = H * 0.83, bem = P.has("bem"), stat = P.has("statin");
    P.mono("acetyl-CoA", W * 0.13, sy + 4, { a: "right" });
    P.sign("ACL", W * 0.16, sy, 18, 0, bem ? "ACL blocked by bempedoic acid" : "ATP citrate lyase", bem ? 0.35 : 1); P.arrow(W * 0.18, sy, W * 0.215, sy);
    P.sign("HMGCR", W * 0.24, sy, 18, 0, stat ? "HMG-CoA reductase blocked by a statin" : "HMG-CoA reductase: the rate-limiting step", stat ? 0.35 : 1); P.arrow(W * 0.262, sy, W * 0.295, sy);
    P.mono("cholesterol", W * 0.3, sy + 4);
    if (bem) P.drugMark("small", W * 0.16 + 11, sy - 11, "Bempedoic acid (works in liver only)");
    if (stat) P.drugMark("small", W * 0.24 + 11, sy - 11, "Statin");
    // receptors on the microvilli
    const vis = this.visible();
    for (const s of this.slots) {
      if (s.away > 0 || (s.type === "LDLR" && !vis.includes(s))) continue;
      const tagged = s.type === "LDLR" && this.tagged(vis, s);
      P.sign(s.type, s.x, g.mem - 13, 17, 0, s.type === "LDLR" ? (tagged ? "LDLR with PCSK9 bound: will be destroyed" : "LDLR: binds ApoB-100 and ApoE") : s.type === "LRP1" ? "LRP1: takes up ApoE-rich remnants" : "SR-B1: takes CE from HDL");
      if (tagged) P.glyph("PCSK9", s.x + 8, g.mem - 24, 12, 0, P.muted);
    }
    if (!vis.length) P.mono("no functional LDLR on the surface", W * 0.5, g.mem - 30, { a: "center", c: P.ink });
    for (const q of this.pc) P.sign("PCSK9", q.x, q.y, 12, 0, "PCSK9, free", 1, P.muted);
    for (const a of this.ab) P.sign("mAb", a.x, a.y, 13, 0, "PCSK9 antibody");
    for (const p of this.flow) if (!p.hold) P.drawParticle(p, 1.15, true);
    for (const a of this.anim) {
      if (a.ce) { P.dot(a.x, a.y, 2.4, coreColor(0.1)); continue; }
      if (a.recOnly) { P.glyph(a.type as string, a.x, a.y, 14, 0, P.ink, 0.7); if (a.tagged) P.glyph("PCSK9", a.x + 7, a.y - 9, 10, 0, P.muted); continue; }
      const p = a.p as Particle;
      p.x = a.x; p.y = a.y; P.drawParticle(p, 1.15, true);
      if (a.rec) { const r = P.radius(p, 1.15); c.save(); c.strokeStyle = P.ink; c.setLineDash([2, 2]); c.beginPath(); c.arc(a.x, a.y, r + 6, 0, TAU); c.stroke(); c.restore(); P.glyph((a.slot as Slot).type, a.x, a.y + r + 2, 13, 0, P.ink, 0.8); }
    }
    this.rings = P.drawRings(this.rings, dt);
  }
}

// ================================================================== capillary bed
class CapScene implements Scene, Lane {
  id = "cap"; name = "Capillary bed";
  note = "A capillary between fat and muscle. LPL sits on GPIHBP1 on the endothelial surface and strips triglyceride from chylomicrons and VLDL; the fatty acids cross into the fat cells to be stored and into the muscle fiber to be burned. ANGPTL3, ANGPTL4 and ApoC-III hold LPL back.";
  caption = "Figure 1. A capillary bed. Docking at LPL follows the model's lipolysis; in FCS the LPL is missing. The capillary is drawn wider than life so particles fit.";
  key = ["CM", "VLDL", "IDL", "CMR", "LDL", "HDL", "LPL", "apoCII", "apoCIII", "ANGPTL3", "ANGPTL4", "FFA", "mAb", "PPARa", "droplet"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; ffa: Mover[] = []; busy: number[] = []; rbc: Cell[] = [];
  ang3: { x: number; y: number; v: number }[] = []; ang4: { x: number; y: number; v: number }[] = [];
  fat: { poly: Pt[]; cx: number; cy: number }[] = [];
  geo() { const H = P.H; return { t: H * 0.09, b: H * 0.37, tis: H * 0.47, split: P.W * 0.53 }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.rings = []; this.ffa = []; this.busy = [];
    prefillAll(this, 0.6, g.t + 12, g.b - 8, 55);
    this.rbc = bloodCells(3, (g.t + g.b) / 2 - 10, (g.t + g.b) / 2 + 10, [42, 50], [18, 20]);
    this.ang3 = Array.from({ length: 5 }, () => ({ x: rand(0, P.W), y: rand(g.t + 20, g.b - 20), v: rand(30, 50) }));
    this.ang4 = Array.from({ length: 3 }, () => ({ x: rand(P.W * 0.05, P.W * 0.5), y: rand(g.b + 12, g.tis - 6), v: rand(-10, 10) }));
    // fat cells packed as a Voronoi tiling of the left half of the tissue
    const R = rnd(91), x0 = 4, x1 = g.split - 10, y0 = g.tis + 4, y1 = P.H - 4, pts: Pt[] = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) pts.push([x0 + (x1 - x0) * ((i + 0.5 + (r ? 0.5 : 0)) / 3.5 + (R() - 0.5) * 0.06), y0 + (y1 - y0) * ((r + 0.5) / 2 + (R() - 0.5) * 0.15)]);
    const v = Delaunay.from(pts).voronoi([x0, y0, x1, y1]);
    this.fat = pts.map((p, i) => ({ poly: (v.cellPolygon(i) ?? []).map(([x, y]) => [x, y] as Pt), cx: p[0], cy: p[1] }));
  }
  lpls() {
    const fcs = P.model.geno === "fcs", n = fcs ? 4 : Math.round(9 * (P.has("fib") ? 1.4 : 1) * (P.has("olez") ? 1.15 : 1));
    return Array.from({ length: n }, (_, i) => ({ x: P.W * (0.06 + (0.88 * (i + 0.5)) / n), inactive: fcs }));
  }
  /** Where a fatty acid released at x goes: into the nearest fat cell's droplet, or to a mitochondrion in the fiber. */
  sink(x: number): Pt {
    const g = this.geo();
    if (x < g.split) { const f = this.fat.reduce((a, b) => (Math.abs(b.cx - x) < Math.abs(a.cx - x) ? b : a)); return [f.cx + rand(-20, 20), f.cy + rand(-20, 20)]; }
    return [Math.min(P.W - 20, Math.max(g.split + 20, x + rand(-40, 40))), rand(g.tis + 30, P.H - 20)];
  }
  step(dt: number) {
    const g = this.geo(), L = this.lpls(), Ln = P.snap.lipolysis;
    feedAll(this, 0.6, g.t + 12, g.b - 8, 55, dt); moveFlow(this, dt); moveCells(this.rbc, dt, (g.t + g.b) / 2 - 10, (g.t + g.b) / 2 + 10);
    for (const r of this.rbc) { r.fixed = true; r.edge = 0.75; r.rot = Math.PI / 2; r.spin = 0; } // squeezed edge-on, single file, across the flow
    for (const p of this.flow) {
      if (p.hold > 0 || p.tg <= (p.b48 ? 0.5 : 0.3) || p.y < g.b - P.radius(p, 1.2) - 16) continue;
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        if (l.inactive || (this.busy[i] ?? 0) > 0 || Math.abs(l.x - p.x) > 10) continue;
        if (Math.random() < Math.min(0.9, 0.5 * Ln) * (p.c3 ? 0.6 : 1)) {
          this.busy[i] = 0.9; p.hold = 0.8; p.y = g.b - P.radius(p, 1.2) - 12; p.x = l.x;
          p.onRelease = (q) => { q.tg = Math.max(q.b48 ? 0.5 : 0.13, q.tg - 0.18 * Math.min(1.6, Ln)); q.c = P.classOf(q); q.vy = -30; };
          for (let k = 0; k < 4; k++) { const [sx, sy] = this.sink(l.x); this.ffa.push(P.mover(l.x, g.b + 2, [{ x: l.x + rand(-6, 6), y: g.b + 14, d: 0.5 }, { x: sx, y: sy, d: rand(1.2, 2) }])); }
        }
        break;
      }
    }
    for (let i = 0; i < this.busy.length; i++) if (this.busy[i]) this.busy[i] -= dt;
    for (const a of this.ang3) { a.x += a.v * dt; if (a.x > P.W + 20) { a.x = -20; a.y = rand(g.t + 20, g.b - 20); } }
    for (const a of this.ang4) { a.x += a.v * dt; if (a.x < 10 || a.x > g.split - 10) a.v *= -1; }
    for (const f of this.ffa) P.stepMover(f, dt);
    this.ffa = this.ffa.filter((f) => !f.done);
  }
  tissue() {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    // above the capillary: interstitium with a pericyte wrapped on the vessel
    const above = new Path2D(); above.rect(0, 0, W, g.t - 5); paint(above, P.stage2, 0.6, null, 0); collagen(0, 4, W, g.t - 14, 10, 93);
    const pc = blob(W * 0.62, g.t - 9, 70, 4.5, 94, 0.2); paint(pc, P.stage2, 1, P.muted, 0.6, 1); nucleus(W * 0.62, g.t - 10, 11, 3.6, 95);
    // continuous endothelium, top and bottom, and the basement membrane under it
    endothelium(0, W, g.t, 1, 96, { t: 5, cell: 210 });
    endothelium(0, W, g.b, -1, 97, { t: 5, cell: 210 });
    alpha(0.4, () => { c.strokeStyle = P.muted; c.setLineDash([1, 2]); c.beginPath(); c.moveTo(0, g.b + 8); c.lineTo(W, g.b + 8); c.stroke(); c.setLineDash([]); });
    // interstitium
    const it = new Path2D(); it.rect(0, g.b + 9, W, g.tis - g.b - 9); paint(it, P.stage2, 0.5, null, 0); collagen(0, g.b + 10, W, g.tis - g.b - 14, 12, 98);
    // fat cells (left) and a muscle fiber (right)
    this.fat.forEach((f, i) => {
      if (f.poly.length < 3) return;
      const ring = f.poly.slice(0, -1), cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      adipocyte(ring.map(([x, y]) => [cx + (x - cx) * 0.97, cy + (y - cy) * 0.97] as Pt), 100 + i);
      f.cx = cx; f.cy = cy;
    });
    muscleFiber(g.split + 6, g.tis + 6, W - g.split - 12, H - g.tis - 12, 120);
    P.label("Capillary lumen", 12, g.t + 22); P.mono("flow →", W - 12, g.t + 20, { a: "right" });
    P.mono("pericyte", W * 0.62, g.t - 18, { a: "center" }); P.mono("endothelium, basement membrane", 12, g.b + 22);
    P.label("Adipocytes", 12, g.tis + 18, { s: 12 }); P.label("Muscle fiber", g.split + 14, g.tis + 22, { s: 12 });
  }
  draw(dt: number) {
    const g = this.geo(), { W } = P;
    P.cached("cap", () => this.tissue());
    for (const f of this.fat) P.reg(f.cx, f.cy, 40, "droplet", "Adipocyte: one large droplet of stored triglyceride");
    anat(W * 0.62, g.t - 9, 14, "Pericyte, wrapped around the capillary");
    drawCells(this.rbc);
    for (const l of this.lpls()) P.sign("LPL", l.x, g.b - 10, 18, Math.PI, l.inactive ? "LPL absent or inactive (FCS)" : "LPL on GPIHBP1: hydrolyzes triglyceride", l.inactive ? 0.3 : 1);
    if (P.has("fib")) P.drugMark("PPARa", W - 24, g.b + 26, "Fibrate: PPAR-α raises LPL and lowers ApoC-III", 16);
    const evin = P.has("evin");
    for (const a of this.ang3) { P.sign("ANGPTL3", a.x, a.y, 14, 0, evin ? "ANGPTL3 captured by evinacumab" : "ANGPTL3: inhibits LPL", evin ? 0.4 : 1); if (evin) P.drugMark("mAb", a.x + 9, a.y - 9, "Evinacumab", 12); }
    for (const a of this.ang4) P.sign("ANGPTL4", a.x, a.y, 13, 0, "ANGPTL4: holds LPL back in fasting fat");
    for (const f of this.ffa) { P.dot(f.x, f.y, 1.8, coreColor(0.95)); P.reg(f.x, f.y, 3, "FFA", "Free fatty acid"); }
    for (const p of this.flow) P.drawParticle(p, 1.2, true);
    this.rings = P.drawRings(this.rings, dt);
  }
}

// ================================================================== intestine
class GutScene implements Scene, Lane {
  id = "gut"; name = "Intestine";
  note = "Enterocytes lining a villus. NPC1L1 at the brush border takes cholesterol from bile micelles, ABCG5/G8 pumps some back, and MTP builds chylomicrons on ApoB-48 in the ER and Golgi. They leave from the base of the cell and enter the lacteal, a lymphatic. Give a meal to fill the lumen.";
  caption = "Figure 1. The small intestine. A meal fills the lumen with micelles and sends chylomicrons into the lymph.";
  key = ["micelle", "NPC1L1", "ABCG58", "MTP", "apoB48", "CM", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; mic: { x: number; y: number; v: number }[] = []; chol: Mover[] = []; anim: Mover[] = [];
  geo() { const H = P.H; return { lum: H * 0.19, bb: H * 0.25, bas: H * 0.7, lac: H * 0.8, lacB: H * 0.97 }; }
  /** Centers of the six enterocytes. */
  cells() { return Array.from({ length: 6 }, (_, i) => P.W * ((i + 0.5) / 6)); }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.chol = []; this.anim = [];
    this.mic = Array.from({ length: 8 }, () => ({ x: rand(0, P.W), y: rand(18, g.lum - 14), v: rand(10, 25) }));
    for (let i = 0; i < 4; i++) this.flow.push(P.particle("CM", rand(0, P.W), rand(g.lac + 12, g.lacB - 12), { y0: g.lac + 12, y1: g.lacB - 12, vmax: 45 }));
  }
  step(dt: number) {
    const g = this.geo(), meal = P.model.meal, eze = P.has("eze"), lomi = P.has("lomi"), cx = this.cells(), H = P.H;
    const micT = Math.round(6 + 16 * meal);
    if (this.mic.length < micT && Math.random() < 3 * dt) this.mic.push({ x: -20, y: rand(18, g.lum - 14), v: rand(10, 25) });
    for (const m of this.mic) m.x += m.v * dt;
    this.mic = this.mic.filter((m) => m.x < P.W + 30); if (this.mic.length > micT + 3) this.mic.shift();
    // cholesterol through NPC1L1 into the cell's ER, and some pumped back by ABCG5/G8
    this.acc.c = (this.acc.c ?? 0) + (0.7 + 3 * meal) * (eze ? 0.12 : 1) * dt;
    while (this.acc.c >= 1) { this.acc.c--; const x = pick(cx); this.chol.push(P.mover(x + rand(-30, 30), g.lum - 10, [{ x, y: g.lum - 2, d: 0.6 }, { x, y: g.bb + 8, d: 0.4 }, { x: x + rand(-20, 20), y: H * 0.36 + rand(-6, 6), d: 1.0 }])); }
    this.acc.e = (this.acc.e ?? 0) + 0.35 * dt;
    while (this.acc.e >= 1) { this.acc.e--; const x = cx[Math.random() < 0.5 ? 1 : 4] + 20; this.chol.push(P.mover(x, g.bb + 30, [{ x, y: g.bb - 4, d: 0.6 }, { x: x + rand(-20, 20), y: g.lum - 22, d: 0.6 }])); }
    // chylomicrons: assembled in the Golgi, released at the base, into the lacteal through its open junctions
    this.acc.cm = (this.acc.cm ?? 0) + (0.15 + 1.4 * meal) * (lomi ? 0.4 : 1) * dt;
    while (this.acc.cm >= 1) {
      this.acc.cm--;
      const x = pick([cx[2], cx[3], cx[1], cx[4]]), p = P.particle("CM", x, H * 0.44, { y0: g.lac + 12, y1: g.lacB - 12, vmax: 45 });
      this.anim.push(P.mover(p.x, p.y, [{ x, y: H * 0.44, d: 1.0 }, { x: x + rand(-14, 14), y: g.bas - 12, d: 1.2 }, { x: x + rand(-20, 20), y: g.bas + 22, d: 0.8 }, { x: x + rand(-20, 20), y: g.lac + 16, d: 0.8 }], { p, onEnd: (m) => { p.x = m.x; p.y = m.y; this.flow.push(p); } }));
    }
    moveFlow(this, dt);
    for (const a of this.chol) P.stepMover(a, dt);
    this.chol = this.chol.filter((a) => !a.done);
    for (const a of this.anim) P.stepMover(a, dt);
    this.anim = this.anim.filter((a) => !a.done);
  }
  tissue() {
    const g = this.geo(), c = P.ctx, { W, H } = P, cx = this.cells(), cw = W / 6;
    // enterocytes: columnar cells, lateral membranes, tight junctions at the apex, basal nuclei, ER and Golgi above them
    const epi = new Path2D(); epi.rect(0, g.bb, W, g.bas - g.bb); paint(epi, P.stage2, 1, null, 0); speckle(epi, 0, g.bb, W, g.bas - g.bb, W * 1.1, 131, 0.2);
    for (let i = 1; i < 6; i++) {
      const x = i * cw;
      alpha(0.65, () => { c.strokeStyle = P.muted; c.lineWidth = 1.1; c.beginPath(); for (let y = g.bb; y <= g.bas; y += 6) c.lineTo(x + Math.sin(y / 17 + i) * 3, y); c.stroke(); c.lineWidth = 3.5; c.beginPath(); c.moveTo(x, g.bb + 1); c.lineTo(x, g.bb + 8); c.stroke(); });
    }
    cx.forEach((x, i) => {
      nucleus(x, H * 0.6, cw * 0.17, H * 0.07, 140 + i);
      golgi(x, H * 0.47, cw * 0.36, 3);
      roughER(x - cw * 0.32, H * 0.34, cw * 0.64, 2, 150 + i);
      mito(x - cw * 0.25, H * 0.53, 18, 6, 1.3); mito(x + cw * 0.26, H * 0.41, 18, 6, 1.5);
    });
    // brush border, the apical membrane and the basal membrane on its basement membrane
    microvilli(0, W, g.bb, g.bb - g.lum, 7, -1, 3.4);
    P.line(0, g.bb, W, g.bb, P.ink, 1.2); P.line(0, g.bas, W, g.bas, P.ink, 1);
    alpha(0.4, () => { c.strokeStyle = P.muted; c.setLineDash([1, 2]); c.beginPath(); c.moveTo(0, g.bas + 4); c.lineTo(W, g.bas + 4); c.stroke(); c.setLineDash([]); });
    // lamina propria: connective tissue, a blood capillary, and the lacteal with overlapping open junctions
    const lp = new Path2D(); lp.rect(0, g.bas + 5, W, H - g.bas - 5); paint(lp, P.stage2, 0.45, null, 0); collagen(0, g.bas + 8, W, g.lac - g.bas - 14, 10, 160);
    for (const [x, y] of [[0.14, 0.75], [0.86, 0.755]] as const) { const v = new Path2D(); v.ellipse(W * x, H * y, 20, 9, 0, 0, TAU); paint(v, P.stage, 1, P.muted, 0.7, 1.2); redCell(W * x, H * y, 7, 0, 0.6); }
    const lac = new Path2D(); lac.rect(0, g.lac, W, g.lacB - g.lac); paint(lac, P.stage, 1, null, 0);
    alpha(0.75, () => { c.strokeStyle = P.muted; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, g.lacB); c.lineTo(W, g.lacB); c.stroke(); for (let x = 0; x < W; x += 60) { c.beginPath(); c.moveTo(x + 4, g.lac); c.lineTo(x + 46, g.lac); c.stroke(); c.beginPath(); c.moveTo(x + 40, g.lac - 3); c.lineTo(x + 62, g.lac + 2); c.stroke(); } });
    P.label("Intestinal lumen", 12, 18); P.mono("brush border", W - 12, g.lum - 6, { a: "right" }); P.label("Enterocytes", 12, g.bb + 24);
    P.mono("lamina propria", 12, g.bas + 22); P.mono("lacteal (lymph) →", W - 12, g.lac + 16, { a: "right" });
  }
  draw() {
    const g = this.geo(), c = P.ctx, { W, H } = P, cx = this.cells();
    P.cached("gut", () => this.tissue());
    anat(W * 0.14, H * 0.75, 18, "Blood capillary: chylomicrons are too large to enter it"); anat(cx[0], H * 0.6, 16, "Enterocyte nucleus");
    for (const m of this.mic) {
      c.fillStyle = P.ink; for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; c.fillRect(m.x + Math.cos(a) * 8, m.y + Math.sin(a) * 8, 1.4, 1.4); }
      P.dot(m.x, m.y, 2.5, coreColor(0.1)); P.reg(m.x, m.y, 10, "micelle", "Bile micelle carrying cholesterol and fatty acids");
    }
    const eze = P.has("eze"), lomi = P.has("lomi");
    for (const x of cx) { P.sign("NPC1L1", x, g.lum - 4, 15, 0, eze ? "NPC1L1 blocked by ezetimibe" : "NPC1L1: cholesterol in", eze ? 0.35 : 1); if (eze) P.drugMark("small", x + 9, g.lum - 12, "Ezetimibe", 10); }
    for (const i of [1, 4]) P.sign("ABCG58", cx[i] + 20, g.lum - 4, 15, 0, "ABCG5/G8: plant sterols and cholesterol back out");
    for (const i of [2, 3]) { P.sign("MTP", cx[i] + 26, H * 0.37, 16, 0, lomi ? "MTP blocked by lomitapide" : "MTP: assembles chylomicrons on ApoB-48", lomi ? 0.35 : 1); if (lomi) P.drugMark("small", cx[i] + 37, H * 0.37 - 9, "Lomitapide"); }
    for (const a of this.chol) P.dot(a.x, a.y, 2.3, coreColor(0.1));
    for (const a of this.anim) { const p = a.p as Particle; p.x = a.x; p.y = a.y; p.tg = 0.92; P.drawParticle(p, 0.55 + Math.min(1, a.i * 0.35 + a.t) * 0.55, true); }
    for (const p of this.flow) P.drawParticle(p, 1.0, true);
    if (P.model.meal < 0.05) P.mono("fasting: few chylomicrons", W * 0.5, (g.lac + g.lacB) / 2 + 4, { a: "center" });
  }
}

// ================================================================== artery wall
class ArteryScene implements Scene, Lane {
  id = "artery"; name = "Artery wall";
  note = "The wall of a large artery: endothelium, the intima, the internal elastic lamina and the smooth muscle of the media. ApoB particles cross the endothelium and are held by proteoglycans; oxidized ones are taken up by a macrophage, and ABCA1 hands its cholesterol to pre-β HDL. A teaching view, not a plaque model.";
  caption = "Figure 1. The arterial intima. The number of ApoB particles held in the wall follows LDL-C and Lp(a). The intima is drawn thicker than in a healthy artery.";
  key = ["LDL", "LPA", "OXLDL", "HDL", "PREB", "SRA", "ABCA1", "apoAI", "droplet"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; ret: Particle[] = []; anim: Mover[] = []; foam = 6; rbc: Cell[] = [];
  geo() { const H = P.H; return { t: H * 0.02, e: H * 0.26, iel: H * 0.64 }; }
  mac() { return { x: P.W * 0.68, y: P.H * 0.45, r: Math.min(P.W * 0.1, P.H * 0.14) }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.rings = []; this.ret = []; this.anim = []; this.foam = 6;
    prefillAll(this, 0.5, g.t + 10, g.e - 10, 70, ["CM", "VLDL", "IDL"]);
    this.rbc = bloodCells(5, g.t + 22, g.e - 22, [60, 80], [15, 18]);
  }
  step(dt: number) {
    const g = this.geo(), m = this.mac(), s = P.snap;
    feedAll(this, 0.5, g.t + 10, g.e - 10, 70, dt, ["CM", "VLDL", "IDL"]); moveFlow(this, dt); moveCells(this.rbc, dt, g.t + 22, g.e - 22);
    const target = Math.min(36, Math.round(3 + (10 * s.ldl) / 100 + (5 * s.lpa) / 100));
    this.acc.in = (this.acc.in ?? 0) + (this.ret.length < target ? 0.9 : 0.1) * dt;
    while (this.acc.in >= 1) {
      this.acc.in--;
      const cand = this.flow.filter((p) => (p.c === "LDL" || p.c === "LPA") && !p.hold && p.x > P.W * 0.05 && p.x < P.W * 0.5);
      if (!cand.length) continue;
      const p = pick(cand); p.gone = true;
      const q = P.particle(p.c, p.x, p.y); q.tg = p.tg;
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: g.e + 10, d: 0.8 }, { x: rand(P.W * 0.04, P.W * 0.5), y: rand(g.e + 26, g.iel - 16), d: 1.4 }], { p: q, onEnd: (mm) => { q.x = mm.x; q.y = mm.y; this.ret.push(q); } }));
    }
    if (this.ret.length > target + 2 && Math.random() < 0.5 * dt) { const q = this.ret.shift()!; P.ring(this.rings, q.x, q.y, 5); }
    for (const q of this.ret) { q.age += dt; q.x += rand(-1, 1) * 4 * dt; q.y += rand(-1, 1) * 4 * dt; if (q.age > 9) q.ox = true; }
    this.acc.mo = (this.acc.mo ?? 0) + 0.3 * dt;
    while (this.acc.mo >= 1) {
      this.acc.mo--;
      const q = this.ret.find((r) => r.ox); if (!q) continue;
      this.ret = this.ret.filter((r) => r !== q);
      const a = Math.PI * rand(0.8, 1.3);
      this.anim.push(P.mover(q.x, q.y, [{ x: m.x + Math.cos(a) * m.r, y: m.y + Math.sin(a) * m.r, d: 1.2 }, { x: m.x + rand(-m.r * 0.4, m.r * 0.4), y: m.y + rand(-m.r * 0.4, m.r * 0.4), d: 0.8 }], { p: q, onEnd: () => { this.foam = Math.min(30, this.foam + 1); } }));
    }
    this.acc.ef = (this.acc.ef ?? 0) + (this.foam > 0 ? 0.3 : 0) * dt;
    while (this.acc.ef >= 1) {
      this.acc.ef--;
      const p = P.particle("PREB", rand(P.W * 0.5, P.W * 0.9), g.e - 12), sx = m.x + rand(-m.r * 0.5, m.r * 0.5), sy = m.y - m.r - 6;
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: g.e + 8, d: 0.7 }, { x: sx, y: sy - 8, d: 1.2 }, { x: sx, y: sy - 8, d: 0.6 }, { x: sx + 30, y: g.e - 16, d: 1.3 }], {
        p, onWay: (_mm, i) => { if (i === 3) { this.foam = Math.max(0, this.foam - 1); p.c = "HDL"; p.tg = 0.15; } },
        onEnd: (mm) => { this.flow.push(P.particle("HDL", mm.x, mm.y, { y0: g.t + 10, y1: g.e - 10, vmax: 70 })); },
      }));
    }
    for (const a of this.anim) P.stepMover(a, dt);
    this.anim = this.anim.filter((a) => !a.done);
  }
  tissue() {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    // intima: extracellular matrix with proteoglycans drawn as bottlebrushes
    const intima = new Path2D(); intima.rect(0, g.e + 5, W, g.iel - g.e - 5); paint(intima, P.stage2, 0.7, null, 0);
    const R = rnd(171);
    alpha(0.3, () => {
      c.strokeStyle = P.muted; c.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const x = R() * W, y = g.e + 20 + R() * (g.iel - g.e - 36), a = R() * TAU, len = 30 + R() * 30;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
        for (let k = 1; k < 7; k++) { const t = k / 7, px = x + Math.cos(a) * len * t, py = y + Math.sin(a) * len * t, n = a + Math.PI / 2; c.beginPath(); c.moveTo(px - Math.cos(n) * 4, py - Math.sin(n) * 4); c.lineTo(px + Math.cos(n) * 4, py + Math.sin(n) * 4); c.stroke(); }
      }
    });
    collagen(0, g.e + 10, W, g.iel - g.e - 20, 10, 172);
    // internal elastic lamina, then the media: layers of smooth muscle
    elasticLamina(0, W, g.iel);
    const media = new Path2D(); media.rect(0, g.iel + 6, W, H - g.iel - 6); paint(media, P.stage2, 1, null, 0);
    for (let row = 0, y = g.iel + 18; y < H - 6; y += 17, row++) for (let x = (row % 2) * 34 - 30; x < W + 40; x += 70 + R() * 12) smoothMuscle(x, y + R() * 4, 60, 12, (R() - 0.5) * 0.12, (R() * 1e6) | 0);
    // the macrophage, with pseudopods
    const m = this.mac(), mac = blob(m.x, m.y, m.r * 1.15, m.r, 181, 0.16);
    paint(mac, P.stage2, 1, P.ink, 0.8, 1); speckle(mac, m.x - m.r * 1.2, m.y - m.r, m.r * 2.4, m.r * 2, 160, 182, 0.35);
    nucleus(m.x + m.r * 0.45, m.y + m.r * 0.35, m.r * 0.3, m.r * 0.22, 183, 0.5);
    // endothelium over a monocyte rolling on it
    endothelium(0, W, g.e, -1, 184, { t: 5, cell: 160 });
    const mo = blob(W * 0.86, g.e - 15, 15, 13, 185, 0.12); paint(mo, P.stage2, 1, P.muted, 0.7, 1); nucleus(W * 0.86 - 2, g.e - 15, 8, 6, 186);
    P.label("Arterial lumen", 12, g.t + 20); P.mono("flow →", W - 12, g.t + 18, { a: "right" }); P.label("Intima", 12, g.e + 28);
    P.mono("internal elastic lamina", 12, g.iel - 8); P.label("Media", 12, g.iel + 30);
  }
  draw(dt: number) {
    const g = this.geo(), m = this.mac(), { W } = P;
    P.cached("artery", () => this.tissue());
    anat(W * 0.86, g.e - 15, 14, "Monocyte rolling on the endothelium, about to enter the wall"); anat(W * 0.5, g.iel, 6, "Internal elastic lamina");
    drawCells(this.rbc);
    P.label(this.foam > 18 ? "Macrophage, becoming a foam cell" : "Macrophage", m.x, m.y + m.r + 20, { a: "center", s: 12 });
    const R = rnd(7);
    alpha(0.85, () => { for (let k = 0; k < Math.round(this.foam); k++) { const a = R() * TAU, d = Math.sqrt(R()) * m.r * 0.7; P.dot(m.x - m.r * 0.15 + Math.cos(a) * d, m.y - m.r * 0.1 + Math.sin(a) * d * 0.8, 3.6, coreColor(0.2)); } });
    P.reg(m.x, m.y, m.r * 0.6, "droplet", `Cholesteryl ester droplets: ${Math.round(this.foam)}`);
    for (let k = 0; k < 3; k++) { const a = Math.PI * (0.85 + k * 0.17); P.sign("SRA", m.x + Math.cos(a) * (m.r * 1.15 + 6), m.y + Math.sin(a) * (m.r + 6), 15, a + Math.PI / 2, "Scavenger receptor (SR-A, CD36): takes up oxidized LDL"); }
    for (let k = 0; k < 3; k++) { const a = Math.PI * (1.35 + k * 0.15); P.sign("ABCA1", m.x + Math.cos(a) * (m.r * 1.15 + 6), m.y + Math.sin(a) * (m.r + 6), 15, a + Math.PI / 2, "ABCA1: cholesterol out to ApoA-I"); }
    for (const p of this.flow) P.drawParticle(p, 1.25, true);
    for (const q of this.ret) P.drawParticle(q, 1.25, true);
    for (const a of this.anim) { const p = a.p as Particle; p.x = a.x; p.y = a.y; P.drawParticle(p, 1.25, true); }
    this.rings = P.drawRings(this.rings, dt);
  }
}

export const bodyScene = new BodyScene();
export const SCENES: Record<string, Scene> = { body: bodyScene, liver: new LiverScene(), plasma: new PlasmaScene(), cap: new CapScene(), gut: new GutScene(), artery: new ArteryScene() };
