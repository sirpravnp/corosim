import { G, coreColor, ramp } from "./glyphs";
import type { LipidModel, Snapshot } from "./model";

/**
 * The stage's drawing kit, shared by every view: the canvas and its size, theme colors, glyphs rendered to images, a hit list for
 * the hover names and the key's highlight, lipoprotein particles, path animations and the flowing lanes the zoom views use.
 */

export type ClassId = "CM" | "CMR" | "VLDL" | "IDL" | "LDL" | "LPA" | "HDL" | "PREB";
export interface ClassDef { label: string; b?: "apoB48" | "apoB100"; tg: number; apos: string[]; apoa?: boolean }
export const CLASSES: Record<ClassId, ClassDef> = {
  CM: { label: "Chylomicron", b: "apoB48", tg: 0.92, apos: ["apoCII", "apoCIII", "apoE"] },
  CMR: { label: "Chylomicron remnant", b: "apoB48", tg: 0.55, apos: ["apoE", "apoCIII"] },
  VLDL: { label: "VLDL", b: "apoB100", tg: 0.74, apos: ["apoCII", "apoCIII", "apoE"] },
  IDL: { label: "IDL", b: "apoB100", tg: 0.45, apos: ["apoE", "apoCIII"] },
  LDL: { label: "LDL", b: "apoB100", tg: 0.13, apos: [] },
  LPA: { label: "Lp(a)", b: "apoB100", tg: 0.12, apos: [], apoa: true },
  HDL: { label: "HDL", tg: 0.15, apos: ["apoAI"] },
  PREB: { label: "Pre-β HDL", tg: 0.05, apos: [] },
};

export interface Particle {
  c: ClassId; c0: ClassId; tg: number; x: number; y: number; vy: number; rot: number; spin: number;
  /** Carries ApoC-III (fewer do on ApoC-III silencers); carries LCAT (drawn in the plasma view). */
  c3: boolean; lcat: boolean; b48: boolean;
  /** Lane bounds and peak speed for flowing particles. */
  y0: number; y1: number; vmax: number;
  hold: number; gone: boolean; ox: boolean; age: number;
  onRelease?: (p: Particle) => void;
  /** Whole-body routing. */
  loop?: string; s?: number; off?: number; sp?: number; pass?: number; lp?: number;
}

export interface Waypoint { x: number; y: number; d: number }
export interface Mover {
  x: number; y: number; sx: number; sy: number; pts: Waypoint[]; i: number; t: number; done: boolean;
  onWay?: (m: Mover, i: number) => void; onEnd?: (m: Mover) => void;
  [k: string]: unknown;
}

export interface Hit { x: number; y: number; r: number; key: string; label: string }
export interface Ring { x: number; y: number; r: number; t: number }

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];
export const nearest = <T extends { x: number }>(a: T[], x: number) => a.reduce((p, q) => (Math.abs(q.x - x) < Math.abs(p.x - x) ? q : p));

class Painter {
  cv!: HTMLCanvasElement; ctx!: CanvasRenderingContext2D;
  W = 0; H = 0; dpr = 1;
  ink = "#f4f1ea"; muted = "#98a0b8"; rule = "#2b2f45"; stage = "#000"; stage2 = "#17181d"; soft = "#1a1d2c";
  hits: Hit[] = [];
  model!: LipidModel; snap!: Snapshot;
  sceneId = "body";
  /** Redraw request for when the loop is paused (a glyph image finished loading, the theme changed). */
  redraw: () => void = () => {};
  private imgs = new Map<string, HTMLImageElement>();

  attach(cv: HTMLCanvasElement) { this.cv = cv; this.ctx = cv.getContext("2d")!; this.readTheme(); }
  readTheme() {
    const cs = getComputedStyle(document.documentElement), g = (n: string) => cs.getPropertyValue(n).trim();
    this.ink = g("--ink") || this.ink; this.muted = g("--muted") || this.muted; this.rule = g("--rule") || this.rule;
    this.stage = g("--stage") || this.stage; this.stage2 = g("--stage-2") || this.stage2; this.soft = g("--rule-light") || this.soft;
  }
  resize() { this.dpr = Math.min(2, window.devicePixelRatio || 1); const r = this.cv.getBoundingClientRect(); this.W = r.width; this.H = r.height; this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr); }
  has(d: string) { return this.model.drugs.has(d as never); }

  private img(id: string, color: string) {
    const k = id + "|" + color;
    let im = this.imgs.get(k);
    if (!im) {
      im = new Image(); im.onload = () => this.redraw();
      im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="64" height="64">${G[id].split("currentColor").join(color)}</svg>`);
      this.imgs.set(k, im);
    }
    return im;
  }
  /** Draw a glyph centered at x, y. */
  glyph(id: string, x: number, y: number, size: number, rot = 0, color = this.ink, alpha = 1) {
    const im = this.img(id, color); if (!im.complete || !im.naturalWidth) return;
    const c = this.ctx; c.save(); c.globalAlpha *= alpha; c.translate(x, y); if (rot) c.rotate(rot); c.drawImage(im, -size / 2, -size / 2, size, size); c.restore();
  }
  /** Draw a glyph and register it for the hover name and the key. */
  sign(id: string, x: number, y: number, size: number, rot: number, label: string, alpha = 1, color = this.ink) { this.glyph(id, x, y, size, rot, color, alpha); this.reg(x, y, size / 2, id, label); }
  /** A drug's class mark on its target, registered under the class so the key finds it. */
  drugMark(cls: string, x: number, y: number, label: string, size = 11) { this.glyph(cls, x, y, size); this.reg(x, y, size / 2, cls, label); }
  reg(x: number, y: number, r: number, key: string, label: string) { this.hits.push({ x, y, r, key, label }); }

  label(t: string, x: number, y: number, o: { s?: number; w?: number; c?: string; a?: CanvasTextAlign } = {}) {
    const c = this.ctx; c.font = `${o.w ?? 500} ${o.s ?? 13}px "Hanken Grotesk", "Helvetica Neue", Arial, sans-serif`; c.fillStyle = o.c ?? this.ink; c.textAlign = o.a ?? "left"; c.fillText(t, x, y); c.textAlign = "left";
  }
  mono(t: string, x: number, y: number, o: { s?: number; c?: string; a?: CanvasTextAlign } = {}) {
    const c = this.ctx; c.font = `${o.s ?? 11}px "JetBrains Mono", ui-monospace, monospace`; c.fillStyle = o.c ?? this.muted; c.textAlign = o.a ?? "left"; c.fillText(t, x, y); c.textAlign = "left";
  }
  line(x1: number, y1: number, x2: number, y2: number, color = this.ink, w = 1) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  arrow(x1: number, y1: number, x2: number, y2: number, color = this.muted) {
    const c = this.ctx; this.line(x1, y1, x2, y2, color);
    const a = Math.atan2(y2 - y1, x2 - x1); c.fillStyle = color; c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 7 * Math.cos(a - 0.4), y2 - 7 * Math.sin(a - 0.4)); c.lineTo(x2 - 7 * Math.cos(a + 0.4), y2 - 7 * Math.sin(a + 0.4)); c.closePath(); c.fill();
  }
  stipple(x0: number, y0: number, w: number, h: number, step: number, alpha: number, color = this.muted) {
    const c = this.ctx; c.fillStyle = color; c.globalAlpha = alpha;
    for (let x = x0 + 2; x < x0 + w; x += step) for (let y = y0 + 2 + (Math.round((x - x0) / step) % 2) * step / 2; y < y0 + h; y += step) c.fillRect(x, y, 1, 1);
    c.globalAlpha = 1;
  }
  dot(x: number, y: number, r: number, fill: string) { const c = this.ctx; c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }

  // ---- particles
  particle(c: ClassId, x: number, y: number, extra: Partial<Particle> = {}): Particle {
    const t = CLASSES[c];
    return { c, c0: c, tg: t.tg * (0.94 + Math.random() * 0.12), x, y, vy: 0, rot: Math.random() * 6.28, spin: rand(-0.7, 0.7), c3: Math.random() < (this.snap?.c3 ?? 1), lcat: Math.random() < 0.3, b48: t.b === "apoB48", y0: 0, y1: this.H, vmax: 60, hold: 0, gone: false, ox: false, age: 0, ...extra };
  }
  radius(p: Particle, k: number) {
    if (p.c === "HDL") return (3 + 2 * p.tg) * k;
    if (p.c === "PREB") return 3 * k;
    return (p.b48 ? 5 + 9.5 * p.tg : 4.2 + 8.5 * p.tg) * k;
  }
  /** Draw a lipoprotein; `detail` adds its apolipoprotein signs (the zoom views), the whole body draws bare particles. */
  drawParticle(p: Particle, k: number, detail: boolean) {
    const c = this.ctx, r = this.radius(p, k), cls = CLASSES[p.c];
    if (p.c === "PREB") {
      c.fillStyle = coreColor(0.05); c.fillRect(p.x - r * 1.7, p.y - r * 0.55, r * 3.4, r * 1.1);
      c.strokeStyle = this.ink; c.lineWidth = 0.8; c.strokeRect(p.x - r * 1.7, p.y - r * 0.55, r * 3.4, r * 1.1);
      if (detail) { this.glyph("apoAI", p.x - r * 1.7 - 3 * k, p.y, 6 * k); this.glyph("apoAI", p.x + r * 1.7 + 3 * k, p.y, 6 * k); }
      this.reg(p.x, p.y, r * 1.8, "PREB", "Pre-β HDL: lipid-poor ApoA-I");
      return;
    }
    c.fillStyle = p.ox ? ramp(0.06) : coreColor(p.tg);
    c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.fill();
    if (r > 3.2) { c.save(); c.strokeStyle = this.ink; c.globalAlpha = 0.6; c.lineWidth = 0.8; c.setLineDash([1.2, 1.7]); c.stroke(); c.restore(); }
    if (detail) {
      const a = p.rot, rr = r + 3.4 * k;
      if (cls.b) this.glyph(cls.b, p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 8 * k, a + Math.PI / 2);
      let j = 0;
      for (const id of cls.apos) {
        if (id === "apoCIII" && !p.c3) continue;
        const b = a + 1.9 + j * 1.25; j++;
        this.glyph(id, p.x + Math.cos(b) * (r + 3 * k), p.y + Math.sin(b) * (r + 3 * k), (p.c === "HDL" ? 6 : 6.5) * k);
      }
      if (cls.apoa) {
        c.strokeStyle = this.ink; c.lineWidth = 0.9; const b = a + Math.PI;
        for (let q = 0; q < 3; q++) { const d = r + (3 + q * 3.6) * k; c.beginPath(); c.arc(p.x + Math.cos(b) * d, p.y + Math.sin(b) * d, 1.6 * k, 0, 6.28); c.stroke(); }
      }
      if (p.c === "HDL" && p.lcat && this.sceneId === "plasma") this.glyph("LCAT", p.x + r + 4 * k, p.y - r - 2 * k, 6 * k, 0, this.muted);
    }
    const lab = p.ox ? "Oxidized LDL, retained in the intima" : `${cls.label}${cls.b ? " · " + (cls.b === "apoB48" ? "ApoB-48" : "ApoB-100") : ""} · core about ${Math.round(p.tg * 100)}% TG`;
    this.reg(p.x, p.y, r + 2, p.ox ? "OXLDL" : p.c, lab);
  }
  /** Class from core content: lipolysis turns VLDL into IDL and LDL, and a chylomicron into its remnant. */
  classOf(p: Particle): ClassId {
    if (p.b48) return p.tg > 0.7 ? "CM" : "CMR";
    if (p.c === "VLDL" || p.c === "IDL" || p.c === "LDL") return p.tg > 0.6 ? "VLDL" : p.tg > 0.3 ? "IDL" : "LDL";
    return p.c;
  }

  // ---- effects and movers
  ring(list: Ring[], x: number, y: number, r: number) { list.push({ x, y, r, t: 0.6 }); }
  drawRings(list: Ring[], dt: number) {
    const c = this.ctx;
    for (const f of list) { f.t -= dt; c.globalAlpha = Math.max(0, f.t / 0.6); c.strokeStyle = this.ink; c.lineWidth = 1; c.beginPath(); c.arc(f.x, f.y, f.r + (0.6 - f.t) * 14, 0, 6.28); c.stroke(); }
    c.globalAlpha = 1;
    return list.filter((f) => f.t > 0);
  }
  mover(x: number, y: number, pts: Waypoint[], o: Partial<Mover> = {}): Mover { return { x, y, sx: x, sy: y, pts, i: 0, t: 0, done: false, ...o }; }
  stepMover(m: Mover, dt: number) {
    if (m.done) return;
    m.t += dt;
    while (m.i < m.pts.length && m.t >= m.pts[m.i].d) { m.t -= m.pts[m.i].d; m.sx = m.pts[m.i].x; m.sy = m.pts[m.i].y; m.i++; m.onWay?.(m, m.i); }
    if (m.i >= m.pts.length) { m.done = true; m.x = m.sx; m.y = m.sy; m.onEnd?.(m); return; }
    const p = m.pts[m.i], u = m.t / p.d, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    m.x = lerp(m.sx, p.x, e); m.y = lerp(m.sy, p.y, e);
  }

  // ---- flowing lanes
  /** How many particles of each class a view of relative size k should show: the model's concentrations, sampled. */
  counts(k: number): Record<"LDL" | "VLDL" | "IDL" | "CM" | "HDL" | "LPA", number> {
    const s = this.snap;
    return {
      LDL: Math.min(150, (28 * s.ldl) / 100 * k), VLDL: Math.min(45, (6 * s.tgVldl) / 95 * k), IDL: Math.min(30, (2.6 * s.tgVldl) / 95 * k * (0.16 / s.idlClearance)),
      CM: Math.min(36, (2.2 * s.tgChylo) / 25 * k), HDL: Math.min(80, (24 * s.hdl) / 50 * k), LPA: Math.min(26, Math.max(0.5, s.lpa / 20) * k),
    };
  }
}
export const P = new Painter();

/** A view's flowing particles and spawn accumulators. */
export interface Lane { flow: Particle[]; acc: Record<string, number> }
export const FLOW_CLASSES = ["LDL", "VLDL", "IDL", "HDL", "LPA", "CM"] as const;
type FlowClass = (typeof FLOW_CLASSES)[number];

export function feed(l: Lane, c: ClassId, target: number, y0: number, y1: number, vmax: number, dt: number) {
  l.acc[c] = l.acc[c] ?? 0;
  const n = l.flow.reduce((a, p) => a + (p.c0 === c ? 1 : 0), 0);
  if (n < target * 1.2) l.acc[c] += ((target * 0.75 * vmax) / (P.W + 60)) * dt * (n < target * 0.7 ? 2 : 1);
  while (l.acc[c] >= 1) { l.acc[c]--; l.flow.push(P.particle(c, -18, rand(y0, y1), { y0, y1, vmax })); }
}
export function moveFlow(l: Lane, dt: number) {
  for (const p of l.flow) {
    if (p.hold > 0) { p.hold -= dt; if (p.hold <= 0 && p.onRelease) { const f = p.onRelease; p.onRelease = undefined; f(p); } continue; }
    const yc = (p.y0 + p.y1) / 2, hh = (p.y1 - p.y0) / 2 + 6, u = p.vmax * (0.25 + 0.75 * (1 - Math.min(1, ((p.y - yc) / hh) ** 2)));
    p.x += u * dt; p.vy += rand(-1, 1) * 60 * dt; p.vy *= Math.exp(-2 * dt); p.y += p.vy * dt;
    if (p.y < p.y0) { p.y = p.y0; p.vy = Math.abs(p.vy); }
    if (p.y > p.y1) { p.y = p.y1; p.vy = -Math.abs(p.vy); }
    p.rot += p.spin * dt;
  }
  l.flow = l.flow.filter((p) => p.x < P.W + 30 && !p.gone);
}
export function feedAll(l: Lane, k: number, y0: number, y1: number, vmax: number, dt: number, skip: FlowClass[] = []) {
  const T = P.counts(k); for (const c of FLOW_CLASSES) if (!skip.includes(c)) feed(l, c, T[c], y0, y1, vmax, dt);
}
export function prefillAll(l: Lane, k: number, y0: number, y1: number, vmax: number, skip: FlowClass[] = []) {
  const T = P.counts(k);
  for (const c of FLOW_CLASSES) if (!skip.includes(c)) for (let i = 0; i < Math.round(T[c]); i++) l.flow.push(P.particle(c, rand(0, P.W), rand(y0, y1), { y0, y1, vmax }));
}
