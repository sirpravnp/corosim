import { V3 } from "../anatomy/curve";
import { Pose, SECTOR, toHeart } from "./poses";
import { EchoFrame, EchoHeart, FrameSample, NORMAL_HEART, Tissue, classifyFrame, stillFrame } from "./tissue";
import { patchiness } from "./organic";

/**
 * A simulated B-mode acquisition. The picture is built the way a scanner builds it, in its own coordinates (scan lines fanning out from
 * the probe, samples down each line), then scan-converted to the screen:
 *
 * 1. Each sample is classified (tissue.ts) and given acoustic properties: backscatter strength, acoustic impedance, attenuation.
 *    Outside the heart the beam crosses the chest wall (skin, fat, muscle), the liver from below, and mediastinal tissue behind.
 * 2. Scatterers: a complex Gaussian random field fixed to the tissue's material coordinate (its end-diastolic position), so speckle rides
 *    on the wall as it moves and changes only as tissue leaves the plane. Blood speckle is faint and reshuffles every frame.
 * 3. The pulse-echo point spread function: short along the beam, wider across it and wider still with depth (beam spreading beyond the
 *    focus). Convolving the scatterers with it gives fully developed speckle (Rayleigh statistics) without drawing any.
 * 4. Specular echoes where impedance changes along the beam: bright where a wall faces the beam, faint or missing where the wall runs
 *    along it (the lateral wall and the interatrial septum in the apical views drop out, as on a real scanner).
 * 5. Attenuation along each line, with shadows behind calcium and enhancement behind blood and fluid once time-gain compensation has
 *    corrected for ordinary tissue.
 * 6. Near-field clutter, reverberation of the chest wall, side-lobe haze and electronic noise.
 * 7. Log compression to a fixed dynamic range, then scan conversion with bilinear interpolation: lines spread apart with depth, so the far
 *    field smears sideways as a real sector does.
 *
 * The constants in `ACOUSTIC` and `BEAM` are tuned so that the image statistics (imageStats.ts) of a normal heart match those measured on
 * the open reference loops (src/echo/reference.json); tests/echoRealism.test.ts checks it. Not modelled: harmonics, frequency-dependent
 * attenuation of the pulse spectrum, refraction, aberration, Doppler.
 */

/** Per tissue: backscatter amplitude (myocardium = 1), relative impedance, attenuation in dB/cm one way at the imaging frequency. */
interface Acoustic { echo: number; z: number; att: number }
export const ACOUSTIC: Record<string, Acoustic> = {
  blood: { echo: 0.045, z: 1.0, att: 0.4 },
  fluid: { echo: 0.006, z: 0.99, att: 0.1 },
  myocardium: { echo: 1, z: 1.07, att: 1.5 },
  papillary: { echo: 1.15, z: 1.08, att: 1.5 },
  leaflet: { echo: 2.6, z: 1.14, att: 2 },
  scar: { echo: 2.6, z: 1.14, att: 2.2 },
  calcium: { echo: 4.5, z: 1.7, att: 28 },
  pericardium: { echo: 5.5, z: 1.25, att: 3 },
  skin: { echo: 2.2, z: 1.1, att: 2 },
  fat: { echo: 0.32, z: 0.94, att: 1.2 },
  muscle: { echo: 0.9, z: 1.06, att: 1.6 },
  liver: { echo: 0.85, z: 1.05, att: 1.4 },
  diaphragm: { echo: 2.4, z: 1.12, att: 2 },
  mediastinum: { echo: 0.5, z: 1.03, att: 1.6 },
  /** Aerated lung: the pleura reflects almost everything, so nothing comes back from behind it. */
  pleura: { echo: 2.2, z: 1.3, att: 6 },
  lung: { echo: 0.02, z: 0.4, att: 60 },
};

export const BEAM = {
  /** Scan lines across the 90 degree sector (a phased array draws about this many). */
  lines: 128,
  /** Sample spacing down each line, mm. */
  dr: 0.33,
  /** Gaussian width (sigma) of the pulse along the beam, mm. */
  axial: 0.92,
  /** Gaussian width of the beam across, mm, at the focus; the focal depth, mm; how fast it widens away from the focus (mm per mm). */
  lateral: 0.8, focus: 60, spread: 0.022,
  /** Scatterer lattice spacing, mm: finer than the resolution cell, so the speckle is fully developed. */
  cell: 0.32,
  /** Echogenicity variation of solid tissue: log-amplitude spread of the smooth patchiness field (0.35 is about +-3 dB). */
  patchiness: 0.35,
  /** Specular echo gain on the impedance step per mm along the beam. */
  specular: 34,
  /** Nominal tissue attenuation that time-gain compensation undoes, dB/cm one way, up to a ceiling of gain (dB) as on a real scanner. */
  tgc: 1.35, tgcMax: 30,
  /** Electronic noise amplitude (after TGC it grows with depth). */
  noise: 0.0015,
  /** Side-lobe haze: share of the wide-blurred intensity added back, and its width, mm. */
  haze: 0.035, hazeWidth: 7,
  /** Near-field clutter amplitude and depth, mm. */
  clutter: 0.35, clutterMm: 24,
  /** Dynamic range of the display, dB, and the echo level shown as white, dB above mean myocardium after TGC. */
  range: 52, ceiling: 32,
};

export type EchoWindow = "parasternal" | "apical" | "subcostal" | "suprasternal" | "tee";
/** Depth of the chest wall under the probe, mm: skin, fat, muscle. Subcostally the liver comes next. */
const CHEST = { parasternal: 13, apical: 15, subcostal: 9, suprasternal: 10, tee: 3.5 } as const;
/** Fat in front of the heart: this many mm before it along a line is soft tissue, not lung. */
const FAT_PAD = 9;
/** Behind the heart, tissue within this many mm of its outer surface is mediastinum (aorta, esophagus, the posterior pericardial fat); beyond is lung. */
const BEHIND = 26;

export interface ScanSettings {
  /** Overall gain, dB (0 = calibrated). */
  gain?: number;
  /** Frame number: blood speckle reshuffles from frame to frame. */
  frameNo?: number;
  /**
   * Spontaneous echo contrast ("smoke"), 0..1: slow-moving blood stacks its red cells into rouleaux that scatter, so a low-output
   * ventricle or a big stagnant atrium shows swirling gray in the cavity. 0 in a normal heart.
   */
  smoke?: number;
  /** Which window the probe sits in: sets the chest wall and whether the liver is in the near field. */
window?: EchoWindow;
  lines?: number;
  dr?: number;
}

/** The scan in its own coordinates: `lines` columns from left to right, `samples` rows down from the probe; display values 0..1. */
export interface Polar {
  lines: number; samples: number; depth: number; dr: number;
  /** Display value (after log compression), row-major by sample: index = sample * lines + line. */
  img: Float32Array;
  /** Tissue per sample, for overlays and tests. */
  tissue: Uint8Array;
  /** Part per sample (-1 outside the heart). */
  part: Int8Array;
}

// ---- deterministic noise on a lattice ----------------------------------------------------------
function hash(x: number, y: number, z: number, k: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(k | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Standard normal deviates, looked up by hash: exact quantiles of 4096 evenly spaced probabilities, shuffled by the hash. */
const NORMALS = (() => {
  const n = 4096, t = new Float32Array(n);
  // inverse normal CDF (Acklam's rational approximation), at the bin centers
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n, lo = p < 0.02425, hi = p > 1 - 0.02425;
    if (lo || hi) { const q = Math.sqrt(-2 * Math.log(lo ? p : 1 - p)); const v = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); t[i] = lo ? v : -v; }
    else { const q = p - 0.5, r = q * q; t[i] = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  }
  return t;
})();
/** A standard normal deviate fixed to a lattice node. */
function gauss(x: number, y: number, z: number, k: number): number {
  return NORMALS[(hash(x, y, z, k) * 4096) | 0];
}
/** Smooth value noise in 0..1 on a 9 mm lattice: makes the edge of the lung behind the heart irregular instead of a copy of the heart's outline. */
function lumpy(p: V3): number {
  const c = 9, x = p[0] / c, y = p[1] / c, zz = p[2] / c, x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(zz);
  const sm = (t: number) => t * t * (3 - 2 * t), fx = sm(x - x0), fy = sm(y - y0), fz = sm(zz - z0);
  let v = 0;
  for (let i = 0; i < 8; i++) { const dx = i & 1, dy = (i >> 1) & 1, dz = (i >> 2) & 1; v += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz) * hash(x0 + dx, y0 + dy, z0 + dz, 61); }
  return v;
}
const pt0 = (pose: Pose, dir: V3, r: number): V3 => [pose.probe[0] + dir[0] * r, pose.probe[1] + dir[1] * r, pose.probe[2] + dir[2] * r];

/** Complex scatterer amplitude at a point (mm), trilinear between lattice nodes: smooth as tissue slides through a cell. */
function scatter(p: V3, seed: number, out: [number, number]): [number, number] {
  const c = BEAM.cell, x = p[0] / c, y = p[1] / c, z = p[2] / c;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0;
  let re = 0, im = 0, wsum = 0;
  for (let i = 0; i < 8; i++) {
    const dx = i & 1, dy = (i >> 1) & 1, dz = (i >> 2) & 1;
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    re += w * gauss(x0 + dx, y0 + dy, z0 + dz, seed); im += w * gauss(x0 + dx, y0 + dy, z0 + dz, seed + 101);
    wsum += w * w;
  }
  const k = 1 / Math.sqrt(2 * Math.max(1e-6, wsum)); // interpolation lowers the variance; restore it
  out[0] = re * k; out[1] = im * k;
  return out;
}

function acousticOf(t: Tissue): Acoustic {
  switch (t) {
    case Tissue.Blood: return ACOUSTIC.blood;
    case Tissue.Fluid: return ACOUSTIC.fluid;
    case Tissue.Myocardium: case Tissue.Septum: return ACOUSTIC.myocardium;
    case Tissue.Papillary: return ACOUSTIC.papillary;
    case Tissue.Leaflet: return ACOUSTIC.leaflet;
    case Tissue.Scar: return ACOUSTIC.scar;
    case Tissue.Calcium: return ACOUSTIC.calcium;
    case Tissue.Pericardium: return ACOUSTIC.pericardium;
    default: return ACOUSTIC.mediastinum;
  }
}

/** Time-gain compensation at depth r mm, dB: undoes nominal tissue loss, saturating at `tgcMax`. */
const tgcDb = (r: number) => Math.min(BEAM.tgcMax, 2 * BEAM.tgc * (r / 10));

/** Separable 1D Gaussian kernel of width `sigma` samples, truncated at 2.5 sigma. */
function kernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(2.5 * sigma)), k = new Float32Array(2 * r + 1);
  let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / Math.max(0.3, sigma)) ** 2); s += k[i + r] ** 2; }
  const n = 1 / Math.sqrt(s); for (let i = 0; i < k.length; i++) k[i] *= n; // unit energy: speckle keeps its mean intensity
  return k;
}

/**
 * Acquire one frame for a probe pose. `depth` is the displayed sector radius in mm (the page's framing). Pass a patient and a moment of
 * the beat to image them; without, the resting normal heart.
 */
export function acquire(pose: Pose, depth: number, patient: { heart: EchoHeart; frame: EchoFrame } = { heart: NORMAL_HEART, frame: stillFrame() }, s: ScanSettings = {}): Polar {
  const NL = s.lines ?? BEAM.lines, dr = s.dr ?? BEAM.dr, NS = Math.max(8, Math.round(depth / dr));
  const win = s.window ?? "parasternal", frameNo = s.frameNo ?? 0, gainLin = Math.pow(10, (s.gain ?? 0) / 20);
  const n = NL * NS, half = SECTOR.halfAngle;
  const echo = new Float32Array(n), z = new Float32Array(n), att = new Float32Array(n);
  const tissue = new Uint8Array(n), part = new Int8Array(n).fill(-1), sdfOf = new Float32Array(n), patch = new Float32Array(n);
  const re = new Float32Array(n), im = new Float32Array(n), re2 = new Float32Array(n), im2 = new Float32Array(n);
  const hit: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] };
  const sc: [number, number] = [0, 0], pt: V3 = [0, 0, 0];
  const chest = CHEST[win];

  // 1-2: classify every sample, give it acoustic properties and its scatterers
  for (let l = 0; l < NL; l++) {
    const a = -half + (2 * half * (l + 0.5)) / NL, ca = Math.cos(a), sa = Math.sin(a);
    const dir: V3 = [pose.beam[0] * ca + pose.lateral[0] * sa, pose.beam[1] * ca + pose.lateral[1] * sa, pose.beam[2] * ca + pose.lateral[2] * sa];
    let firstHeart = -1;
    for (let j = 0; j < NS; j++) {
      const r = (j + 0.5) * dr, i = j * NL + l;
      pt[0] = pose.probe[0] + dir[0] * r; pt[1] = pose.probe[1] + dir[1] * r; pt[2] = pose.probe[2] + dir[2] * r;
      classifyFrame(toHeart(pt), patient.heart, patient.frame, hit);
      tissue[i] = hit.tissue; part[i] = hit.part ?? -1; sdfOf[i] = hit.sdf;
      if (hit.tissue !== Tissue.Outside && firstHeart < 0) firstHeart = j;
      const ac = acousticOf(hit.tissue);
      echo[i] = ac.echo; z[i] = ac.z; att[i] = ac.att;
      patch[i] = patchiness(hit.tissue === Tissue.Outside ? pt : hit.ref);
      // tissue speckle is fixed to the material point; blood's moves with the flow (new every frame); the chest stays still
      const where = hit.tissue === Tissue.Outside ? pt : hit.ref;
      const seed = hit.tissue === Tissue.Blood || hit.tissue === Tissue.Fluid ? 17 + frameNo * 31 : hit.tissue === Tissue.Outside ? 5 : 3;
      scatter(where, seed, sc); re[i] = sc[0]; im[i] = sc[1];
      scatter(where, seed + 1000, sc); re2[i] = sc[0]; im2[i] = sc[1]; // a second band of the pulse: frequency compounding
    }
    // Outside the heart along this line. In front of it: the chest wall, then (subcostal) liver and diaphragm, or (from the chest) a thin
    // layer of fat where the heart lies against the chest wall and lung where it does not. Behind it: mediastinal tissue close behind the
    // pericardium, lung further out. A line that misses the heart crosses only lung, which is why the sector's edges go dark.
    const stop = firstHeart < 0 ? NS : firstHeart;
    // the chest-wall layers follow the skin but not at exact depths: each boundary wanders smoothly across the sector, so they are not
    // perfect arcs around the probe
    const u = l / NL, wob = (k: number, mm: number) => mm * (lumpy([u * 60, k * 13, 3]) - 0.5) * 2;
    const fatEnd = chest * 0.42 + wob(1, 1.6), wallEnd = chest + wob(2, 2.4);
    for (let j = 0; j < NS; j++) {
      const r = (j + 0.5) * dr, i = j * NL + l;
      if (j >= stop && tissue[i] !== Tissue.Outside) continue;
      let ac: Acoustic;
      if (win === "tee" && j < stop) ac = r < 1.2 ? ACOUSTIC.skin : r < chest ? ACOUSTIC.muscle : { echo: 0.35, z: 1.0, att: 1.2 }; // esophageal wall, then mediastinal fat
      else if (r < 1.6) ac = ACOUSTIC.skin;
      else if (r < fatEnd) ac = ACOUSTIC.fat;
      else if (r < wallEnd) ac = ACOUSTIC.muscle;
      else if (j < stop) {
        if (win === "subcostal") ac = firstHeart >= 0 && r > firstHeart * dr - 3.5 ? ACOUSTIC.diaphragm : ACOUSTIC.liver;
        else if (firstHeart >= 0 && firstHeart * dr - r < FAT_PAD) ac = { echo: 0.28, z: 0.97, att: 1.1 }; // epicardial and mediastinal fat
        else ac = r - chest < 1.2 ? ACOUSTIC.pleura : ACOUSTIC.lung;
      } else {
        // behind the heart: mediastinal tissue that gives way to lung over about a centimeter, at an irregular distance
        const edge = BEHIND * (0.55 + 0.9 * lumpy(pt0(pose, dir, r))), w = Math.min(1, Math.max(0, (sdfOf[i] - edge + 6) / 12));
        const m = ACOUSTIC.mediastinum, g = ACOUSTIC.lung;
        ac = { echo: m.echo + (g.echo - m.echo) * w, z: m.z + (0.85 - m.z) * w, att: m.att + (g.att * 0.35 - m.att) * w * w };
      }
      echo[i] = ac.echo; z[i] = ac.z; att[i] = ac.att;
    }
    // muscle fascia: a few bright, broken planes roughly parallel to the skin
    for (let j = 0; j < stop; j++) {
      const r = (j + 0.5) * dr + wob(3, 0.9);
      if (r > fatEnd && r < wallEnd && Math.abs(((r - fatEnd) % 3.2) - 1.6) < 0.25 && lumpy([u * 90, r * 2, 7]) > 0.35) echo[j * NL + l] *= 1.9;
    }
  }

  // Real tissue is not one even gray: echogenicity varies with fiber direction and make-up, by a few dB over several millimeters.
  // Blood, fluid and lung are left alone (they have no structure to vary).
  const smoke = Math.max(0, Math.min(1, s.smoke ?? 0));
  for (let i = 0; i < n; i++) {
    const t = tissue[i];
    if (t === Tissue.Blood && smoke > 0) { echo[i] *= 1 + 3.5 * smoke * (0.5 + 0.5 * patch[i]); continue; } // swirls, not an even fog
    if (t === Tissue.Blood || t === Tissue.Fluid || echo[i] < 0.1) continue;
    echo[i] *= Math.exp(BEAM.patchiness * patch[i]);
  }

  // 3: the point spread function convolves the backscatter-weighted scatterers: along each line, then across lines with a width that
  // depends on depth. The result is fully developed speckle whose mean intensity follows backscatter squared.
  // Two independent scatterer realizations stand for two frequency bands of the pulse; their intensities are averaged below
  // (frequency compounding), which fills the dark nulls of single-band speckle the way a cardiac scanner's processing does.
  const ka = kernel(BEAM.axial / dr), dTheta = (2 * half) / NL;
  for (const [fr, fi] of [[re, im], [re2, im2]] as const) {
    for (let i = 0; i < n; i++) { fr[i] *= echo[i]; fi[i] *= echo[i]; }
    conv1(fr, NL, NS, ka, true); conv1(fi, NL, NS, ka, true);
    for (let j = 0; j < NS; j++) {
      const r = (j + 0.5) * dr, sigmaMm = Math.hypot(BEAM.lateral, BEAM.spread * (r - BEAM.focus)) + 0.006 * r;
      const k = kernel(sigmaMm / Math.max(0.05, r * dTheta));
      convRow(fr, NL, j, k); convRow(fi, NL, j, k);
    }
  }

  // 4: specular echoes from impedance steps along the beam, blurred by the same beam across
  const zs = new Float32Array(z);
  conv1(zs, NL, NS, kernel(0.35 / dr), true, true);
  const spec = new Float32Array(n);
  for (let j = 1; j < NS - 1; j++) for (let l = 0; l < NL; l++) {
    const i = j * NL + l, dz = (zs[i + NL] - zs[i - NL]) / (2 * dr);
    // even a tissue-air boundary returns a bounded echo; along a wall the border's strength varies, as a real endocardium's does
    spec[i] = 2.2 * Math.tanh((BEAM.specular / 2.2) * Math.abs(dz)) * (0.55 + 0.45 * (0.5 + 0.5 * patch[i]));
  }
  for (let j = 0; j < NS; j++) {
    const r = (j + 0.5) * dr, sigmaMm = Math.hypot(BEAM.lateral, BEAM.spread * (r - BEAM.focus));
    convRow(spec, NL, j, kernel(sigmaMm / Math.max(0.05, r * dTheta)), true);
  }

  // 5-6: envelope, attenuation and TGC down each line, clutter, reverberation, noise
  const env = new Float32Array(n);
  for (let l = 0; l < NL; l++) {
    let loss = 0; // dB, two-way, accumulated
    for (let j = 0; j < NS; j++) {
      const i = j * NL + l, r = (j + 0.5) * dr;
      loss += 2 * att[i] * (dr / 10);
      const t = Math.pow(10, (-loss + tgcDb(r)) / 20);
      const a = re[i] + spec[i], b = im[i], a2 = re2[i] + spec[i], b2 = im2[i];
      env[i] = Math.sqrt(0.5 * (a * a + b * b + a2 * a2 + b2 * b2)) * t;
    }
  }
  // side-lobe haze: a wide lateral blur of the intensity, added back faintly (fills cavities next to bright walls)
  {
    const inten = new Float32Array(n); for (let i = 0; i < n; i++) inten[i] = env[i] * env[i];
    for (let j = 0; j < NS; j++) { const r = (j + 0.5) * dr; convRow(inten, NL, j, kernel(BEAM.hazeWidth / Math.max(0.05, r * dTheta)), true); }
    for (let i = 0; i < n; i++) env[i] = Math.sqrt(env[i] * env[i] + BEAM.haze * inten[i]);
  }
  for (let l = 0; l < NL; l++) {
    // Reverberation: the strongest interface in the chest wall bounces between itself and the transducer, so a thin copy of it appears
    // at two and three times its depth (fainter each time). It is the interface that repeats, not the whole near field.
    const wallEnd = Math.min(NS - 2, Math.round((chest + 3) / dr));
    let jb = 2, best = 0;
    for (let j = 2; j < wallEnd; j++) { const v = env[j * NL + l]; if (v > best) { best = v; jb = j; } }
    const halfW = Math.max(1, Math.round(0.8 / dr));
    for (let j = 0; j < NS; j++) {
      const i = j * NL + l, r = (j + 0.5) * dr;
      let v = env[i];
      for (const [m, g] of [[2, 0.22], [3, 0.08]] as const) {
        const off = j - m * jb;
        if (Math.abs(off) <= halfW) v += g * env[(jb + Math.round(off / m)) * NL + l] * (1 - Math.abs(off) / (halfW + 1));
      }
      // near-field clutter: not an even haze but broken bands at fixed depths (the transducer face and chest-wall layers ringing),
      // patchy across the sector and flickering a little from frame to frame
      if (r < BEAM.clutterMm) {
        const q = 1 - r / BEAM.clutterMm, band = Math.max(0, gauss(0, (r / 2.4) | 0, 0, 78)), patchy = Math.max(0, 0.4 + gauss(l >> 3, (r / 6) | 0, 0, 79));
        v += BEAM.clutter * q * q * band * patchy * (0.7 + 0.3 * Math.abs(gauss(l, j, frameNo, 77)));
      }
      v += BEAM.noise * Math.pow(10, tgcDb(r) / 20) * Math.abs(gauss(l, j >> 1, frameNo, 41));
      env[i] = v * gainLin;
    }
  }

  // 7: log compression to the display range; lines at the sector's edge are a little weaker (aperture apodization)
  const img = new Float32Array(n), top = BEAM.ceiling;
  for (let j = 0; j < NS; j++) for (let l = 0; l < NL; l++) {
    const i = j * NL + l, edge = Math.min(l, NL - 1 - l) / 6, apod = edge < 1 ? 0.5 + 0.5 * edge : 1;
    const db = 20 * Math.log10(Math.max(1e-6, env[i] * apod));
    const u = (db - (top - BEAM.range)) / BEAM.range;
    img[i] = Math.max(0, Math.min(1, u));
  }
  return { lines: NL, samples: NS, depth, dr, img, tissue, part };
}

/** Convolve every column (one scan line, along the beam) of a lines-by-samples grid with a 1D kernel. `mean` normalizes to unit sum. */
function conv1(a: Float32Array, NL: number, NS: number, k: Float32Array, clamp: boolean, mean = false) {
  const r = (k.length - 1) >> 1, col = new Float32Array(NS);
  let ks = 0; for (const v of k) ks += v;
  const norm = mean ? 1 / ks : 1;
  for (let l = 0; l < NL; l++) {
    for (let j = 0; j < NS; j++) col[j] = a[j * NL + l];
    for (let j = 0; j < NS; j++) {
      let s = 0;
      for (let t = -r; t <= r; t++) { let jj = j + t; if (jj < 0 || jj >= NS) { if (!clamp) continue; jj = Math.min(NS - 1, Math.max(0, jj)); } s += k[t + r] * col[jj]; }
      a[j * NL + l] = s * norm;
    }
  }
}
/** Convolve one row (one depth, across lines). `mean` normalizes to unit sum. */
function convRow(a: Float32Array, NL: number, j: number, k: Float32Array, mean = false) {
  const r = (k.length - 1) >> 1, row = a.slice(j * NL, (j + 1) * NL);
  let ks = 0; for (const v of k) ks += v;
  const norm = mean ? 1 / ks : 1;
  for (let l = 0; l < NL; l++) {
    let s = 0;
    for (let t = -r; t <= r; t++) { const ll = Math.min(NL - 1, Math.max(0, l + t)); s += k[t + r] * row[ll]; }
    a[j * NL + l] = s * norm;
  }
}

/** Gray curve of the display: a gentle S that keeps blood black and lifts mid-gray tissue. */
export const grayMap = (u: number) => { const x = Math.max(0, Math.min(1, u)); return 255 * Math.pow(x, 1.35) * (1.15 - 0.15 * x); };

/**
 * Scan-convert a polar frame to a w-by-h picture with the probe at the top center, `pxPerMm` pixels per millimeter, black outside the
 * sector. Bilinear between lines and samples. Returns gray values 0..255 (one byte per pixel).
 */
export function scanConvert(p: Polar, w: number, h: number, pxPerMm: number, out = new Uint8Array(w * h)): Uint8Array {
  const half = SECTOR.halfAngle, NL = p.lines, NS = p.samples, cx = w / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lat = (x + 0.5 - cx) / pxPerMm, d = (y + 0.5) / pxPerMm, r = Math.hypot(lat, d), a = Math.atan2(lat, d);
    const o = y * w + x;
    if (r >= p.depth || Math.abs(a) > half) { out[o] = 0; continue; }
    const lf = ((a + half) / (2 * half)) * NL - 0.5, sf = r / p.dr - 0.5;
    const l0 = Math.max(0, Math.min(NL - 2, Math.floor(lf))), s0 = Math.max(0, Math.min(NS - 2, Math.floor(sf)));
    const fl = Math.max(0, Math.min(1, lf - l0)), fs = Math.max(0, Math.min(1, sf - s0)), i = s0 * NL + l0;
    const v = (p.img[i] * (1 - fl) + p.img[i + 1] * fl) * (1 - fs) + (p.img[i + NL] * (1 - fl) + p.img[i + NL + 1] * fl) * fs;
    out[o] = grayMap(v);
  }
  return out;
}
