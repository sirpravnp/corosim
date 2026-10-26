// The ischemic PVC model of the core engine (task B3a): the rate model and the beat generator on the test rig (tests/ectopyRig.ts,
// no hemodynamics), over many seeds. Ranges come from the targets in docs/ECTOPY.md (sources in config/ectopy.ts).
import { describe, it, expect } from "vitest";
import { EctopyRig, LESIONS, share, mean, median } from "./ectopyRig";
import { Ectopy, burdenEffect, onsetCourse, reperfusionWeight, couplingVsT, tWaveEnd, susceptibility, REST_TONE } from "../src/physics/ectopy";
import { ECTOPY } from "../src/config/ectopy";
import { normalizeScenario, toScenario } from "../src/sim/scenario";
import { Simulation } from "../src/sim/simulation";
import { Beat } from "../src/physics/ecg";

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
/** PVC share of the ventricular beats over the first `sec` seconds (2 clinical min/s) after `lesion` is put in place. */
const shareAfter = (lesion: keyof typeof LESIONS, seed: number, sec = 90, tendency = 1) => share(new EctopyRig(seed, { tendency }).lesions(LESIONS[lesion]).run(sec));
const pooled = (runs: Beat[][]) => share(runs.flat());

describe("rate model pieces", () => {
  it("burden effect is smooth, zero only below a 1% floor, and rises with the size of the territory", () => {
    expect(burdenEffect(0)).toBe(0);
    expect(burdenEffect(ECTOPY.floor)).toBe(0);
    expect(burdenEffect(0.03)).toBeGreaterThan(0);
    expect(burdenEffect(0.03)).toBeLessThan(0.01);
    const sizes = [0.05, 0.1, 0.2, 0.3, 0.43].map(burdenEffect);
    sizes.forEach((v, i) => i && expect(v).toBeGreaterThan(sizes[i - 1]));
    expect(burdenEffect(0.43) / burdenEffect(0.1)).toBeGreaterThan(5); // proximal against distal LAD
  });
  it("time since onset: a peak within the first hour or two, then a decay over hours to a low late value", () => {
    const peak = Math.max(...Array.from({ length: 120 }, (_, m) => onsetCourse(m)));
    expect(onsetCourse(0)).toBe(0);
    expect(onsetCourse(10)).toBeGreaterThan(0.8 * peak);
    const firstHour = mean(Array.from({ length: 60 }, (_, m) => onsetCourse(m + 0.5)));
    expect(firstHour / onsetCourse(480)).toBeGreaterThan(5);
    expect(onsetCourse(24 * 60)).toBeLessThan(0.1 * peak);
  });
  it("reperfusion counts little after a minute of ischemia, most after 15-60 min, and still a good part after hours", () => {
    expect(reperfusionWeight(1)).toBeLessThan(0.1);
    expect(reperfusionWeight(30)).toBeGreaterThan(0.85);
    expect(reperfusionWeight(360)).toBeGreaterThan(0.5);
    expect(reperfusionWeight(360)).toBeLessThan(reperfusionWeight(60));
  });
  it("susceptibility is fixed per seed with a wide, lognormal spread around 1", () => {
    const s = Array.from({ length: 400 }, (_, i) => susceptibility(i + 1));
    expect(susceptibility(7)).toBe(susceptibility(7));
    const sorted = [...s].sort((a, b) => a - b), q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
    expect(q(0.5)).toBeGreaterThan(0.75); expect(q(0.5)).toBeLessThan(1.33);
    expect(q(0.2)).toBeLessThan(0.5); // a sizeable fraction with little ectopy
    expect(q(0.9)).toBeGreaterThan(3); // and a tail with frequent ectopy
  });
  it("sympathetic tone and adrenergic drugs raise the rate, a beta-blocker lowers it; potassium and magnesium hooks scale it", () => {
    const at = (tone: Partial<typeof REST_TONE>, k = 1) => { const e = new Ectopy(5); e.potassium = k; e.update(30, 0.43, { ...REST_TONE, ...tone }); return e.rate(); };
    const rest = at({});
    expect(at({ sympathetic: 0.6 })).toBeGreaterThan(1.8 * rest);
    expect(at({ drugDrive: 1 })).toBeCloseTo(rest * (1 + ECTOPY.drugGain), 9);
    expect(at({ sympathetic: 0.6, betaBlock: 0.8 })).toBeLessThan(rest);
    expect(at({}, 2)).toBeCloseTo(2 * rest, 9);
  });
  it("hooks for VT/VF (B3b): instantaneous rate, phase, and the coupling against the T wave", () => {
    const e = new Ectopy(3);
    expect(e.phase()).toBe("none"); expect(e.rate()).toBe(0);
    e.update(20, 0.43); expect(e.phase()).toBe("hyperacute");
    e.update(300, 0.43); expect(e.phase()).toBe("subacute");
    e.update(600, 0.43); expect(e.phase()).toBe("late");
    e.update(1, 0); expect(e.phase()).toBe("reperfusion");
    expect(e.rate()).toBeGreaterThan(0);
    expect(couplingVsT(tWaveEnd(0.8), 0.8)).toBeCloseTo(1, 9); // < 1 = R-on-T
    expect(couplingVsT(ECTOPY.coupling * 0.8, 0.8)).toBeGreaterThan(1); // the usual PVC lands after the T wave
  });
});

describe("PVC burden on the beat generator, 40 seeds", () => {
  it("a healthy heart has no PVCs", () => {
    for (const s of SEEDS.slice(0, 10)) expect(shareAfter("none", s, 300)).toBe(0);
  });
  it("a stable 70% stenosis at rest (no ischemia in this model) has none", () => {
    for (const s of SEEDS.slice(0, 10)) expect(shareAfter("lad70", s, 300)).toBe(0);
  });
  it("a small or distal infarct gives at most a few percent", () => {
    for (const k of ["ladDistal", "diagonal"] as const) {
      const sh = SEEDS.map((s) => shareAfter(k, s));
      expect(mean(sh), k).toBeLessThan(0.015);
      expect(Math.max(...sh), k).toBeLessThan(0.06);
    }
  });
  it("a large anterior infarct gives a clearly higher mean burden than a small one, with a wide spread between patients", () => {
    const big = SEEDS.map((s) => shareAfter("ladProx", s)), small = SEEDS.map((s) => shareAfter("ladDistal", s));
    expect(mean(big)).toBeGreaterThan(4 * mean(small));
    expect(mean(big)).toBeGreaterThan(0.02); expect(mean(big)).toBeLessThan(0.1); // D3: well under the old flat 25%
    expect(big.filter((x) => x < 0.005).length).toBeGreaterThanOrEqual(6); // some patients with next to none
    expect(big.filter((x) => x > 0.06).length).toBeGreaterThanOrEqual(4); // a tail with frequent ones
    expect(Math.max(...big)).toBeLessThan(0.3); // the saturation
  });
  it("burden at 8 clinical hours is well below the burden in the first hours", () => {
    const early: Beat[][] = [], late: Beat[][] = [];
    for (const s of SEEDS) {
      const r = new EctopyRig(s).lesions(LESIONS.ladProx);
      r.run(10); early.push(r.run(50)); // 20-120 clinical min
      r.run(170); late.push(r.run(60)); // 7-9 h
    }
    expect(pooled(late)).toBeLessThan(0.35 * pooled(early));
  });
  it("reperfusion brings a burst in most patients, which decays", () => {
    let more = 0, any = 0;
    const burst: Beat[][] = [], after: Beat[][] = [];
    for (const s of SEEDS) {
      const r = new EctopyRig(s).lesions(LESIONS.ladProx);
      r.run(30); const before = r.run(30); // 1-2 h of occlusion
      const rate0 = r.ectopy.rate();
      r.lesions([]);
      const b = r.run(30); burst.push(b);
      expect(r.ectopy.phase()).toBe("reperfusion");
      expect(r.ectopy.rate(), `seed ${s}`).toBeGreaterThan(rate0); // the expected rate always rises
      r.run(150); after.push(r.run(60)); // 3-4 clinical h after reperfusion
      if (share(before) + share(b) > 0) { any++; if (share(b) > share(before)) more++; }
    }
    expect(more / any).toBeGreaterThan(0.6);
    expect(pooled(after)).toBeLessThan(0.5 * pooled(burst));
  });
  it("ectopyTendency 0 gives none; 2 gives more than 1 on average", () => {
    for (const s of SEEDS.slice(0, 10)) {
      const r = new EctopyRig(s, { tendency: 0 }).lesions(LESIONS.ladProx);
      r.run(60); r.lesions([]);
      expect(share(r.run(60))).toBe(0);
    }
    const one = SEEDS.map((s) => shareAfter("ladProx", s, 90, 1)), two = SEEDS.map((s) => shareAfter("ladProx", s, 90, 2));
    expect(mean(two)).toBeGreaterThan(1.4 * mean(one));
  });
  it("is deterministic per seed and differs between seeds", () => {
    const a = new EctopyRig(9).lesions(LESIONS.ladProx).run(120), b = new EctopyRig(9).lesions(LESIONS.ladProx).run(120);
    expect(b).toEqual(a);
    const c = new EctopyRig(10).lesions(LESIONS.ladProx).run(120);
    expect(c.map((x) => x.pvc)).not.toEqual(a.map((x) => x.pvc));
  });
});

describe("pattern: couplets, bigeminy and clustering, not coin flips", () => {
  // Ectopy-prone patients (tendency 2) with a proximal LAD occlusion, the first 3 clinical hours: enough PVCs to see the pattern.
  const runs = SEEDS.map((s) => new EctopyRig(s, { tendency: 2 }).lesions(LESIONS.ladProx).run(90));
  const pvcCount = runs.flat().filter((b) => b.pvc).length;
  it("couplets occur, at roughly one per ten PVCs, and nothing longer (VT is B3b)", () => {
    let couplets = 0, longer = 0;
    for (const r of runs) {
      let run = 0;
      for (const b of [...r, { pvc: false } as Beat]) { if (b.pvc) run++; else { if (run === 2) couplets++; if (run > 2) longer++; run = 0; } }
    }
    expect(pvcCount).toBeGreaterThan(200);
    expect(couplets).toBeGreaterThan(0);
    // Cercek 1987: median 4 couplets against 44 PVCs an hour, so about a sixth of the PVCs are in couplets
    expect(couplets / pvcCount).toBeGreaterThan(0.04); expect(couplets / pvcCount).toBeLessThan(0.15);
    expect(longer).toBe(0);
  });
  it("bigeminy runs occur but are not implausibly regular", () => {
    let runsOf3 = 0, longest = 0;
    for (const r of runs) {
      let n = 0; // consecutive sinus-PVC pairs
      for (let i = 1; i < r.length; i++) {
        if (r[i].pvc && !r[i - 1].pvc) { n++; longest = Math.max(longest, n); if (n === 3) runsOf3++; }
        else if (!r[i].pvc && !r[i - 1].pvc) n = 0;
      }
    }
    expect(runsOf3).toBeGreaterThan(0);
    expect(longest).toBeLessThan(40);
  });
  it("PVCs cluster in time within a patient (over-dispersed against independent beats)", () => {
    // Each patient's PVC counts per block of 20 beats, over 10 minutes with the clinical clock stopped (a fixed underlying rate):
    // independent coin flips give a variance at most the mean; clustering (slow noise, after-PVC memory, couplets) gives more.
    const ratio: number[] = [];
    for (const s of SEEDS.slice(0, 20)) {
      const rig = new EctopyRig(s, { tendency: 2 }).lesions(LESIONS.ladProx);
      rig.run(30);
      const r = rig.run(600, 0), blocks: number[] = [];
      for (let i = 0; i + 20 <= r.length; i += 20) blocks.push(r.slice(i, i + 20).filter((b) => b.pvc).length);
      const m = mean(blocks), v = mean(blocks.map((x) => (x - m) ** 2));
      if (m * blocks.length >= 10) ratio.push(v / m);
    }
    expect(ratio.length).toBeGreaterThan(8);
    expect(median(ratio)).toBeGreaterThan(1.1); // binomial (independent beats): (1 - p) < 1; the mild burstiness asked for: about 1.2
    expect(median(ratio)).toBeLessThan(3); // mild: not runs that come and go in bursts of tens
  });
  it("coupling intervals spread around 0.6 x RR within a realistic range", () => {
    const k: number[] = [];
    for (const r of runs) for (let i = 1; i < r.length; i++) if (r[i].pvc && !r[i - 1].pvc) k.push((r[i].t - r[i - 1].t) / r[i].rr);
    expect(Math.min(...k)).toBeGreaterThanOrEqual(ECTOPY.couplingMin - 1e-9);
    expect(Math.max(...k)).toBeLessThanOrEqual(ECTOPY.couplingMax + 1e-9);
    expect(mean(k)).toBeGreaterThan(0.56); expect(mean(k)).toBeLessThan(0.64);
    expect(Math.max(...k) - Math.min(...k)).toBeGreaterThan(0.1);
  });
  it("a PVC keeps the sinus rate: the next P wave is blocked (compensatory pause)", () => {
    const c = new EctopyRig(4, { tendency: 3 }).lesions(LESIONS.ladProx);
    c.run(60);
    const all = c.conduction.advance(c.t + 60, { rhythm: "sinus", bbb: "none", sinusRate: 80, afRate: 96, pr: 0.16, avDegree: 0, escapeRate: 42, pvcSeverity: 0, vagal: 0, sympathetic: 0, sinusNodeIschemia: 0, avNodeIschemia: 0 });
    const p = all.filter((b) => !b.noP && !b.pvc).length; // conducted and blocked P waves
    expect(all.some((b) => b.pvc)).toBe(true);
    expect(Math.abs(p - 80)).toBeLessThan(4);
  });
});

describe("scenario field and engines", () => {
  it("ectopyTendency is normalized with a warning when out of range, and round-trips", () => {
    expect(normalizeScenario({}).scenario.ectopyTendency).toBe(1);
    const n = normalizeScenario({ ectopyTendency: 5 });
    expect(n.scenario.ectopyTendency).toBe(3);
    expect(n.warnings.some((w) => w.includes("ectopyTendency"))).toBe(true);
    expect(normalizeScenario({ ectopyTendency: -1 }).scenario.ectopyTendency).toBe(0);
    expect(toScenario(normalizeScenario({ ectopyTendency: 0.5 }).scenario).ectopyTendency).toBe(0.5);
    expect("ectopyTendency" in toScenario(normalizeScenario({}).scenario)).toBe(false); // plain specs stay as they were
  });
  it("the legacy engine keeps the old PVC rule (no ectopy model); the core engine has one, with the scenario's tendency", () => {
    expect(new Simulation({ seed: 3 }).stream.ectopy).toBeUndefined();
    const s = new Simulation({ seed: 3, ectopyTendency: 2 }, { engine: "core", deferCore: true });
    expect(s.stream.ectopy?.tendency).toBe(2);
    s.apply({ ectopyTendency: 0 });
    expect(s.stream.ectopy?.tendency).toBe(0);
  });
});
