import { defaultDiffusion, DiffusionParams, DiffusionSample, o2Profile } from "../diffusion";
import { fitCanvas, palette, wash } from "./canvasKit";

function at(sample: DiffusionSample, xUm: number): number {
  const L = sample.effectiveThicknessUm || 1;
  const t = Math.min(1, Math.max(0, xUm / L));
  const i = t * (sample.conc.length - 1);
  const i0 = Math.floor(i);
  const i1 = Math.min(sample.conc.length - 1, i0 + 1);
  const f = i - i0;
  return sample.conc[i0]! * (1 - f) + sample.conc[i1]! * f;
}

export class DiffusionWidget {
  private params: DiffusionParams = defaultDiffusion();
  private anim = 0;
  private readonly axisUm = 480;

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
  ) {
    this.buildControls();
    this.updateReadout();
    this.draw();
  }

  tick(dt: number) {
    this.anim += dt;
    this.draw();
  }

  private buildControls() {
    this.controls.innerHTML = `
      <label><span>Tissue thickness</span>
        <input type="range" id="sb-th" min="60" max="320" step="5" value="${this.params.thicknessUm}">
        <output id="sb-thv">${this.params.thicknessUm} µm</output></label>
      <label><span>Capillary density</span>
        <input type="range" id="sb-den" min="0.4" max="2.5" step="0.05" value="${this.params.density}">
        <output id="sb-denv">${this.params.density.toFixed(2)}×</output></label>
      <label><span>Metabolic rate</span>
        <input type="range" id="sb-met" min="0.4" max="2.5" step="0.05" value="${this.params.consumption}">
        <output id="sb-metv">${this.params.consumption.toFixed(2)}×</output></label>
      <label class="sb-chk"><input type="checkbox" id="sb-flow" ${this.params.flowOn ? "checked" : ""}> Capillary flow on</label>
      <p class="sb-lock">The slab width is the real diffusion distance. Density shortens it; metabolism eats the profile.</p>`;
    this.controls.querySelector("#sb-th")!.addEventListener("input", (e) => {
      this.params.thicknessUm = +(e.target as HTMLInputElement).value;
      this.updateReadout();
    });
    this.controls.querySelector("#sb-den")!.addEventListener("input", (e) => {
      this.params.density = +(e.target as HTMLInputElement).value;
      this.updateReadout();
    });
    this.controls.querySelector("#sb-met")!.addEventListener("input", (e) => {
      this.params.consumption = +(e.target as HTMLInputElement).value;
      this.updateReadout();
    });
    this.controls.querySelector("#sb-flow")!.addEventListener("change", (e) => {
      this.params.flowOn = (e.target as HTMLInputElement).checked;
      this.updateReadout();
    });
  }

  private updateReadout() {
    const th = this.controls.querySelector("output#sb-thv");
    const den = this.controls.querySelector("output#sb-denv");
    const met = this.controls.querySelector("output#sb-metv");
    if (th) th.textContent = `${this.params.thicknessUm} µm`;
    if (den) den.textContent = `${this.params.density.toFixed(2)}×`;
    if (met) met.textContent = `${this.params.consumption.toFixed(2)}×`;
    const sample = o2Profile(this.params);
    const anox = sample.anoxicDepthUm;
    const doubled = o2Profile({ ...this.params, thicknessUm: this.params.thicknessUm * 2 });
    this.readout.innerHTML = `
      <dl class="sb-meas">
        <div><dt>Capillary O₂</dt><dd>${sample.capConc.toFixed(2)}</dd></div>
        <div><dt>Path</dt><dd>${sample.effectiveThicknessUm.toFixed(0)} µm</dd></div>
        <div><dt>Anoxic at</dt><dd>${anox == null ? "none" : `${anox.toFixed(0)} µm`}</dd></div>
        <div><dt>t ≈ x²/2D</dt><dd>${sample.diffusionTimeS.toFixed(2)} s</dd></div>
      </dl>
      <p class="sb-note">${anox == null ? "Oxygen reaches the core." : "The core past the dashed line is anoxic."} Doubling thickness would make the same path take ${doubled.diffusionTimeS.toFixed(1)} s.</p>`;
  }

  private draw() {
    const sample = o2Profile(this.params);
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const padL = 78;
    const padR = 28;
    const top = 48;
    const slabH = h - 108;
    const track = w - padL - padR;
    const L = sample.effectiveThicknessUm;
    const slabW = Math.max(24, (L / this.axisUm) * track);

    ctx.fillStyle = "#1a1014";
    ctx.fillRect(padL, top, slabW, slabH);

    const cols = Math.max(24, Math.round(slabW));
    const maxC = Math.max(sample.capConc, 0.2);
    for (let i = 0; i < cols; i++) {
      const xUm = (L * (i + 0.5)) / cols;
      const o2 = at(sample, xUm) / maxC;
      const dead = o2 < 0.04;
      ctx.fillStyle = dead
        ? "#3a1820"
        : `rgb(${Math.round(48 + 90 * o2)}, ${Math.round(24 + 150 * o2)}, ${Math.round(36 + 190 * o2)})`;
      ctx.fillRect(padL + (i * slabW) / cols, top, slabW / cols + 1, slabH);
    }

    const cellRows = 5;
    const cellCols = Math.max(3, Math.round(slabW / 36));
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const xUm = (L * (col + 0.5)) / cellCols;
        const o2 = at(sample, xUm) / maxC;
        const cx = padL + ((col + 0.5) / cellCols) * slabW;
        const cy = top + ((row + 0.5) / cellRows) * slabH;
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = o2 < 0.05 ? c.bad : `rgba(190, 230, 255, ${0.25 + 0.6 * o2})`;
        ctx.fill();
      }
    }

    ctx.fillStyle = this.params.flowOn ? c.accent : "#5a3034";
    round(ctx, padL - 22, top, 22, slabH, 8);
    ctx.fill();
    const dots = 10;
    for (let i = 0; i < dots; i++) {
      const speed = this.params.flowOn ? 0.35 : 0;
      const u = (i / dots + this.anim * speed) % 1;
      ctx.beginPath();
      ctx.arc(padL - 11, top + 10 + u * (slabH - 20), 2.4, 0, Math.PI * 2);
      ctx.fillStyle = this.params.flowOn ? "#ffe8e4" : "#8a6064";
      ctx.fill();
    }

    if (sample.anoxicDepthUm != null && sample.anoxicDepthUm < L - 1) {
      const ax = padL + (sample.anoxicDepthUm / L) * slabW;
      ctx.strokeStyle = c.bad;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, top);
      ctx.lineTo(ax, top + slabH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = "#ffffffcc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    sample.xUm.forEach((x, i) => {
      const px = padL + (x / L) * slabW;
      const py = top + 16 + (1 - sample.conc[i]! / maxC) * (slabH - 32);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.fillStyle = c.muted;
    ctx.font = "12px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText("Capillary", 16, top + 16);
    ctx.fillText("0", padL, h - 18);
    ctx.fillText(`${Math.round(L)} µm`, padL + slabW - 28, h - 18);
    ctx.fillText(`${this.axisUm} µm scale`, padL + track - 88, h - 18);
    ctx.fillStyle = c.ink;
    ctx.font = "600 13px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText("Oxygen across the slab", padL, 28);
  }
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
