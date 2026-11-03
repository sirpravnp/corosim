import { defaultStarling, starlingProfile, StarlingParams } from "../starlingCapillary";
import { fitCanvas, palette, wash } from "./canvasKit";

export class StarlingWidget {
  private params: StarlingParams = defaultStarling();
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
      <label><span>Venous pressure Pv</span>
        <input type="range" id="sb-pv" min="4" max="18" step="0.5" value="${this.params.venousPressureMmHg}">
        <output id="sb-pvv">${this.params.venousPressureMmHg.toFixed(1)} mmHg</output></label>
      <label><span>Plasma albumin</span>
        <input type="range" id="sb-alb" min="0.4" max="1.2" step="0.05" value="${this.params.albuminScale}">
        <output id="sb-albv">${(this.params.albuminScale * 7).toFixed(1)} g/dl</output></label>
      <label><span>Permeability Kf</span>
        <input type="range" id="sb-kf" min="0.5" max="2.5" step="0.05" value="${this.params.kfScale}">
        <output id="sb-kfv">${this.params.kfScale.toFixed(2)}×</output></label>
      <p class="sb-lock">Lymph return is fixed in the background; edema when net filtration exceeds it.</p>`;
    this.controls.querySelector("#sb-pv")!.addEventListener("input", (e) => {
      this.params.venousPressureMmHg = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-alb")!.addEventListener("input", (e) => {
      this.params.albuminScale = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
    this.controls.querySelector("#sb-kf")!.addEventListener("input", (e) => {
      this.params.kfScale = +(e.target as HTMLInputElement).value;
      this.syncReadout();
      this.draw();
    });
  }

  private syncReadout() {
    const pv = this.controls.querySelector("output#sb-pvv");
    const alb = this.controls.querySelector("output#sb-albv");
    const kf = this.controls.querySelector("output#sb-kfv");
    if (pv) pv.textContent = `${this.params.venousPressureMmHg.toFixed(1)} mmHg`;
    if (alb) alb.textContent = `${(this.params.albuminScale * 7).toFixed(1)} g/dl`;
    if (kf) kf.textContent = `${this.params.kfScale.toFixed(2)}×`;
    const prof = starlingProfile(this.params);
    const filt = prof.stations.filter((s) => s.jvMlMin > 0).length;
    const reabs = prof.stations.filter((s) => s.jvMlMin < 0).length;
    this.readout.innerHTML = `
      <dl class="sb-meas">
        <div><dt>Net filtration</dt><dd>${prof.netFiltrationMlMin.toFixed(3)} ml/min</dd></div>
        <div><dt>Lymph return</dt><dd>${prof.lymphReturnMlMin.toFixed(2)} ml/min</dd></div>
        <div><dt>πc / πi</dt><dd>${prof.piCapMmHg.toFixed(0)} / ${prof.piInterMmHg.toFixed(0)} mmHg</dd></div>
        <div><dt>Edema</dt><dd>${prof.edema ? "yes" : "no"}</dd></div>
      </dl>
      <p class="sb-note">Filtration at ${filt} stations, reabsorption at ${reabs}. Arteriolar → venular left to right.</p>`;
  }

  private draw() {
    const prof = starlingProfile(this.params);
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const pad = 48;
    const capY = h * 0.38;
    const capL = w - pad * 2;
    const capX = pad;
    const tube = 18;
    const g = ctx.createLinearGradient(capX, 0, capX + capL, 0);
    g.addColorStop(0, c.accent);
    g.addColorStop(1, c.down);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(capX, capY - tube / 2, capL, tube, 9);
    ctx.fill();

    const n = 8;
    for (let i = 0; i < n; i++) {
      const u = (i / n + this.anim * 0.12) % 1;
      ctx.beginPath();
      ctx.arc(capX + 12 + u * (capL - 24), capY, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    }

    if (prof.edema) {
      const excess = Math.min(1, (prof.netFiltrationMlMin - prof.lymphReturnMlMin) / 0.4);
      ctx.fillStyle = `rgba(255, 122, 110, ${0.12 + 0.28 * excess})`;
      ctx.beginPath();
      ctx.ellipse(capX + capL * 0.55, capY + 54, 70 + 40 * excess, 16 + 10 * excess, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const maxJv = Math.max(...prof.stations.map((s) => Math.abs(s.jvMlMin)), 1e-6);
    let cross: number | null = null;
    for (let i = 1; i < prof.stations.length; i++) {
      const a = prof.stations[i - 1]!;
      const b = prof.stations[i]!;
      if (a.jvMlMin >= 0 && b.jvMlMin < 0) cross = capX + b.s * capL;
    }
    prof.stations.forEach((st, i) => {
      if (i % 4 !== 0) return;
      const x = capX + st.s * capL;
      const out = st.jvMlMin > 0;
      const mag = 10 + (Math.abs(st.jvMlMin) / maxJv) * 42;
      const y0 = out ? capY - tube / 2 : capY + tube / 2;
      const y1 = out ? y0 - mag : y0 + mag;
      ctx.strokeStyle = out ? c.bad : c.ok;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x - 4, y1 + (out ? 6 : -6));
      ctx.lineTo(x + 4, y1 + (out ? 6 : -6));
      ctx.closePath();
      ctx.fillStyle = out ? c.bad : c.ok;
      ctx.fill();
    });
    if (cross != null) {
      ctx.strokeStyle = c.ink;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(cross, capY - 70);
      ctx.lineTo(cross, capY + 70);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const base = h - 78;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(capX, base);
    ctx.lineTo(capX + capL, base);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = c.down;
    prof.stations.forEach((st, i) => {
      const x = capX + st.s * capL;
      const y = base - (st.jvMlMin / maxJv) * 36;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.font = "12px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillStyle = c.muted;
    ctx.fillText("Arteriole", capX, capY - 28);
    ctx.fillText("Venule", capX + capL - 42, capY - 28);
    ctx.fillText("Jv  (out above the line)", capX, base + 22);
    ctx.fillStyle = prof.edema ? c.bad : c.ok;
    ctx.font = "600 13px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText(prof.edema ? "Edema — filtration exceeds lymph" : "Lymph return keeps up", capX + capL - 250, h - 18);
  }
}
