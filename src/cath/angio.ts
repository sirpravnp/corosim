import { V3, sub, len } from "../anatomy/curve";
import { ANGIO, VESSEL_LABELS } from "../config/cath";
import { AngioModel, AngioSegment } from "../sim/cath";
import type { Plaque } from "../lab/types";
import { Backdrop, type StaticFrame } from "./backdrop";
import { bodyMotion, motionWeight, viewBasis } from "./body";
import { makeTwigs, type Twig } from "./twigs";
import { calciumSpan, levelRuns, plaqueShift, smoothPath, wallLines, type P2 } from "./lumen";

/** What the C-arm is doing: where it is pointed, which coronary is being injected, whether the vessel names are drawn. */
export interface AngioOptions {
  rot: number; // degrees, LAO positive / RAO negative
  tilt: number; // degrees, cranial positive / caudal negative
  injection: "both" | "left" | "right";
  labels: boolean;
  heartRate: number; // bpm, drives the cardiac motion of the picture
  catheter?: boolean; // draw the stand-in catheter; the lab turns it off because it draws the real guide
  cam?: { centre: V3; spanMm: number }; // the lab's Follow view: aim and zoom the picture; unset frames the heart
  plaques?: readonly Plaque[]; // the lab's plaque model: eccentric lesions take the lumen off-center and calcium shows before dye
  overlay?: HTMLCanvasElement | null; // devices drawn as attenuation (white = dense) by the lab; they go through the same image formation
}

/** Patient frame -> screen (x right, y up) for a C-arm at rotation `ry` and tilt `rx`. Iodine adds along the ray, so overlap and foreshortening come out of this. */
function project(p: V3, ry: number, rx: number): V3 {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1];
  return [x, y * cx - z * sx, y * sx + z * cx];
}

/**
 * Where the C-arm puts the picture at time `now`: scale, a static origin (the table and the bones do not move), and two patient-frame
 * to canvas-pixel mappers. `toScreen` moves with the heart and the breath, weighted by distance from the heart, so the coronaries
 * swing, the arch barely moves and the pelvis not at all. Devices draw through the same mapper so they sit on the vessels.
 */
export function frameOf(centre: V3, o: AngioOptions, now: number, W: number, H: number) {
  const ry = (o.rot * Math.PI) / 180, rx = (o.tilt * Math.PI) / 180;
  const c0 = o.cam?.centre ?? centre, sc = W / (o.cam?.spanMm ?? DEFAULT_SPAN_MM), cm = project(c0, ry, rx);
  const ox = W / 2 - cm[0] * sc, oy = H / 2 + cm[1] * sc;
  const m1 = bodyMotion(now, o.heartRate, 1);
  const toStatic = (p: V3): P2 => { const q = project(p, ry, rx); return [ox + q[0] * sc, oy - q[1] * sc]; };
  const toScreen = (p: V3): P2 => {
    const w = motionWeight(len(sub(p, centre))), above = smooth((62 - (p[1] - centre[1])) / 22) * smooth((p[2] - centre[2] + 48) / 22), wp = w > 0.02 && above > 0 ? tortuosity(p, w * above) : p; // the aorta (above and behind the heart) and the guide in it stay smooth; only epicardial vessels wander
    // vessels and devices bend through the same field, so a wire stays on its vessel
    const q = project(wp, ry, rx);
    return [ox + (q[0] + w * m1.dx) * sc, oy - (q[1] + w * m1.dy) * sc];
  };
  return { sc, cx0: ox, cy0: oy, ox, oy, toScreen, toStatic, basis: viewBasis(o.rot, o.tilt), W, H };
}
export type Frame = ReturnType<typeof frameOf>;

/**
 * A smooth, fixed displacement field (patient frame, mm) that gives the coronary tree the sinuosity of a real one: the modeled centerlines are
 * smooth curves, real epicardial arteries wander by several millimeters. It is applied inside `toScreen` to everything near the heart, vessels
 * and devices alike, and fades to nothing toward the arch and the pelvis.
 */
export function tortuosity(p: V3, weight: number): V3 {
  const a = 2.6 * weight;
  return [
    p[0] + a * (Math.sin(p[1] * 0.21 + p[2] * 0.11 + 1.3) + 0.4 * Math.sin(p[2] * 0.47 + p[0] * 0.23)),
    p[1] + a * (Math.sin(p[2] * 0.19 + p[0] * 0.13 + 0.7) + 0.4 * Math.sin(p[0] * 0.43 + p[1] * 0.27 + 2)),
    p[2] + a * 0.8 * (Math.sin(p[0] * 0.17 + p[1] * 0.09 + 2.1) + 0.4 * Math.sin(p[1] * 0.51 + p[2] * 0.21)),
  ];
}

/** The angiographic field of a cardiac frame, in mm across the picture: about 17 cm, which is what real frames show (the heart fills most of it). */
export const DEFAULT_SPAN_MM = 170;

/** Magnification and geometric unsharpness make the lumen look a little wider than its true diameter. */
const VESSEL_MAG = 1.25;
const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ---- display model. Optical density d = tissue + bone + iodine + device; the detector sees exp(-d), the monitor shows a shouldered curve of it.
const T_REF = 180; // mm of tissue-equivalent along an AP ray through the chest: mid-gray, as an automatic exposure control would set it
const K_SOFT = 1.3, K_THIN = 0.8, K_BONE = 1.5, K_IODINE = 1.3, K_DEVICE = 2.2;
const VEIL = 0.05; // scatter and glare lift the dark end
const LUT_N = 2048, D_MIN = -2.5, D_MAX = 9;
const EXP_LUT = new Float32Array(LUT_N + 1); for (let i = 0; i <= LUT_N; i++) EXP_LUT[i] = Math.exp(-(D_MIN + ((D_MAX - D_MIN) * i) / LUT_N));
const MOT = 96; // the coarse grid of low-frequency mottle, redrawn every frame
const TONE_N = 1024, TONE_MAX = 6;
const TONE_LUT = new Float32Array(TONE_N + 1); for (let i = 0; i <= TONE_N; i++) TONE_LUT[i] = 1 - Math.exp(-1.15 * ((i / TONE_N) * TONE_MAX));

/**
 * The angiogram: a canvas-2D renderer (a WebGL one could replace it behind this class). The anatomy comes from `Backdrop` (analytic
 * chords through a procedural patient, so it follows the C-arm), iodine fills each vessel as a lumen with two walls, and the sum goes through
 * one image-formation step: beam hardening, scatter, quantum noise that grows in the dark, a shouldered display curve and a round collimator.
 */
export class AngioView {
  opts: AngioOptions = { rot: 30, tilt: -20, injection: "both", labels: false, heartRate: 70 };
  private model: AngioModel | null = null; private twigs: Twig[] = [];
  private ctx: CanvasRenderingContext2D;
  private acc: HTMLCanvasElement; private actx: CanvasRenderingContext2D;
  private ovl: HTMLCanvasElement; private octx: CanvasRenderingContext2D;
  private W: number; private H: number;
  private noise: Float32Array;
  private backdrop: Backdrop;
  private mottle = new Float32Array(MOT * MOT); private mi = new Int16Array(0); private mf = new Float32Array(0); private mj = new Int16Array(0); private mg = new Float32Array(0);
  private vig: Float32Array; private xi: Int16Array; private xf: Float32Array; private yi: Int16Array; private yf: Float32Array;
  private out: ImageData; private lum: Float32Array; private lum2: Float32Array;
  private t0 = -1e9; private run = ANGIO.runSeconds;

  constructor(private canvas: HTMLCanvasElement) {
    this.W = canvas.width; this.H = canvas.height;
    this.ctx = canvas.getContext("2d")!;
    this.acc = document.createElement("canvas"); this.acc.width = this.W; this.acc.height = this.H;
    this.actx = this.acc.getContext("2d", { willReadFrequently: true })!;
    this.ovl = document.createElement("canvas"); this.ovl.width = this.W; this.ovl.height = this.H;
    this.octx = this.ovl.getContext("2d", { willReadFrequently: true })!;
    this.noise = new Float32Array(this.W * this.H + 977 * 64); for (let i = 0; i < this.noise.length; i++) this.noise[i] = Math.random() + Math.random() - 1; // triangular, mean 0
    this.backdrop = new Backdrop(this.W, this.H);
    this.out = this.ctx.createImageData(this.W, this.H); this.lum = new Float32Array(this.W * this.H); this.lum2 = new Float32Array(this.W * this.H);
    const { W, H } = this, R = this.backdrop.res;
    this.vig = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const rr = Math.hypot((i - W / 2) / W, (j - H / 2) / H) / 0.47; // 1 at the edge of the collimated field
      // the field edge, and two straight collimator shutters that cut the corners with a soft penumbra and leave a dim margin
      const X = i / W - 0.5, Y = j / H - 0.5; let sh = 1;
      for (const [th, off] of [[-0.35, 0.44], [2.6, 0.46]]) sh = Math.min(sh, 0.3 + 0.7 * smooth((off - (X * Math.cos(th) + Y * Math.sin(th))) * W / 14));
      this.vig[j * W + i] = rr > 1 ? 0 : Math.min(1, (1 - rr) * W * 0.47 / 2.2) * (1 - 0.18 * rr * rr) * sh;
    }
    this.mi = new Int16Array(W); this.mf = new Float32Array(W); this.mj = new Int16Array(H); this.mg = new Float32Array(H);
    for (let i = 0; i < W; i++) { const g = Math.min(MOT - 1.001, (i / W) * (MOT - 1)); this.mi[i] = Math.floor(g); this.mf[i] = g - this.mi[i]; }
    for (let j = 0; j < H; j++) { const g = Math.min(MOT - 1.001, (j / H) * (MOT - 1)); this.mj[j] = Math.floor(g); this.mg[j] = g - this.mj[j]; }
    this.xi = new Int16Array(W); this.xf = new Float32Array(W); this.yi = new Int16Array(H); this.yf = new Float32Array(H);
    for (let i = 0; i < W; i++) { const g = Math.min(R - 1.001, Math.max(0, ((i + 0.5) * R) / W - 0.5)); this.xi[i] = Math.floor(g); this.xf[i] = g - this.xi[i]; }
    for (let j = 0; j < H; j++) { const g = Math.min(R - 1.001, Math.max(0, ((j + 0.5) * R) / H - 0.5)); this.yi[j] = Math.floor(g); this.yf[j] = g - this.yi[j]; }
  }

  setModel(m: AngioModel) {
    this.model = m; this.twigs = m.segments.flatMap((sg) => makeTwigs(sg));
    let last = 0;
    for (const s of m.segments) if (this.visible(s)) for (const t of s.arrival) if (Number.isFinite(t)) last = Math.max(last, t);
    this.run = Math.min(14, Math.max(ANGIO.runSeconds, last + ANGIO.injectSeconds + 1.5)); // a slow vessel gets a longer run before the loop repeats
    this.inject();
  }
  inject() { this.t0 = performance.now(); }

  /** Which vessels the catheter is filling: the left coronary system, the right, or (aortic root injection) both. */
  private visible(s: AngioSegment): boolean {
    const inj = this.opts.injection;
    return inj === "both" || (inj === "right") === (s.group === "RCA");
  }

  /** The dye in each vessel as lumens: a polygon per run of equal opacity, in nested layers so the density is flat in the middle and falls off at the wall, like a cylinder of iodine. */
  private paintVessels(F: Frame, m: AngioModel, t: number) {
    const A = this.actx, o = this.opts, NS = ANGIO.samples, LV = 6;
    const layers: [number, number][] = [[1, 0.27], [0.9, 0.1], [0.77, 0.11], [0.6, 0.11], [0.4, 0.1]]; // [width fraction, density]
    for (const seg of m.segments) {
      if (!this.visible(seg)) continue;
      const pts: P2[] = [], width: number[] = [], asym: number[] = [], level: number[] = [];
      const plaques = (o.plaques ?? []).filter((p) => p.segId === seg.id);
      for (let i = 0; i <= NS; i++) {
        const ta = seg.arrival[i];
        let c = 0;
        if (Number.isFinite(ta)) c = o.labels ? 1 : smooth((t - ta) / 0.25) * (1 - smooth((t - ta - ANGIO.injectSeconds) / 0.5));
        level.push(Math.round(c * LV));
        pts.push(F.toScreen(seg.samples[i]));
        width.push(seg.diameterMm[i] * F.sc * VESSEL_MAG);
        let a = 0;
        for (const p of plaques) a += plaqueShift(p, (i / NS) * seg.length).asym;
        asym.push(Math.max(-0.6, Math.min(0.6, a)));
      }
      // keep the polygon cheap: every vessel is thinned to a point about every 2.5 px
      const step = Math.max(1, Math.round(2.5 / Math.max(0.5, (len(sub(seg.samples[NS], seg.samples[0])) * F.sc) / NS)));
      const keep: number[] = []; for (let i = 0; i < NS; i += step) keep.push(i); keep.push(NS);
      const kp = keep.map((i) => pts[i]), kw = keep.map((i) => width[i]), ka = keep.map((i) => asym[i]), kl = keep.map((i) => level[i]);
      const walls = wallLines(kp, kw, ka);
      for (const r of levelRuns(kl)) {
        const dens = r.level / LV;
        for (const [wf, d] of layers) {
          A.beginPath();
          for (let i = r.a; i <= r.b; i++) { const c = kp[i], l = walls.left[i]; const x = c[0] + (l[0] - c[0]) * wf, y = c[1] + (l[1] - c[1]) * wf; if (i === r.a) A.moveTo(x, y); else A.lineTo(x, y); }
          for (let i = r.b; i >= r.a; i--) { const c = kp[i], l = walls.right[i]; A.lineTo(c[0] + (l[0] - c[0]) * wf, c[1] + (l[1] - c[1]) * wf); }
          A.closePath(); A.fillStyle = `rgba(255,255,255,${(d * dens).toFixed(3)})`; A.fill();
        }
      }
      // the fine branches: they fill just after the point they leave the parent, a hair thinner than a pixel at low zoom
      for (const tw of this.twigs) {
        if (tw.segId !== seg.id) continue;
        const ta = seg.arrival[tw.at] + 0.12;
        if (!Number.isFinite(ta)) continue;
        const c = o.labels ? 1 : smooth((t - ta) / 0.3) * (1 - smooth((t - ta - ANGIO.injectSeconds) / 0.5));
        if (c < 0.02) continue;
        const sp = smoothPath(tw.pts.map((p) => F.toScreen(p)), 2), w = Math.max(1.3, tw.dMm * F.sc * 1.2);
        A.beginPath(); sp.forEach((q, i) => (i ? A.lineTo(q[0], q[1]) : A.moveTo(q[0], q[1])));
        A.lineJoin = "round"; A.lineCap = "round"; A.lineWidth = w; A.strokeStyle = `rgba(255,255,255,${(0.15 * c).toFixed(3)})`; A.stroke();
        A.lineWidth = Math.max(0.8, w * 0.55); A.strokeStyle = `rgba(255,255,255,${(0.12 * c).toFixed(3)})`; A.stroke();
      }
      // calcium shows before any dye: a dense line along each wall of the plaque
      for (const p of plaques) {
        const cs = calciumSpan(p, seg.length, NS); if (!cs) continue;
        for (const wall of [walls.left, walls.right]) {
          A.beginPath(); let started = false;
          for (let i = 0; i < keep.length; i++) {
            if (keep[i] < cs.from || keep[i] > cs.to) continue;
            const q = wall[i]; if (started) A.lineTo(q[0], q[1]); else { A.moveTo(q[0], q[1]); started = true; }
          }
          A.lineWidth = 1.6; A.strokeStyle = `rgba(255,255,255,${(0.09 + 0.2 * p.calcium).toFixed(3)})`; A.stroke();
        }
      }
    }
  }

  draw(now: number) {
    const m = this.model; if (!m) return;
    const { W, H, actx: A, ctx: C } = this, o = this.opts;
    let t = (now - this.t0) / 1000;
    if (t > this.run) { this.t0 = now; t = 0; }
    const F = frameOf(m.centre, o, now, W, H);
    const sf: StaticFrame = { W, H, sc: F.sc, ox: F.ox, oy: F.oy, basis: F.basis, project: F.toStatic };
    this.backdrop.update(sf, m.centre, now, o.heartRate);

    A.globalCompositeOperation = "source-over"; A.fillStyle = "#000"; A.fillRect(0, 0, W, H); A.globalCompositeOperation = "lighter";
    this.paintVessels(F, m, t);
    // the stand-in catheter (the heart-cath page), from the injected ostium up and out
    const root = m.segments.find((s) => this.visible(s) && !s.parent);
    if (root && o.catheter !== false) {
      const p = F.toScreen(root.samples[0]), ox = p[0], oy = p[1];
      A.strokeStyle = "rgba(255,255,255,.2)"; A.lineWidth = 5; A.beginPath(); A.moveTo(ox, oy); A.bezierCurveTo(ox - 30, oy - 40, ox - 80, oy - 90, ox - 150, oy - 220); A.stroke();
    }
    const acc = A.getImageData(0, 0, W, H).data;
    let dev: Uint8ClampedArray | null = null;
    if (o.overlay) { this.octx.drawImage(o.overlay, 0, 0, W, H); dev = this.octx.getImageData(0, 0, W, H).data; }

    const { soft, bone } = this.backdrop, R = this.backdrop.res, od = this.out.data, f = (Math.floor(now / 33) * 977) % (this.noise.length - W * H);
    const nz = this.noise, vig = this.vig, xi = this.xi, xf = this.xf, yi = this.yi, yf = this.yf;
    const mot = this.mottle, mi = this.mi, mf = this.mf, mj = this.mj, mg = this.mg; for (let q = 0; q < mot.length; q++) mot[q] = Math.random() + Math.random() - 1;
    const lutScale = LUT_N / (D_MAX - D_MIN), toneScale = TONE_N / TONE_MAX, rr = 1 / T_REF;
    for (let j = 0; j < H; j++) {
      const r0 = yi[j] * R, r1 = r0 + R, wy = yf[j];
      for (let i = 0; i < W; i++) {
        const k = j * W + i, p = k * 4, v0 = vig[k];
        if (v0 === 0) { this.lum[k] = 0; continue; }
        const a = xi[i], wx = xf[i];
        const s = (soft[r0 + a] * (1 - wx) + soft[r0 + a + 1] * wx) * (1 - wy) + (soft[r1 + a] * (1 - wx) + soft[r1 + a + 1] * wx) * wy;
        const xs = Math.pow(s * rr, 0.9) - 1;
        let d = (xs < 0 ? K_THIN : K_SOFT) * xs + (bone[k] / 255) * K_BONE + (acc[p] / 255) * K_IODINE;
        if (dev) d += (dev[p] / 255) * K_DEVICE;
        let ix = (d - D_MIN) * lutScale; ix = ix < 0 ? 0 : ix > LUT_N ? LUT_N : ix;
        let raw = EXP_LUT[ix | 0] + VEIL;
        const m0 = mj[j] * MOT + mi[i], mx = mf[i], my = mg[j];
        const low = (mot[m0] * (1 - mx) + mot[m0 + 1] * mx) * (1 - my) + (mot[m0 + MOT] * (1 - mx) + mot[m0 + MOT + 1] * mx) * my; // low-frequency mottle
        const fine = (nz[k + f] + nz[k + f + 1]) * 0.72; // grain one to two pixels wide: neighbors share photons
        raw *= 1 + (0.2 * fine + 0.09 * low) / Math.sqrt(raw + 0.05); // quantum mottle: fewer photons behind dense anatomy, so grainier there
        let ti = raw * toneScale; ti = ti < 0 ? 0 : ti > TONE_N ? TONE_N : ti;
        this.lum[k] = TONE_LUT[ti | 0] * v0;
      }
    }
    // focal spot, scintillator and detector soften every edge a little, grain included: a separable blur over the whole picture.
    const A1 = this.lum, A2 = this.lum2, wk = [0.27, 0.46, 0.27];
    for (let j = 0; j < H; j++) { const r = j * W; A2[r] = A1[r]; A2[r + W - 1] = A1[r + W - 1]; for (let i = 1; i < W - 1; i++) A2[r + i] = A1[r + i - 1] * wk[0] + A1[r + i] * wk[1] + A1[r + i + 1] * wk[2]; }
    for (let j = 0; j < H; j++) {
      const up = Math.max(0, j - 1) * W, mid = j * W, dn = Math.min(H - 1, j + 1) * W;
      for (let i = 0; i < W; i++) {
        const blur = A2[up + i] * wk[0] + A2[mid + i] * wk[1] + A2[dn + i] * wk[2], v = Math.max(0, Math.min(1, blur)) * 255, p = (mid + i) * 4;
        od[p] = v; od[p + 1] = v; od[p + 2] = v * 1.015; od[p + 3] = 255;
      }
    }
    C.putImageData(this.out, 0, 0);
    C.font = '13px "JetBrains Mono", ui-monospace, Menlo, monospace'; C.fillStyle = "rgba(220,220,210,.8)"; C.textBaseline = "alphabetic";
    C.fillText(`${o.rot < 0 ? "RAO" : "LAO"} ${Math.abs(o.rot)}  ${o.tilt < 0 ? "CAUD" : "CRAN"} ${Math.abs(o.tilt)}`, 14, 24);
    C.fillText(`t ${Math.max(0, t).toFixed(1)} s`, 14, H - 14);
    if (t >= 0 && t < ANGIO.injectSeconds) { C.fillStyle = "rgba(255,235,120,.9)"; C.fillText("INJECTING", W - 100, 24); }
    if (o.labels) this.drawLabels(m, F);
  }

  private drawLabels(m: AngioModel, F: Frame) {
    const C = this.ctx, { W } = this, NS = ANGIO.samples;
    C.font = "12px system-ui, sans-serif"; C.textBaseline = "middle";
    const used: [number, number, number][] = [];
    for (const seg of m.segments) {
      if (!this.visible(seg)) continue;
      for (const [txt, u] of VESSEL_LABELS[seg.id] ?? []) {
        const i = Math.min(NS - 1, Math.round(u * NS));
        if (!Number.isFinite(seg.arrival[i])) continue; // nothing to label where no dye goes
        const [x, y] = F.toScreen(seg.samples[i]), w = C.measureText(txt).width + 6;
        let lx = Math.min(x + 9, W - w - 3), ly = y - 9;
        for (let tries = 0; tries < 8 && used.some((q) => lx < q[0] + q[2] && lx + w > q[0] && Math.abs(ly - q[1]) < 16); tries++) { ly += 14; if (tries === 3) { lx = x - w - 9; ly = y - 9; } }
        used.push([lx, ly, w]);
        C.strokeStyle = "rgba(255,235,120,.55)"; C.lineWidth = 1; C.beginPath(); C.moveTo(x, y); C.lineTo(lx, ly); C.stroke();
        C.fillStyle = "#ffe27a"; C.beginPath(); C.arc(x, y, 2.4, 0, 6.283); C.fill();
        C.fillStyle = "rgba(0,0,0,.6)"; C.fillRect(lx, ly - 8, w, 16); C.fillStyle = "#ffe27a"; C.fillText(txt, lx + 3, ly);
      }
    }
  }
}
