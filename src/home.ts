// The homepage: the thermogram settles on load and stands still; a cursor over it stirs the dots, which flow back.
import { Stipple, draw, fieldFromLogo, thermalGradient } from "./stipple";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("art"), tag = $("tag");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hovers = matchMedia("(hover: hover)").matches; // a mouse or pen: a finger would be scrolling
const MAX_STEPS = 90, SETTLED = 0.05; // Lloyd steps, and the largest move (raster px) at which the dots count as settled
const OMEGA = 0.5; // animated: each frame goes halfway to the centroid, so the settling takes about a second to watch
const STIR = { radius: 0.11, push: 2.0, warmth: 0.55 }; // the cursor's reach (fraction of the raster), shove (px per frame) and heat
$("bar").style.background = thermalGradient();

const img = new Image();
img.src = "logo-transparent.png";
img.decode().then(start).catch(() => { tag.textContent = ""; });

function start() {
  // The point budget follows the screen: about 3 000 dots on a phone, 6 500 on a desktop, so every device stays smooth.
  const css = canvas.clientWidth || 360, dpr = Math.min(devicePixelRatio || 1, 2);
  const count = Math.round(Math.min(7000, Math.max(3000, css * 9)));
  const n = css < 480 ? 320 : 400;
  const field = fieldFromLogo(img, n);
  const st = new Stipple(field, count);
  const ctx = canvas.getContext("2d")!;
  let size = 0;
  const fit = () => { size = Math.round(canvas.clientWidth * dpr); if (canvas.width !== size) canvas.width = canvas.height = size; };
  const paint = () => { fit(); draw(ctx, st, size, 0.95); };
  const label = (state: string) => { tag.innerHTML = `${count.toLocaleString("en")} points · <span class="wide">weighted voronoi · </span>${state}`; };
  new ResizeObserver(paint).observe(canvas);

  // Once settled, the cursor stirs the dots: each frame pushes those under it aside and warms them, and a Lloyd step
  // draws everything back toward its cell's centroid, so the disturbance heals behind the pointer.
  const pointer = { x: 0, y: 0, over: false };
  let running = false;
  const stirring = () => {
    if (!running) return;
    if (pointer.over) st.stir(pointer.x, pointer.y, STIR.radius * n, STIR.push, STIR.warmth);
    const moved = st.step(0.4);
    paint();
    if (!pointer.over && moved < SETTLED) { running = false; label(hovers ? "settled · stir with the cursor" : "settled"); return; }
    requestAnimationFrame(stirring);
  };
  const wake = () => { if (!running) { running = true; label("stirred"); requestAnimationFrame(stirring); } };
  const listen = () => {
    if (!hovers || reduced) return;
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * n; pointer.y = ((e.clientY - r.top) / r.height) * n; pointer.over = true;
      wake();
    });
    canvas.addEventListener("pointerleave", () => { pointer.over = false; wake(); });
  };

  let done = false;
  const finish = () => { done = true; st.settle(); paint(); label(`settled in ${st.iterations} steps${hovers && !reduced ? " · stir with the cursor" : ""}`); listen(); };
  if (reduced) {
    // No animation: relax in chunks that leave the page responsive, and draw once, settled.
    label("relaxing");
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
    paint(); label("relaxing");
    if (moved < SETTLED || st.iterations >= MAX_STEPS) finish(); else requestAnimationFrame(frame);
  };
  paint(); label("relaxing");
  requestAnimationFrame(frame);
}
