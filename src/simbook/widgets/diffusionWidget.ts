import { defaultDiffusion, DiffusionParams, DiffusionSample, o2Profile } from "../diffusion";
import { FONT_UI, axisX, axisY, fitCanvas, legend, palette, thermal, wash } from "./canvasKit";
import { meas, tile } from "./meas";

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
      ${meas(
        tile("Capillary O₂", sample.capConc.toFixed(2)),
        tile("Path", `${sample.effectiveThicknessUm.toFixed(0)} µm`),
        tile("Anoxic at", anox == null ? "none" : `${anox.toFixed(0)} µm`, anox == null ? "" : "bad"),
        tile("t ≈ x²/2D", `${sample.diffusionTimeS.toFixed(2)} s`),
      )}
      <p class="sb-note">${anox == null ? "Oxygen reaches the core." : "Tissue past the dashed line is anoxic."} Doubling thickness would make the same path take ${doubled.diffusionTimeS.toFixed(1)} s.</p>`;
  }

  private draw() {
    const sample = o2Profile(this.params);
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const padL = 70;
    const padR = 28;
    const track = w - padL - padR;
    const L = sample.effectiveThicknessUm;
    const axisUm = Math.max(400, Math.ceil(L / 50) * 50);
    const px = (um: number) => padL + (um / axisUm) * track;
    const slabTop = 44;
    const slabH = 104;
    const plotTop = 188;
    const plotBottom = 292;
    const anox = sample.anoxicDepthUm;

    // Slab heat map: O2 on the thermal ramp (cold is starved).
    const cols = Math.max(24, Math.round(px(L) - padL));
    for (let i = 0; i < cols; i++) {
      const um = (L * (i + 0.5)) / cols;
      ctx.fillStyle = thermal(at(sample, um));
      ctx.fillRect(padL + (i * (px(L) - padL)) / cols, slabTop, (px(L) - padL) / cols + 1, slabH);
    }
    ctx.strokeStyle = "rgba(152,160,184,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, slabTop + 0.5, px(L) - padL, slabH);
    if (anox != null) this.hatch(ctx, px(anox), slabTop, px(L) - px(anox), slabH, c.bad);

    // Capillary face on the left.
    ctx.fillStyle = this.params.flowOn ? c.accent : "#3a2a2e";
    ctx.fillRect(padL - 16, slabTop, 16, slabH);
    const speed = this.params.flowOn ? 0.35 : 0;
    for (let i = 0; i < 6; i++) {
      const u = (i / 6 + this.anim * speed) % 1;
      ctx.fillStyle = this.params.flowOn ? "#f4f1ea" : "#6d5559";
      ctx.fillRect(padL - 10, slabTop + 6 + u * (slabH - 16), 4, 4);
    }
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = "right";
    ctx.fillText("Capillary", padL - 22, slabTop + 14);
    ctx.fillText(this.params.flowOn ? "flow on" : "flow off", padL - 22, slabTop + 28);
    ctx.textAlign = "left";
    ctx.fillStyle = c.ink;
    ctx.font = `600 13px ${FONT_UI}`;
    ctx.fillText("Oxygen across the slab", padL, 28);

    // Profile plot sharing the distance axis.
    const yOf = axisY(ctx, padL, plotTop, plotBottom, 0, 1.05, [0, 0.5, 1], c.muted, (v) => v.toFixed(1));
    const ticks: number[] = [];
    for (let v = 0; v <= axisUm; v += axisUm > 400 ? 100 : 50) ticks.push(v);
    axisX(ctx, plotBottom, padL, padL + track, 0, axisUm, ticks, c.muted, (v) => `${v}`);
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = "right";
    ctx.fillText("Distance from capillary, µm", padL + track, plotBottom + 34);
    ctx.save();
    ctx.translate(14, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("O₂ (rest = 1)", 0, 0);
    ctx.restore();
    ctx.textAlign = "left";

    if (anox != null) this.hatch(ctx, px(anox), plotTop, px(L) - px(anox), plotBottom - plotTop, c.bad);
    ctx.beginPath();
    sample.xUm.forEach((x, i) => {
      const X = px(x), Y = yOf(Math.min(1.05, sample.conc[i]!));
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.lineTo(px(L), plotBottom);
    ctx.lineTo(px(0), plotBottom);
    ctx.closePath();
    ctx.fillStyle = "rgba(224,164,71,0.12)";
    ctx.fill();
    ctx.beginPath();
    sample.xUm.forEach((x, i) => {
      const X = px(x), Y = yOf(Math.min(1.05, sample.conc[i]!));
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (anox != null) {
      ctx.strokeStyle = c.bad;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(anox) + 0.5, slabTop - 6);
      ctx.lineTo(px(anox) + 0.5, plotBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.bad;
      ctx.font = `600 12px ${FONT_UI}`;
      ctx.fillText(`Anoxic past ${anox.toFixed(0)} µm`, Math.min(px(anox) + 6, w - padR - 120), plotTop + 14);
    }
    legend(ctx, w - padR - 150, 12, 150, "O₂ low", "high", c.muted);
  }

  private hatch(ctx: CanvasRenderingContext2D, x: number, y: number, wd: number, ht: number, color: string) {
    if (wd <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, wd, ht);
    ctx.clip();
    ctx.fillStyle = "rgba(5,6,10,0.55)";
    ctx.fillRect(x, y, wd, ht);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -ht; k < wd; k += 9) { ctx.moveTo(x + k, y + ht); ctx.lineTo(x + k + ht, y); }
    ctx.stroke();
    ctx.restore();
  }
}
