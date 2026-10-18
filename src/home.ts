// The homepage: a different heart each day, stippled as a thermogram. The dots settle on load and stand still; a cursor
// over them stirs them, and they flow back. The title, the fact and the doors are laid over the picture (home.css).
import { Placement, Stipple, draw, dotsFor, thermalGradient } from "./stipple";
import { fieldFor, usesLogo } from "./specimenArt";
import { specimenFor } from "./specimens";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("art");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hovers = matchMedia("(hover: hover)").matches; // a mouse or pen: a finger would be scrolling
const MAX_STEPS = 90, SETTLED = 0.05; // Lloyd steps, and the largest move (raster px) at which the dots count as settled
const OMEGA = 0.5; // animated: each frame goes halfway to the centroid, so the settling takes about a second to watch
const STIR = { reach: 100, push: 4.5, warmth: 0.55 }; // the cursor's reach and shove per frame (screen px, so the same on every heart) and heat
const DOTS = { min: 3000, max: 8000, perPx2: 0.0415, dot: 0.43 }; // the budget: dots per screen pixel² of density-weighted heart (about 7 000 on the logo heart on a desktop), the caps, and the dot's radius as a share of the dot spacing
$("bar").style.background = thermalGradient();

// ?heart=<id> or ?day=YYYY-MM-DD pick a heart; with neither it is today's.
const sp = specimenFor(location.search);
$("fact-name").textContent = `· ${sp.name}`;
$("fact-text").textContent = sp.fact;
$("fact").hidden = false;
canvas.setAttribute("aria-label", `${sp.name}: a heart as a thermogram, stippled, its vessels hot against the muscle`);

if (usesLogo(sp)) {
  const img = new Image();
  img.src = "logo-transparent.png";
  img.decode().then(() => start(img)).catch(() => {});
} else start(null);

function start(logo: HTMLImageElement | null) {
  const short = Math.min(innerWidth, innerHeight) || 360, dpr = Math.min(devicePixelRatio || 1, 2);
  const n = short < 480 ? 320 : 400;
  const field = fieldFor(sp, n, logo as HTMLImageElement);
  const ctx = canvas.getContext("2d")!;
  let w = 0, h = 0, at: Placement = { s: 1, ox: 0, oy: 0 };
  /** Every heart is fitted to the same stage by its own box. On a wide screen the stage is the space between the title
   *  column and the fact (or half the page, where that is narrower than it should be) by most of the height; on a
   *  narrow one it is the space between the title and the fact. The rule is the same for all of them, so a fish and a
   *  giraffe fill the stage alike. */
  const fit = () => {
    w = Math.round(innerWidth * dpr); h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const b = field.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0, wide = innerWidth >= 820;
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    let top = 0, bottom = h, cx = w / 2, maxW = 0.52 * w, maxH = 0.84 * h;
    if (wide) {
      const left = Math.max(rect(".home-head").right, rect(".doors").right) + 24, right = rect(".fact").left - 24;
      if (right - left >= 0.36 * innerWidth) { cx = ((left + right) / 2) * dpr; maxW = (right - left) * dpr; }
    } else {
      top = (rect(".home-head").bottom + 10) * dpr; bottom = Math.max(top + 120 * dpr, (rect(".fact").top - 10) * dpr); maxW = 0.94 * w; maxH = bottom - top;
    }
    const s = Math.min(maxW / bw, maxH / bh);
    at = { s, ox: cx - ((b.x0 + b.x1) / 2) * s, oy: (top + bottom) / 2 - ((b.y0 + b.y1) / 2) * s };
  };
  const paint = () => { fit(); draw(ctx, st, w, h, at, dotRadius); };
  fit();
  // the point budget: the same dot spacing in every heart, whatever its shape, capped for the device
  const count = Math.round(Math.min(DOTS.max, Math.max(DOTS.min, dotsFor(field, at.s / dpr, DOTS.perPx2))));
  const st = new Stipple(field, count);
  const dotRadius = DOTS.dot * Math.sqrt(field.mass / count); // raster px: the dots grow with the spacing, so a clamped count keeps the look
  canvas.dataset.dots = String(count);
  addEventListener("resize", paint);
  document.fonts?.ready.then(paint);

  // Once settled, the cursor stirs the dots: each frame pushes those under it aside and warms them, and a Lloyd step
  // draws everything back toward its cell's centroid, so the disturbance heals behind the pointer.
  const pointer = { x: 0, y: 0, over: false };
  let running = false;
  const stirring = () => {
    if (!running) return;
    if (pointer.over) { const k = at.s / dpr; st.stir(pointer.x, pointer.y, STIR.reach / k, STIR.push / k, STIR.warmth); } // k: screen px per raster px
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
