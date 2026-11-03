export interface Palette {
  ink: string;
  muted: string;
  accent: string;
  down: string;
  ok: string;
  warn: string;
  bad: string;
  stage: string;
  o2: string;
}

export const FONT_UI = "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif";
export const FONT_DATA = "JetBrains Mono, ui-monospace, Menlo, Consolas, monospace";

export function palette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    ink: g("--ink", "#f4f1ea"),
    muted: g("--muted", "#98a0b8"),
    accent: g("--accent", "#b8372e"),
    down: g("--down", "#3d8bff"),
    ok: g("--ok", "#c9c6bd"),
    warn: g("--warn", "#e0a447"),
    bad: g("--bad", "#ff6b5e"),
    stage: g("--stage", "#000000"),
    o2: g("--o2", g("--down", "#3d8bff")),
  };
}

export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 420;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Flat stage wash. Depth comes from the room/stage tokens, not a decorative glow. */
export function wash(ctx: CanvasRenderingContext2D, w: number, h: number, stage: string) {
  ctx.fillStyle = stage;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.45, h * 0.38, 12, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
  g.addColorStop(0, "#17181d");
  g.addColorStop(1, stage);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
