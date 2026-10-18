// The game's front door: the homepage's stippled heart behind the card. It settles once (drawn out over about a second,
// or all at once under reduced motion) and then stands still: no cursor stirring, since the card is what is clicked.
import { Placement, Stipple, draw, fieldFromLogo } from "./stipple";

const MAX_STEPS = 90, SETTLED = 0.05, OMEGA = 0.5; // as on the homepage (home.ts)

/** The heart for `canvas`, stippled from `logo`. Returns `show`, to call whenever the canvas comes into view: the first
 *  call builds and settles the dots, later ones redraw them at the current size and finish any settling left over. */
export function gateArt(canvas: HTMLCanvasElement, logo: HTMLImageElement): () => void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shown = () => !canvas.closest("[hidden]");
  let st: Stipple | null = null, running = false, settled = false;
  const ctx = canvas.getContext("2d")!;
  /** The heart centered behind the card: most of the height on a wide screen, most of the width on a tall one. */
  const paint = () => {
    if (!st) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const b = st.field.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0, tall = innerHeight > innerWidth;
    const s = Math.min((tall ? 0.7 : 0.88) * h / bh, 0.94 * w / bw);
    const at: Placement = { s, ox: w / 2 - ((b.x0 + b.x1) / 2) * s, oy: h / 2 - ((b.y0 + b.y1) / 2) * s };
    draw(ctx, st, w, h, at, 0.95);
  };
  const step = (omega: number) => { settled = st!.step(omega) < SETTLED || st!.iterations >= MAX_STEPS; };
  // Animated: a partial Lloyd step a frame, drawn, until settled or the gate closes (show() picks it up again).
  const frame = () => {
    if (!shown()) { running = false; return; }
    step(OMEGA); paint();
    if (settled) running = false; else requestAnimationFrame(frame);
  };
  // Reduced motion: relax in chunks that leave the page responsive, and draw once, settled.
  const chunk = () => {
    const t0 = performance.now();
    while (!settled && performance.now() - t0 < 24) step(1);
    if (settled) { running = false; paint(); } else requestAnimationFrame(chunk);
  };
  const resume = () => {
    if (settled || !reduced) paint();
    if (settled || running) return;
    running = true;
    requestAnimationFrame(reduced ? chunk : frame);
  };
  let started = false;
  addEventListener("resize", () => { if (shown()) paint(); });
  return () => {
    if (started) return resume();
    started = true;
    logo.decode().then(() => {
      // The point budget follows the screen, as on the homepage: about 3 500 dots on a phone, 7 000 on a desktop.
      const short = Math.min(innerWidth, innerHeight) || 360;
      const n = short < 480 ? 320 : 400;
      st = new Stipple(fieldFromLogo(logo, n), Math.round(Math.min(7000, Math.max(3000, short * 9))));
      if (shown()) resume();
    }).catch(() => {}); // without the logo the door is plain black
  };
}
