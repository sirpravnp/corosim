// Test rig for the VT/VF model (task B3b): the coronary network, the ischemia kinetics, the rhythm state, the ectopy and arrhythmia
// models and the beat stream, without the hemodynamics, so clinical hours over hundreds of seeds take seconds. Mirrors what Simulation
// does each sub-step on the core engine (severity toward its target, clinical clock at 2 min/s, `Ectopy.update`, `Arrhythmia.update`,
// `BeatStream.extend`), at rest tone, with the mean arterial pressure given (`map`) instead of computed. Not a test file itself.
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { solveNetwork, Lesion } from "../src/physics/network";
import { bedSites, ischemicBurden, globalSeverity, transmurality, BedSite } from "../src/physics/ecgLink";
import { stepSeverity } from "../src/physics/ischemia";
import { rhythmState, Patient, HEALTHY } from "../src/physics/rhythm";
import { Ectopy, EctopyTone, REST_TONE, weightedBurden } from "../src/physics/ectopy";
import { Arrhythmia } from "../src/physics/arrhythmia";
import { BeatStream } from "../src/physics/beatStream";
import { Beat } from "../src/physics/ecg";
import { INFARCT } from "../src/config/management";

export class ArrhythmiaRig {
  readonly ectopy: Ectopy;
  readonly arrhythmia: Arrhythmia;
  readonly stream: BeatStream;
  readonly sites: BedSite[];
  private tree;
  sev: Record<string, number> = {};
  target: Record<string, number> = {};
  transmural: Record<string, number> = {};
  t = 0; minutes = 0;
  tone: EctopyTone = { ...REST_TONE };
  map = 85; scar = 0;
  patient: Patient = { ...HEALTHY };
  /** Every ventricular beat delivered so far (not P waves). */
  beats: Beat[] = [];

  constructor(seed: number, opts: { tendency?: number; ectopyTendency?: number } = {}) {
    this.tree = buildTree(TYPICAL);
    this.sites = bedSites(this.tree);
    this.ectopy = new Ectopy(seed, opts.ectopyTendency ?? 1);
    this.arrhythmia = new Arrhythmia(seed, this.ectopy, opts.tendency ?? 1);
    this.stream = new BeatStream(seed, 0.5, 0.05);
    this.stream.ectopy = this.ectopy;
    this.stream.arrhythmia = this.arrhythmia;
  }

  lesions(l: Lesion[]) {
    const r = solveNetwork(this.tree, l, 1);
    this.target = Object.fromEntries(r.terminals.map((x) => [x.key, x.severity]));
    this.transmural = Object.fromEntries(r.terminals.map((x) => [x.key, transmurality(x.blocked ? 0 : x.ratio)]));
    return this;
  }

  /** Run `sec` heartbeat seconds (clinical time at `minutesPerSecond`, default the Simulation's 2 min/s); `until` stops early when it returns true. */
  run(sec: number, minutesPerSecond: number = INFARCT.minutesPerSecond, until?: () => boolean): this {
    const dt = 0.05, end = this.t + sec - 1e-9;
    while (this.t < end) {
      for (const s of this.sites) this.sev[s.key] = stepSeverity(this.sev[s.key] ?? 0, this.target[s.key] ?? 0, dt);
      const m = dt * minutesPerSecond;
      this.minutes += m;
      this.ectopy.update(m, weightedBurden(this.sites, this.sev, this.transmural), this.tone);
      const st = rhythmState(this.sites, this.sev, globalSeverity(ischemicBurden(this.sites, this.sev)), this.patient);
      this.arrhythmia.update(m, dt, this.t, { map: this.map, scar: this.scar, sinusRate: st.sinusRate, sinus: this.patient.rhythm === "sinus" });
      this.stream.extend(this.t, st);
      this.stream.prune(this.t);
      this.t += dt;
      this.beats.push(...this.stream.drain(this.t));
      if (until?.()) break;
    }
    return this;
  }

  /** Clinical minutes of the first event of `kind` (Infinity: none). */
  first(kind: string): number { const e = this.arrhythmia.log.find((x) => x.kind === kind); return e ? e.minute : Infinity; }
}
