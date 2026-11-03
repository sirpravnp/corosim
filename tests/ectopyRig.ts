// Test rig for the ectopy model (task B3a): the coronary network, the ischemia kinetics, the rhythm state and the beat generator,
// without the hemodynamics, so a run of clinical hours over many seeds takes milliseconds. It mirrors what Simulation does each
// sub-step for the core engine (severity toward its target, clinical clock at 2 min/s, `Ectopy.update` with the weighted burden,
// `Conduction.advance` with the rhythm the ischemia makes), at rest tone. Not a test file itself.
import { buildTree, TYPICAL, Variant } from "../src/anatomy/tree";
import { solveNetwork, Lesion } from "../src/physics/network";
import { bedSites, ischemicBurden, globalSeverity, transmurality, BedSite } from "../src/physics/ecgLink";
import { stepSeverity } from "../src/physics/ischemia";
import { rhythmState, Conduction } from "../src/physics/rhythm";
import { Ectopy, EctopyTone, REST_TONE, weightedBurden } from "../src/physics/ectopy";
import { Beat } from "../src/physics/ecg";
import { INFARCT } from "../src/config/management";

export const LESIONS: Record<string, Lesion[]> = {
  none: [],
  ladProx: [{ segId: "LAD", pos: 0.1, ds: 1, occluded: true }],
  ladMid: [{ segId: "LAD", pos: 0.45, ds: 1, occluded: true }],
  ladDistal: [{ segId: "LAD", pos: 0.8, ds: 1, occluded: true }],
  diagonal: [{ segId: "D1", pos: 0.1, ds: 1, occluded: true }],
  rcaProx: [{ segId: "RCA", pos: 0.1, ds: 1, occluded: true }],
  rcaDistal: [{ segId: "RCA", pos: 0.8, ds: 1, occluded: true }],
  lcx: [{ segId: "LCX", pos: 0.2, ds: 1, occluded: true }],
  lad90: [{ segId: "LAD", pos: 0.15, ds: 0.9, occluded: false }],
  lad70: [{ segId: "LAD", pos: 0.15, ds: 0.7, occluded: false }],
};

export class EctopyRig {
  readonly ectopy: Ectopy;
  readonly conduction: Conduction;
  readonly sites: BedSite[];
  private tree;
  sev: Record<string, number> = {};
  target: Record<string, number> = {};
  transmural: Record<string, number> = {};
  t = 0; minutes = 0;
  tone: EctopyTone = { ...REST_TONE };
  beats: Beat[] = [];

  constructor(seed: number, opts: { tendency?: number; variant?: Variant } = {}) {
    this.tree = buildTree(opts.variant ?? TYPICAL);
    this.sites = bedSites(this.tree);
    this.ectopy = new Ectopy(seed, opts.tendency ?? 1);
    this.conduction = new Conduction(seed);
    this.conduction.ectopy = this.ectopy;
  }

  /** Put a lesion set in place (the targets change; the beds follow at the ischemia kinetics). */
  lesions(l: Lesion[]) {
    const r = solveNetwork(this.tree, l, 1);
    this.target = Object.fromEntries(r.terminals.map((x) => [x.key, x.severity]));
    this.transmural = Object.fromEntries(r.terminals.map((x) => [x.key, transmurality(x.blocked ? 0 : x.ratio)]));
    return this;
  }

  /** Run `sec` seconds of heartbeat time (clinical time at INFARCT.minutesPerSecond unless `minutesPerSecond` is given); returns the ventricular beats made. */
  run(sec: number, minutesPerSecond: number = INFARCT.minutesPerSecond): Beat[] {
    const out: Beat[] = [], dt = 0.1, end = this.t + sec - 1e-9;
    while (this.t < end) {
      for (const s of this.sites) this.sev[s.key] = stepSeverity(this.sev[s.key] ?? 0, this.target[s.key] ?? 0, dt);
      const m = dt * minutesPerSecond;
      this.minutes += m;
      this.ectopy.update(m, weightedBurden(this.sites, this.sev, this.transmural), this.tone);
      const st = rhythmState(this.sites, this.sev, globalSeverity(ischemicBurden(this.sites, this.sev)));
      this.t += dt;
      for (const b of this.conduction.advance(this.t, st)) if (!b.pOnly) out.push(b);
    }
    this.beats.push(...out);
    return out;
  }
}

export const share = (b: Beat[]) => (b.length ? b.filter((x) => x.pvc).length / b.length : 0);
export const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
