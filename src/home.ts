// The homepage: the thermogram fills the page, settles on load and stands still; a cursor over it stirs the dots,
// which flow back. The title and the doors are laid over it (home.css).
import { Placement, Stipple, draw, fieldFromLogo, thermalGradient } from "./stipple";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("art");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hovers = matchMedia("(hover: hover)").matches; // a mouse or pen: a finger would be scrolling
const MAX_STEPS = 90, SETTLED = 0.05; // Lloyd steps, and the largest move (raster px) at which the dots count as settled
const OMEGA = 0.5; // animated: each frame goes halfway to the centroid, so the settling takes about a second to watch
const STIR = { radius: 0.11, push: 2.0, warmth: 0.55 }; // the cursor's reach (fraction of the raster), shove (px per frame) and heat
$("bar").style.background = thermalGradient();

const img = new Image();
img.src = "logo-transparent.png";
img.decode().then(start).catch(() => {});

function start() {
  // The point budget follows the screen: about 3 500 dots on a phone, 7 000 on a desktop, so every device stays smooth.
  const short = Math.min(innerWidth, innerHeight) || 360, dpr = Math.min(devicePixelRatio || 1, 2);
  const count = Math.round(Math.min(7000, Math.max(3000, short * 9)));
  const n = short < 480 ? 320 : 400;
  const field = fieldFromLogo(img, n);
  const st = new Stipple(field, count);
  const ctx = canvas.getContext("2d")!;
  let w = 0, h = 0, at: Placement = { s: 1, ox: 0, oy: 0 };
  /** The heart fitted to the viewport: most of the height on a wide screen, most of the width and a little high on a
   *  tall one, where the doors sit along the bottom. */
  const fit = () => {
    w = Math.round(innerWidth * dpr); h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const b = field.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0, tall = innerHeight > innerWidth;
    const s = Math.min((tall ? 0.62 : 0.84) * h / bh, (tall ? 0.9 : 0.9) * w / bw);
    at = { s, ox: w / 2 - ((b.x0 + b.x1) / 2) * s, oy: (tall ? 0.44 : 0.5) * h - ((b.y0 + b.y1) / 2) * s };
  };
  const paint = () => { fit(); draw(ctx, st, w, h, at, 0.95); };
  addEventListener("resize", paint);

  // Once settled, the cursor stirs the dots: each frame pushes those under it aside and warms them, and a Lloyd step
  // draws everything back toward its cell's centroid, so the disturbance heals behind the pointer.
  const pointer = { x: 0, y: 0, over: false };
  let running = false;
  const stirring = () => {
    if (!running) return;
    if (pointer.over) st.stir(pointer.x, pointer.y, STIR.radius * n, STIR.push, STIR.warmth);
    const moved = st.step(0.4);
    paint();
    if (!pointer.over && moved < SETTLED) { running = false; return; }
    requestAnimationFrame(stirring);
  };
  const wake = () => { if (!running) { running = true; requestAnimationFrame(stirring); } };
  const listen = () => {
    if (!hovers || reduced) return;
    addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      pointer.x = (e.clientX * dpr - at.ox) / at.s; pointer.y = (e.clientY * dpr - at.oy) / at.s; pointer.over = true;
      wake();
    });
    document.addEventListener("pointerleave", () => { pointer.over = false; wake(); });
  };

  let done = false;
  const finish = () => { done = true; st.settle(); paint(); listen(); };
  if (reduced) {
    // No animation: relax in chunks that leave the page responsive, and draw once, settled.
    const chunk = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 24) if (st.step() < SETTLED || st.iterations >= MAX_STEPS) return finish();
      requestAnimationFrame(chunk);
    };
    requestAnimationFrame(chunk);
    return;
  }
  const frame = () => {
    if (done) return;
    const moved = st.step(OMEGA);
    paint();
    if (moved < SETTLED || st.iterations >= MAX_STEPS) finish(); else requestAnimationFrame(frame);
  };
  paint();
  requestAnimationFrame(frame);
}
