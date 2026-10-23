import type { BeatSummary, Chamber, DeviceConsole, HemoNode, HemoNumbers, HemoSource, Saturations, Series } from "./hemoSource";
import type { PatientSpec } from "./patient";
import type { Simulation } from "./simulation";
import type { BeatRecord } from "./metrics";
import { analyze, NODES } from "../physics/structural";
import type { StructuralReport, StructuralSpec, Waveform } from "../physics/structural";
import { CIRC } from "../physics/circulation";
import { PATIENTS, O2_PER_G_HB } from "../config/structural";
import { SUPPORT } from "../config/management";
import { BRIDGE } from "../config/bridge";

const CHAMBERS: readonly Chamber[] = ["RA", "RV", "LA", "LV"];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const empty = (): Series => ({ t: new Float32Array(0), v: new Float32Array(0) });
const VOL_KEY = { RA: "vRA", RV: "vRV", LA: "vLA", LV: "vLV" } as const;

/** What a solve was made from; a re-solve is due when the live inputs move away from it. */
interface Inputs { hr: number; lv: number; rv: number; map: number }

/**
 * `HemoSource` over today's engines (task P2): the ACS `Simulation` supplies the state of the patient, the structural
 * engine (src/physics/structural.ts) supplies structural-quality hemodynamics (waveforms, chamber volumes, valve
 * statistics, saturations), and this class replays the solved beat once per ventricular beat of the simulation.
 * `kind` is "bridge": the numbers are a steady-state solve replayed, not a beat-by-beat engine, so a beat's waveform does
 * not carry beat-to-beat physiology (Frank-Starling, PVC potentiation, an atrial kick lost in AF). Task P16 replaces this.
 *
 * Mapping from the ACS state to a `StructuralSpec` (every choice, so a reader can check the direction):
 *  - `patient`: PatientSpec.kind (default "adult"; the ACS model is an adult model).
 *  - `heart` lesions: the optional PatientSpec passed to the constructor (Simulation keeps only the normalised Scenario,
 *    not the structural fields). Its fields are copied as given.
 *  - `hr`: `sim.circ.hr`, the ventricular rate the rhythm implies (not the noisy measured one).
 *  - `lvContractility` = (heart.lvContractility ?? 1) x (1 - CIRC.lvContractileLoss x sim.circ.lvIschemia): the same loss
 *    constant the ACS model uses on stroke volume, here applied to left-ventricular end-systolic elastance. Floor 0.2
 *    (structural clamp). In the ACS model the loss works on stroke volume; here it works on Ees, so the stroke volume the
 *    structural engine returns is its own answer (afterload and preload respond), not the ACS number.
 *  - `rvContractility` = (heart.rvContractility ?? 1) x (1 - CIRC.rvPreloadLoss x sim.circ.rvIschemia): the ACS model
 *    has only an RV "preload loss" (less blood delivered to the left heart); that constant is reused as the RV
 *    contractility loss so the direction matches (RV infarct: less RV output, higher right-sided filling pressure).
 *    Note the structural engine scales the RV's passive stiffness with rvContractility too.
 *  - `svrScale`: calibrated, see below. A `heart.svrScale` in the PatientSpec is only the starting guess.
 *  - Not mapped: reflexes (the ACS model's autonomic loop acts through the calibrated svrScale and the rate), drugs and
 *    volume (their effect on MAP is absorbed by the calibration, on filling pressures it is not), Impella/IABP (the
 *    structural engine has no devices; see devices()), the pericardium, fluids and ventilation of a PatientSpec.
 *
 * MAP calibration: `svrScale` is adjusted (proportional first step, then secant, at most `maxCalibrationIterations`
 * extra analyze calls, stop within `mapToleranceMmHg`) until the structural mean aortic pressure matches the monitor's
 * MAP: the mean of the simulation's beat MAPs over the last 15 s (`sim.rolling`, as a bedside monitor averages; falls back
 * to `sim.map` before there are beats). The beat-to-beat MAP of the ACS model swings by about +-5 mmHg from respiration
 * and the baroreflex, which would force a re-solve every 3 s; the averaged value is the trigger and the target. `calibrationError` is the remaining difference (structural minus monitor, mmHg). If
 * the PatientSpec has a lesion the ACS model knows nothing about, the calibration still forces MAP to the monitor's.
 *
 * Re-solving: never every frame. A solve (several analyze calls, ~100 ms each) runs when an input moved from its value at
 * the last solve by more than a threshold (HR 3 bpm, ischemia 0.03 of either ventricle, monitor MAP 3 mmHg) and at least
 * 3 s of simulated time have passed; also on `refresh()`. The check runs at each beat and when numbers() or
 * saturations() is read. All solve work is in `solve()`, so it can move to a worker later.
 *
 * Replay: each ventricular beat of the simulation (`Simulation.onBeat`, chained, restored by `dispose()`) emits one
 * `BeatSummary` covering the interval that just ended (start = beat time - RR). The cached waveform is time-warped to the
 * actual RR: systole (up to the LV's end-systolic volume) and the final atrial-contraction tail keep their duration,
 * the diastole between them is stretched or compressed (a short RR shortens filling). When the diastole left is under
 * 50 ms the whole beat is scaled uniformly. Volumes (EDV, ESV, SV) and valve statistics are those of the solve and do not
 * change with the RR. When a re-solve changes the waveform, the next beat is blended from the old waveform to the new
 * one over its length so traces do not jump. `atrial`: the P wave one PR before the beat's closing R wave; none in AF
 * or for a PVC; in third-degree block, P waves at the sinus rate, dissociated from the beats. (The waveform's own atrial
 * contraction is not removed in AF: a limit of the bridge.) A 30 s ring buffer of beats serves `trace()`.
 *
 * numbers(): from the cached report: MAP, systolic, diastolic = aortic mean, max, min; CVP = mean RA; PCWP = mean LA;
 * LVEDP / RVEDP = `end` of the LV / RV pressure; CO = systemic flow, CI = CO / BSA; SVR, PVR in Wood units; EF, Qp:Qs.
 * saturations(): per node from the report; SpO2 = pre-ductal (aortic) saturation; SvO2 = pulmonary artery;
 * DO2 = CO(L/min) x Hb(g/dl) x 10 x 1.34 x SaO2 (ml O2/min, dissolved O2 ignored); VO2 = the patient baseline,
 * vo2PerKg x weight (ml O2/min), the same demand the structural engine uses (the ACS model has no VO2 of its own);
 * lactate NaN.
 * Per-bed tissue oxygenation is a PLACEHOLDER until tasks E2/E3: 0.75 - 0.45 x `sim.sev[bed]`, `bedSource` is
 * "ischemia-derived".
 * devices(): if `sim.support.impella` or `.iabp` is on, a minimal console labelled as the legacy ACS device model, with the
 * flow `sim.circ.deviceFlow` (Impella) in `flowLpm`; otherwise empty. The structural engine does not see the device, so
 * the numbers do not include it.
 *
 * Counters `analyzeCalls` and `solves` are public for tests and for the performance budget.
 */
export class BridgeSource implements HemoSource {
  readonly kind = "bridge" as const;
  /** analyze() calls made so far (a solve makes 1 to 1 + maxCalibrationIterations), and solves. */
  analyzeCalls = 0;
  solves = 0;
  /** Structural mean aortic pressure minus the monitor's MAP at the last solve, mmHg. */
  calibrationError = NaN;

  private report: StructuralReport | null = null;
  private wave: Waveform | null = null;
  private lastInputs: Inputs | null = null;
  private lastSolveT = -Infinity;
  private svr = 1;
  private blendFrom: Waveform | null = null;
  private ring: BeatSummary[] = [];
  private subs = new Set<(b: BeatSummary) => void>();
  private prevHandler: Simulation["onBeat"];
  private hook: (b: BeatRecord) => void;
  private active = true;
  private pPhase = 0; // s, next P wave in third-degree block, on the simulation clock

  constructor(private sim: Simulation, private opts: { patient?: PatientSpec } = {}) {
    this.prevHandler = sim.onBeat;
    this.hook = (rec) => {
      this.prevHandler?.(rec);
      if (this.active) this.handleBeat(rec);
    };
    sim.onBeat = this.hook;
    this.svr = opts.patient?.heart?.svrScale ?? 1;
  }

  /** Stop listening and give the simulation its original beat handler back (if nothing was chained after ours). */
  dispose() {
    this.active = false;
    if (this.sim.onBeat === this.hook) this.sim.onBeat = this.prevHandler;
    this.subs.clear();
  }

  now() { return this.sim.t; }
  nodes(): readonly string[] { return NODES; }
  onBeat(cb: (b: BeatSummary) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  beats(count = 8): readonly BeatSummary[] { return this.ring.slice(-count); }

  /** Re-solve now, whatever the thresholds say. */
  refresh() { this.solve(); }

  // ---- solving ----------------------------------------------------------------------------------------------------

  private inputs(): Inputs {
    const c = this.sim.circ;
    const m = this.sim.rolling(BRIDGE.mapWindowS).map;
    return { hr: c.hr, lv: c.lvIschemia, rv: c.rvIschemia, map: Number.isFinite(m) ? m : this.sim.map };
  }

  private maybeSolve() {
    if (!this.report || !this.lastInputs) { this.solve(); return; }
    if (this.sim.t - this.lastSolveT < BRIDGE.minSolveIntervalS) return;
    const a = this.inputs(), b = this.lastInputs, T = BRIDGE.threshold;
    if (Math.abs(a.hr - b.hr) > T.hrBpm || Math.abs(a.lv - b.lv) > T.ischemia || Math.abs(a.rv - b.rv) > T.ischemia || Math.abs(a.map - b.map) > T.mapMmHg) this.solve();
  }

  private spec(svrScale: number): StructuralSpec {
    const h = this.opts.patient?.heart ?? {}, c = this.sim.circ;
    return {
      ...h, patient: this.opts.patient?.kind ?? "adult", hr: c.hr, svrScale,
      lvContractility: (h.lvContractility ?? 1) * (1 - CIRC.lvContractileLoss * c.lvIschemia),
      rvContractility: (h.rvContractility ?? 1) * (1 - CIRC.rvPreloadLoss * c.rvIschemia),
    };
  }

  /** The one place engine work happens: build the spec, calibrate svrScale to the monitor's MAP, cache the report. */
  private solve() {
    const inputs = this.inputs(), target = inputs.map;
    const run = (s: number) => { this.analyzeCalls++; return analyze(this.spec(s), { waveform: true }); };
    let s = clamp(this.svr, 0.1, 5), r = run(s), f = r.pressure.AO.mean - target;
    let best = { r, f, s };
    let sPrev = NaN, fPrev = NaN;
    for (let i = 0; i < BRIDGE.maxCalibrationIterations && Math.abs(best.f) > BRIDGE.mapToleranceMmHg; i++) {
      let next = Number.isFinite(sPrev) && Math.abs(f - fPrev) > 1e-9 ? s - (f * (s - sPrev)) / (f - fPrev) : s * (target / Math.max(1, r.pressure.AO.mean));
      next = clamp(next, 0.1, 5);
      if (Math.abs(next - s) < 1e-6) break;
      sPrev = s; fPrev = f; s = next; r = run(s); f = r.pressure.AO.mean - target;
      if (Math.abs(f) < Math.abs(best.f)) best = { r, f, s };
    }
    this.svr = best.s; this.calibrationError = best.f;
    if (this.wave) this.blendFrom = this.wave;
    this.report = best.r; this.wave = best.r.waveform ?? null;
    this.lastInputs = inputs; this.lastSolveT = this.sim.t; this.solves++;
  }

  private ensure(): StructuralReport {
    this.maybeSolve();
    return this.report!;
  }

  // ---- replay -----------------------------------------------------------------------------------------------------

  private handleBeat(rec: BeatRecord) {
    this.maybeSolve();
    if (!this.wave || !this.report) return;
    const b = this.makeBeat(rec);
    this.blendFrom = null;
    this.ring.push(b);
    const cutoff = this.sim.t - BRIDGE.ringSeconds;
    while (this.ring.length > BRIDGE.maxBeats || (this.ring.length > 1 && this.ring[0].t + this.ring[0].rr < cutoff)) this.ring.shift();
    for (const cb of [...this.subs]) cb(b);
  }

  /** Piecewise-linear map from a beat of length rr to the solved beat of length T0: systole and the atrial tail keep their length. */
  private warp(w: Waveform, rr: number): (tau: number) => number {
    const T0 = w.t[w.t.length - 1];
    let iMin = 0;
    for (let i = 1; i < w.vLV.length; i++) if (w.vLV[i] < w.vLV[iMin]) iMin = i;
    const ts = w.t[iMin], tail = Math.min(BRIDGE.atrialTailS, BRIDGE.atrialTailMaxFrac * T0);
    if (rr - tail - ts < BRIDGE.minWarpDiastoleS || T0 - tail - ts < BRIDGE.minWarpDiastoleS) return (tau) => (tau * T0) / rr;
    const dStretch = (T0 - tail - ts) / (rr - tail - ts);
    return (tau) => (tau <= ts ? tau : tau >= rr - tail ? T0 - tail + (tau - (rr - tail)) : ts + (tau - ts) * dStretch);
  }

  /** One solved waveform resampled to n points over a beat of length rr. */
  private resample(w: Waveform, rr: number, n: number) {
    const map = this.warp(w, rr), src = w.t, last = src.length - 1;
    const idx = new Int32Array(n), frac = new Float32Array(n);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = clamp(map((k * rr) / n), 0, src[last]);
      while (j < last - 1 && src[j + 1] < s) j++;
      const d = src[j + 1] - src[j];
      idx[k] = j; frac[k] = d > 0 ? clamp((s - src[j]) / d, 0, 1) : 0;
    }
    const at = (a: number[]) => { const o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = a[idx[k]] + (a[idx[k] + 1] - a[idx[k]]) * frac[k]; return o; };
    return { at };
  }

  private makeBeat(rec: BeatRecord): BeatSummary {
    const w = this.wave!, rep = this.report!, rr = Math.max(0.25, rec.interval);
    const n = Math.max(8, Math.round(rr / BRIDGE.sampleDt));
    const cur = this.resample(w, rr, n), old = this.blendFrom ? this.resample(this.blendFrom, rr, n) : null;
    const series = (pick: (x: Waveform) => number[]) => {
      const c = cur.at(pick(w));
      if (!old) return c;
      const o = old.at(pick(this.blendFrom!));
      for (let k = 0; k < n; k++) { const a = k / n; o[k] += (c[k] - o[k]) * a; } // old to new across the beat
      return o;
    };
    const time = new Float32Array(n);
    for (let k = 0; k < n; k++) time[k] = (k * rr) / n;
    const pressure = {} as Record<HemoNode, Float32Array>;
    for (const nd of NODES) pressure[nd] = series((x) => x.p[nd]);
    const loops = {} as BeatSummary["loops"];
    const edv = {} as Record<Chamber, number>, esv = {} as Record<Chamber, number>;
    for (const c of CHAMBERS) {
      loops[c] = { p: pressure[c], v: series((x) => x[VOL_KEY[c]]) };
      const v = w[VOL_KEY[c]];
      edv[c] = Math.max(...v); esv[c] = Math.min(...v);
    }
    const vs = rep.valves, vz = { forwardMl: 0, regurgMl: 0, openMs: 0 };
    const val = (k: string) => (vs[k] ? { forwardMl: vs[k].forwardMl, regurgMl: vs[k].regurgMl, openMs: vs[k].openMs } : { ...vz });
    return {
      t: rec.t - rec.interval, rr, pvc: rec.pvc, loops, pressure, time, atrial: this.atrialTimes(rec, rr),
      edv, esv, strokeVolume: edv.LV - esv.LV, valves: { AV: val("AV"), MV: val("MV"), TV: val("TV"), PV: val("PVL") },
    };
  }

  /** Atrial activation times within the beat, s from its start. */
  private atrialTimes(rec: BeatRecord, rr: number): Float32Array {
    const rs = this.sim.rstate, start = rec.t - rec.interval;
    if (rs.rhythm === "af") return new Float32Array(0);
    if (rs.avDegree === 3) { // atria and ventricles dissociated: P waves march at the sinus rate
      const step = 60 / rs.sinusRate, out: number[] = [];
      if (!(this.pPhase > start - step)) this.pPhase = start;
      while (this.pPhase < start) this.pPhase += step;
      for (; this.pPhase < start + rr; this.pPhase += step) out.push(this.pPhase - start);
      return Float32Array.from(out);
    }
    if (rec.pvc || !rec.atrialKick) return new Float32Array(0);
    return Float32Array.from([Math.max(0, rr - rs.pr)]);
  }

  // ---- pull -------------------------------------------------------------------------------------------------------

  trace(node: string, seconds: number, opts: { quantity?: "pressure" | "volume"; maxPoints?: number } = {}): Series {
    const max = Math.max(2, opts.maxPoints ?? 600), vol = opts.quantity === "volume";
    if (vol ? !CHAMBERS.includes(node as Chamber) : !(NODES as readonly string[]).includes(node)) return empty();
    const from = this.sim.t - seconds, ts: number[] = [], vs: number[] = [];
    for (const b of this.ring) {
      if (b.t + b.rr < from) continue;
      const v = vol ? b.loops[node as Chamber].v : b.pressure[node as HemoNode];
      for (let k = 0; k < v.length; k++) { const t = b.t + b.time[k]; if (t >= from) { ts.push(t); vs.push(v[k]); } }
    }
    const n = ts.length, m = Math.min(n, max);
    const t = new Float32Array(m), v = new Float32Array(m);
    for (let i = 0; i < m; i++) { const k = m === n ? i : Math.floor((i * (n - 1)) / (m - 1)); t[i] = ts[k]; v[i] = vs[k]; }
    return { t, v };
  }

  numbers(): HemoNumbers {
    const r = this.ensure(), p = r.pressure, bsa = PATIENTS[this.opts.patient?.kind ?? "adult"].bsa;
    return {
      hr: r.hr, map: p.AO.mean, systolic: p.AO.max, diastolic: p.AO.min,
      cvp: p.RA.mean, pa: { systolic: p.PA.max, diastolic: p.PA.min, mean: p.PA.mean }, pcwp: p.LA.mean,
      lvedp: p.LV.end, rvedp: p.RV.end, co: r.qs, ci: r.qs / bsa, svr: r.svr, pvr: r.pvr, lvEf: r.lvEf, rvEf: r.rvEf, qpQs: r.qpQs,
    };
  }

  saturations(): Saturations {
    const r = this.ensure(), kind = this.opts.patient?.kind ?? "adult", base = PATIENTS[kind];
    const node = {} as Record<HemoNode, number>;
    for (const n of NODES) node[n] = r.saturation[n];
    const bed: Record<string, number> = {}, B = BRIDGE.bedOxygen;
    for (const s of this.sim.sites) if (!/^(SAN|AVN)#/.test(s.key)) bed[s.key] = clamp(B.base - B.slope * (this.sim.sev[s.key] ?? 0), 0, 1);
    return {
      node, spo2: r.preductalSat, preductal: r.preductalSat, postductal: r.postductalSat, svo2: r.saturation.PA,
      do2: r.qs * base.hb * 10 * O2_PER_G_HB * r.preductalSat, vo2: base.vo2PerKg * base.weightKg,
      lactate: NaN, bed, bedSource: "ischemia-derived",
    };
  }

  devices(): readonly DeviceConsole[] {
    const s = this.sim.support, out: DeviceConsole[] = [];
    if (s.impella) out.push({ id: "impella", label: "Impella (legacy ACS device model)", readings: { flowLpm: this.sim.circ.deviceFlow }, alarms: [] });
    if (s.iabp) out.push({ id: "iabp", label: "IABP (legacy ACS device model)", readings: { ratio: 1, flowLpm: 0, coronaryAugmentationMmHg: SUPPORT.iabpCoronaryAug }, alarms: [] });
    return out;
  }
}
