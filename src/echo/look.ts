import { Tissue } from "./tissue";

/**
 * The stylized echo look: a pure function from a tissue raster to grayscale pixels. No canvas, no Math.random, so it can be
 * tested and replayed. It is an approximation of how an ultrasound picture is built (echogenicity, specular edges, speckle,
 * time-gain compensation, near-field clutter), not a physical simulation.
 */

/** The raster fields this function reads (a subset of `Raster` in paint.ts). */
export interface LookRaster {
  w: number;
  h: number;
  /** Pixels per mm. */
  px: number;
  /** Part index, -1 outside heart, -2 outside the fan. */
  part: Int8Array;
  tissue: Uint8Array;
  /** Signed distance to the heart's outer surface, mm (negative inside). */
  sdf: Float32Array;
}

/** Base echogenicity per tissue, 0..255, before edges, speckle and gain. */
export const ECHO_BASE = {
  blood: 12,
  myocardium: 105,
  septum: 120,
  papillary: 140,
  leaflet: 210,
  pericardium: 245,
  /** Inside the fan but outside the heart: low-mid tissue haze. */
  haze: 30,
} as const;

/** Log-amplitude of the speckle (multiplicative, unit-variance noise times this). */
export const SPECKLE_AMP = { blood: 0.18, tissue: 0.38, haze: 0.32 } as const;

export const LOOK = {
  /** Time-gain: exp(-TGC_FALL * depth / depthMax), times a mid-field boost. */
  TGC_FALL: 1.0,
  TGC_BOOST: 0.25,
  TGC_BOOST_AT: 0.45,
  TGC_BOOST_WIDTH: 0.2,
  /** Near-field clutter: peak added gray and its extent in mm below the apex. */
  CLUTTER_GRAY: 28,
  CLUTTER_MM: 12,
  /** Speckle cells drawn per second (the field crossfades between them). */
  SPECKLE_RATE: 2,
  /** Specular gain at an edge head-on to the beam, and the dimming of an edge parallel to it. */
  SPEC_HEAD_ON: 0.8,
  SPEC_PARALLEL: 0.45,
} as const;

// Separable blurs. Across the beam (x) about 1 px wide, along the beam (y) about 0.5 px.
const BLUR_X = [0.27, 0.46, 0.27];
const BLUR_Y = [0.12, 0.76, 0.12];
// Speckle kernels, normalized: long along the beam (y), short across (x), ratio of sigmas about 2.4.
const norm = (k: number[]) => { const s = k.reduce((a, b) => a + b, 0); return k.map((v) => v / s); };
const SPK_X = norm([1, 4, 1]);
const SPK_Y = norm([1, 2, 3, 4, 3, 2, 1]);
const sumSq = (k: number[]) => k.reduce((a, b) => a + b * b, 0);
/** Divides the blurred white-noise deviation back to unit standard deviation. */
const SPK_NORM = 1 / Math.sqrt(sumSq(SPK_X) * sumSq(SPK_Y));

/** Seeded integer hash to [0, 1). */
function hash3(x: number, y: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Base gray of one pixel: the structure layer before blur. */
function baseGray(tissue: number, part: number): number {
  switch (tissue) {
    case Tissue.Blood: return ECHO_BASE.blood;
    case Tissue.Myocardium: return ECHO_BASE.myocardium;
    case Tissue.Septum: return ECHO_BASE.septum;
    case Tissue.Papillary: return ECHO_BASE.papillary;
    case Tissue.Leaflet: return ECHO_BASE.leaflet;
    case Tissue.Pericardium: return ECHO_BASE.pericardium;
    default: return part === -2 ? 0 : ECHO_BASE.haze;
  }
}

/** Separable convolution with edge clamping; pixels outside the fan keep their own value in the taps. */
function blur(src: Float32Array, w: number, h: number, kx: number[], ky: number[], fan: Uint8Array | null): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = 0;
      for (let k = -rx; k <= rx; k++) {
        const j = y * w + Math.min(w - 1, Math.max(0, x + k));
        s += kx[k + rx] * (fan && !fan[j] ? src[i] : src[j]);
      }
      tmp[i] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = 0;
      for (let k = -ry; k <= ry; k++) {
        const j = Math.min(h - 1, Math.max(0, y + k)) * w + x;
        s += ky[k + ry] * (fan && !fan[j] ? tmp[i] : tmp[j]);
      }
      out[i] = s;
    }
  }
  return out;
}

/**
 * Anisotropic, unit-variance speckle field at time `t`. Two seeded white-noise frames are crossfaded with
 * cos/sin weights (variance preserving), so the pattern drifts slowly instead of flickering.
 */
function speckleField(w: number, h: number, t: number): Float32Array {
  const u = Math.max(0, t) * LOOK.SPECKLE_RATE;
  const k = Math.floor(u), f = u - k;
  const a = Math.cos(f * Math.PI / 2), b = Math.sin(f * Math.PI / 2);
  const white = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Uniform [0,1) minus the mean 0.5, scaled to unit variance (var of uniform = 1/12).
      const n0 = (hash3(x, y, k) - 0.5) * Math.sqrt(12);
      const n1 = (hash3(x, y, k + 1) - 0.5) * Math.sqrt(12);
      white[y * w + x] = a * n0 + b * n1;
    }
  }
  const sm = blur(white, w, h, SPK_X, SPK_Y, null);
  for (let i = 0; i < sm.length; i++) sm[i] *= SPK_NORM;
  return sm;
}

/** Time-gain compensation at depth fraction u = depth / depthMax. */
export function tgc(u: number): number {
  const z = (u - LOOK.TGC_BOOST_AT) / LOOK.TGC_BOOST_WIDTH;
  return Math.exp(-LOOK.TGC_FALL * u) * (1 + LOOK.TGC_BOOST * Math.exp(-0.5 * z * z));
}

/**
 * Stylize a raster as an ultrasound picture. Returns grayscale RGBA (w*h*4), black outside the fan.
 * Deterministic for the same raster and `t` (seconds).
 */
export function stylizeRaster(r: LookRaster, t: number): Uint8ClampedArray {
  const { w, h, px, part, tissue, sdf } = r;
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const fan = new Uint8Array(n);
  const base = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fan[i] = part[i] === -2 ? 0 : 1;
    base[i] = baseGray(tissue[i], part[i]);
  }

  // 5. Soft edges on the structure layer, before speckle.
  const s = blur(base, w, h, BLUR_X, BLUR_Y, fan);
  const noise = speckleField(w, h, t);
  const depthMax = Math.max(1e-6, h / px);
  const at = (a: Float32Array, x: number, y: number, i: number) => a[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] ?? a[i];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      out[o + 3] = 255;
      if (!fan[i]) continue; // black

      const tis = tissue[i];
      const solid = tis !== Tissue.Outside && tis !== Tissue.Blood;
      let v = s[i];

      // 2. Specular edges: the sdf gradient is the surface normal; compare it with the beam from the apex.
      if (solid) {
        let nx = (at(sdf, x + 1, y, i) - at(sdf, x - 1, y, i)) * 0.5;
        let ny = (at(sdf, x, y + 1, i) - at(sdf, x, y - 1, i)) * 0.5;
        const gsx = (at(s, x + 1, y, i) - at(s, x - 1, y, i)) * 0.5;
        const gsy = (at(s, x, y + 1, i) - at(s, x, y - 1, i)) * 0.5;
        if (Math.hypot(nx, ny) < 1e-4) { nx = gsx; ny = gsy; }
        const nl = Math.hypot(nx, ny);
        if (nl > 1e-6) {
          nx /= nl; ny /= nl;
          let bx = x - w / 2, by = y;
          const bl = Math.hypot(bx, by);
          if (bl < 1e-6) { bx = 0; by = 1; } else { bx /= bl; by /= bl; }
          const c = nx * bx + ny * by;
          const c2 = c * c;
          // Edge weight: strong where the structure layer changes, or within ~1.5 mm of the outer surface.
          const e = Math.min(1, Math.hypot(gsx, gsy) / 30 + 0.5 * Math.exp(-Math.abs(sdf[i]) / 1.5));
          v *= 1 - e * LOOK.SPEC_PARALLEL + e * (LOOK.SPEC_PARALLEL + LOOK.SPEC_HEAD_ON) * c2;
        }
      }

      // 3. Multiplicative speckle (mean preserving), stronger in tissue than in blood.
      const amp = solid ? SPECKLE_AMP.tissue : tis === Tissue.Blood ? SPECKLE_AMP.blood : SPECKLE_AMP.haze;
      v *= Math.exp(amp * noise[i] - 0.5 * amp * amp);

      // 4. Time-gain compensation.
      const depthMm = y / px;
      v *= tgc(depthMm / depthMax);

      // 6. Near-field clutter in the first few millimeters under the probe.
      if (depthMm < LOOK.CLUTTER_MM) {
        const q = 1 - depthMm / LOOK.CLUTTER_MM;
        v += LOOK.CLUTTER_GRAY * q * q * (0.75 + 0.25 * Math.tanh(noise[i]));
      }

      out[o] = out[o + 1] = out[o + 2] = v;
    }
  }
  return out;
}
