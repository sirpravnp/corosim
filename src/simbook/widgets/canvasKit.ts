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

export function palette(el: HTMLElement): Palette {
  const s = getComputedStyle(el);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    ink: g("--ink", "#f3f0ea"),
    muted: g("--muted", "#9aa3b8"),
    accent: g("--accent", "#e24b3c"),
    down: g("--down", "#6aa7ff"),
    ok: g("--ok", "#6dcaa0"),
    warn: g("--warn", "#e0a447"),
    bad: g("--bad", "#ff6b5e"),
    stage: g("--stage", "#0a0c12"),
    o2: g("--o2", "#7fd4ff"),
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

export function wash(ctx: CanvasRenderingContext2D, w: number, h: number, stage: string) {
  const g = ctx.createRadialGradient(w * 0.45, h * 0.4, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
  g.addColorStop(0, "#161a24");
  g.addColorStop(1, stage);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
