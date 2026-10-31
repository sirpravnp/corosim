import { SIMBOOK_CIRCUIT as C } from "../../config/simbook";
import { CircuitParams, OrganId, defaultCircuit, resistanceFromRadius, solveCircuit } from "../circuit";

export interface CircuitWidgetOptions {
  /** Which organ radius the learner may change; other radii stay fixed. */
  editableOrgan: OrganId;
  coRange: [number, number];
  radiusRange: [number, number];
}

const DEFAULT_OPTS: CircuitWidgetOptions = {
  editableOrgan: "gut",
  coRange: [2, 8],
  radiusRange: [0.4, 1.4],
};

export class CircuitWidget {
  private params: CircuitParams = defaultCircuit();
  private animT = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
    private opts: CircuitWidgetOptions = DEFAULT_OPTS,
  ) {
    this.buildControls();
    this.draw();
  }

  getParams(): CircuitParams {
    return structuredClone(this.params);
  }

  setCardiacOutput(co: number) {
    this.params.cardiacOutputLMin = co;
    this.syncControls();
    this.draw();
  }

  private buildControls() {
    const o = this.opts;
    const ed = this.params.organs.find((x) => x.id === o.editableOrgan)!;
    this.controls.innerHTML = `
      <label><span>Cardiac output</span>
        <input type="range" id="sb-co" min="${o.coRange[0]}" max="${o.coRange[1]}" step="0.05" value="${this.params.cardiacOutputLMin}">
        <output id="sb-cov">${this.params.cardiacOutputLMin.toFixed(2)} L/min</output></label>
      <label><span>${ed.label} vessel radius</span>
        <input type="range" id="sb-rad" min="${o.radiusRange[0]}" max="${o.radiusRange[1]}" step="0.05" value="${ed.radius}">
        <output id="sb-radv">${ed.radius.toFixed(2)}×</output></label>
      <p class="sb-lock">Other organ radii are fixed at ${C.refRadius}× (resistances at reference Poiseuille scale).</p>`;
    const co = this.controls.querySelector<HTMLInputElement>("#sb-co")!;
    const rad = this.controls.querySelector<HTMLInputElement>("#sb-rad")!;
    co.addEventListener("input", () => {
      this.params.cardiacOutputLMin = +co.value;
      this.syncControls(false);
      this.draw();
    });
    rad.addEventListener("input", () => {
      ed.radius = +rad.value;
      this.syncControls(false);
      this.draw();
    });
  }

  private syncControls(updateSliders = true) {
    const coOut = this.controls.querySelector("output#sb-cov");
    const rOut = this.controls.querySelector("output#sb-radv");
    const ed = this.params.organs.find((x) => x.id === this.opts.editableOrgan)!;
    if (coOut) coOut.textContent = `${this.params.cardiacOutputLMin.toFixed(2)} L/min`;
    if (rOut) rOut.textContent = `${ed.radius.toFixed(2)}×`;
    if (updateSliders) {
      const co = this.controls.querySelector<HTMLInputElement>("#sb-co");
      const rad = this.controls.querySelector<HTMLInputElement>("#sb-rad");
      if (co) co.value = String(this.params.cardiacOutputLMin);
      if (rad) rad.value = String(ed.radius);
    }
    const sol = solveCircuit(this.params);
    const edR = sol.resistances[this.opts.editableOrgan];
    const edQ = sol.flows[this.opts.editableOrgan];
    const rRatio = resistanceFromRadius(ed.r0, ed.radius) / ed.r0;
    this.readout.innerHTML = `
      <dl class="sb-meas">
        <div><dt>MAP</dt><dd>${sol.mapMmHg.toFixed(0)} mmHg</dd></div>
        <div><dt>CVP</dt><dd>${sol.cvpMmHg.toFixed(0)} mmHg</dd></div>
        <div><dt>CO</dt><dd>${this.params.cardiacOutputLMin.toFixed(2)} L/min</dd></div>
        <div><dt>SVR</dt><dd>${sol.svr.toFixed(1)} mmHg·min/L</dd></div>
        <div><dt>MAP − CVP</dt><dd>${sol.deltaPMmHg.toFixed(0)} mmHg</dd></div>
        <div><dt>CO × SVR</dt><dd>${(this.params.cardiacOutputLMin * sol.svr).toFixed(0)} mmHg</dd></div>
      </dl>
      <table class="sb-flows" aria-label="Organ flows">
        <thead><tr><th>Organ</th><th>R</th><th>Flow</th></tr></thead>
        <tbody>
          ${this.params.organs.map((org) => {
            const r = sol.resistances[org.id];
            const q = sol.flows[org.id];
            const hi = org.id === this.opts.editableOrgan ? ' class="hi"' : "";
            return `<tr${hi}><td>${org.label}</td><td>${r.toFixed(0)}</td><td>${q.toFixed(2)} L/min</td></tr>`;
          }).join("")}
        </tbody>
      </table>
      <p class="sb-note">${ed.label} resistance ×${rRatio.toFixed(1)} vs reference radius (Poiseuille r⁴).</p>`;
  }

  tick(dt: number) {
    this.animT += dt;
    this.draw();
  }

  private draw() {
    const ctx = this.canvas.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 560;
    const h = this.canvas.clientHeight || 360;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const sol = solveCircuit(this.params);
    const styles = getComputedStyle(this.canvas);
    const ink = styles.getPropertyValue("--ink").trim() || "#f4f1ea";
    const muted = styles.getPropertyValue("--muted").trim() || "#98a0b8";
    const accent = styles.getPropertyValue("--accent").trim() || "#b8372e";
    const down = styles.getPropertyValue("--down").trim() || "#3d8bff";
    const ok = styles.getPropertyValue("--ok").trim() || "#7fc69a";
    const stage = styles.getPropertyValue("--stage").trim() || "#000";

    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.22;
    const cy = h * 0.48;
    const loopR = Math.min(w, h) * 0.32;
    const organX = w * 0.62;
    const organW = w * 0.32;

    // Arterial arc (high pressure) and venous return
    const grad = ctx.createLinearGradient(cx - loopR, cy, cx + loopR, cy);
    grad.addColorStop(0, accent);
    grad.addColorStop(0.45, accent);
    grad.addColorStop(0.55, down);
    grad.addColorStop(1, down);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, loopR, -Math.PI * 0.15, Math.PI * 1.15);
    ctx.stroke();

    // Heart pump symbol
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy + 6);
    ctx.bezierCurveTo(cx - 28, cy - 22, cx + 28, cy - 22, cx + 18, cy + 6);
    ctx.bezierCurveTo(cx + 8, cy + 18, cx - 8, cy + 18, cx - 18, cy + 6);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pump", cx, cy + 36);
    ctx.font = "11px monospace";
    ctx.fillStyle = muted;
    ctx.fillText(`${this.params.cardiacOutputLMin.toFixed(1)} L/min`, cx, cy + 52);

    // Parallel organ branches
    const ids = this.params.organs;
    const maxQ = Math.max(...ids.map((o) => sol.flows[o.id]));
    ids.forEach((org, i) => {
      const y = h * 0.18 + (i / (ids.length - 1 || 1)) * h * 0.64;
      const q = sol.flows[org.id];
      const bar = (q / maxQ) * (organW * 0.55);
      const isEd = org.id === this.opts.editableOrgan;
      ctx.strokeStyle = isEd ? accent : muted;
      ctx.lineWidth = isEd ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + loopR * 0.55, cy - loopR * 0.05);
      ctx.lineTo(organX - 8, y);
      ctx.stroke();
      ctx.fillStyle = isEd ? accent : down;
      ctx.fillRect(organX, y - 10, bar, 20);
      ctx.strokeStyle = ink;
      ctx.strokeRect(organX, y - 10, organW * 0.55, 20);
      ctx.fillStyle = ink;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(org.label, organX, y - 14);
      ctx.fillStyle = muted;
      ctx.font = "11px monospace";
      ctx.fillText(`${q.toFixed(2)} L/min`, organX + organW * 0.58, y + 4);
    });

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "600 12px sans-serif";
    ctx.fillText(`MAP ${sol.mapMmHg.toFixed(0)} mmHg`, 12, 22);
    ctx.fillStyle = down;
    ctx.fillText(`CVP ${sol.cvpMmHg.toFixed(0)} mmHg`, 12, 40);
    ctx.fillStyle = ok;
    ctx.font = "11px monospace";
    ctx.fillText("ΔP = CO × SVR", 12, h - 14);
  }
}
