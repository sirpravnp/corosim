/**
 * Fluoro field behind the angiogram. A real cine is processed frame by frame into a vessel-free loop
 * (ribs, diaphragm, heart border); the page then draws this patient's tree on top. Until that loop
 * loads, and if it fails, a static synthetic field is used instead.
 */

/** Open cine the bake reads. Attribution stays with every use of the baked loop. */
export const FLUORO_SOURCE = {
  commonsFile: "Coronarographie.gif",
  url: "https://upload.wikimedia.org/wikipedia/commons/9/9b/Coronarographie.gif",
  author: "Alextogus",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  page: "https://commons.wikimedia.org/wiki/File:Coronarographie.gif",
  /** What the baked loop is, shown under the angiogram. */
  note: "Ribs and diaphragm from a teaching cine, processed frame by frame with the contrast stripped; the tree is this patient's.",
} as const;

/** Size and timing of the baked loop in `src/cath/media/fluoro.webm`. */
export const FLUORO_BAKE = {
  w: 320,
  h: 320,
  fps: 5,
  /** VP9 constant quality; 30 is about 200 KB for this loop. */
  crf: 30,
  /** Circular collimator, as a fraction of half the short side. Matches the synthetic field. */
  radius: 0.47,
  /** Breathing cycles packed into the loop (about 12 breaths/min at 5 fps × 52 frames). */
  breaths: 2,
  /** Vertical shift of the field at peak inspiration, pixels at bake size. */
  amp: 5,
} as const;

export const FLUORO_CLIP = {
  w: FLUORO_BAKE.w,
  h: FLUORO_BAKE.h,
  fps: FLUORO_BAKE.fps,
} as const;

/** Vite rewrites this for whatever base the site is published under. */
export function fluoroUrl(): string {
  return new URL("./media/fluoro.webm", import.meta.url).href;
}

/** Soft-tissue field the angiogram used before a real cine: lung, spine hint, diaphragm, vignette. */
export function syntheticBackground(W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const X = (i - W / 2) / W, Y = (j - H / 2) / H;
    let b = 0.46 + 0.10 * Math.exp(-((X - 0.05) ** 2 + (Y + 0.05) ** 2) / 0.05) - 0.2 * Math.exp(-((X + 0.34) ** 2) / 0.012) + 0.12 * Math.exp(-((Y - 0.42) ** 2) / 0.02) - 0.08 * Math.exp(-((X - 0.36) ** 2 + (Y - 0.1) ** 2) / 0.04);
    b += 0.05 * Math.sin(Y * 60) * Math.exp(-((X + 0.34) ** 2) / 0.012);
    const rr = Math.hypot(X, Y);
    out[j * W + i] = rr > 0.47 ? 0 : b * (1 - Math.pow(rr / 0.47, 6) * 0.5);
  }
  return out;
}

/** Per-pixel maximum across a cine. Contrast is dark, so this is the empty fluoro field. */
export function temporalMax(frames: Uint8Array[], nPix: number): Uint8Array {
  const mx = new Uint8Array(nPix);
  for (const f of frames) {
    if (f.length !== nPix) throw new Error("frame length");
    for (let k = 0; k < nPix; k++) if (f[k] > mx[k]) mx[k] = f[k];
  }
  return mx;
}

/**
 * Pixels much darker than the temporal max are iodine (or the catheter). Replace them with the
 * empty field, blending the shoulder so grain is not a hard cut.
 */
export function stripVessels(frame: Uint8Array, mx: Uint8Array, thr = 18, blend = 12): Uint8Array {
  const n = frame.length, out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const d = mx[k] - frame[k];
    if (d <= thr) out[k] = frame[k];
    else {
      const t = Math.min(1, (d - thr) / blend);
      out[k] = Math.round(frame[k] * (1 - t) + mx[k] * t);
    }
  }
  return out;
}

/** Shift a field down by `dy` pixels (positive = inspiration). Edge-clamped. */
export function shiftVertical(src: Uint8Array, w: number, h: number, dy: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const s = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - s));
    out.set(src.subarray(sy * w, sy * w + w), y * w);
  }
  return out;
}

/** Two (or `breaths`) sine cycles over `n` frames, in pixels. */
export function breatheShift(i: number, n: number, amp = FLUORO_BAKE.amp, breaths = FLUORO_BAKE.breaths): number {
  if (n <= 0) return 0;
  return Math.round(amp * Math.sin((i / n) * 2 * Math.PI * breaths)) || 0;
}

/** Circular collimator with a soft rim. Pixels outside are 0, as in the synthetic field. */
export function applyCollimator(frame: Uint8Array, w: number, h: number, radius = FLUORO_BAKE.radius): void {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r = Math.min(w, h) * radius, r2 = r * r;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx, d2 = dx * dx + dy * dy, k = y * w + x;
      if (d2 > r2) frame[k] = 0;
      else {
        const v = frame[k] * (1 - Math.pow(Math.sqrt(d2) / r, 6) * 0.5);
        frame[k] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
      }
    }
  }
}

/** Bilinear resize of a grayscale frame. */
export function resizeGray(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return new Uint8Array(src);
  const out = new Uint8Array(dw * dh);
  const sx = sw === 1 ? 0 : (sw - 1) / Math.max(1, dw - 1), sy = sh === 1 ? 0 : (sh - 1) / Math.max(1, dh - 1);
  for (let y = 0; y < dh; y++) {
    const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  return out;
}

/**
 * One cine, processed: temporal-max empty field, a breathing shift per frame, collimator, bake size.
 * `srcW`/`srcH` is the raw ffmpeg gray dump.
 */
export function bakeLoop(raw: Uint8Array, srcW: number, srcH: number, n: number): Uint8Array[] {
  const nPix = srcW * srcH;
  if (raw.length !== nPix * n) throw new Error(`raw length ${raw.length}, expected ${nPix * n}`);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i++) frames.push(raw.subarray(i * nPix, (i + 1) * nPix) as Uint8Array);
  const mx = temporalMax(frames, nPix);
  const { w, h } = FLUORO_BAKE;
  const field = resizeGray(mx, srcW, srcH, w, h);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const fr = shiftVertical(field, w, h, breatheShift(i, n));
    applyCollimator(fr, w, h);
    out.push(fr);
  }
  return out;
}

/** Hidden looping video of the baked field. Pauses when `canvas` leaves the page. */
export function playFluoro(canvas: HTMLCanvasElement, src = fluoroUrl()): HTMLVideoElement {
  const v = document.createElement("video");
  v.src = src;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.autoplay = true;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) v.autoplay = false;
  const watch = () => {
    if (!canvas.isConnected) { v.pause(); v.removeAttribute("src"); v.load(); return; }
    if ("requestVideoFrameCallback" in v) (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): void }).requestVideoFrameCallback(watch);
    else requestAnimationFrame(watch);
  };
  v.addEventListener("loadeddata", () => {
    if (reduce) { v.pause(); v.currentTime = 0; }
    watch();
  }, { once: true });
  void v.play().catch(() => undefined);
  return v;
}
