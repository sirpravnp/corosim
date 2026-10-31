import { SIMBOOK_CIRCUIT as C } from "../../config/simbook";
import { solveAutoreg } from "../autoreg";
import { CircuitParams, OrganId, defaultCircuit, resistanceFromRadius, solveCircuit } from "../circuit";

export type CircuitWidgetMode = "autoreg" | "pump";

export interface CircuitWidgetOptions {
  mode: CircuitWidgetMode;
  editableOrgan: OrganId;
  coRange: [number, number];
  radiusRange: [number, number];
  mapRange: [number, number];
}

const DEFAULT_OPTS: CircuitWidgetOptions = {
  mode: "pump",
  editableOrgan: "gut",
  coRange: [2, 8],
  radiusRange: [0.4, 1.4],
  mapRange: [45, 110],
};

export class CircuitWidget {
  private params: CircuitParams = defaultCircuit();
  private mapMmHg = C.baseMapMmHg;
  private animT = 0;
  private mode: CircuitWidgetMode;

  constructor(
    private canvas: HTMLCanvasElement,
    private readout: HTMLElement,
    private controls: HTMLElement,
    private opts: CircuitWidgetOptions = DEFAULT_OPTS,
  ) {
    this.mode = opts.mode;
    this.buildControls();
    this.draw();
  }

  setMode(mode: CircuitWidgetMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.buildControls();
    this.syncControls();
    this.draw();
  }

  getParams(): CircuitParams {
    return structuredClone(this.params);
  }

  private buildControls() {
    const o = this.opts;
    if (this.mode === "autoreg") {
      this.controls.innerHTML = `
        <label><span>Mean arterial pressure</span>
          <input type="range" id="sb-map" min="${o.mapRange[0]}" max="${o.mapRange[1]}" step="1" value="${this.mapMmHg}">
          <output id="sb-mapv">${this.mapMmHg.toFixed(0)} mmHg</output></label>
        <p class="sb-lock">Cardiac output is computed as the sum of organ flows. Vessel radii fixed; brain and kidney autoregulate; gut is less protected.</p>`;
      this.controls.querySelector<HTMLInputElement>("#sb-map")!.addEventListener("input", (e) => {
        this.mapMmHg = +(e.target as HTMLInputElement).value;
        this.syncControls(false);
        this.draw();
      });
      return;
    }
    const ed = this.params.organs.find((x) => x.id === o.editableOrgan)!;
    this.controls.innerHTML = `
      <label><span>Cardiac output</span>
        <input type="range" id="sb-co" min="${o.coRange[0]}" max="${o.coRange[1]}" step="0.05" value="${this.params.cardiacOutputLMin}">
        <output id="sb-cov">${this.params.cardiacOutputLMin.toFixed(2)} L/min</output></label>
      <label><span>${ed.label} vessel radius</span>
        <input type="range" id="sb-rad" min="${o.radiusRange[0]}" max="${o.radiusRange[1]}" step="0.05" value="${ed.radius}">
        <output id="sb-radv">${ed.radius.toFixed(2)}×</output></label>
      <p class="sb-lock">Other organ radii fixed at ${C.refRadius}×. Autoregulation is off — pure Ohm/Poiseuille parallel circuit.</p>`;
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
    if (this.mode === "autoreg") {
      const mapOut = this.controls.querySelector("output#sb-mapv");
      if (mapOut) mapOut.textContent = `${this.mapMmHg.toFixed(0)} mmHg`;
      if (updateSliders) {
        const map = this.controls.querySelector<HTMLInputElement>("#sb-map");
        if (map) map.value = String(this.mapMmHg);
      }
      const sol = solveAutoreg(this.mapMmHg, this.params.organs, this.params.cvpMmHg);
      const statusLabel = (s: string) => ({ plateau: "on plateau", below: "below range", above: "above range", passive: "passive" })[s] ?? s;
      this.readout.innerHTML = `
        <dl class="sb-meas">
          <div><dt>MAP</dt><dd>${sol.mapMmHg.toFixed(0)} mmHg</dd></div>
          <div><dt>CVP</dt><dd>${sol.cvpMmHg.toFixed(0)} mmHg</dd></div>
          <div><dt>CO (Σ flows)</dt><dd>${sol.cardiacOutputLMin.toFixed(2)} L/min</dd></div>
          <div><dt>ΔP</dt><dd>${sol.deltaPMmHg.toFixed(0)} mmHg</dd></div>
        </dl>
        <table class="sb-flows" aria-label="Organ flows">
          <thead><tr><th>Organ</th><th>R (effective)</th><th>Flow</th><th>Autoreg</th></tr></thead>
          <tbody>
            ${this.params.organs.map((org) => {
              const o = sol.organs[org.id];
              return `<tr><td>${org.label}</td><td>${o.resistance.toFixed(0)}</td><td>${o.flowLMin.toFixed(2)} L/min</td><td>${statusLabel(o.status)}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
        <p class="sb-note">Drop MAP toward 60 mmHg and watch gut leave the plateau before brain and kidney.</p>`;
      return;
    }

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
      <p class="sb-note">${ed.label} resistance ×${rRatio.toFixed(1)} vs reference (Poiseuille r⁴).</p>`;
  }

  tick(dt: number) {
    this.animT += dt;
    this.draw();
  }

  private organFlows(): { id: OrganId; label: string; q: number; highlight: boolean }[] {
    if (this.mode === "autoreg") {
      const sol = solveAutoreg(this.mapMmHg, this.params.organs, this.params.cvpMmHg);
      return this.params.organs.map((o) => ({
        id: o.id,
        label: o.label,
        q: sol.organs[o.id].flowLMin,
        highlight: sol.organs[o.id].status === "below",
      }));
    }
    const sol = solveCircuit(this.params);
    const ed = this.opts.editableOrgan;
    return this.params.organs.map((o) => ({
      id: o.id,
      label: o.label,
      q: sol.flows[o.id],
      highlight: o.id === ed,
    }));
  }

  private headerPressures(): { map: number; cvp: number; co: number; foot: string } {
    if (this.mode === "autoreg") {
      const sol = solveAutoreg(this.mapMmHg, this.params.organs, this.params.cvpMmHg);
      return { map: sol.mapMmHg, cvp: sol.cvpMmHg, co: sol.cardiacOutputLMin, foot: "Autoregulation active" };
    }
    const sol = solveCircuit(this.params);
    return { map: sol.mapMmHg, cvp: sol.cvpMmHg, co: this.params.cardiacOutputLMin, foot: "ΔP = CO × SVR" };
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

    const styles = getComputedStyle(this.canvas);
    const ink = styles.getPropertyValue("--ink").trim() || "#f4f1ea";
    const muted = styles.getPropertyValue("--muted").trim() || "#98a0b8";
    const accent = styles.getPropertyValue("--accent").trim() || "#b8372e";
    const down = styles.getPropertyValue("--down").trim() || "#3d8bff";
    const ok = styles.getPropertyValue("--ok").trim() || "#7fc69a";
    const warn = styles.getPropertyValue("--warn").trim() || "#e0a447";
    const stage = styles.getPropertyValue("--stage").trim() || "#000";

    ctx.fillStyle = stage;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.22;
    const cy = h * 0.48;
    const loopR = Math.min(w, h) * 0.32;
    const organX = w * 0.62;
    const organW = w * 0.32;
    const hdr = this.headerPressures();
    const rows = this.organFlows();
    const maxQ = Math.max(...rows.map((r) => r.q), 0.01);

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

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy + 6);
    ctx.bezierCurveTo(cx - 28, cy - 22, cx + 28, cy - 22, cx + 18, cy + 6);
    ctx.bezierCurveTo(cx + 8, cy + 18, cx - 8, cy + 18, cx - 18, cy + 6);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.mode === "autoreg" ? "Arterial pressure" : "Pump", cx, cy + 36);
    ctx.font = "11px monospace";
    ctx.fillStyle = muted;
    ctx.fillText(this.mode === "autoreg" ? `${hdr.map.toFixed(0)} mmHg MAP` : `${hdr.co.toFixed(1)} L/min`, cx, cy + 52);

    rows.forEach((org, i) => {
      const y = h * 0.18 + (i / (rows.length - 1 || 1)) * h * 0.64;
      const bar = (org.q / maxQ) * (organW * 0.55);
      ctx.strokeStyle = org.highlight ? (this.mode === "autoreg" ? warn : accent) : muted;
      ctx.lineWidth = org.highlight ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + loopR * 0.55, cy - loopR * 0.05);
      ctx.lineTo(organX - 8, y);
      ctx.stroke();
      ctx.fillStyle = org.highlight ? (this.mode === "autoreg" ? warn : accent) : down;
      ctx.fillRect(organX, y - 10, bar, 20);
      ctx.strokeStyle = ink;
      ctx.strokeRect(organX, y - 10, organW * 0.55, 20);
      ctx.fillStyle = ink;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(org.label, organX, y - 14);
      ctx.fillStyle = muted;
      ctx.font = "11px monospace";
      ctx.fillText(`${org.q.toFixed(2)} L/min`, organX + organW * 0.58, y + 4);
    });

    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = "600 12px sans-serif";
    ctx.fillText(`MAP ${hdr.map.toFixed(0)} mmHg`, 12, 22);
    ctx.fillStyle = down;
    ctx.fillText(`CVP ${hdr.cvp.toFixed(0)} mmHg`, 12, 40);
    ctx.fillStyle = ok;
    ctx.font = "11px monospace";
    ctx.fillText(hdr.foot, 12, h - 14);

    this.syncControls(false);
  }
}
