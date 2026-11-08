import type { V3 } from "../anatomy/curve";
import { Basis, bodyMotion, chordAt, patientEllipsoids, prepare, ribs, spine, vertebraEllipsoids, type Prepared } from "./body";
import { BODY } from "../lab/access";

/** Where the C-arm puts the picture: the static map (the table and the bones do not move) and the basis of the screen axes. */
export interface StaticFrame { W: number; H: number; sc: number; ox: number; oy: number; basis: Basis; project: (p: V3) => [number, number] }

/** Separable box blur, `passes` times: three passes approximate a gaussian. The focal spot, scatter and the detector all soften an x-ray; a vector edge never is. */
export function boxBlur(a: Float32Array, w: number, h: number, r: number, passes = 2, tmp = new Float32Array(a.length)) {
  for (let n = 0; n < passes; n++) {
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w, cnt = 2 * r + 1;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { tmp[row + x] = acc / cnt; acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0; const cnt = 2 * r + 1;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = acc / cnt; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
  }
}

/** Smooth value noise on the image plane (mm), a few octaves: the texture of lung vessels and bowel that a smooth ellipsoid lacks. */
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}

const RES = 192; // the soft-tissue field is smooth, so it is solved on a coarse grid and sampled bilinearly

/**
 * The anatomy behind the vessels. `soft` is the tissue-equivalent thickness (mm) along each ray, from analytic chords through
 * the patient's ellipsoids; `bone` is the optical density of the vertebrae, ribs, sternum and clavicles, drawn as projected solids.
 * Both come from the patient frame through the same mapping as the vessels, so they turn with the C-arm and follow the camera.
 */
export class Backdrop {
  readonly res = RES;
  soft = new Float32Array(RES * RES);
  bone: Uint8Array;
  private lin = new Float32Array(RES * RES); private bon = new Float32Array(RES * RES); private tmp = new Float32Array(RES * RES);
  private cub = new Float32Array(RES * RES);
  private canvas: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private key = "";
  constructor(private W: number, private H: number) {
    this.bone = new Uint8Array(W * H);
    this.canvas = document.createElement("canvas"); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  /** Rebuild what changed: the bones when the pose or the camera moved, the soft-tissue field every frame (the heart and the diaphragm move). */
  update(F: StaticFrame, heartCentre: V3, now: number, heartRate: number, effusionMl = 0) {
    const key = `${F.sc.toFixed(3)},${F.ox.toFixed(1)},${F.oy.toFixed(1)},${F.basis.e3.map((v) => v.toFixed(4)).join(",")}`;
    if (key !== this.key) { this.key = key; this.drawBones(F); }
    this.solveSoft(F, heartCentre, now, heartRate, effusionMl);
  }

  private solveSoft(F: StaticFrame, hc: V3, now: number, heartRate: number, effusionMl: number) {
    const { soft, lin, cub, bon } = this, R = RES, cell = F.W / R;
    lin.fill(0); cub.fill(0); bon.fill(0);
    const heartMove = bodyMotion(now, heartRate, Math.max(0.15, 1 - effusionMl / 320)), breath = heartMove.breath;
    const ells = [...patientEllipsoids(hc, breath, effusionMl), ...spine().flatMap((v, i) => vertebraEllipsoids(v, i))];
    for (const e of ells) {
      const p: Prepared = prepare(e, F.basis, e.group === "heart" ? [heartMove.dx, heartMove.dy] : [0, 0]);
      const sx0 = F.ox + (p.c1 - p.ext1) * F.sc, sx1 = F.ox + (p.c1 + p.ext1) * F.sc;
      const sy0 = F.oy - (p.c2 + p.ext2) * F.sc, sy1 = F.oy - (p.c2 - p.ext2) * F.sc;
      const g0 = Math.max(0, Math.floor(sx0 / cell - 0.5)), g1 = Math.min(R - 1, Math.ceil(sx1 / cell - 0.5));
      const h0 = Math.max(0, Math.floor(sy0 / cell - 0.5)), h1 = Math.min(R - 1, Math.ceil(sy1 / cell - 0.5));
      const body = p.group === "body";
      for (let gy = h0; gy <= h1; gy++) {
        const x2 = (F.oy - (gy + 0.5) * cell) / F.sc;
        for (let gx = g0; gx <= g1; gx++) {
          const c = chordAt(p, (F.ox * -1 + (gx + 0.5) * cell) / F.sc, x2);
          if (c <= 0) continue;
          const k = gy * R + gx;
          if (body) cub[k] += c * c * c; else if (p.group === "bone") bon[k] += p.w * c; else lin[k] += p.w * c;
        }
      }
    }
    for (let gy = 0; gy < R; gy++) for (let gx = 0; gx < R; gx++) {
      const k = gy * R + gx; if (bon[k] === 0) continue;
      // trabecular streaks run along the vertebra: noise stretched in the cranio-caudal direction, tied to the patient
      const x1 = (-F.ox + (gx + 0.5) * cell) / F.sc, x2 = (F.oy - (gy + 0.5) * cell) / F.sc;
      bon[k] *= 0.72 + 0.55 * valueNoise(x1 / 2.4, x2 / 8) * 0.6 + 0.55 * valueNoise(x1 / 1.1, x2 / 3.2) * 0.4;
    }
    for (let k = 0; k < soft.length; k++) soft[k] = Math.max(62, Math.cbrt(cub[k]) + lin[k] + bon[k]); // where both lungs overlap the ray still crosses the chest wall and mediastinum
    boxBlur(soft, R, R, 1, 1, this.tmp);
    // a little anatomical texture, tied to the patient (the image plane in mm), strongest in the lungs
    for (let gy = 0; gy < R; gy++) for (let gx = 0; gx < R; gx++) {
      const x1 = (-F.ox + (gx + 0.5) * cell) / F.sc, x2 = (F.oy - (gy + 0.5) * cell) / F.sc, k = gy * R + gx;
      const n = valueNoise(x1 / 14, x2 / 14) * 0.6 + valueNoise(x1 / 5.5, x2 / 5.5) * 0.4 - 0.5;
      soft[k] += n * 10 * (lin[k] < -20 ? 2.4 : 1);
    }
  }

  private drawBones(F: StaticFrame) {
    const { ctx: C, W, H } = this, P = F.project;
    C.globalCompositeOperation = "source-over"; C.fillStyle = "#000"; C.fillRect(0, 0, W, H); C.globalCompositeOperation = "lighter";
    const hull = (pts: [number, number][]) => {
      pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo: [number, number][] = [], up: [number, number][] = [];
      for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const solid = (c: V3, s: V3, fill: number, edge: number) => {
      const pts: [number, number][] = [];
      for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) pts.push(P([c[0] + dx * s[0], c[1] + dy * s[1], c[2] + dz * s[2]]));
      const h = hull(pts); if (h.length < 3) return;
      C.beginPath(); h.forEach((p, i) => (i ? C.lineTo(p[0], p[1]) : C.moveTo(p[0], p[1])));
      C.closePath(); C.fillStyle = `rgba(255,255,255,${fill})`; C.fill();
      C.strokeStyle = `rgba(255,255,255,${edge * 0.8})`; C.lineWidth = Math.max(1, F.sc * 1.6); C.lineJoin = "round"; C.stroke();
    };
    // ribs, thinning toward the front
    for (const r of ribs()) {
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = P(r.pts[k]), b = P(r.pts[k + 1]);
        C.beginPath(); C.moveTo(a[0], a[1]); C.lineTo(b[0], b[1]);
        C.lineWidth = Math.max(1.2, r.widthMm[k] * F.sc * 0.55); C.lineCap = "butt";
        C.strokeStyle = `rgba(255,255,255,${0.036 * (1 - 0.35 * (k / r.pts.length))})`; C.stroke();
        C.lineWidth = Math.max(0.8, r.widthMm[k] * F.sc * 0.85); C.strokeStyle = "rgba(255,255,255,0.05)"; C.stroke();
      }
    }
    // sternum and clavicles
    const xm = BODY.midlineX;
    solid([xm, 78, 84], [36, 118, 12], 0.04, 0.04); solid([xm, -2, 82], [26, 46, 9], 0.04, 0.04); solid([xm, -44, 78], [10, 16, 6], 0.025, 0.025);
    for (const s of [-1, 1]) {
      const pts: V3[] = [[xm + s * 12, 134, 70], [xm + s * 55, 143, 66], [xm + s * 105, 140, 50], [xm + s * 152, 131, 30]];
      C.beginPath(); pts.forEach((q, i) => { const a = P(q); if (i) C.lineTo(a[0], a[1]); else C.moveTo(a[0], a[1]); });
      C.lineWidth = Math.max(2, 11 * F.sc); C.lineJoin = "round"; C.lineCap = "round"; C.strokeStyle = "rgba(255,255,255,0.05)"; C.stroke();
    }
    const d = C.getImageData(0, 0, W, H).data, f = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) f[k] = d[k * 4];
    boxBlur(f, W, H, Math.max(1, Math.round(F.sc * 0.42)), 2); // the focal spot and detector blur an edge over about a millimeter
    for (let k = 0; k < W * H; k++) this.bone[k] = f[k];
  }
}
