import { defaultFick, fickFlux, FickParams } from "../fick";
import { fitCanvas, palette, wash } from "./canvasKit";

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
      <dl class="sb-meas">
        <div><dt>Flux J</dt><dd>${flux.toFixed(1)}</dd></div>
        <div><dt>Vs rest</dt><dd>${(flux / rest).toFixed(2)}×</dd></div>
        <div><dt>D·A·ΔC</dt><dd>${(this.params.d * this.params.areaCm2 * this.params.deltaC).toFixed(1)}</dd></div>
        <div><dt>x</dt><dd>${this.params.thicknessUm.toFixed(2)} µm</dd></div>
      </dl>
      <p class="sb-note">Molecules cross in proportion to J. A thicker membrane (fibrosis, edema) slows them at the same gradient.</p>`;
  }

  private draw() {
    const flux = fickFlux(this.params);
    const rest = fickFlux(defaultFick());
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const my = h * 0.46;
    const thick = 16 + this.params.thicknessUm * 28;
    const left = w * 0.18;
    const right = w * 0.82;
    const mid = w * 0.5;
    const chamberH = 160;
    const areaScale = Math.max(0.55, Math.min(1.35, this.params.areaCm2 / 100));
    const chH = chamberH * areaScale;

    const leftG = ctx.createLinearGradient(left - 70, 0, mid, 0);
    leftG.addColorStop(0, "rgba(127, 212, 255, 0.55)");
    leftG.addColorStop(1, "rgba(127, 212, 255, 0.08)");
    ctx.fillStyle = leftG;
    ctx.fillRect(left - 90, my - chH / 2, mid - left + 40, chH);

    const rightG = ctx.createLinearGradient(mid, 0, right + 70, 0);
    rightG.addColorStop(0, "rgba(226, 75, 60, 0.05)");
    rightG.addColorStop(1, `rgba(226, 75, 60, ${0.15 + 0.25 * this.params.deltaC})`);
    ctx.fillStyle = rightG;
    ctx.fillRect(mid - 20, my - chH / 2, right - mid + 110, chH);

    ctx.fillStyle = "rgba(244, 241, 234, 0.14)";
    ctx.fillRect(mid - thick / 2, my - chH / 2 - 8, thick, chH + 16);
    ctx.strokeStyle = c.ink;
    ctx.strokeRect(mid - thick / 2, my - chH / 2 - 8, thick, chH + 16);

    const n = 14;
    const speed = 0.12 + Math.min(1.4, flux / rest) * 0.35;
    for (let i = 0; i < n; i++) {
      const lane = (i % 7) / 6;
      const u = (i / n + this.anim * speed) % 1;
      const x = left - 20 + u * (right - left + 40);
      const y = my - chH / 2 + 16 + lane * (chH - 32);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = x < mid ? c.o2 : c.accent;
      ctx.fill();
    }

    const meterW = 160;
    const meterX = w - meterW - 28;
    const frac = Math.max(0.04, Math.min(1, flux / (rest * 2.2)));
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(meterX, 28, meterW, 8);
    ctx.fillStyle = c.o2;
    ctx.fillRect(meterX, 28, meterW * frac, 8);

    ctx.fillStyle = c.ink;
    ctx.font = "600 13px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("High concentration", left - 70, my - chH / 2 - 14);
    ctx.textAlign = "right";
    ctx.fillText("Low concentration", right + 70, my - chH / 2 - 14);
    ctx.textAlign = "center";
    ctx.fillStyle = c.muted;
    ctx.font = "12px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText(`membrane  ${this.params.thicknessUm.toFixed(1)} µm`, mid, my + chH / 2 + 28);
    ctx.fillStyle = c.ok;
    ctx.font = "600 15px IBM Plex Mono, monospace";
    ctx.fillText(`J = ${flux.toFixed(1)}`, mid, h - 28);
    ctx.textAlign = "left";
    ctx.fillStyle = c.muted;
    ctx.font = "11px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText("Flux vs 2× rest", meterX, 22);
  }
}
