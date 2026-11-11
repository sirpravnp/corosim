import { coreColor } from "./glyphs";
import { rnd } from "./molecules";
import { Lane, Mover, P, Particle, Ring, feedAll, lerp, moveFlow, nearest, pick, prefillAll, rand } from "./paint";

/**
 * The six views on the stage. The whole body shows circulation without receptor detail; each zoom view shows one place where
 * lipoproteins are made, changed or removed. All of them draw their particle counts and event rates from the model's snapshot
 * (P.snap), so a drug turned on changes every view and the labs together.
 */
export interface Scene {
  id: string; name: string; note: string; caption: string; key: string[];
  init(): void; step(dt: number): void; draw(dt: number): void;
  region?(x: number, y: number): string | null;
}

// ================================================================== whole body
type Pt = [number, number];
interface Loop { pts: Pt[]; bed?: number[]; liver?: number[]; lymph?: boolean; px: Pt[]; cum: number[]; len: number }
const BODY = {
  liver: [[0.6, 0.12], [0.93, 0.09], [0.96, 0.2], [0.88, 0.35], [0.72, 0.38], [0.61, 0.3]] as Pt[],
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
/** The whole-body drawing, also used small as the "where am I" map in the zoom views. */
export function drawBody(bx: number, by: number, bw: number, bh: number, mini: boolean, hi: string | null) {
  const c = P.ctx, X = (x: number) => bx + x * bw, Y = (y: number) => by + y * bh, sc = mini ? 0.32 : 1;
  const edge = (on: boolean) => { c.strokeStyle = on ? P.ink : P.rule; c.lineWidth = on ? 2 : 1; };
  c.save();
  c.beginPath(); BODY.liver.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath();
  c.fillStyle = P.stage2; c.fill(); edge(hi === "liver"); c.stroke();
  for (const e of [BODY.adip, BODY.musc]) { c.beginPath(); c.ellipse(X(e[0]), Y(e[1]), e[2] * bw, e[3] * bh, 0, 0, 6.28); c.fillStyle = P.stage2; c.fill(); edge(hi === "cap"); c.stroke(); }
  c.beginPath(); BODY.gut.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
  c.strokeStyle = P.stage2; c.lineWidth = 16 * sc; c.lineJoin = "round"; c.lineCap = "round"; c.stroke();
  edge(hi === "gut"); c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
  for (const L of Object.values(LOOPS)) {
    c.beginPath(); L.pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
    c.strokeStyle = P.stage2; c.lineWidth = (L.lymph ? 6 : 11) * sc; c.stroke();
    c.strokeStyle = hi === "plasma" ? P.ink : P.muted; c.lineWidth = hi === "plasma" ? 1.4 : 0.8; if (L.lymph) c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
  }
  c.beginPath(); c.arc(X(BODY.heart[0]), Y(BODY.heart[1]), 26 * sc * Math.min(1, bw / 900) + (mini ? 2 : 6), 0, 6.28); c.fillStyle = P.stage2; c.fill(); c.strokeStyle = P.rule; c.lineWidth = 1; c.stroke();
  const ax = X(BODY.aorta[0]), ay = Y(BODY.aorta[1]), as = mini ? 4 : 9;
  c.strokeStyle = hi === "artery" ? P.ink : P.muted; c.lineWidth = hi === "artery" ? 2 : 1; c.strokeRect(ax - as, ay - as, as * 2, as * 2);
  c.restore();
}

class BodyScene implements Scene {
  id = "body"; name = "Whole body";
  note = "Lipoproteins circulating without receptor detail. Click the liver, a capillary bed, the gut, a vessel or the aortic wall marker to zoom in.";
  caption = "Figure 1. The whole body. Chylomicrons leave the gut by the lymph, VLDL leaves the liver, both shrink in the capillary beds, and the liver takes remnants and LDL back.";
  key = ["CM", "CMR", "VLDL", "IDL", "LDL", "LPA", "HDL", "lymph", "artmark"];
  ps: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = [];
  init() {
    for (const L of Object.values(LOOPS)) layoutLoop(L);
    this.ps = []; this.acc = {}; this.rings = [];
    const T = P.counts(1);
    for (const c of ["VLDL", "LDL", "HDL", "LPA", "CM"] as const) for (let i = 0; i < Math.round(T[c]); i++) this.spawn(c, true);
  }
  spawn(c: "VLDL" | "LDL" | "HDL" | "LPA" | "CM", anywhere = false) {
    const loop = c === "CM" ? "lymph" : anywhere ? pick(["adip", "musc", "gut"]) : "gut", L = LOOPS[loop];
    const s = anywhere ? Math.random() * L.len : c === "CM" ? 0 : L.cum[9];
    const p = P.particle(c, 0, 0, { loop, s, off: rand(-3, 3), sp: rand(70, 100), pass: -1 });
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
  hover: string | null = null;
  draw(dt: number) {
    const { W, H } = P;
    drawBody(0, 0, W, H, false, this.hover);
    P.label("Liver", W * 0.78, H * 0.2, { a: "center" }); P.label("Heart", W * 0.47, H * 0.47 + 4, { a: "center", s: 12 });
    P.label("Adipose capillaries", W * 0.12, H * 0.68 + 4, { a: "center", s: 12 }); P.label("Muscle capillaries", W * 0.88, H * 0.74 + 4, { a: "center", s: 12 });
    P.label("Small intestine", W * 0.51, H * 0.95, { a: "center", s: 12 }); P.mono("lymph, thoracic duct", W * 0.3, H * 0.6, { a: "right" });
    P.mono("portal vein", W * 0.66, H * 0.6); P.mono("hepatic vein", W * 0.56, H * 0.2, { a: "right" }); P.mono("aortic wall", W * BODY.aorta[0] - 12, H * BODY.aorta[1] - 14, { a: "center" });
    P.reg(W * BODY.aorta[0], H * BODY.aorta[1], 10, "artmark", "Aortic wall: click to zoom");
    for (const p of this.ps) P.drawParticle(p, 0.75, false);
    this.rings = P.drawRings(this.rings, dt);
  }
  region(x: number, y: number): string | null {
    const X = x / P.W, Y = y / P.H, e = (b: number[]) => ((X - b[0]) / b[2]) ** 2 + ((Y - b[1]) / b[3]) ** 2 < 1.2;
    if (Math.hypot(X - BODY.aorta[0], Y - BODY.aorta[1]) < 0.03) return "artery";
    if (X > 0.6 && X < 0.96 && Y > 0.08 && Y < 0.38) return "liver";
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
  note = "A vessel lumen at higher magnification. CETP shuttles cholesterol ester from HDL to ApoB particles and triglyceride back. Red cells are drawn only for scale.";
  caption = "Figure 1. Plasma. Particle numbers follow the model's concentrations; CETP stops when obicetrapib is on.";
  key = ["VLDL", "IDL", "LDL", "LPA", "HDL", "CM", "CETP", "LCAT", "apoB100", "apoE", "apoCII", "apoCIII", "apoAI", "apoa", "RBC", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; rbc: { x: number; y: number; v: number }[] = []; cetp: Cetp[] = [];
  geo() { return { t: P.H * 0.1, b: P.H * 0.9 }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.rings = [];
    prefillAll(this, 1, g.t + 10, g.b - 10, 70);
    this.rbc = Array.from({ length: 9 }, () => ({ x: rand(0, P.W), y: rand(g.t + 30, g.b - 30), v: rand(40, 70) }));
    this.cetp = Array.from({ length: 6 }, () => ({ x: rand(0, P.W), y: rand(g.t + 20, g.b - 20), st: "free" as const }));
  }
  step(dt: number) {
    const g = this.geo(); feedAll(this, 1, g.t + 10, g.b - 10, 70, dt); moveFlow(this, dt);
    for (const r of this.rbc) { r.x += r.v * dt; if (r.x > P.W + 40) { r.x = -40; r.y = rand(g.t + 30, g.b - 30); } }
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
  draw(dt: number) {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    P.stipple(0, 0, W, g.t - 8, 6, 0.22); P.stipple(0, g.b + 8, W, H - g.b - 8, 6, 0.22);
    c.strokeStyle = P.ink; c.lineWidth = 1.2;
    for (const y of [g.t, g.b]) { c.beginPath(); for (let x = 0; x <= W; x += 8) c.lineTo(x, y + Math.sin(x / 40) * 2); c.stroke(); }
    for (let x = 60; x < W; x += 180) for (const y of [g.t - 8, g.b + 8]) { c.strokeStyle = P.rule; c.beginPath(); c.ellipse(x, y, 16, 4, 0, 0, 6.28); c.stroke(); }
    P.label("Vessel lumen", 12, g.t + 22); P.mono("flow →", W - 12, g.t + 20, { a: "right" }); P.mono("endothelium", 12, g.b + 26);
    c.save(); c.globalAlpha = 0.5; c.strokeStyle = P.muted; c.lineWidth = 1;
    for (const r of this.rbc) { c.beginPath(); c.ellipse(r.x, r.y, 22, 9, 0.2, 0, 6.28); c.stroke(); c.beginPath(); c.ellipse(r.x, r.y, 9, 3.5, 0.2, 0, 6.28); c.stroke(); }
    c.restore();
    for (const r of this.rbc) P.reg(r.x, r.y, 20, "RBC", "Red cell, for scale (about 7,500 nm)");
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
  note = "A sinusoid over one hepatocyte. Particles small enough pass the fenestrae into the space of Disse, dock on LDLR, LRP1 or SR-B1, and are taken in. Receptors return to the surface unless PCSK9 rode in with them.";
  caption = "Figure 1. The liver. Docking happens at the rate the model's receptor-mediated uptake sets; receptors shown follow its surface LDLR.";
  key = ["LDL", "IDL", "VLDL", "CMR", "LPA", "HDL", "LDLR", "LRP1", "SRB1", "PCSK9", "SREBP2", "HMGCR", "ACL", "MTP", "ABCG58", "fenestra", "mAb", "siRNA", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; anim: Mover[] = []; pc: Mover[] = []; ab: { x: number; y: number; v: number }[] = [];
  slots: Slot[] = []; order: Slot[] = []; gaps: number[] = [];
  geo() { return { sT: P.H * 0.05, sB: P.H * 0.3, mem: P.H * 0.42, cB: P.H * 0.88 }; }
  init() {
    const g = this.geo(), NS = 22;
    this.flow = []; this.acc = {}; this.rings = []; this.anim = []; this.pc = []; this.ab = [];
    prefillAll(this, 0.45, g.sT + 8, g.sB - 8, 60, ["CM"]);
    this.slots = Array.from({ length: NS }, (_, i) => ({ x: P.W * (0.05 + (0.9 * i) / (NS - 1)), type: [3, 11, 18].includes(i) ? "LRP1" : [7, 15].includes(i) ? "SRB1" : "LDLR", away: 0 }));
    const ld = this.slots.filter((s) => s.type === "LDLR"), R = rnd(3);
    this.order = ld.map((s) => ({ s, k: R() })).sort((a, b) => a.k - b.k).map((o) => o.s);
    this.gaps = []; for (let x = 30; x < P.W; x += 58) this.gaps.push(x);
  }
  visible() { return this.order.slice(0, Math.min(this.order.length, Math.round(P.snap.receptors * 8))); }
  tagged(vis: Slot[], s: Slot) { const i = vis.indexOf(s); return i >= 0 && (i * 0.618) % 1 < P.snap.pcsk9Share; }
  gapNear(x: number) { return this.gaps.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), this.gaps[0]); }
  dock(p: Particle, slot: Slot, vis: Slot[]) {
    const g = this.geo(), gx = this.gapNear(slot.x), tagged = slot.type === "LDLR" && this.tagged(vis, slot), y = g.mem - P.radius(p, 1.15) - 17;
    const endo = { x: P.W * 0.46, y: P.H * 0.58 }, lyso = { x: P.W * 0.62, y: P.H * 0.66 };
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
    feedAll(this, 0.45, g.sT + 8, g.sB - 8, 60, dt, ["CM"]); moveFlow(this, dt);
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
      this.anim.push(P.mover(p.x, p.y, [{ x: gx, y: g.sB + 4, d: 0.5 }, { x: sl.x, y: g.mem - 22, d: 0.5 }, { x: sl.x, y: g.mem - 22, d: 0.5 }, { x: gx, y: g.sB - 10, d: 0.6 }], {
        p, onWay: (_m, i) => { if (i === 3) this.anim.push(P.mover(sl.x, g.mem + 4, [{ x: sl.x + rand(-20, 20), y: P.H * 0.55, d: 1.2 }], { ce: true })); },
        onEnd: (m) => { sl.away = 0; p.hold = 0; p.x = m.x; p.y = m.y; },
      }));
    }
    // VLDL and Lp(a) leave the ER and Golgi, cross the space of Disse and join the sinusoid
    this.acc.v = (this.acc.v ?? 0) + ((0.45 * s.rates.vldl) / 1.6) * dt;
    this.acc.lpa = (this.acc.lpa ?? 0) + Math.min(0.6, (0.08 * s.lpa) / 20) * dt;
    for (const [k, c] of [["v", "VLDL"], ["lpa", "LPA"]] as const) while (this.acc[k] >= 1) {
      this.acc[k]--;
      const p = P.particle(c, P.W * 0.2, P.H * 0.62, { y0: g.sT + 8, y1: g.sB - 8, vmax: 60 }), ex = P.W * rand(0.12, 0.34), gx = this.gapNear(ex);
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: p.y, d: 0.8 }, { x: ex, y: g.mem + 10, d: 1.0 }, { x: ex, y: g.mem - 12, d: 0.4 }, { x: gx, y: g.sB + 2, d: 0.5 }, { x: gx + 10, y: g.sB - 14, d: 0.4 }], {
        p, sec: true, onEnd: (m) => { p.x = m.x; p.y = m.y; p.hold = 0; this.flow.push(p); },
      }));
    }
    // free PCSK9 in the space of Disse follows the model
    const pcT = Math.min(16, Math.round(s.pcsk9 * 9));
    if (this.pc.length < pcT && Math.random() < 2 * dt) { const ex = P.W * rand(0.1, 0.4); this.pc.push(P.mover(P.W * 0.26, P.H * 0.6, [{ x: ex, y: g.mem + 8, d: 1.0 }, { x: ex, y: rand(g.sB + 8, g.mem - 30), d: 0.5 }], { drift: rand(-20, 20) })); }
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
  draw(dt: number) {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    c.fillStyle = P.stage2; c.fillRect(0, g.mem, W, g.cB - g.mem); P.stipple(0, g.mem, W, g.cB - g.mem, 9, 0.15);
    P.line(0, g.mem, W, g.mem, P.ink, 1.5);
    c.strokeStyle = P.ink; c.lineWidth = 2.5;
    for (let i = 0; i < this.gaps.length; i++) { const a = this.gaps[i] + 7, b = (this.gaps[i + 1] ?? W + 40) - 7; c.beginPath(); c.moveTo(a, g.sB); c.lineTo(b, g.sB); c.stroke(); P.reg(this.gaps[i], g.sB, 7, "fenestra", "Fenestra, about 100 nm: chylomicrons are too large to pass"); }
    P.line(0, g.sT, W, g.sT);
    P.label("Sinusoid", 12, g.sT + 18); P.mono("portal blood →", W - 12, g.sT + 16, { a: "right" }); P.mono("space of Disse", 12, g.sB + 22); P.label("Hepatocyte", 12, g.mem + 22);
    P.line(0, g.cB, W, g.cB, P.ink, 1.2); P.mono("bile canaliculus", 12, g.cB + 18); P.sign("ABCG58", W * 0.5, g.cB - 10, 18, 0, "ABCG5/G8: sterol out into bile");
    // nucleus
    const nx = W * 0.74, ny = H * 0.6, nr = H * 0.1;
    c.strokeStyle = P.ink; c.lineWidth = 1; c.beginPath(); c.arc(nx, ny, nr, 0, 6.28); c.stroke(); P.mono("nucleus", nx, ny + nr + 14, { a: "center" });
    P.sign("SREBP2", nx, ny - 8, 20, 0, "SREBP-2: low liver sterol switches on the LDLR and PCSK9 genes"); P.mono("LDLR, PCSK9 genes", nx, ny + 14, { a: "center" });
    if (P.has("incl")) { P.drugMark("siRNA", nx + nr + 12, ny - 6, "Inclisiran (siRNA) silences PCSK9 mRNA", 18); P.mono("inclisiran: PCSK9 mRNA cut", nx + nr - 4, ny + 30, { a: "right" }); }
    // ER and Golgi
    c.strokeStyle = P.muted; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(W * 0.16, H * 0.64 + i * 6, 40 - i * 6, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
    P.mono("ER and Golgi", W * 0.16, H * 0.72, { a: "center" });
    const lomi = P.has("lomi");
    P.sign("MTP", W * 0.2, H * 0.6, 18, 0, lomi ? "MTP blocked by lomitapide" : "MTP: loads triglyceride onto ApoB-100 to make VLDL", lomi ? 0.35 : 1);
    if (lomi) P.drugMark("small", W * 0.2 + 12, H * 0.6 - 10, "Lomitapide blocks MTP");
    if (P.has("olpa")) P.drugMark("siRNA", W * 0.28, H * 0.66, "Olpasiran (siRNA) silences apo(a): less Lp(a) made", 16);
    // endosome, lysosome
    c.strokeStyle = P.ink; c.beginPath(); c.arc(W * 0.46, H * 0.58, 18, 0, 6.28); c.stroke(); P.mono("endosome", W * 0.46, H * 0.58 + 32, { a: "center" });
    c.save(); c.fillStyle = P.muted; c.globalAlpha = 0.25; c.beginPath(); c.arc(W * 0.62, H * 0.66, 14, 0, 6.28); c.fill(); c.restore(); c.stroke(); P.mono("lysosome", W * 0.62, H * 0.66 + 28, { a: "center" });
    // cholesterol synthesis
    const sy = H * 0.8, bem = P.has("bem"), stat = P.has("statin");
    P.mono("acetyl-CoA", W * 0.3, sy + 4, { a: "right" });
    P.sign("ACL", W * 0.35, sy, 18, 0, bem ? "ACL blocked by bempedoic acid" : "ATP citrate lyase", bem ? 0.35 : 1); P.arrow(W * 0.37, sy, W * 0.41, sy);
    P.sign("HMGCR", W * 0.44, sy, 18, 0, stat ? "HMG-CoA reductase blocked by a statin" : "HMG-CoA reductase: the rate-limiting step", stat ? 0.35 : 1); P.arrow(W * 0.465, sy, W * 0.5, sy);
    P.mono("cholesterol", W * 0.51, sy + 4);
    if (bem) P.drugMark("small", W * 0.35 + 11, sy - 11, "Bempedoic acid (works in liver only)");
    if (stat) P.drugMark("small", W * 0.44 + 11, sy - 11, "Statin");
    // receptors
    const vis = this.visible();
    for (const s of this.slots) {
      if (s.away > 0 || (s.type === "LDLR" && !vis.includes(s))) continue;
      const tagged = s.type === "LDLR" && this.tagged(vis, s);
      P.sign(s.type, s.x, g.mem - 9, 17, 0, s.type === "LDLR" ? (tagged ? "LDLR with PCSK9 bound: will be destroyed" : "LDLR: binds ApoB-100 and ApoE") : s.type === "LRP1" ? "LRP1: takes up ApoE-rich remnants" : "SR-B1: takes CE from HDL");
      if (tagged) P.glyph("PCSK9", s.x + 8, g.mem - 20, 12, 0, P.muted);
    }
    if (!vis.length) P.mono("no functional LDLR on the surface", W * 0.5, g.mem - 26, { a: "center", c: P.ink });
    for (const q of this.pc) P.sign("PCSK9", q.x, q.y, 12, 0, "PCSK9, free", 1, P.muted);
    for (const a of this.ab) P.sign("mAb", a.x, a.y, 13, 0, "PCSK9 antibody");
    for (const p of this.flow) if (!p.hold) P.drawParticle(p, 1.15, true);
    for (const a of this.anim) {
      if (a.ce) { P.dot(a.x, a.y, 2.4, coreColor(0.1)); continue; }
      if (a.recOnly) { P.glyph(a.type as string, a.x, a.y, 14, 0, P.ink, 0.7); if (a.tagged) P.glyph("PCSK9", a.x + 7, a.y - 9, 10, 0, P.muted); continue; }
      const p = a.p as Particle;
      p.x = a.x; p.y = a.y; P.drawParticle(p, 1.15, true);
      if (a.rec) { const r = P.radius(p, 1.15); c.save(); c.strokeStyle = P.ink; c.setLineDash([2, 2]); c.beginPath(); c.arc(a.x, a.y, r + 6, 0, 6.28); c.stroke(); c.restore(); P.glyph((a.slot as Slot).type, a.x, a.y + r + 2, 13, 0, P.ink, 0.8); }
    }
    this.rings = P.drawRings(this.rings, dt);
  }
}

// ================================================================== capillary bed
class CapScene implements Scene, Lane {
  id = "cap"; name = "Capillary bed";
  note = "A muscle and adipose capillary. LPL sits on GPIHBP1 on the luminal surface and strips triglyceride from chylomicrons and VLDL; the fatty acids go into the fat cell and the muscle fiber. ANGPTL3, ANGPTL4 and ApoC-III hold LPL back.";
  caption = "Figure 1. A capillary bed. Docking at LPL follows the model's lipolysis; in FCS the LPL is missing.";
  key = ["CM", "VLDL", "IDL", "CMR", "LDL", "HDL", "LPL", "apoCII", "apoCIII", "ANGPTL3", "ANGPTL4", "FFA", "mAb", "PPARa", "droplet"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; ffa: Mover[] = []; busy: number[] = [];
  ang3: { x: number; y: number; v: number }[] = []; ang4: { x: number; y: number; v: number }[] = [];
  geo() { return { t: P.H * 0.06, b: P.H * 0.4, eB: P.H * 0.47, tis: P.H * 0.53 }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.rings = []; this.ffa = []; this.busy = [];
    prefillAll(this, 0.6, g.t + 10, g.b - 6, 55);
    this.ang3 = Array.from({ length: 5 }, () => ({ x: rand(0, P.W), y: rand(g.t + 20, g.b - 20), v: rand(30, 50) }));
    this.ang4 = Array.from({ length: 3 }, () => ({ x: rand(P.W * 0.05, P.W * 0.5), y: rand(g.eB + 4, g.tis - 4), v: rand(-10, 10) }));
  }
  lpls() {
    const fcs = P.model.geno === "fcs", n = fcs ? 4 : Math.round(9 * (P.has("fib") ? 1.4 : 1) * (P.has("olez") ? 1.15 : 1));
    return Array.from({ length: n }, (_, i) => ({ x: P.W * (0.06 + (0.88 * (i + 0.5)) / n), inactive: fcs }));
  }
  step(dt: number) {
    const g = this.geo(), L = this.lpls(), Ln = P.snap.lipolysis;
    feedAll(this, 0.6, g.t + 10, g.b - 6, 55, dt); moveFlow(this, dt);
    for (const p of this.flow) {
      if (p.hold > 0 || p.tg <= (p.b48 ? 0.5 : 0.3) || p.y < g.b - P.radius(p, 1.2) - 16) continue;
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        if (l.inactive || (this.busy[i] ?? 0) > 0 || Math.abs(l.x - p.x) > 10) continue;
        if (Math.random() < Math.min(0.9, 0.5 * Ln) * (p.c3 ? 0.6 : 1)) {
          this.busy[i] = 0.9; p.hold = 0.8; p.y = g.b - P.radius(p, 1.2) - 10; p.x = l.x;
          p.onRelease = (q) => { q.tg = Math.max(q.b48 ? 0.5 : 0.13, q.tg - 0.18 * Math.min(1.6, Ln)); q.c = P.classOf(q); q.vy = -30; };
          for (let k = 0; k < 4; k++) this.ffa.push(P.mover(l.x, g.b + 2, [{ x: l.x + rand(-25, 25), y: rand(g.tis + 20, P.H * 0.9), d: rand(1.2, 2) }]));
        }
        break;
      }
    }
    for (let i = 0; i < this.busy.length; i++) if (this.busy[i]) this.busy[i] -= dt;
    for (const a of this.ang3) { a.x += a.v * dt; if (a.x > P.W + 20) { a.x = -20; a.y = rand(g.t + 20, g.b - 20); } }
    for (const a of this.ang4) { a.x += a.v * dt; if (a.x < 10 || a.x > P.W * 0.52) a.v *= -1; }
    for (const f of this.ffa) P.stepMover(f, dt);
    this.ffa = this.ffa.filter((f) => !f.done);
  }
  draw(dt: number) {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    c.fillStyle = P.stage2; c.fillRect(0, g.b, W, g.eB - g.b); P.stipple(0, g.b, W, g.eB - g.b, 5, 0.3);
    P.line(0, g.t, W, g.t, P.ink, 1.2); P.line(0, g.b, W, g.b, P.ink, 1.2);
    P.label("Capillary lumen", 12, g.t + 20); P.mono("flow →", W - 12, g.t + 18, { a: "right" }); P.mono("endothelium", 12, g.eB - 6); P.mono("interstitium", 12, g.tis - 6);
    const ax = W * 0.27, ay = H * 0.77;
    c.strokeStyle = P.ink; c.lineWidth = 1; c.strokeRect(W * 0.02, g.tis, W * 0.5, H * 0.96 - g.tis);
    c.save(); c.fillStyle = coreColor(0.9); c.globalAlpha = 0.28; c.beginPath(); c.ellipse(ax, ay, W * 0.2, H * 0.17, 0, 0, 6.28); c.fill(); c.restore(); c.strokeStyle = P.muted; c.stroke();
    P.label("Adipocyte", W * 0.03 + 6, g.tis + 18, { s: 12 }); P.mono("lipid droplet: fatty acids stored as TG", ax, ay + 4, { a: "center" });
    P.reg(ax, ay, Math.min(W * 0.2, H * 0.17), "droplet", "Adipocyte lipid droplet");
    const mx = W * 0.55; c.strokeStyle = P.ink; c.strokeRect(mx, g.tis, W * 0.43, H * 0.96 - g.tis);
    c.strokeStyle = P.soft; for (let x = mx + 10; x < W * 0.98; x += 12) { c.beginPath(); c.moveTo(x, g.tis + 26); c.lineTo(x, H * 0.95); c.stroke(); }
    c.strokeStyle = P.muted; for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(mx + 30 + i * (W * 0.055), H * 0.72 + (i % 2) * 40, 12, 6, 0, 0, 6.28); c.stroke(); }
    P.label("Muscle fiber", mx + 8, g.tis + 18, { s: 12 }); P.mono("mitochondria burn fatty acids", mx + 8, H * 0.93);
    for (const l of this.lpls()) P.sign("LPL", l.x, g.b - 9, 18, Math.PI, l.inactive ? "LPL absent or inactive (FCS)" : "LPL on GPIHBP1: hydrolyzes triglyceride", l.inactive ? 0.3 : 1);
    if (P.has("fib")) P.drugMark("PPARa", W - 24, g.eB + 16, "Fibrate: PPAR-α raises LPL and lowers ApoC-III", 16);
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
  note = "An enterocyte. NPC1L1 takes cholesterol from bile micelles at the brush border, ABCG5/G8 pumps some back, and MTP builds chylomicrons on ApoB-48 that leave through the lacteal. Give a meal to fill the lumen.";
  caption = "Figure 1. The small intestine. A meal fills the lumen with micelles and sends chylomicrons into the lymph.";
  key = ["micelle", "NPC1L1", "ABCG58", "MTP", "apoB48", "CM", "small"];
  flow: Particle[] = []; acc: Record<string, number> = {}; mic: { x: number; y: number; v: number }[] = []; chol: Mover[] = []; anim: Mover[] = [];
  geo() { return { lum: P.H * 0.22, bb: P.H * 0.3, bas: P.H * 0.78, lac: P.H * 0.84 }; }
  init() {
    const g = this.geo(); this.flow = []; this.acc = {}; this.chol = []; this.anim = [];
    this.mic = Array.from({ length: 8 }, () => ({ x: rand(0, P.W), y: rand(18, g.lum - 14), v: rand(10, 25) }));
    for (let i = 0; i < 4; i++) this.flow.push(P.particle("CM", rand(0, P.W), rand(g.lac + 10, P.H - 12), { y0: g.lac + 10, y1: P.H - 12, vmax: 45 }));
  }
  npc() { const out: number[] = []; for (let x = P.W * 0.08; x < P.W * 0.95; x += P.W * 0.12) out.push(x); return out; }
  step(dt: number) {
    const g = this.geo(), meal = P.model.meal, eze = P.has("eze"), lomi = P.has("lomi");
    const micT = Math.round(6 + 16 * meal);
    if (this.mic.length < micT && Math.random() < 3 * dt) this.mic.push({ x: -20, y: rand(18, g.lum - 14), v: rand(10, 25) });
    for (const m of this.mic) m.x += m.v * dt;
    this.mic = this.mic.filter((m) => m.x < P.W + 30); if (this.mic.length > micT + 3) this.mic.shift();
    this.acc.c = (this.acc.c ?? 0) + (0.7 + 3 * meal) * (eze ? 0.12 : 1) * dt;
    while (this.acc.c >= 1) { this.acc.c--; const x = pick(this.npc()); this.chol.push(P.mover(x + rand(-30, 30), g.lum - 8, [{ x, y: g.bb - 12, d: 0.6 }, { x, y: g.bb + 8, d: 0.4 }, { x: P.W * 0.45 + rand(-20, 20), y: P.H * 0.55 + rand(-10, 10), d: 1.2 }])); }
    this.acc.e = (this.acc.e ?? 0) + 0.35 * dt;
    while (this.acc.e >= 1) { this.acc.e--; const x = P.W * (Math.random() < 0.5 ? 0.3 : 0.7); this.chol.push(P.mover(x, g.bb + 30, [{ x, y: g.bb - 6, d: 0.6 }, { x: x + rand(-20, 20), y: g.lum - 20, d: 0.6 }])); }
    this.acc.cm = (this.acc.cm ?? 0) + (0.15 + 1.4 * meal) * (lomi ? 0.4 : 1) * dt;
    while (this.acc.cm >= 1) {
      this.acc.cm--;
      const p = P.particle("CM", P.W * 0.5, P.H * 0.56, { y0: g.lac + 10, y1: P.H - 12, vmax: 45 }), ex = P.W * rand(0.3, 0.7);
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: p.y, d: 1.0 }, { x: ex, y: g.bas - 12, d: 1.0 }, { x: ex, y: g.lac + 14, d: 0.7 }], { p, onEnd: (m) => { p.x = m.x; p.y = m.y; this.flow.push(p); } }));
    }
    moveFlow(this, dt);
    for (const a of this.chol) P.stepMover(a, dt);
    this.chol = this.chol.filter((a) => !a.done);
    for (const a of this.anim) P.stepMover(a, dt);
    this.anim = this.anim.filter((a) => !a.done);
  }
  draw() {
    const g = this.geo(), c = P.ctx, { W, H } = P;
    c.fillStyle = P.stage2; c.fillRect(0, g.bb, W, g.bas - g.bb); P.stipple(0, g.bb, W, g.bas - g.bb, 9, 0.15);
    c.strokeStyle = P.ink; c.lineWidth = 1;
    for (let x = 6; x < W; x += 14) { c.beginPath(); c.moveTo(x - 4, g.bb); c.lineTo(x - 4, g.lum + 4); c.arc(x, g.lum + 4, 4, Math.PI, 0); c.lineTo(x + 4, g.bb); c.stroke(); }
    P.line(0, g.bb, W, g.bb); P.line(0, g.bas, W, g.bas);
    P.label("Intestinal lumen", 12, 18); P.mono("brush border", W - 12, g.bb + 16, { a: "right" }); P.label("Enterocyte", 12, g.bb + 22);
    P.line(0, g.lac, W, g.lac, P.ink, 1.2); P.mono("lacteal (lymph) →", W - 12, g.lac + 16, { a: "right" });
    for (const m of this.mic) {
      c.fillStyle = P.ink; for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.28; c.fillRect(m.x + Math.cos(a) * 8, m.y + Math.sin(a) * 8, 1.4, 1.4); }
      P.dot(m.x, m.y, 2.5, coreColor(0.1)); P.reg(m.x, m.y, 10, "micelle", "Bile micelle carrying cholesterol and fatty acids");
    }
    const eze = P.has("eze"), lomi = P.has("lomi");
    for (const x of this.npc()) { P.sign("NPC1L1", x, g.lum - 6, 15, 0, eze ? "NPC1L1 blocked by ezetimibe" : "NPC1L1: cholesterol in", eze ? 0.35 : 1); if (eze) P.drugMark("small", x + 9, g.lum - 14, "Ezetimibe", 10); }
    for (const x of [W * 0.3, W * 0.7]) P.sign("ABCG58", x, g.bb + 14, 16, 0, "ABCG5/G8: plant sterols and cholesterol back out");
    P.sign("MTP", W * 0.5, H * 0.6 + 16, 18, 0, lomi ? "MTP blocked by lomitapide" : "MTP: assembles chylomicrons on ApoB-48", lomi ? 0.35 : 1);
    P.mono("ER, chylomicron assembly", W * 0.5, H * 0.6 + 38, { a: "center" });
    if (lomi) P.drugMark("small", W * 0.5 + 12, H * 0.6 + 6, "Lomitapide");
    c.strokeStyle = P.ink; c.beginPath(); c.ellipse(W * 0.84, H * 0.5, 34, 22, 0, 0, 6.28); c.stroke(); P.mono("nucleus", W * 0.84, H * 0.5 + 4, { a: "center" });
    for (const a of this.chol) P.dot(a.x, a.y, 2.3, coreColor(0.1));
    for (const a of this.anim) { const p = a.p as Particle; p.x = a.x; p.y = a.y; p.tg = 0.92; P.drawParticle(p, 0.55 + Math.min(1, a.i * 0.35 + a.t) * 0.55, true); }
    for (const p of this.flow) P.drawParticle(p, 1.0, true);
    if (P.model.meal < 0.05) P.mono("fasting: few chylomicrons", W * 0.5, H * 0.96, { a: "center" });
  }
}

// ================================================================== artery wall
class ArteryScene implements Scene, Lane {
  id = "artery"; name = "Artery wall";
  note = "LDL entry and reverse cholesterol transport, not a plaque model. ApoB particles cross the endothelium and are held by proteoglycans; oxidized ones are taken up by a macrophage, and ABCA1 hands its cholesterol to pre-β HDL.";
  caption = "Figure 1. The arterial intima. The number of ApoB particles held in the wall follows LDL-C and Lp(a).";
  key = ["LDL", "LPA", "OXLDL", "HDL", "PREB", "SRA", "ABCA1", "apoAI", "droplet"];
  flow: Particle[] = []; acc: Record<string, number> = {}; rings: Ring[] = []; ret: Particle[] = []; anim: Mover[] = []; foam = 6;
  geo() { return { t: P.H * 0.04, e: P.H * 0.32, i: P.H * 0.37 }; }
  mac() { return { x: P.W * 0.68, y: P.H * 0.68, r: Math.min(P.W * 0.14, P.H * 0.2) }; }
  init() { const g = this.geo(); this.flow = []; this.acc = {}; this.rings = []; this.ret = []; this.anim = []; this.foam = 6; prefillAll(this, 0.5, g.t + 10, g.e - 10, 70, ["CM", "VLDL", "IDL"]); }
  step(dt: number) {
    const g = this.geo(), m = this.mac(), s = P.snap;
    feedAll(this, 0.5, g.t + 10, g.e - 10, 70, dt, ["CM", "VLDL", "IDL"]); moveFlow(this, dt);
    const target = Math.min(36, Math.round(3 + (10 * s.ldl) / 100 + (5 * s.lpa) / 100));
    this.acc.in = (this.acc.in ?? 0) + (this.ret.length < target ? 0.9 : 0.1) * dt;
    while (this.acc.in >= 1) {
      this.acc.in--;
      const cand = this.flow.filter((p) => (p.c === "LDL" || p.c === "LPA") && !p.hold && p.x > P.W * 0.05 && p.x < P.W * 0.5);
      if (!cand.length) continue;
      const p = pick(cand); p.gone = true;
      const q = P.particle(p.c, p.x, p.y); q.tg = p.tg;
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: g.e + 8, d: 0.8 }, { x: rand(P.W * 0.04, P.W * 0.48), y: rand(g.i + 20, P.H * 0.92), d: 1.4 }], { p: q, onEnd: (mm) => { q.x = mm.x; q.y = mm.y; this.ret.push(q); } }));
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
      this.anim.push(P.mover(p.x, p.y, [{ x: p.x, y: g.e + 6, d: 0.7 }, { x: sx, y: sy - 8, d: 1.2 }, { x: sx, y: sy - 8, d: 0.6 }, { x: sx + 30, y: g.e - 16, d: 1.3 }], {
        p, onWay: (_mm, i) => { if (i === 3) { this.foam = Math.max(0, this.foam - 1); p.c = "HDL"; p.tg = 0.15; } },
        onEnd: (mm) => { this.flow.push(P.particle("HDL", mm.x, mm.y, { y0: g.t + 10, y1: g.e - 10, vmax: 70 })); },
      }));
    }
    for (const a of this.anim) P.stepMover(a, dt);
    this.anim = this.anim.filter((a) => !a.done);
  }
  draw(dt: number) {
    const g = this.geo(), m = this.mac(), c = P.ctx, { W, H } = P;
    c.fillStyle = P.stage2; c.fillRect(0, g.i, W, H - g.i);
    c.strokeStyle = P.soft; c.lineWidth = 1;
    for (let y = g.i + 24; y < H; y += 26) { c.beginPath(); for (let x = 0; x <= W; x += 10) c.lineTo(x, y + Math.sin(x / 30 + y) * 4); c.stroke(); }
    P.line(0, g.e, W, g.e, P.ink, 1.2); P.line(0, g.i, W, g.i, P.ink, 1.2);
    for (let x = 40; x < W; x += 110) { c.strokeStyle = P.rule; c.beginPath(); c.ellipse(x, (g.e + g.i) / 2, 20, 4, 0, 0, 6.28); c.stroke(); }
    P.label("Arterial lumen", 12, g.t + 18); P.mono("flow →", W - 12, g.t + 16, { a: "right" }); P.mono("endothelium", 12, g.i - 4); P.label("Intima", 12, g.i + 20); P.mono("proteoglycans hold ApoB particles", 12, H - 10);
    c.beginPath(); for (let k = 0; k <= 40; k++) { const a = (k / 40) * 6.28, rr = m.r * (1 + 0.08 * Math.sin(a * 5)); c.lineTo(m.x + Math.cos(a) * rr, m.y + Math.sin(a) * rr); } c.closePath();
    c.fillStyle = P.stage2; c.fill(); c.strokeStyle = P.ink; c.stroke();
    P.label(this.foam > 18 ? "Macrophage, becoming a foam cell" : "Macrophage", m.x, m.y + m.r + 20, { a: "center", s: 12 });
    const R = rnd(7);
    c.save(); c.globalAlpha = 0.85; for (let k = 0; k < Math.round(this.foam); k++) { const a = R() * 6.28, d = Math.sqrt(R()) * m.r * 0.75; P.dot(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, 3.5, coreColor(0.2)); } c.restore();
    P.reg(m.x, m.y, m.r * 0.6, "droplet", `Cholesteryl ester droplets: ${Math.round(this.foam)}`);
    for (let k = 0; k < 3; k++) { const a = Math.PI * (0.85 + k * 0.17); P.sign("SRA", m.x + Math.cos(a) * (m.r + 6), m.y + Math.sin(a) * (m.r + 6), 15, a + Math.PI / 2, "Scavenger receptor (SR-A, CD36): takes up oxidized LDL"); }
    for (let k = 0; k < 3; k++) { const a = Math.PI * (1.35 + k * 0.15); P.sign("ABCA1", m.x + Math.cos(a) * (m.r + 6), m.y + Math.sin(a) * (m.r + 6), 15, a + Math.PI / 2, "ABCA1: cholesterol out to ApoA-I"); }
    for (const p of this.flow) P.drawParticle(p, 1.25, true);
    for (const q of this.ret) P.drawParticle(q, 1.25, true);
    for (const a of this.anim) { const p = a.p as Particle; p.x = a.x; p.y = a.y; P.drawParticle(p, 1.25, true); }
    this.rings = P.drawRings(this.rings, dt);
  }
}

export const bodyScene = new BodyScene();
export const SCENES: Record<string, Scene> = { body: bodyScene, liver: new LiverScene(), plasma: new PlasmaScene(), cap: new CapScene(), gut: new GutScene(), artery: new ArteryScene() };
