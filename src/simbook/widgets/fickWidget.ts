import { defaultFick, fickFlux, FickParams } from "../fick";

export class FickWidget {
  private params: FickParams = defaultFick();

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
  ) {
    this.buildControls();
    this.syncReadout();
    this.draw();
  }

  tick(_dt: number) {
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
    this.readout.innerHTML = `
      <dl class="sb-meas">
        <div><dt>Flux J</dt><dd>${flux.toFixed(1)}</dd></div>
        <div><dt>D·A·ΔC</dt><dd>${(this.params.d * this.params.areaCm2 * this.params.deltaC).toFixed(1)}</dd></div>
        <div><dt>x</dt><dd>${this.params.thicknessUm.toFixed(2)} µm</dd></div>
      </dl>
      <p class="sb-note">Thicken the membrane (fibrosis, edema) and the same gradient moves less O₂ per minute.</p>`;
  }

  private draw() {
    const flux = fickFlux(this.params);
    const ctx = this.canvas.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 380;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(this.canvas);
    const ink = styles.getPropertyValue("--ink").trim() || "#f4f1ea";
    const muted = styles.getPropertyValue("--muted").trim() || "#98a0b8";
    const accent = styles.getPropertyValue("--accent").trim() || "#b8372e";
    const down = styles.getPropertyValue("--down").trim() || "#3d8bff";
    const ok = styles.getPropertyValue("--ok").trim() || "#7fc69a";
    const stage = styles.getPropertyValue("--stage").trim() || "#000";
    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, w, h);

    const mx = w * 0.5;
    const my = h * 0.45;
    const thick = 20 + this.params.thicknessUm * 18;
    ctx.fillStyle = muted;
    ctx.fillRect(mx - 120, my - 60, 100, 120);
    ctx.fillRect(mx + 20, my - 60, 100, 120);
    ctx.fillStyle = accent;
    ctx.fillRect(mx - thick / 2, my - 70, thick, 140);
    ctx.fillStyle = ink;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Alveolar / blood side", mx - 70, my - 76);
    ctx.fillText("Tissue side", mx + 70, my - 76);
    ctx.fillText(`x = ${this.params.thicknessUm.toFixed(1)} µm`, mx, my + 90);

    const arrowN = 5;
    const fluxNorm = flux / (this.params.d * this.params.areaCm2 * 2);
    for (let i = 0; i < arrowN; i++) {
      const y = my - 40 + (i * 80) / (arrowN - 1);
      const len = 12 + fluxNorm * 40;
      ctx.strokeStyle = down;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - thick / 2 - 4, y);
      ctx.lineTo(mx - thick / 2 - 4 - len, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - thick / 2 - 4 - len, y);
      ctx.lineTo(mx - thick / 2 - 4 - len + 6, y - 4);
      ctx.lineTo(mx - thick / 2 - 4 - len + 6, y + 4);
      ctx.fillStyle = down;
      ctx.fill();
    }
    ctx.fillStyle = ok;
    ctx.font = "600 14px monospace";
    ctx.fillText(`J = ${flux.toFixed(1)}`, mx, my + 110);
    ctx.textAlign = "left";
  }
}
