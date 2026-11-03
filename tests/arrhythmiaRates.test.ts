// Population rates of the VT/VF model (task B3b) against the literature, on the rig (tests/arrhythmiaRig.ts: coronary network, ischemia
// kinetics, rhythm, ectopy, arrhythmia and beat stream, no hemodynamics, mean pressure held at 85 mmHg), 400 seeds per arm, at rest tone
// and the clinical clock of the Simulation (2 clinical minutes per heartbeat second). Slow: listed in tests/slow.json. Targets, sources
// and the measured values: docs/ARRHYTHMIA.md.
import { describe, it, expect } from "vitest";
import { ArrhythmiaRig } from "./arrhythmiaRig";
import { LESIONS } from "./ectopyRig";
import type { ArrhythmiaEvent } from "../src/physics/arrhythmia";

const N = 400;
const has = (log: ArrhythmiaEvent[], f: (e: ArrhythmiaEvent) => boolean) => log.some(f);
const share = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;

interface Course { hour1: ArrhythmiaEvent[]; hour2: ArrhythmiaEvent[]; reperfused: ArrhythmiaEvent[] }
/** Occlusion for 2 clinical hours (any running arrhythmia ended at the cath lab door, as a shock would), then the artery opened for one clinical hour. */
function course(seed: number, lesion: keyof typeof LESIONS, opts: { potassium?: number; reperfuse?: boolean } = {}): Course {
  const r = new ArrhythmiaRig(seed).lesions(LESIONS[lesion]);
  if (opts.potassium) r.arrhythmia.potassium = opts.potassium;
  r.run(30);
  const hour1 = r.arrhythmia.log.slice();
  if (opts.reperfuse === false) return { hour1, hour2: [], reperfused: [] };
  r.arrhythmia.terminate(r.t);
  r.run(30);
  const hour2 = r.arrhythmia.log.slice(hour1.length);
  r.arrhythmia.terminate(r.t);
  const n = r.arrhythmia.log.length;
  r.lesions(LESIONS.none);
  r.run(30);
  return { hour1, hour2, reperfused: r.arrhythmia.log.slice(n) };
}
const cohort = (lesion: keyof typeof LESIONS, opts: { potassium?: number; reperfuse?: boolean } = {}) => Array.from({ length: N }, (_, i) => course(i + 1, lesion, opts));

describe("VT/VF and AIVR rates against the literature (rig, 400 seeds)", () => {
  const prox = cohort("ladProx");
  const vf1 = share(prox.map((c) => has(c.hour1, (e) => e.kind === "vf")));

  it("VF in the first clinical hour of a proximal LAD occlusion in a minority of patients: 5-20% (VF before primary PCI 9.5-12% of all STEMIs, anterior about twice)", () => {
    expect(vf1).toBeGreaterThan(0.05);
    expect(vf1).toBeLessThan(0.2);
  });
  it("VF clusters in the first hour: more in hour 1 than hour 2 (GISSI-2: 3.1% in 0-4 h against 0.6% in 4-48 h)", () => {
    const vf2 = share(prox.map((c) => has(c.hour2, (e) => e.kind === "vf")));
    expect(vf1).toBeGreaterThan(1.3 * vf2);
  });
  it("non-sustained VT is commoner than VF; sustained monomorphic VT rarer than VF in the first hour", () => {
    const nsvt = share(prox.map((c) => has(c.hour1, (e) => e.kind === "nsvt")));
    const mono = share(prox.map((c) => has(c.hour1, (e) => e.kind === "mono")));
    expect(nsvt).toBeGreaterThan(1.5 * vf1);
    expect(mono).toBeLessThan(vf1);
  });
  it("after reperfusing a proximal LAD at 2 h: AIVR in 25-65% (42% during primary PCI), non-sustained VT in 12-40% (26%), VF in at most 5% (1.6%)", () => {
    const aivr = share(prox.map((c) => has(c.reperfused, (e) => e.kind === "aivr")));
    const nsvt = share(prox.map((c) => has(c.reperfused, (e) => e.kind === "nsvt" && e.cause === "reperfusion")));
    const vf = share(prox.map((c) => has(c.reperfused, (e) => e.kind === "vf")));
    expect(aivr).toBeGreaterThan(0.25); expect(aivr).toBeLessThan(0.65);
    expect(nsvt).toBeGreaterThan(0.12); expect(nsvt).toBeLessThan(0.4);
    expect(vf).toBeLessThanOrEqual(0.05);
  });
  it("small infarcts: far fewer VF and AIVR than a proximal LAD (anterior and large infarcts carry the risk)", () => {
    const distal = cohort("ladDistal"), lcx = cohort("lcx", { reperfuse: false });
    expect(share(distal.map((c) => has(c.hour1, (e) => e.kind === "vf")))).toBeLessThan(vf1 / 4);
    expect(share(lcx.map((c) => has(c.hour1, (e) => e.kind === "vf")))).toBeLessThan(vf1 / 1.5);
    expect(share(distal.map((c) => has(c.reperfused, (e) => e.kind === "aivr")))).toBeLessThan(share(prox.map((c) => has(c.reperfused, (e) => e.kind === "aivr"))) / 4);
  });
  it("hypokalaemia (3.2 mmol/l) raises VF in the first hour (OR 1.9 before primary PCI)", () => {
    const low = cohort("ladProx", { potassium: 3.2, reperfuse: false });
    expect(share(low.map((c) => has(c.hour1, (e) => e.kind === "vf")))).toBeGreaterThan(1.3 * vf1);
  });
  it("no arrhythmia of any kind in a stable 70% stenosis at rest over 2 clinical hours", () => {
    for (let seed = 1; seed <= N; seed++) {
      const r = new ArrhythmiaRig(seed).lesions(LESIONS.lad70).run(60);
      expect(r.arrhythmia.log.length, `seed ${seed}`).toBe(0);
    }
  });
});
