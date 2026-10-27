import type { BeatSummary, Chamber, DeviceConsole, HemoNode, HemoNumbers, HemoSource, Saturations, Series } from "./hemoSource";
import type { Simulation } from "./simulation";
import type { DevicesReadout } from "./coreDevices";
import { NODES as ALL_NODES, CATH_NODES as NODES, solveOxygen, type Model } from "../physics/structural";
import { oxygenatorSat, type Ecmo } from "../physics/core/devices/ecmo";
import type { RotaryPump } from "../physics/core/devices/pump";
import type { LiveBeat, LiveHeart } from "../physics/core/live";
import { windowedHemodynamicBeats, type HemoBeatSelection } from "./hemoBeats";
import { PATIENTS, O2_PER_G_HB } from "../config/structural";
import { LIVE_SOURCE as CFG } from "../config/liveSource";

const CHAMBERS: readonly Chamber[] = ["RA", "RV", "LA", "LV"];

/**
 * Per-bed tissue oxygenation placeholder until tasks E2/E3: 0.75 - 0.45 x the bed's ischemia (`LIVE_SOURCE.bedOxygen`), for the ischemia sites
 * (not the nodal ones). The O2 view reads it through `saturations().bed`.
 */
export function bedOxygen(sim: Simulation): Record<string, number> {
  const bed: Record<string, number> = {}, B = CFG.bedOxygen;
  for (const s of sim.sites) if (!/^(SAN|AVN)#/.test(s.key)) bed[s.key] = Math.min(1, Math.max(0, B.base - B.slope * (sim.sev[s.key] ?? 0)));
  return bed;
}
const IDX = (n: string) => (ALL_NODES as readonly string[]).indexOf(n);
const empty = (): Series => ({ t: new Float32Array(0), v: new Float32Array(0) });
const NaNs = <T extends string>(keys: readonly T[]) => Object.fromEntries(keys.map((k) => [k, NaN])) as Record<T, number>;
const NO_NUMBERS: HemoNumbers = {
  hr: NaN, map: NaN, systolic: NaN, diastolic: NaN, cvp: NaN, pa: { systolic: NaN, diastolic: NaN, mean: NaN }, pcwp: NaN, lvedp: NaN, rvedp: NaN,
  co: NaN, ci: NaN, svr: NaN, pvr: NaN, lvEf: NaN, rvEf: NaN, qpQs: NaN,
};

/** A completed beat as the source keeps it: the engine's record, the beat's length and the panels' summary. */
interface Rec { lb: LiveBeat; rr: number; end: number; summary: BeatSummary | null }

/**
 * `HemoSource` over the core engine's live heart (task P16, docs/HEMODYNAMICS_CORE.md §4G). Every beat here is the engine's own: a premature beat is small and the next one large, atrial fibrillation has
 * no atrial event and a beat-to-beat stroke volume, heart block has two atrial events per beat and cannon waves in the right atrium,
 * an Impella or a balloon pump shapes the aortic trace. `kind` is "live". The source reads `sim.live` (the core-engine `Simulation`
 * keeps it current, rebuilds it when the patient's structure changes and steps it) and never steps anything itself.
 *
 * Clock. `now()` is the simulation's clock; every time the source reports is on it. The live heart runs on its own stream clock,
 * offset by `sim.liveDelta`; the source subtracts it.
 *
 * Beats. A `BeatSummary` is built when the live heart completes a beat (ventricular event to ventricular event; it lags the
 * beat's own end by nothing: the record closes at the event). `loops` and `pressure` are the engine's 2 ms trace samples over the beat,
 * `atrial` the atrial events the engine delivered in it (P waves that never conducted included), `edv`/`esv` the largest/smallest
 * volume of a chamber over the beat (a ventricle's EDV is its volume at the event), `strokeVolume` EDV - ESV of the LV (an Impella's
 * output leaves the LV too), `valves` the engine's per-valve forward and regurgitant volumes and open time (TV, MV, AV, PV = element PVL).
 * 30 s are kept (`CFG.maxBeats` beats at most).
 *
 * Numbers. A bedside monitor averages: `numbers()` is the mean over the beats of the last `CFG.numbersWindowS` s (at least
 * `CFG.minBeats` beats, duration-weighted), so it follows a change within a few beats and does not jump with a PVC; before the first
 * beat completes it is the settled beat the warm-up ended on (never NaN, never legacy). HR = beats per minute over the window (the
 * ventricular rate: 40 in complete heart block). CO = systemic bed flow (BEDU + BEDL, net) over the window, in L/min, so it counts
 * an Impella's and an ECMO circuit's flow and loses the blood an ECMO circuit drains; PVR from the lung flow; MAP, systolic and
 * diastolic = mean over the beats of the aortic mean, maximum and minimum (an IABP's augmented diastolic peak is a systolic maximum
 * of that beat if it exceeds the ejection peak, as a monitor reads it); EF = (EDV - ESV) / EDV.
 *
 * Saturations. The oxygen model (`solveOxygen`, physics/structural.ts), fed with the forward and backward
 * volumes through every element over the same window instead of one steady-state beat: an Impella and an Impella RP are streams
 * between their nodes, an ECMO circuit the extra stream into the descending aorta through its oxygenator (`oxygenatorSat`), so
 * differential hypoxemia (upper body from the lungs, lower body from the circuit) appears. SpO2 = pre-ductal = AO; DO2, VO2 and the
 * per-bed tissue oxygenation placeholder (`bedOxygen`). Recomputed once per completed beat.
 *
 * Devices. `sim.devices()` as DeviceConsoles: Impella (flow, speed, current, placement signal, suction; the placement trace of the
 * last seconds), IABP (settings, balloon, augmentation; the arterial trace), ECMO (flow, speed, sweep, FiO2, suction, return
 * saturation from the saturations above) and Impella RP. Only the devices that are in the patient and on are listed.
 */
export class LiveSource implements HemoSource {
  readonly kind = "live" as const;

  private heart: LiveHeart | null = null;
  private off: (() => void) | null = null;
  private ring: Rec[] = [];
  private subs = new Set<(b: BeatSummary) => void>();
  private satKey = "";
  private sat: Saturations | null = null;
  private devKey = NaN;
  private dev: DeviceConsole[] = [];

  private unbuilt: () => void;
  constructor(private sim: Simulation) {
    this.unbuilt = sim.onCoreBuilt(() => this.sync()); // a rebuilt heart is picked up at once, not when a panel next asks
    this.sync();
  }

  /** Stop listening to the live heart and the simulation. */
  dispose() { this.unbuilt(); this.off?.(); this.off = null; this.heart = null; this.subs.clear(); }

  /** Follow the simulation's live heart: a new one (reset, a patient change that rebuilt it) starts the source's history afresh. */
  private sync(): LiveHeart | null {
    const live = this.sim.live ?? null;
    if (live === this.heart) return live;
    this.off?.(); this.off = null;
    this.heart = live; this.ring = []; this.satKey = ""; this.sat = null; this.devKey = NaN;
    if (live) this.off = live.onRecord((lb) => this.onRecord(lb, live));
    return live;
  }

  now() { this.sync(); return this.sim.t; }
  nodes(): readonly string[] { return NODES; }
  onBeat(cb: (b: BeatSummary) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  beats(count = 8): readonly BeatSummary[] {
    this.sync();
    const out: BeatSummary[] = [];
    for (let i = this.ring.length - 1; i >= 0 && out.length < count; i--) {
      const s = this.ring[i].summary;
      if (s) { s.prematureNext = !!this.ring[i + 1]?.lb.pvc; out.unshift(s); } // known once the next beat has arrived
    }
    return out;
  }

  // ---- beats ------------------------------------------------------------------------------------------------------

  private onRecord(lb: LiveBeat, live: LiveHeart) {
    if (live !== this.heart) return;
    const delta = this.sim.liveDelta, start = lb.t, end = live.time, rr = end - start;
    if (!(rr > 0.05) || !Number.isFinite(delta)) return;
    const rec: Rec = { lb, rr, end: end - delta, summary: this.summarise(live, lb, start, end, rr, delta) };
    this.ring.push(rec);
    const cutoff = rec.end - CFG.ringSeconds;
    while (this.ring.length > CFG.maxBeats || (this.ring.length > 1 && this.ring[0].end < cutoff)) this.ring.shift();
    if (rec.summary) for (const cb of [...this.subs]) cb(rec.summary);
  }

  private summarise(live: LiveHeart, lb: LiveBeat, start: number, end: number, rr: number, delta: number): BeatSummary | null {
    const tr = live.trace(start - 1e-9);
    let n = 0;
    while (n < tr.t.length && tr.t[n] <= end + 1e-6) n++;
    if (n < 8) return null;
    const time = new Float32Array(n);
    for (let k = 0; k < n; k++) time[k] = tr.t[k] - start;
    const pressure = {} as Record<HemoNode, Float32Array>;
    for (const nd of NODES) pressure[nd] = tr.p[nd].slice(0, n);
    const loops = {} as BeatSummary["loops"], edv = {} as Record<Chamber, number>, esv = {} as Record<Chamber, number>;
    for (const c of CHAMBERS) {
      loops[c] = { p: pressure[c], v: tr.v[c].slice(0, n) };
      const st = lb.v[c];
      edv[c] = c === "LV" || c === "RV" ? lb.edv[c] : st.max; // a ventricle's EDV is the volume at the event; an atrium's the peak before it empties
      esv[c] = st.min;
    }
    const val = (k: string) => { const v = lb.valves[k]; return v ? { forwardMl: v.forwardMl, regurgMl: v.regurgMl, openMs: v.openMs } : { forwardMl: 0, regurgMl: 0, openMs: 0 }; };
    return {
      t: start - delta, rr, pvc: lb.pvc, loops, pressure, time, atrial: Float32Array.from(live.atrialBetween(start, end), (t) => t - start),
      edv, esv, strokeVolume: edv.LV - esv.LV, valves: { AV: val("AV"), MV: val("MV"), TV: val("TV"), PV: val("PVL") },
    };
  }

  // ---- traces -----------------------------------------------------------------------------------------------------

  trace(node: string, seconds: number, opts: { quantity?: "pressure" | "volume"; maxPoints?: number } = {}): Series {
    const live = this.sync();
    const vol = opts.quantity === "volume";
    if (!live || (vol ? !CHAMBERS.includes(node as Chamber) : !(NODES as readonly string[]).includes(node))) return empty();
    const delta = this.sim.liveDelta;
    if (!Number.isFinite(delta)) return empty();
    const r = live.read(node, vol ? "volume" : "pressure", this.sim.t + delta - seconds);
    if (!r || r.t.length === 0) return empty();
    const n = r.t.length, max = Math.max(2, opts.maxPoints ?? 600), m = Math.min(n, max);
    const t = new Float32Array(m), v = new Float32Array(m);
    for (let i = 0; i < m; i++) { const k = m === n ? i : Math.floor((i * (n - 1)) / (m - 1)); t[i] = r.t[k] - delta; v[i] = r.v[k]; }
    return { t, v };
  }

  // ---- numbers ----------------------------------------------------------------------------------------------------

  /**
   * The beats a monitor averages now: the window (`numbersWindowS` s, at least `minBeats`) passed through the hemodynamic-beats policy
   * (hemoBeats.ts), the ONE place it is applied for the numbers and the oxygen solve. `recs` are the selected beats, `all` every beat of
   * the window (the heart rate counts them all). With frequent ectopy the window holds few steady beats, so up to `minSteadyBeats` of
   * the latest steady ones are used, borrowing from before the window (windowedHemodynamicBeats). `flow` is every beat of the longer `flowWindowS` window when it holds a premature
   * beat (else the plain window): MAP, CO, SVR, PVR, Qp:Qs, the oxygen solve and the pump flow means average all beats (see numbers()). Before any beat completes it is the settled beat the warm-up ended on (never NaN, never legacy).
   */
  private window(): { recs: Pick<Rec, "lb" | "rr">[]; all: Pick<Rec, "lb" | "rr">[]; flow: Pick<Rec, "lb" | "rr">[]; key: string; sel: HemoBeatSelection<unknown> | null } {
    const live = this.sync();
    if (!live) return { recs: [], all: [], flow: [], key: "", sel: null };
    const now = this.sim.t, ring = this.ring;
    let i = ring.length;
    while (i > 0 && (ring[i - 1].end > now - CFG.numbersWindowS || ring.length - i < CFG.minBeats)) i--;
    if (i >= ring.length) {
      if (live.warmBeat) { const r = { lb: live.warmBeat, rr: live.warmBeat.interval }; return { recs: [r], all: [r], flow: [r], key: "warm", sel: null }; }
      return { recs: [], all: [], flow: [], key: "", sel: null };
    }
    const items = ring.map((r, k) => ({ rec: r, pvc: r.lb.pvc, prematureNext: !!ring[k + 1]?.lb.pvc })); // the ring before the window is history for "follows a premature beat" and lends steady beats when ectopy is frequent
    const sel = windowedHemodynamicBeats(items, i, CFG.minSteadyBeats), recs = sel.beats.map((b) => b.rec);
    // Time-averaged flow and mean pressure are over EVERY beat of a longer window: a premature beat ejects little and is followed by a pause, and that
    // cost is part of the minute's output (in bigeminy about half). Only with ectopy, so a regular rhythm keeps the short window and its numbers.
    let j = ring.length;
    while (j > 0 && (ring[j - 1].end > now - CFG.flowWindowS || ring.length - j < CFG.minBeats)) j--;
    const flow = ring.slice(j).some((r) => r.lb.pvc) ? ring.slice(j) : ring.slice(i);
    return { recs, all: ring.slice(i), flow, key: `${recs.length}@${recs[recs.length - 1].end}|${sel.used}|${flow.length}@${flow[flow.length - 1].end}`, sel };
  }

  numbers(): HemoNumbers {
    const { recs, all, flow, sel } = this.window();
    if (!recs.length) return NO_NUMBERS;
    const Tall = all.reduce((s, r) => s + r.rr, 0);
    const T = recs.reduce((s, r) => s + r.rr, 0), w = (f: (r: Pick<Rec, "lb" | "rr">) => number) => recs.reduce((s, r) => s + f(r) * r.rr, 0) / T;
    // Two kinds of readout. Beat-SHAPE values (end-diastolic pressures, EF, systolic/diastolic pressures, PCWP, CVP) are over the hemodynamic beats
    // `recs` (hemoBeats.ts): a premature beat, the beat it cuts short and the three after it are not averaged. TIME-averaged values (MAP, the flows
    // and what is computed from them) are over every beat of `flow`, premature ones included: they eject little and are followed by a pause, which is
    // part of the minute's output and mean pressure (a pulse deficit), so CO is not HR x the typical stroke volume while there is ectopy.
    const Tf = flow.reduce((s, r) => s + r.rr, 0), wf = (f: (r: Pick<Rec, "lb" | "rr">) => number) => flow.reduce((s, r) => s + f(r) * r.rr, 0) / Tf;
    const net = (name: string) => flow.reduce((s, r) => s + (r.lb.flows.fwd[name] ?? 0) - (r.lb.flows.bwd[name] ?? 0), 0);
    const qs = ((net("BEDU") + net("BEDL")) / Tf) * 0.06, qp = (net("LUNG") / Tf) * 0.06; // L/min
    const map = wf((r) => r.lb.p.AO.mean), cvp = w((r) => r.lb.p.RA.mean), pam = w((r) => r.lb.p.PA.mean), pcwp = w((r) => r.lb.p.LA.mean);
    const mapF = map, cvpF = wf((r) => r.lb.p.RA.mean), pamF = wf((r) => r.lb.p.PA.mean), pcwpF = wf((r) => r.lb.p.LA.mean); // resistances use pressures from the same beats as their flow
    const ef = (c: "LV" | "RV") => w((r) => (r.lb.v[c].max > 0 ? (r.lb.edv[c] - r.lb.esv[c]) / r.lb.edv[c] : NaN));
    return {
      hr: (60 * all.filter((r) => r.lb.strength !== 0).length) / Tall, // the rate counts every beat, premature ones included; not the silent ticks of VF or asystole (B2)
      map, systolic: w((r) => r.lb.p.AO.max), diastolic: w((r) => r.lb.p.AO.min), cvp,
      pa: { systolic: w((r) => r.lb.p.PA.max), diastolic: w((r) => r.lb.p.PA.min), mean: pam }, pcwp,
      lvedp: w((r) => r.lb.p.LV.end), rvedp: w((r) => r.lb.p.RV.end),
      co: qs, ci: qs / PATIENTS.adult.bsa, svr: qs > 0 ? (mapF - cvpF) / qs : NaN, pvr: qp > 0 ? (pamF - pcwpF) / qp : NaN,
      lvEf: ef("LV"), rvEf: ef("RV"), qpQs: qs > 0 ? qp / qs : NaN,
      ...(sel ? { ectopy: { fraction: sel.fraction, beats: recs.length, used: sel.used } } : {}),
    };
  }

  saturations(): Saturations {
    const live = this.sync(), { recs, flow: fb, key } = this.window();
    const base = PATIENTS.adult;
    if (!live || !recs.length) return { node: NaNs(NODES), spo2: NaN, preductal: NaN, postductal: NaN, svo2: NaN, do2: NaN, vo2: NaN, lactate: NaN, bed: {}, bedSource: "ischemia-derived" };
    const ec = live.engine.elements.find((e) => e.name === "ecmo") as Ecmo | undefined;
    const drop = this.sim.lungSatDrop(), bed = bedOxygen(this.sim), k = `${key}|${ec?.sweep}|${ec?.fio2}|${drop.toFixed(3)}`;
    if (this.sat && this.satKey === k) return { ...this.sat, bed };
    const T = fb.reduce((s, r) => s + r.rr, 0); // the oxygen solve takes its flows from every beat of the flow window
    const fwd: Record<string, number> = {}, bwd: Record<string, number> = {};
    for (const r of fb) for (const [src, dst] of [[r.lb.flows.fwd, fwd], [r.lb.flows.bwd, bwd]] as const) for (const [n, v] of Object.entries(src)) dst[n] = (dst[n] ?? 0) + v;
    // The pumps are streams between their nodes: an Impella carries the LV's blood into the aorta without crossing the aortic valve, an RP the cava's into the PA.
    const m: Model = { ...live.model, T, edges: [...live.model.edges], patient: drop > 0 ? { ...live.model.patient, satLung: live.model.patient.satLung - drop } : live.model.patient }; // lung water (C3) lowers the saturation the lungs put out
    for (const name of ["impella", "impellaRp"]) {
      const p = live.engine.elements.find((e) => e.name === name) as RotaryPump | undefined;
      if (p && name in fwd && p.from !== p.to) m.edges.push({ name, from: p.from, to: p.to, type: "resistor" }); // an Impella left in the aorta moves blood from the aorta to itself
    }
    const flow = ec ? (((fwd.ecmo ?? 0) - (bwd.ecmo ?? 0)) / T) : 0; // ml/s drained from RA (or IVC) and returned into DAO
    const ox = solveOxygen(m, { fwd, bwd }, ec ? { from: IDX(ec.drain), to: IDX("DAO"), flow, oxygenate: (c, cap) => ec.returnSat(c / cap) * cap } : undefined);
    const node = {} as Record<HemoNode, number>;
    for (const nd of NODES) node[nd] = ox.content[IDX(nd)] / ox.capacity;
    const n = this.numbers();
    this.satKey = k;
    this.sat = {
      node, spo2: node.AO, preductal: node.AO, postductal: node.DAO, svo2: node.PA,
      do2: n.co * base.hb * 10 * O2_PER_G_HB * node.AO, vo2: base.vo2PerKg * base.weightKg, lactate: NaN, bed, bedSource: "ischemia-derived",
    };
    return this.sat;
  }

  // ---- devices ----------------------------------------------------------------------------------------------------

  devices(): readonly DeviceConsole[] {
    const bucket = Math.floor(this.sim.t / CFG.deviceEveryS);
    if (bucket === this.devKey) return this.dev;
    this.devKey = bucket;
    const d: DevicesReadout | null = this.sim.devices();
    const out: DeviceConsole[] = [];
    const lazy = (c: DeviceConsole, make: () => Record<string, Series>) => { let tr: Record<string, Series> | undefined; Object.defineProperty(c, "traces", { enumerable: true, get: () => (tr ??= make()) }); return c; };
    if (d?.impella?.on) {
      const i = d.impella;
      out.push(lazy({
        id: "impella", label: `Impella ${i.model} P-${i.level}`, alarms: i.alarms,
        readings: { flowLpm: i.flowLpm, flowMinLpm: i.flowMinLpm, flowMaxLpm: i.flowMaxLpm, level: i.level, speedKrpm: i.speedKrpm, motorCurrentMa: i.motorCurrentMa, currentPulsatilityMa: i.currentPulsatilityMa, placementMmHg: i.placementMmHg, placementAmplitudeMmHg: i.placementAmplitudeMmHg, suctionLevel: i.suctionLevel, suctionFraction: i.suctionFraction, inletMeanMmHg: i.inletMeanMmHg, inletMinMmHg: i.inletMinMmHg, inletMaxMmHg: i.inletMaxMmHg, inletAmplitudeMmHg: i.inletAmplitudeMmHg },
      }, () => ({ placement: this.difference("AO", i.position === "aortic" ? "AO" : "LV") })));
    }
    if (d?.iabp?.on) {
      const i = d.iabp;
      out.push(lazy({
        id: "iabp", label: `IABP 1:${i.ratio}`, alarms: [],
        readings: { ratio: i.ratio, flowLpm: 0, inflateMs: i.inflateMs, deflateMs: i.deflateMs, volumeMl: i.volumeMl, balloonVolumeMl: i.balloonVolumeMl, balloonPressureMmHg: i.balloonPressureMmHg, peakDiastolicMmHg: i.peakDiastolicMmHg, diastolicMeanMmHg: i.diastolicMeanMmHg, endDiastolicMmHg: i.endDiastolicMmHg, systolicMmHg: i.systolicMmHg, coronaryAugmentationMmHg: i.coronaryAugmentationMmHg },
      }, () => ({ arterial: this.trace("AO", CFG.deviceTraceS) })));
    }
    if (d?.ecmo) {
      const e = d.ecmo, rs = oxygenatorSat(this.saturations().node[e.drain], e.sweepLpm, e.fio2), { flow } = this.window();
      const T = flow.reduce((s, r) => s + r.rr, 0), mean = T > 0 ? (flow.reduce((s, r) => s + (r.lb.flows.fwd.ecmo ?? 0) - (r.lb.flows.bwd.ecmo ?? 0), 0) / T) * 0.06 : e.flowLpm; // the pump's flow over the window, as a flow meter averages it
      out.push({
        id: "ecmo", label: `VA-ECMO ${mean.toFixed(1)} L/min`, alarms: e.suctionAlarm ? ["Suction: the drainage cannula is starved (low venous volume)"] : [],
        readings: { flowLpm: mean, targetLpm: e.targetLpm, rpm: e.rpm, sweepLpm: e.sweepLpm, fio2: e.fio2, returnSat: rs, suctionLevel: e.suctionLevel, membraneDpMmHg: e.membraneDpMmHg, headMmHg: e.headMmHg },
      });
    }
    if (d?.impellaRp?.on) {
      const r = d.impellaRp;
      out.push({ id: "impellaRp", label: `Impella RP P-${r.level}`, alarms: r.suctionAlarm ? ["Suction: the inflow is collapsing in the vena cava"] : [], readings: { flowLpm: r.flowLpm, level: r.level, speedKrpm: r.speedKrpm, motorCurrentMa: r.motorCurrentMa, placementMmHg: r.placementMmHg } });
    }
    return (this.dev = out);
  }

  /** `a` minus `b` pressure over the last seconds (the placement signal is aortic minus ventricular pressure), at the samples the two share. */
  private difference(a: string, b: string): Series {
    const x = this.trace(a, CFG.deviceTraceS), y = this.trace(b, CFG.deviceTraceS), n = Math.min(x.t.length, y.t.length);
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = x.v[i] - y.v[i];
    return { t: x.t.slice(0, n), v };
  }
}
