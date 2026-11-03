import { defaultFick, fickFlux, FickParams } from "../fick";
import { FONT_DATA, FONT_UI, fitCanvas, palette, thermal, wash } from "./canvasKit";
import { meas, tile } from "./meas";

export class FickWidget {
  private params: FickParams = defaultFick();
  private anim = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
  ) {
    this.buildControls();
    this.syncReadout();
    this.draw();
  }

  tick(dt: number) {
    this.anim += dt;
    this.draw();
  }

  private buildControls() {
    this.controls.innerHTML = `
      <label><span>Membrane area A</span>
        <input type="range" id="sb-a" min="20" max="200" step="5" value="${this.params.areaCm2}">
        <output id="sb-av">${this.params.areaCm2} cm²</output></label>
      <label><span>Thickness x</span>
        <input type="range" id="sb-x" min="0.5" max="4" step="0.05" value="${this.params.thicknessUm}">
        <output id="sb-xv">${this.params.thicknessUm.toFixed(2)} µm</output></label>
      <label><span>Gradient ΔC</span>
        <input type="range" id="sb-dc" min="0.2" max="2" step="0.05" value="${this.params.deltaC}">
        <output id="sb-dcv">${this.params.deltaC.toFixed(2)}</output></label>
      <p class="sb-lock">D fixed. J = D·A·ΔC / x (relative flux units).</p>`;
    this.controls.querySelector("#sb-a")!.addEventListener("input", (e) => {
      this.params.areaCm2 = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-x")!.addEventListener("input", (e) => {
      this.params.thicknessUm = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-dc")!.addEventListener("input", (e) => {
      this.params.deltaC = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
  }

  private syncReadout() {
    const a = this.controls.querySelector("output#sb-av");
    const x = this.controls.querySelector("output#sb-xv");
    const dc = this.controls.querySelector("output#sb-dcv");
    if (a) a.textContent = `${this.params.areaCm2} cm²`;
    if (x) x.textContent = `${this.params.thicknessUm.toFixed(2)} µm`;
    if (dc) dc.textContent = `${this.params.deltaC.toFixed(2)}`;
    const flux = fickFlux(this.params);
    const rest = fickFlux(defaultFick());
    this.readout.innerHTML = `
      ${meas(
        tile("Flux J", flux.toFixed(1)),
        tile("Vs rest", `${(flux / rest).toFixed(2)}×`),
        tile("D·A·ΔC", (this.params.d * this.params.areaCm2 * this.params.deltaC).toFixed(1)),
        tile("x", `${this.params.thicknessUm.toFixed(2)} µm`),
      )}
      <p class="sb-note">Molecules cross in proportion to J. A thicker membrane (fibrosis, edema) slows them at the same gradient.</p>`;
  }

  private draw() {
    const flux = fickFlux(this.params);
    const rest = fickFlux(defaultFick());
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const padX = 40;
    const top = 56;
    const areaScale = Math.max(0.55, Math.min(1.35, this.params.areaCm2 / 100));
    const chH = 170 * areaScale;
    const cy = top + 90;
    const mid = w / 2;
    const mem = 10 + this.params.thicknessUm * 18;
    const leftEdge = mid - mem / 2;
    const rightEdge = mid + mem / 2;
    const y0 = cy - chH / 2;

    // Two chambers: concentration is particle density, so the gradient reads as crowding.
    ctx.strokeStyle = "rgba(152,160,184,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(padX + 0.5, y0 + 0.5, leftEdge - padX - 1, chH);
    ctx.strokeRect(rightEdge + 0.5, y0 + 0.5, w - padX - rightEdge - 1, chH);
    const hiN = Math.round(46 * this.params.deltaC / 1 * Math.min(1, (leftEdge - padX) / 340));
    const loN = Math.max(2, Math.round(hiN * 0.18));
    const dot = (x: number, y: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 3, 3); };
    const rnd = (i: number, k: number) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    for (let i = 0; i < hiN; i++) {
      const wob = Math.sin(this.anim * 1.6 + i) * 3;
      dot(padX + 10 + rnd(i, 1) * (leftEdge - padX - 20) + wob, y0 + 8 + rnd(i, 2) * (chH - 16), thermal(0.78));
    }
    for (let i = 0; i < loN; i++) {
      const wob = Math.sin(this.anim * 1.6 + i) * 3;
      dot(rightEdge + 10 + rnd(i, 3) * (w - padX - rightEdge - 20) + wob, y0 + 8 + rnd(i, 4) * (chH - 16), thermal(0.78));
    }

    // Membrane drawn to scale: its width follows x.
    ctx.fillStyle = "#2b2f45";
    ctx.fillRect(leftEdge, y0 - 8, mem, chH + 16);
    ctx.strokeStyle = c.ink;
    ctx.strokeRect(leftEdge + 0.5, y0 - 7.5, mem - 1, chH + 15);

    // Crossing molecules: count and speed follow J.
    const ratio = flux / rest;
    const cross = Math.max(1, Math.min(16, Math.round(5 * ratio)));
    for (let i = 0; i < cross; i++) {
      const u = (i / cross + this.anim * (0.18 + 0.12 * Math.min(2, ratio))) % 1;
      dot(leftEdge - 26 + u * (mem + 52), y0 + 10 + ((i * 37) % 100) / 100 * (chH - 20), thermal(0.95));
    }

    ctx.fillStyle = c.ink;
    ctx.font = `600 13px ${FONT_UI}`;
    ctx.fillText("Diffusion across a membrane", padX, 28);
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = "left";
    ctx.fillText("High concentration", padX, y0 - 14);
    ctx.textAlign = "right";
    ctx.fillText("Low concentration", w - padX, y0 - 14);
    ctx.textAlign = "center";
    ctx.fillText(`membrane ${this.params.thicknessUm.toFixed(2)} µm, area ${this.params.areaCm2} cm²`, mid, y0 + chH + 30);
    ctx.textAlign = "left";

    // Flux bar on a fixed scale, with a tick at rest.
    const barX = padX, barW = w - padX * 2, barY = h - 44;
    const scaleMax = rest * 4;
    ctx.fillStyle = "#17181d";
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = thermal(Math.min(1, flux / scaleMax));
    ctx.fillRect(barX, barY, barW * Math.min(1, flux / scaleMax), 10);
    ctx.strokeStyle = c.ink;
    const restX = Math.round(barX + (rest / scaleMax) * barW) + 0.5;
    ctx.beginPath(); ctx.moveTo(restX, barY - 4); ctx.lineTo(restX, barY + 14); ctx.stroke();
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.fillText("Flux J", barX, barY - 8);
    ctx.textAlign = "center";
    ctx.fillText("rest", restX, barY + 27);
    ctx.textAlign = "right";
    ctx.fillStyle = c.ink;
    ctx.font = `600 12px ${FONT_DATA}`;
    ctx.fillText(`J = ${flux.toFixed(1)}  (${ratio.toFixed(2)}× rest)`, barX + barW, barY - 8);
    ctx.textAlign = "left";
  }
}
