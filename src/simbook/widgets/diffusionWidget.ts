import { defaultDiffusion, DiffusionParams, o2Profile } from "../diffusion";

export class DiffusionWidget {
  private params: DiffusionParams = defaultDiffusion();

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
  ) {
    this.buildControls();
    this.updateReadout();
    this.draw();
  }

  tick(_dt: number) {
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
      <p class="sb-lock">Diffusion coefficient D is fixed. Effective distance scales as thickness / √density.</p>`;
    this.controls.querySelector("#sb-th")!.addEventListener("input", (e) => {
      this.params.thicknessUm = +(e.target as HTMLInputElement).value;
      this.updateReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-den")!.addEventListener("input", (e) => {
      this.params.density = +(e.target as HTMLInputElement).value;
      this.updateReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-met")!.addEventListener("input", (e) => {
      this.params.consumption = +(e.target as HTMLInputElement).value;
      this.updateReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-flow")!.addEventListener("change", (e) => {
      this.params.flowOn = (e.target as HTMLInputElement).checked;
      this.updateReadout();
      this.draw();
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
    this.readout.innerHTML = `
      <dl class="sb-meas">
        <div><dt>Capillary O₂</dt><dd>${sample.capConc.toFixed(2)}</dd></div>
        <div><dt>Effective depth</dt><dd>${sample.effectiveThicknessUm.toFixed(0)} µm</dd></div>
        <div><dt>Anoxic from edge</dt><dd>${anox == null ? "none" : `${anox.toFixed(0)} µm`}</dd></div>
        <div><dt>t ≈ x²/2D</dt><dd>${sample.diffusionTimeS.toFixed(2)} s</dd></div>
      </dl>
      <p class="sb-note">${anox == null ? "O₂ reaches the core — bulk delivery or short diffusion path." : "Core is anoxic beyond this depth from the nearest capillary."}</p>`;
  }

  private draw() {
    const sample = o2Profile(this.params);
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
    const bad = styles.getPropertyValue("--bad").trim() || "#ff6b5e";
    const stage = styles.getPropertyValue("--stage").trim() || "#000";
    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, w, h);

    const pad = 36;
    const slabX = pad;
    const slabY = 50;
    const slabW = w - pad * 2;
    const slabH = h - 100;
    ctx.fillStyle = "#2a1515";
    ctx.fillRect(slabX, slabY, slabW, slabH);
    ctx.strokeStyle = ink;
    ctx.strokeRect(slabX, slabY, slabW, slabH);

    const capW = 14;
    ctx.fillStyle = accent;
    ctx.fillRect(slabX - capW, slabY, capW, slabH);
    ctx.fillStyle = ink;
    ctx.font = "11px sans-serif";
    ctx.fillText("capillary", slabX - capW, slabY - 6);

    const maxC = Math.max(...sample.conc, 0.01);
    ctx.beginPath();
    sample.xUm.forEach((x, i) => {
      const px = slabX + (x / sample.effectiveThicknessUm) * slabW;
      const py = slabY + slabH - (sample.conc[i]! / maxC) * (slabH - 8);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(slabX + slabW, slabY + slabH);
    ctx.lineTo(slabX, slabY + slabH);
    ctx.closePath();
    ctx.fillStyle = down + "99";
    ctx.fill();
    ctx.strokeStyle = down;
    ctx.lineWidth = 2;
    ctx.beginPath();
    sample.xUm.forEach((x, i) => {
      const px = slabX + (x / sample.effectiveThicknessUm) * slabW;
      const py = slabY + slabH - (sample.conc[i]! / maxC) * (slabH - 8);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    if (sample.anoxicDepthUm != null) {
      const ax = slabX + (sample.anoxicDepthUm / sample.effectiveThicknessUm) * slabW;
      ctx.strokeStyle = bad;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, slabY);
      ctx.lineTo(ax, slabY + slabH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = bad;
      ctx.fillText("O₂ = 0", ax + 4, slabY + 14);
    }

    ctx.fillStyle = muted;
    ctx.fillText("Tissue core →", slabX + slabW - 72, slabY + slabH + 18);
  }
}
