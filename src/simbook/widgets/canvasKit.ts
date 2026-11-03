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

/** Flat stage with a faint hairline grid. Depth comes from the stage token, not a glow. */
export function wash(ctx: CanvasRenderingContext2D, w: number, h: number, stage: string) {
  ctx.fillStyle = stage;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(152,160,184,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40.5; x < w; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 40.5; y < h; y += 40) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

const THERMAL: [number, number, number][] = [
  [14, 20, 48], // cold
  [61, 38, 104],
  [140, 44, 92],
  [184, 55, 46], // brick
  [224, 164, 71], // amber
  [244, 241, 234], // bone
];

/** The home thermogram ramp: 0 is cold, 1 is hot. */
export function thermal(t: number): string {
  const u = Math.min(1, Math.max(0, t)) * (THERMAL.length - 1);
  const i = Math.min(THERMAL.length - 2, Math.floor(u));
  const f = u - i;
  const a = THERMAL[i]!, b = THERMAL[i + 1]!;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/** Horizontal thermal legend bar with end labels. */
export function legend(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, lo: string, hi: string, muted: string) {
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = thermal(i / (steps - 1));
    ctx.fillRect(x + (i * w) / steps, y, w / steps + 0.5, 8);
  }
  ctx.strokeStyle = "rgba(152,160,184,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 7);
  ctx.fillStyle = muted;
  ctx.font = `11px ${FONT_UI}`;
  ctx.textAlign = "left";
  ctx.fillText(lo, x, y + 22);
  ctx.textAlign = "right";
  ctx.fillText(hi, x + w, y + 22);
  ctx.textAlign = "left";
}

/** Left axis with tick labels; returns a mapper from value to y. */
export function axisY(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, lo: number, hi: number, ticks: number[], muted: string, fmt: (v: number) => string = String) {
  const map = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  ctx.strokeStyle = "rgba(152,160,184,0.45)";
  ctx.fillStyle = muted;
  ctx.font = `11px ${FONT_DATA}`;
  ctx.textAlign = "right";
  ctx.lineWidth = 1;
  for (const v of ticks) {
    const y = Math.round(map(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillText(fmt(v), x - 8, y + 4);
  }
  ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, bottom); ctx.stroke();
  ctx.textAlign = "left";
  return map;
}

/** Bottom axis with tick labels at the given values. */
export function axisX(ctx: CanvasRenderingContext2D, y: number, left: number, right: number, lo: number, hi: number, ticks: number[], muted: string, fmt: (v: number) => string = String) {
  const map = (v: number) => left + ((v - lo) / (hi - lo)) * (right - left);
  ctx.strokeStyle = "rgba(152,160,184,0.45)";
  ctx.fillStyle = muted;
  ctx.font = `11px ${FONT_DATA}`;
  ctx.textAlign = "center";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, y + 0.5); ctx.lineTo(right, y + 0.5); ctx.stroke();
  for (const v of ticks) {
    const x = Math.round(map(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 4); ctx.stroke();
    ctx.fillText(fmt(v), x, y + 17);
  }
  ctx.textAlign = "left";
  return map;
}
