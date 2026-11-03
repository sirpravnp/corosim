import { defaultStarling, starlingProfile, StarlingParams } from "../starlingCapillary";
import { FONT_UI, axisX, axisY, fitCanvas, palette, thermal, wash } from "./canvasKit";
import { meas, tile } from "./meas";

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
      ${meas(
        tile("Net filtration", `${prof.netFiltrationMlMin.toFixed(3)} ml/min`),
        tile("Lymph return", `${prof.lymphReturnMlMin.toFixed(2)} ml/min`),
        tile("πc / πi", `${prof.piCapMmHg.toFixed(0)} / ${prof.piInterMmHg.toFixed(0)} mmHg`),
        tile("Edema", prof.edema ? "yes" : "no", prof.edema ? "bad" : ""),
      )}
      <p class="sb-note">Filtration at ${filt} stations, reabsorption at ${reabs}. Arteriolar → venular left to right.</p>`;
  }

  private draw() {
    const prof = starlingProfile(this.params);
    const { ctx, w, h } = fitCanvas(this.canvas);
    const c = palette(this.canvas);
    wash(ctx, w, h, c.stage);

    const padL = 64;
    const padR = 28;
    const track = w - padL - padR;
    const sx = (s: number) => padL + s * track;
    const tubeY = 78;
    const tubeH = 22;
    const pcMax = Math.max(...prof.stations.map((s) => s.pcMmHg), prof.opposingMmHg);

    // Capillary tube colored by hydrostatic pressure (hot is high).
    const n = 60;
    for (let i = 0; i < n; i++) {
      const st = prof.stations[Math.round((i / (n - 1)) * (prof.stations.length - 1))]!;
      ctx.fillStyle = thermal(Math.min(1, Math.max(0, st.pcMmHg / 40)));
      ctx.fillRect(sx(i / n), tubeY, track / n + 1, tubeH);
    }
    ctx.strokeStyle = "rgba(152,160,184,0.55)";
    ctx.strokeRect(padL + 0.5, tubeY + 0.5, track, tubeH);
    for (let i = 0; i < 8; i++) {
      const u = (i / 8 + this.anim * 0.12) % 1;
      ctx.fillStyle = "rgba(244,241,234,0.9)";
      ctx.fillRect(sx(u) - 2, tubeY + tubeH / 2 - 2, 4, 4);
    }

    // Fluid movement arrows: out above the tube, back in below it.
    const maxJv = Math.max(...prof.stations.map((s) => Math.abs(s.jvMlMin)), 1e-6);
    prof.stations.forEach((st, i) => {
      if (i % 4 !== 0) return;
      const x = Math.round(sx(st.s)) + 0.5;
      const out = st.jvMlMin > 0;
      const mag = 6 + (Math.abs(st.jvMlMin) / maxJv) * 30;
      const y0 = out ? tubeY - 3 : tubeY + tubeH + 3;
      const y1 = out ? y0 - mag : y0 + mag;
      ctx.strokeStyle = out ? c.bad : c.down;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, out ? y0 : y0); ctx.lineTo(x, y1); ctx.stroke();
      const dir = out ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x - 4, y1 + 6 * dir); ctx.lineTo(x + 4, y1 + 6 * dir); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = "right";
    ctx.fillText("Arteriole", padL - 8, tubeY + 15);
    ctx.textAlign = "left";
    ctx.fillText("Venule", padL + track + 6 > w - 40 ? w - 46 : padL + track + 6, tubeY + 15);
    ctx.fillStyle = c.ink;
    ctx.font = `600 13px ${FONT_UI}`;
    ctx.fillText("Pressures along the capillary", padL, 24);

    // Pressure plot: hydrostatic Pc against the opposing oncotic pull.
    const top = 168, bottom = 296;
    const yMax = Math.ceil((pcMax + 2) / 10) * 10;
    const yOf = axisY(ctx, padL, top, bottom, 0, yMax, [0, yMax / 2, yMax], c.muted);
    axisX(ctx, bottom, padL, padL + track, 0, 1, [0, 0.25, 0.5, 0.75, 1], c.muted, (v) => (v === 0 ? "arteriole" : v === 1 ? "venule" : ""));
    ctx.fillStyle = c.muted;
    ctx.font = `11px ${FONT_UI}`;
    ctx.save();
    ctx.translate(14, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("mmHg", 0, 0);
    ctx.restore();
    ctx.textAlign = "left";

    const opp = yOf(prof.opposingMmHg);
    // Filled gap between Pc and the opposing pressure: filtration above the line, reabsorption below it.
    for (let i = 1; i < prof.stations.length; i++) {
      const a = prof.stations[i - 1]!, b = prof.stations[i]!;
      const pa = yOf(a.pcMmHg), pb = yOf(b.pcMmHg);
      const filt = (a.pcMmHg + b.pcMmHg) / 2 > prof.opposingMmHg;
      ctx.fillStyle = filt ? "rgba(255,107,94,0.28)" : "rgba(61,139,255,0.28)";
      ctx.beginPath();
      ctx.moveTo(sx(a.s), pa); ctx.lineTo(sx(b.s), pb); ctx.lineTo(sx(b.s), opp); ctx.lineTo(sx(a.s), opp);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.ink;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padL, opp); ctx.lineTo(padL + track, opp); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = thermal(0.8);
    prof.stations.forEach((st, i) => { const X = sx(st.s), Y = yOf(st.pcMmHg); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
    ctx.stroke();

    ctx.font = `600 12px ${FONT_UI}`;
    ctx.fillStyle = thermal(0.8);
    ctx.fillText("Hydrostatic Pc", sx(0.02), yOf(prof.stations[0]!.pcMmHg) - 8);
    ctx.fillStyle = c.ink;
    ctx.fillText(`Opposing  σ(πc − πi) + Pi = ${prof.opposingMmHg.toFixed(0)}`, sx(0.45), opp + (opp > top + 30 ? -8 : 18));
    ctx.textAlign = "right";
    ctx.fillStyle = prof.edema ? c.bad : c.ok;
    ctx.fillText(prof.edema ? "Edema: filtration exceeds lymph" : "Lymph keeps up", padL + track, 24);
    ctx.textAlign = "left";
  }
}
