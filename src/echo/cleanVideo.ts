/**
 * Plays an echo loop with everything but the ultrasound picture removed. The sources are teaching loops with an ECG trace, text, a depth scale,
 * tick marks, an index marker and a watermark drawn around and beside the sector. Each frame is cropped to the sector's bounding box, everything
 * outside the sector (a wedge from the apex, cut off at a radius) is painted black, and saturated pixels inside it (the yellow markers) are
 * blacked out. The ultrasound itself is grayscale, so it is untouched.
 */
export interface CleanSpec {
  /** Crop in source pixels: x, y, width, height. */
  crop: [number, number, number, number];
  /** Sector apex in source pixels, the angle of the wedge's left and right edges from straight down in degrees, and its radius in source pixels. */
  apex: [number, number];
  half: [number, number];
  radius: number;
}

const SATURATION = 28;

export function sectorMask(spec: CleanSpec): Uint8Array {
  const [cx, cy, w, h] = spec.crop, tl = Math.tan((spec.half[0] * Math.PI) / 180), tr = Math.tan((spec.half[1] * Math.PI) / 180), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = cx + x - spec.apex[0], dy = cy + y - spec.apex[1];
    m[y * w + x] = dy > 0 && -dx <= dy * tl && dx <= dy * tr && Math.hypot(dx, dy) <= spec.radius ? 1 : 0;
  }
  return m;
}

/** Start the loop in `canvas`; it stops by itself once the canvas leaves the page. Returns the hidden video element. */
export function playClean(canvas: HTMLCanvasElement, src: string, spec: CleanSpec): HTMLVideoElement {
  const [cx, cy, w, h] = spec.crop, mask = sectorMask(spec);
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const v = document.createElement("video");
  v.src = src; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
  const draw = () => {
    if (!canvas.isConnected) { v.pause(); v.removeAttribute("src"); v.load(); return; }
    g.drawImage(v, cx, cy, w, h, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4, r = d[o], gr = d[o + 1], b = d[o + 2];
      if (!mask[i] || Math.max(r, gr, b) - Math.min(r, gr, b) > SATURATION) { d[o] = d[o + 1] = d[o + 2] = 0; }
    }
    g.putImageData(img, 0, 0);
    if ("requestVideoFrameCallback" in v) (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): void }).requestVideoFrameCallback(draw);
    else requestAnimationFrame(draw);
  };
  v.addEventListener("loadeddata", draw, { once: true });
  void v.play().catch(() => undefined);
  return v;
}
