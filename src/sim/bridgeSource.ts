import type { BeatSummary, Chamber, DeviceConsole, HemoNode, HemoNumbers, HemoSource, Saturations, Series } from "./hemoSource";
import type { PatientSpec } from "./patient";
import type { Simulation } from "./simulation";
import type { BeatRecord } from "./metrics";
import { CATH_NODES as NODES } from "../physics/structural"; // the splanchnic reservoir is not a catheter site
import type { StructuralReport, StructuralSpec, Waveform } from "../physics/structural";
import { BASE_SVR } from "../physics/circulation";
import { PATIENTS, O2_PER_G_HB, type PatientKind } from "../config/structural";
import { SUPPORT } from "../config/management";
import { BRIDGE } from "../config/bridge";
import { ISCHEMIA } from "../config/ischemia";
import { syncSolver } from "./bridgeSolver";
import type { BridgeSolver, SolveRequest, SolveResult } from "./bridgeSolver";

const CHAMBERS: readonly Chamber[] = ["RA", "RV", "LA", "LV"];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const empty = (): Series => ({ t: new Float32Array(0), v: new Float32Array(0) });
const VOL_KEY = { RA: "vRA", RV: "vRV", LA: "vLA", LV: "vLV" } as const;

const NaNs = <T extends string>(keys: readonly T[]) => Object.fromEntries(keys.map((k) => [k, NaN])) as Record<T, number>;
/** Before the first (asynchronous) solve lands: every value unknown, which panels draw as a dash. */
const NO_NUMBERS: HemoNumbers = {
  hr: NaN, map: NaN, systolic: NaN, diastolic: NaN, cvp: NaN, pa: { systolic: NaN, diastolic: NaN, mean: NaN }, pcwp: NaN, lvedp: NaN, rvedp: NaN,
  co: NaN, ci: NaN, svr: NaN, pvr: NaN, lvEf: NaN, rvEf: NaN, qpQs: NaN,
};
const noSaturations = (): Saturations => ({
  node: NaNs(NODES), spo2: NaN, preductal: NaN, postductal: NaN, svo2: NaN, do2: NaN, vo2: NaN, lactate: NaN, bed: {}, bedSource: "ischemia-derived",
});

/**
 * Per-bed tissue oxygenation placeholder until tasks E2/E3: 0.75 - 0.45 x the bed's ischemia (`BRIDGE.bedOxygen`), for the ischemia sites
 * (not the nodal ones). Shared by every source, so the O2 view reads the same whichever engine runs.
 */
export function bedOxygen(sim: Simulation): Record<string, number> {
  const bed: Record<string, number> = {}, B = BRIDGE.bedOxygen;
  for (const s of sim.sites) if (!/^(SAN|AVN)#/.test(s.key)) bed[s.key] = clamp(B.base - B.slope * (sim.sev[s.key] ?? 0), 0, 1);
  return bed;
}

/** What a solve was made from; a re-solve is due when the live inputs move away from it. */
interface Inputs { hr: number; lv: number; rv: number; map: number; svr: number; co: number }

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
 *  - `lvEes` = (heart.lvEes ?? 1) x max(0.2, 1 - ISCHEMIA.lvEesLoss x sim.circ.lvIschemia): left-ventricular end-systolic
 *    elastance only. The loss (1.25) is above the ACS model's own 0.8 because ischemic segments bulge. The ACS constant
 *    is not touched, so the monitor is unaffected. The stroke volume the structural engine returns is its own answer.
 *  - `lvStiffness` / `rvStiffness` = (heart value ?? 1) x (1 + ISCHEMIA.*StiffGain x ischemia): passive stiffness rises
 *    during acute ischemia, so filling pressure is higher at a given volume.
 *  - `rvEes` = (heart.rvEes ?? 1) x (1 - ISCHEMIA.rvEesLoss x sim.circ.rvIschemia): weaker RV contraction only. (Not
 *    `rvContractility`, which also stiffens the RV and would hold CVP down.)
 *  - `svrScale` = sim.circ.svr / BASE_SVR x (heart.svrScale ?? 1) x `svrMul`: the starting resistance comes from the ACS
 *    model (sympathetic, vagal and drug effects); `svrMul` is the calibrated correction, see "Cardiac output" below.
 *  - `volumeMl` = (heart.volumeMl ?? 0) + a calibrated volume, see below.
 *  - Not mapped: drugs and fluids as such (their effect on MAP reaches the engine through svr and the calibrated volume),
 *    Impella/IABP (the structural engine has no devices; see devices()), the pericardium, fluids and ventilation of a PatientSpec.
 *
 * MAP calibration: the volume (ml added to or removed from the circulation, standing in for venoconstriction and fluids;
 * clamped to BRIDGE.volumeRangeMl) is adjusted (first step from an assumed slope, then secant, at most
 * `maxCalibrationIterations` extra analyze calls, stop within `mapToleranceMmHg`) until the structural mean aortic
 * pressure matches the monitor's
 * MAP: the mean of the simulation's beat MAPs over the last 15 s (`sim.rolling`, as a bedside monitor averages; falls back
 * to `sim.map` before there are beats). The beat-to-beat MAP of the ACS model swings by about +-5 mmHg from respiration
 * and the baroreflex, which would force a re-solve every 3 s; the averaged value is the trigger and the target. `calibrationError` is the remaining difference (structural minus monitor, mmHg), nonzero when the volume clamp binds. The volume is public as `volume`. If
 * the PatientSpec has a lesion the ACS model knows nothing about, the calibration still forces MAP to the monitor's.
 *
 * Cardiac output (task P2d): matching MAP alone left the bridge's CO well off the monitor's (RV infarct: 2.88 against 1.84
 * L/min). Two causes, measured: (1) `circ.svr` is the ACS model's open-loop resistance; its MAP is baroreflex-buffered
 * (map = baseMap - (baseMap - CO x svr) x retained), so the resistance its own MAP and CO imply, (MAP - RAP) / CO, is higher
 * (about 24 against 16 mmHg.min/L in the RV infarct); (2) the structural engine's heart is stronger than the ACS model's
 * in the RV infarct at the same filling (it lacks the series RV-LV interdependence, septal shift and pericardial
 * constraint that cut the real LV preload), so volume alone cannot give both CO and the high CVP of the syndrome (CO 1.85
 * needed a volume that put CVP at 3). So the solve has three knobs, in two phases (src/sim/bridgeSolver.ts): the volume
 * for MAP (filling, as before), then with the volume fixed `svrMul` on systemic resistance (effective resistance, from MAP
 * and RAP) and `eesMul` on LV end-systolic elastance (the unmodelled LV dysfunction of interdependence, 0.5 in the RV
 * infarct, 0.9 in an anterior STEMI) until MAP is within 1 mmHg and the structural flow within 3 % of the monitor's native
 * CO (`circ.cardiacOutput` minus the device flow, which the structural engine does not see). The multipliers are public
 * (`svrMul`, `eesMul`), `coError` is the remaining flow difference. A re-solve is also due when that CO moves by 5 %.
 *
 * Re-solving: never every frame. A solve (several analyze calls, ~100 ms each) runs when an input moved from its value at
 * the last solve by more than a threshold (HR 3 bpm, ischemia 0.03 of either ventricle, monitor MAP 3 mmHg) and at least
 * 3 s of simulated time have passed; also on `refresh()`. The check runs at each beat and when numbers() or
 * saturations() is read. The engine work (spec in, calibrated report out) is a `BridgeSolver` (src/sim/bridgeSolver.ts):
 * the synchronous one by default (Node, tests), or an asynchronous one such as the Web Worker of
 * src/sim/bridgeWorkerSolver.ts (task P2b). With an asynchronous solver the bridge keeps replaying the previous waveform
 * while a solve is in flight and never starts a second one: a refresh() meanwhile is remembered and, when the first
 * lands, solved from the then-live inputs. A result is applied like a synchronous one, with the one-beat blend. Before the
 * first result numbers() and saturations() are all NaN and there are no beats; `solves` counts applied results,
 * `analyzeCalls` the calls made inside them, `calibrationError` is that of the last applied result.
 *
 * Replay: each ventricular beat of the simulation (`Simulation.onBeat`, chained, restored by `dispose()`) emits one
 * `BeatSummary` covering the interval that just ended (start = beat time - RR). The cached waveform is time-warped to the
 * actual RR: systole (up to the LV's end-systolic volume) and the final atrial-contraction tail keep their duration,
 * the diastole between them is stretched or compressed (a short RR shortens filling). When the diastole left is under
 * 50 ms the whole beat is scaled uniformly. Volumes (EDV, ESV, SV) and valve statistics are those of the solve and do not
 * change with the RR. When a re-solve changes the waveform, the next beat is blended from the old waveform to the new
 * one over its length so traces do not jump. `atrial`: the P wave one PR before the beat's closing R wave; none in AF
 * or for a PVC; in third-degree block, P waves at the sinus rate, dissociated from the beats. (The waveform's own atrial
 * contraction is not removed in AF: a limit of the bridge.) A 30 s ring buffer of beats serves `trace()`, whose sample times are strictly increasing
 * (a beat shorter than the 0.25 s replay minimum is cut where the next one starts). A reload of the simulation (its clock
 * going back) clears the buffer, the cached solve and the beats, as a new patient.
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
 * Standalone patients (task P2e): the ACS model is an adult, so when the PatientSpec's kind is not "adult" (a neonate) the
 * monitor's state is not mapped and the solve is not calibrated to it: mapping an adult MAP of 86 onto a newborn heart
 * loaded volume until the pressures were absurd (LV 104/67, aorta 103/72, a normal mitral valve read as severe
 * stenosis). `standalone` is then true: the structural engine is solved once on the patient's own baseline (its HR, MAP,
 * volume) plus the PatientSpec's heart lesions, with no ischemia mapping, no svr/volume/Ees calibration (`volume`,
 * `svrMul`, `eesMul` stay 0/1/1, `calibrationError` and `coError` NaN) and no re-solve when the monitor moves (only
 * `refresh()`). The monitor (ACS, adult) is not meaningful for such a patient and pages should say so. Beats are replayed
 * at the patient's own heart rate (the solved waveform's period), not the monitor's rhythm: on each ACS beat the beats
 * that fit since the last one are emitted, with the P wave a fixed PR before each. Adult patients are unchanged.
 *
 * Counters `analyzeCalls` and `solves` are public for tests and for the performance budget.
 */
export class BridgeSource implements HemoSource {
  readonly kind = "bridge" as const;
  /** analyze() calls made so far (a solve makes 1 to 1 + maxCalibrationIterations), and solves. */
  analyzeCalls = 0;
  solves = 0;
  /** `kind` of the PatientSpec; see "Standalone patients" in the class comment. */
  get patientKind(): PatientKind { return this.opts.patient?.kind ?? "adult"; }
  /** Read live (a page may set `opts.patient` after construction); true for any kind other than "adult". */
  get standalone(): boolean { return this.patientKind !== "adult"; }
  /** Structural mean aortic pressure minus the monitor's MAP at the last solve, mmHg. */
  calibrationError = NaN;

  private report: StructuralReport | null = null;
  private wave: Waveform | null = null;
  private lastInputs: Inputs | null = null;
  private lastSolveT = -Infinity;
  private inFlight = false;
  private queued = false;
  private solver: BridgeSolver;
  /** ml added (+) or removed (-) by the MAP calibration at the last solve. */
  volume = 0;
  /** Multipliers the cardiac-output calibration put on svrScale and lvEes at the last solve, and the flow error (structural minus monitor, L/min). */
  svrMul = 1; eesMul = 1; coError = NaN;
  private blendFrom: Waveform | null = null;
  private ring: BeatSummary[] = [];
  private subs = new Set<(b: BeatSummary) => void>();
  private prevHandler: Simulation["onBeat"];
  private hook: (b: BeatRecord) => void;
  private active = true;
  private ownT = -Infinity; // standalone: end of the last beat emitted on the patient's own clock
  private pPhase = 0; // s, next P wave in third-degree block, on the simulation clock
  /** Largest simulation clock seen (reads and beats): a smaller one means the simulation was reloaded. */
  private clockSeen = 0;
  /** Counts reloads; a solve that was started before one is discarded when it lands. */
  private epoch = 0;

  /** `opts.patient` is read at each solve, so a page may set it later. `solver` defaults to the synchronous one. */
  constructor(private sim: Simulation, private opts: { patient?: PatientSpec; solver?: BridgeSolver } = {}) {
    this.solver = opts.solver ?? syncSolver;
    this.prevHandler = sim.onBeat;
    this.hook = (rec) => {
      this.prevHandler?.(rec);
      if (this.active) this.handleBeat(rec);
    };
    sim.onBeat = this.hook;
  }

  /** Stop listening and give the simulation its original beat handler back (if nothing was chained after ours). */
  dispose() {
    this.active = false;
    if (this.sim.onBeat === this.hook) this.sim.onBeat = this.prevHandler;
    this.subs.clear();
  }

  now() { this.sync(this.sim.t); return this.sim.t; }
  nodes(): readonly string[] { return NODES; }
  onBeat(cb: (b: BeatSummary) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  beats(count = 8): readonly BeatSummary[] { this.sync(this.sim.t); return this.ring.slice(-count); }

  /** Re-solve now, whatever the thresholds say. */
  refresh() { this.solve(); }

  /**
   * Notice a reload. `Simulation.reset` (a loaded scenario) sets the clock back to 0, but the ring holds beats stamped on
   * the old clock, so trace() would join old and new samples with time running backwards. A clock that moved back is a
   * new patient: the ring, the cached solve and the third-degree P-wave phase are dropped and the first beat solves
   * afresh. `t` is the clock of what is being read (a beat's end, or `sim.t`).
   */
  private sync(t: number) {
    if (t < this.clockSeen - 1e-6) {
      this.epoch++;
      this.ring = []; this.report = null; this.wave = null; this.blendFrom = null; this.lastInputs = null;
      this.lastSolveT = -Infinity; this.queued = false; this.pPhase = 0; this.ownT = -Infinity; this.volume = 0; this.calibrationError = NaN; this.svrMul = 1; this.eesMul = 1; this.coError = NaN;
    }
    if (t > this.clockSeen || t < this.clockSeen) this.clockSeen = t;
  }

  // ---- solving ----------------------------------------------------------------------------------------------------

  private inputs(): Inputs {
    const c = this.sim.circ;
    const m = this.sim.rolling(BRIDGE.mapWindowS).map;
    return { hr: c.hr, lv: c.lvIschemia, rv: c.rvIschemia, map: Number.isFinite(m) ? m : this.sim.map, svr: c.svr, co: c.cardiacOutput - c.deviceFlow };
  }

  private maybeSolve() {
    if (this.inFlight) return; // the beat after it lands checks the thresholds against the new solve
    if (!this.report || !this.lastInputs) { if (this.sim.t - this.lastSolveT >= BRIDGE.minSolveIntervalS) this.solve(); return; }
    if (this.standalone) return; // the monitor does not drive this patient
    if (this.sim.t - this.lastSolveT < BRIDGE.minSolveIntervalS) return;
    const a = this.inputs(), b = this.lastInputs, T = BRIDGE.threshold;
    if (Math.abs(a.hr - b.hr) > T.hrBpm || Math.abs(a.lv - b.lv) > T.ischemia || Math.abs(a.rv - b.rv) > T.ischemia || Math.abs(a.map - b.map) > T.mapMmHg || Math.abs(a.svr / b.svr - 1) > T.svrFrac || Math.abs(a.co / b.co - 1) > BRIDGE.coThresholdFrac) this.solve();
  }

  private spec(volumeMl: number): StructuralSpec {
    const h = this.opts.patient?.heart ?? {}, c = this.sim.circ;
    if (this.standalone) return { ...h, patient: this.patientKind, hr: PATIENTS[this.patientKind].hr };
    return {
      ...h, patient: this.opts.patient?.kind ?? "adult", hr: c.hr,
      svrScale: (c.svr / BASE_SVR) * (h.svrScale ?? 1), volumeMl: (h.volumeMl ?? 0) + volumeMl,
      lvEes: (h.lvEes ?? 1) * Math.max(ISCHEMIA.eesFloor, 1 - ISCHEMIA.lvEesLoss * c.lvIschemia),
      lvStiffness: (h.lvStiffness ?? 1) * (1 + ISCHEMIA.lvStiffGain * c.lvIschemia), rvStiffness: (h.rvStiffness ?? 1) * (1 + ISCHEMIA.rvStiffGain * c.rvIschemia),
      rvEes: (h.rvEes ?? 1) * Math.max(ISCHEMIA.eesFloor, 1 - ISCHEMIA.rvEesLoss * c.rvIschemia),
    };
  }

  /** Start a solve of the live inputs. With an asynchronous solver, one at a time; a call during a solve is queued. */
  private solve() {
    if (this.inFlight) { this.queued = true; return; }
    const inputs = this.inputs(), req: SolveRequest = { base: this.spec(0), volume: this.volume, targetMap: inputs.map, targetCo: inputs.co, standalone: this.standalone, warm: this.report ? { svr: this.svrMul, ees: this.eesMul } : undefined };
    let out: SolveResult | Promise<SolveResult>;
    try { out = this.solver.solve(req); } catch (e) { this.failed(e); return; }
    if (!(out instanceof Promise)) { this.apply(out, inputs); return; }
    this.inFlight = true;
    const epoch = this.epoch;
    out.then(
      (r) => { this.inFlight = false; if (this.active && epoch === this.epoch) this.apply(r, inputs); this.drain(); },
      (e) => { this.inFlight = false; this.failed(e); this.drain(); },
    );
  }

  /** After an asynchronous solve: run the one asked for meanwhile, from the live inputs of now (the latest wanted wins). */
  private drain() {
    if (!this.active || !this.queued) return;
    this.queued = false;
    this.solve();
  }

  private failed(e: unknown) {
    console.warn("CoroSim: the bridge solve failed", e);
    this.lastSolveT = this.sim.t; // do not retry on every beat
  }

  /** Cache a solved report; the next beat blends from the previous waveform to this one. */
  private apply(r: SolveResult, inputs: Inputs) {
    this.analyzeCalls += r.analyzeCalls;
    this.volume = r.volume; this.calibrationError = r.calibrationError; this.svrMul = r.svrMul; this.eesMul = r.eesMul; this.coError = r.coError;
    if (this.wave) this.blendFrom = this.wave;
    this.report = r.report; this.wave = r.report.waveform ?? null;
    this.lastInputs = inputs; this.lastSolveT = this.sim.t; this.solves++;
  }

  /** The cached report, or null before the first asynchronous solve has finished. */
  private ensure(): StructuralReport | null {
    this.maybeSolve();
    return this.report;
  }

  // ---- replay -----------------------------------------------------------------------------------------------------

  private handleBeat(rec: BeatRecord) {
    this.sync(Math.min(this.sim.t, rec.t));
    this.maybeSolve();
    if (!this.wave || !this.report) return;
    if (this.standalone) { // the patient's own rate: every beat that fits in the interval the monitor just closed
      const T0 = this.wave.t[this.wave.t.length - 1];
      if (!(this.ownT > rec.t - rec.interval - T0)) this.ownT = rec.t - rec.interval;
      while (this.ownT + T0 <= rec.t + 1e-9) {
        const start = this.ownT;
        this.ownT += T0;
        this.emit(this.makeBeat(start, T0, false, Float32Array.from([Math.max(0, T0 - BRIDGE.standalonePrS)])));
      }
      return;
    }
    this.emit(this.makeBeat(rec.t - rec.interval, rec.interval, rec.pvc, this.atrialTimes(rec, Math.max(0.25, rec.interval))));
  }

  private emit(b: BeatSummary) {
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

  private makeBeat(start: number, interval: number, pvc: boolean, atrial: Float32Array): BeatSummary {
    const w = this.wave!, rep = this.report!, rr = Math.max(0.25, interval);
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
      t: start, rr, pvc, loops, pressure, time, atrial,
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
    this.sync(this.sim.t);
    const from = this.sim.t - seconds, ts: number[] = [], vs: number[] = [];
    let last = -Infinity;
    for (const b of this.ring) {
      if (b.t + b.rr < from) continue;
      const v = vol ? b.loops[node as Chamber].v : b.pressure[node as HemoNode];
      // Time must only increase (the contract of Series): a beat shorter than the replay minimum (rr is held at 0.25 s) runs
      // into the next one, and the later beat wins where they overlap.
      while (ts.length && last >= Math.fround(b.t)) { ts.pop(); vs.pop(); last = ts.length ? Math.fround(ts[ts.length - 1]) : -Infinity; }
      for (let k = 0; k < v.length; k++) {
        const t = b.t + b.time[k], tf = Math.fround(t); // the Series holds float32: compare as stored
        if (t >= from && tf > last) { ts.push(t); vs.push(v[k]); last = tf; }
      }
    }
    const n = ts.length, m = Math.min(n, max);
    const t = new Float32Array(m), v = new Float32Array(m);
    for (let i = 0; i < m; i++) { const k = m === n ? i : Math.floor((i * (n - 1)) / (m - 1)); t[i] = ts[k]; v[i] = vs[k]; }
    return { t, v };
  }

  numbers(): HemoNumbers {
    this.sync(this.sim.t);
    const r = this.ensure();
    if (!r) return NO_NUMBERS;
    const p = r.pressure, bsa = PATIENTS[this.opts.patient?.kind ?? "adult"].bsa;
    return {
      hr: r.hr, map: p.AO.mean, systolic: p.AO.max, diastolic: p.AO.min,
      cvp: p.RA.mean, pa: { systolic: p.PA.max, diastolic: p.PA.min, mean: p.PA.mean }, pcwp: p.LA.mean,
      lvedp: p.LV.end, rvedp: p.RV.end, co: r.qs, ci: r.qs / bsa, svr: r.svr, pvr: r.pvr, lvEf: r.lvEf, rvEf: r.rvEf, qpQs: r.qpQs,
    };
  }

  saturations(): Saturations {
    this.sync(this.sim.t);
    const r = this.ensure(), kind = this.opts.patient?.kind ?? "adult", base = PATIENTS[kind];
    if (!r) return noSaturations();
    const node = {} as Record<HemoNode, number>;
    for (const n of NODES) node[n] = r.saturation[n];
    const bed = bedOxygen(this.sim);
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
