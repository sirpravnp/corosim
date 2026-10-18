import { V3 } from "../anatomy/curve";
import { ANGIO, VESSEL_LABELS } from "../config/cath";
import { AngioModel, AngioSegment } from "../sim/cath";

/** What the C-arm is doing: where it is pointed, which coronary is being injected, whether the vessel names are drawn. */
export interface AngioOptions {
  rot: number; // degrees, LAO positive / RAO negative
  tilt: number; // degrees, cranial positive / caudal negative
  injection: "both" | "left" | "right";
  labels: boolean;
  heartRate: number; // bpm, drives the small cardiac motion of the picture
}

const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Patient frame -> screen (x right, y up) for a C-arm at rotation `ry` and tilt `rx`. Iodine adds along the ray, so overlap and foreshortening come out of this. */
function project(p: V3, ry: number, rx: number): V3 {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1];
  return [x, y * cx - z * sx, y * sx + z * cx];
}

/**
 * The angiogram: a canvas-2D renderer (a WebGL one could replace it behind this class). Iodine is summed into an
 * accumulation canvas and darkens a soft-tissue background; the dye in each vessel follows `AngioSegment.arrival`.
 */
export class AngioView {
  opts: AngioOptions = { rot: 30, tilt: -20, injection: "both", labels: false, heartRate: 70 };
  private model: AngioModel | null = null;
  private ctx: CanvasRenderingContext2D;
  private acc: HTMLCanvasElement; private actx: CanvasRenderingContext2D;
  private W: number; private H: number;
  private base: Float32Array; private noise: Float32Array;
  private t0 = -1e9; private run = ANGIO.runSeconds;
  private lastPose = "";

  constructor(private canvas: HTMLCanvasElement) {
    this.W = canvas.width; this.H = canvas.height;
    this.ctx = canvas.getContext("2d")!;
    this.acc = document.createElement("canvas"); this.acc.width = this.W; this.acc.height = this.H;
    this.actx = this.acc.getContext("2d", { willReadFrequently: true })!;
    this.noise = new Float32Array(this.W * this.H); for (let i = 0; i < this.noise.length; i++) this.noise[i] = Math.random();
    this.base = this.background();
  }

  /** Soft-tissue backdrop: lung fields, spine, diaphragm hint, vignette. Static, so it is built once. */
  private background(): Float32Array {
    const { W, H } = this, out = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const X = (i - W / 2) / W, Y = (j - H / 2) / H;
      let b = 0.46 + 0.10 * Math.exp(-((X - 0.05) ** 2 + (Y + 0.05) ** 2) / 0.05) - 0.2 * Math.exp(-((X + 0.34) ** 2) / 0.012) + 0.12 * Math.exp(-((Y - 0.42) ** 2) / 0.02) - 0.08 * Math.exp(-((X - 0.36) ** 2 + (Y - 0.1) ** 2) / 0.04);
      b += 0.05 * Math.sin(Y * 60) * Math.exp(-((X + 0.34) ** 2) / 0.012);
      const rr = Math.hypot(X, Y);
      out[j * W + i] = rr > 0.47 ? 0 : b * (1 - Math.pow(rr / 0.47, 6) * 0.5);
    }
    return out;
  }

  setModel(m: AngioModel) {
    this.model = m;
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

  draw(now: number) {
    const m = this.model; if (!m) return;
    const { W, H, actx: A, ctx: C } = this, o = this.opts;
    const ry = (o.rot * Math.PI) / 180, rx = (o.tilt * Math.PI) / 180;
    let t = (now - this.t0) / 1000;
    if (t > this.run) { this.t0 = now; t = 0; }
    const beat = ((now / 1000) * (o.heartRate / 60)) % 1, dx = Math.sin(beat * 6.283) * 1.4, dy = Math.cos(beat * 6.283) * 2.2;
    A.globalCompositeOperation = "source-over"; A.fillStyle = "#000"; A.fillRect(0, 0, W, H); A.globalCompositeOperation = "lighter";
    const sc = W / 135, cm = project(m.centre, ry, rx), cx0 = W / 2 + dx - cm[0] * sc, cy0 = H / 2 + dy + cm[1] * sc;
    const NS = ANGIO.samples;
    for (const seg of m.segments) {
      if (!this.visible(seg)) continue;
      const lo = seg.arrival;
      for (let i = 0; i < NS; i++) {
        const ta = lo[i];
        let c: number;
        if (!Number.isFinite(ta)) c = 0;
        else if (o.labels) c = 1; // with the names on, the whole tree stays lit so every label sits on a vessel
        else c = smooth((t - ta) / 0.25) * (1 - smooth((t - ta - ANGIO.injectSeconds) / 0.5));
        if (c < 0.01) continue;
        const a = project(seg.samples[i], ry, rx), b = project(seg.samples[i + 1], ry, rx), d = seg.diameterMm[i];
        for (let k = 0; k < 2; k++) {
          const w = k / 2, x = cx0 + lerp(a[0], b[0], w) * sc, y = cy0 - lerp(a[1], b[1], w) * sc;
          const rad = Math.max(1.4, d * sc * 0.62), al = 0.55 * c;
          const g = A.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, `rgba(255,255,255,${al})`); g.addColorStop(0.7, `rgba(255,255,255,${al * 0.8})`); g.addColorStop(1, "rgba(255,255,255,0)");
          A.fillStyle = g; A.beginPath(); A.arc(x, y, rad, 0, 6.283); A.fill();
        }
      }
    }
    // the catheter, from the injected ostium up and out
    const root = m.segments.find((s) => this.visible(s) && !s.parent);
    if (root) {
      const p = project(root.samples[0], ry, rx), ox = cx0 + p[0] * sc, oy = cy0 - p[1] * sc;
      A.strokeStyle = "rgba(255,255,255,.16)"; A.lineWidth = 5; A.beginPath(); A.moveTo(ox, oy); A.bezierCurveTo(ox - 30, oy - 40, ox - 80, oy - 90, ox - 150, oy - 220); A.stroke();
    }
    const px = A.getImageData(0, 0, W, H).data, out = C.createImageData(W, H), od = out.data, f = Math.floor(now / 33) * 977;
    for (let k = 0; k < W * H; k++) {
      const iod = px[k * 4] / 255, noise = (this.noise[(k + f) % this.noise.length] - 0.5) * 0.09;
      let v = this.base[k] === 0 ? 0 : (this.base[k] + noise) * Math.exp(-iod * 2.6);
      v = Math.max(0, Math.min(1, v)) * 255;
      const p = k * 4; od[p] = v; od[p + 1] = v; od[p + 2] = v * 1.02; od[p + 3] = 255;
    }
    C.putImageData(out, 0, 0);
    C.font = "13px ui-monospace, Menlo, monospace"; C.fillStyle = "rgba(220,220,210,.8)"; C.textBaseline = "alphabetic";
    C.fillText(`${o.rot < 0 ? "RAO" : "LAO"} ${Math.abs(o.rot)}  ${o.tilt < 0 ? "CAUD" : "CRAN"} ${Math.abs(o.tilt)}`, 14, 24);
    C.fillText(`t ${Math.max(0, t).toFixed(1)} s`, 14, H - 14);
    if (t >= 0 && t < ANGIO.injectSeconds) { C.fillStyle = "rgba(255,235,120,.9)"; C.fillText("INJECTING", W - 100, 24); }
    if (o.labels) this.drawLabels(m, ry, rx, cx0, cy0, sc);
    this.lastPose = `${o.rot},${o.tilt}`;
  }

  private drawLabels(m: AngioModel, ry: number, rx: number, cx0: number, cy0: number, sc: number) {
    const C = this.ctx, { W } = this, NS = ANGIO.samples;
    C.font = "12px system-ui, sans-serif"; C.textBaseline = "middle";
    const used: [number, number, number][] = [];
    for (const seg of m.segments) {
      if (!this.visible(seg)) continue;
      for (const [txt, u] of VESSEL_LABELS[seg.id] ?? []) {
        const i = Math.min(NS - 1, Math.round(u * NS));
        if (!Number.isFinite(seg.arrival[i])) continue; // nothing to label where no dye goes
        const p = project(seg.samples[i], ry, rx), x = cx0 + p[0] * sc, y = cy0 - p[1] * sc, w = C.measureText(txt).width + 6;
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
