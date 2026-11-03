import { SIMBOOK_CIRCUIT as C } from "../../config/simbook";
import { solveAutoreg } from "../autoreg";
import { CircuitParams, OrganId, defaultCircuit, resistanceFromRadius, solveCircuit } from "../circuit";
import { fitCanvas, palette, wash } from "./canvasKit";

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
    this.syncControls();
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
        <p class="sb-lock">Cardiac output is the sum of organ flows. Vessel width shows dilation: resistance falls on the plateau.</p>`;
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
    this.syncControls();
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

  private calibers(): number[] {
    if (this.mode === "autoreg") {
      const sol = solveAutoreg(this.mapMmHg, this.params.organs, this.params.cvpMmHg);
      return this.params.organs.map((o) => {
        const r = sol.organs[o.id].resistance;
        const rRef = resistanceFromRadius(o.r0, 1);
        return Math.max(2.5, Math.min(16, 7 * rRef / Math.max(r, 1)));
      });
    }
    return this.params.organs.map((o) => 3 + o.radius * 8);
  }

  private draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const pal = palette(this.canvas);
    wash(ctx, w, h, pal.stage);

    const cx = w * 0.24;
    const cy = h * 0.5;
    const loopR = Math.min(w, h) * 0.3;
    const organX = w * 0.58;
    const organW = w * 0.28;
    const hdr = this.headerPressures();
    const rows = this.organFlows();
    const widths = this.calibers();
    const maxQ = Math.max(...rows.map((r) => r.q), 0.01);
    const a0 = -Math.PI * 0.2;
    const a1 = Math.PI * 1.2;

    const grad = ctx.createLinearGradient(cx - loopR, cy, cx + loopR, cy);
    grad.addColorStop(0, pal.accent);
    grad.addColorStop(0.5, pal.accent);
    grad.addColorStop(0.62, pal.down);
    grad.addColorStop(1, pal.down);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, loopR, a0, a1);
    ctx.stroke();

    const dots = 16;
    const speed = 0.08 + hdr.co * 0.03;
    for (let i = 0; i < dots; i++) {
      const u = (i / dots + this.animT * speed) % 1;
      const ang = a0 + u * (a1 - a0);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * loopR, cy + Math.sin(ang) * loopR, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = u < 0.48 ? "#ffe8e2" : "#d7e6ff";
      ctx.fill();
    }

    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy + 4);
    ctx.bezierCurveTo(cx - 26, cy - 20, cx + 26, cy - 20, cx + 16, cy + 4);
    ctx.bezierCurveTo(cx + 6, cy + 16, cx - 6, cy + 16, cx - 16, cy + 4);
    ctx.fill();
    ctx.fillStyle = pal.ink;
    ctx.font = "600 13px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.mode === "autoreg" ? "Arterial pressure" : "Pump", cx, cy + loopR + 28);
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillStyle = pal.muted;
    ctx.fillText(this.mode === "autoreg" ? `${hdr.map.toFixed(0)} mmHg` : `${hdr.co.toFixed(1)} L/min`, cx, cy + loopR + 46);

    rows.forEach((org, i) => {
      const y = h * 0.16 + (i / (rows.length - 1 || 1)) * h * 0.68;
      const bar = (org.q / maxQ) * (organW * 0.62);
      const wide = widths[i] ?? 4;
      ctx.strokeStyle = org.highlight ? (this.mode === "autoreg" ? pal.warn : pal.accent) : pal.down;
      ctx.lineWidth = wide;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx + loopR * 0.72, cy);
      ctx.quadraticCurveTo((cx + organX) / 2, y, organX - 6, y);
      ctx.stroke();
      ctx.fillStyle = org.highlight ? (this.mode === "autoreg" ? pal.warn : pal.accent) : pal.down;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(organX, y - 9, Math.max(6, bar), 18, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(organX, y - 9, organW * 0.62, 18, 6);
      ctx.stroke();
      ctx.fillStyle = pal.ink;
      ctx.font = "13px Helvetica Neue, Helvetica, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(org.label, organX, y - 16);
      ctx.fillStyle = pal.muted;
      ctx.font = "12px IBM Plex Mono, monospace";
      ctx.fillText(`${org.q.toFixed(2)}`, organX + organW * 0.66, y + 4);
    });

    ctx.textAlign = "left";
    ctx.fillStyle = pal.ink;
    ctx.font = "600 13px Helvetica Neue, Helvetica, Arial, sans-serif";
    ctx.fillText(`MAP  ${hdr.map.toFixed(0)}`, 18, 26);
    ctx.fillStyle = pal.down;
    ctx.fillText(`CVP  ${hdr.cvp.toFixed(0)}`, 18, 46);
    ctx.fillStyle = pal.ok;
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillText(hdr.foot, 18, h - 18);
  }
}
