import { defaultStarling, starlingProfile, StarlingParams } from "../starlingCapillary";

export class StarlingWidget {
  private params: StarlingParams = defaultStarling();

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
    const bad = styles.getPropertyValue("--bad").trim() || "#ff6b5e";
    const stage = styles.getPropertyValue("--stage").trim() || "#000";
    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, w, h);

    const pad = 40;
    const capY = h * 0.42;
    const capL = w - pad * 2;
    const capX = pad;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(capX, capY);
    ctx.lineTo(capX + capL, capY);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = "11px sans-serif";
    ctx.fillText("Arteriolar", capX, capY - 10);
    ctx.fillText("Venular", capX + capL - 44, capY - 10);

    const maxJv = Math.max(...prof.stations.map((s) => Math.abs(s.jvMlMin)), 1e-6);
    prof.stations.forEach((st, i) => {
      if (i % 3 !== 0) return;
      const x = capX + st.s * capL;
      const up = st.jvMlMin > 0;
      const mag = (Math.abs(st.jvMlMin) / maxJv) * 50;
      ctx.strokeStyle = up ? bad : ok;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, capY);
      ctx.lineTo(x, capY + (up ? -mag : mag));
      ctx.stroke();
    });

    const curveY = h * 0.72;
    ctx.strokeStyle = down;
    ctx.beginPath();
    prof.stations.forEach((st, i) => {
      const x = capX + st.s * capL;
      const y = curveY - (st.pcMmHg / 40) * 60;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = down;
    ctx.fillText("Pc along capillary", capX, curveY + 24);

    ctx.fillStyle = prof.edema ? bad : ok;
    ctx.font = "600 12px sans-serif";
    ctx.fillText(prof.edema ? "Net filtration > lymph" : "Lymph keeps up", pad, h - 16);
  }
}
