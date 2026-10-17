import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { normalizeScenario } from "../src/sim/scenario";
import { computeMetrics, sequenceBrs, BeatRecord } from "../src/sim/metrics";

const settled = (sc = {}, warm = 60) => { const s = new Simulation(); s.reset({ seed: 3, ...sc }, { settled: true }); s.warmup(warm); s.history = []; return s; };
const measure = (s: Simulation, sec = 90) => { s.run(sec); return s.metrics(sec); };

describe("resting patient", () => {
  const m = measure(settled());
  it("has physiological rate, pressure and variability", () => {
    expect(m.hr.mean!).toBeGreaterThan(65); expect(m.hr.mean!).toBeLessThan(85);
    expect(m.sbp.mean!).toBeGreaterThan(105); expect(m.sbp.mean!).toBeLessThan(135);
    expect(m.dbp.mean!).toBeGreaterThan(60); expect(m.dbp.mean!).toBeLessThan(90);
    expect(m.hrv!.sdnnMs!).toBeGreaterThan(25); expect(m.hrv!.sdnnMs!).toBeLessThan(90);
  });
  it("is stochastic beat to beat: intervals and pressures differ", () => {
    const s = settled(); const b = s.run(60);
    expect(new Set(b.map((x) => x.interval.toFixed(3))).size).toBeGreaterThan(b.length * 0.8);
    expect(new Set(b.map((x) => x.sbp.toFixed(3))).size).toBeGreaterThan(b.length * 0.8);
  });
  it("is deterministic for a given seed, and differs across seeds", () => {
    const run = (seed: number) => { const s = new Simulation({ seed }); return s.run(30).map((b) => b.sbp.toFixed(3)).join(); };
    expect(run(4)).toBe(run(4)); expect(run(4)).not.toBe(run(5));
  });
  it("shows respiratory sinus arrhythmia", () => { expect(m.respiratorySinusArrhythmia.peakToTroughMs!).toBeGreaterThan(20); });
  it("pressure reflects the beats: a PVC's following pause raises the next pressure", () => {
    const s = settled({ lesions: [{ artery: "LAD", occluded: true }] }, 30);
    const b = s.run(120);
    const after = b.filter((x, i) => i > 0 && b[i - 1].pvc && !x.pvc), normal = b.filter((x, i) => i > 0 && !b[i - 1].pvc && !x.pvc && !x.pvc);
    expect(after.length).toBeGreaterThan(2);
    const mean = (a: BeatRecord[]) => a.reduce((s2, x) => s2 + x.sv, 0) / a.length;
    expect(mean(after)).toBeGreaterThan(mean(normal));
  });
});

describe("baroreflex in the closed loop", () => {
  it("hemorrhage raises heart rate and the reflex buffers the pressure", () => {
    const base = measure(settled()), bleed = measure(settled({ bloodLoss: 0.15 })), denerv = measure(settled({ bloodLoss: 0.15, autonomic: { baroreflexGain: 0 } }));
    expect(bleed.hr.mean!).toBeGreaterThan(base.hr.mean! + 8);
    expect(bleed.strokeVolume.mean!).toBeLessThan(base.strokeVolume.mean! - 8);
    expect(bleed.map.mean!).toBeGreaterThan(denerv.map.mean! + 4);
    expect(base.map.mean! - bleed.map.mean!).toBeLessThan(10);
  });
  it("a vasopressor raises pressure and slows the heart reflexively; with the reflex cut the heart does not slow and pressure rises further", () => {
    const base = measure(settled()), pe = measure(settled({ drugs: { vasopressor: 1 } })), peDenerv = measure(settled({ drugs: { vasopressor: 1 }, autonomic: { baroreflexGain: 0 } }));
    expect(pe.map.mean!).toBeGreaterThan(base.map.mean! + 4);
    expect(pe.hr.mean!).toBeLessThan(base.hr.mean! - 5);
    expect(peDenerv.map.mean!).toBeGreaterThan(pe.map.mean! + 15);
    expect(peDenerv.hr.mean!).toBeGreaterThan(pe.hr.mean! + 5);
  });
  it("atropine raises heart rate and abolishes respiratory variability", () => {
    const base = measure(settled()), at = measure(settled({ drugs: { atropine: 1 } }));
    expect(at.hr.mean!).toBeGreaterThan(base.hr.mean! + 12);
    expect(at.hrv!.rmssdMs!).toBeLessThan(base.hrv!.rmssdMs! * 0.4);
  });
  it("beta blockade slows the heart", () => {
    const base = measure(settled()), bb = measure(settled({ drugs: { betaBlocker: 1 } }));
    expect(bb.hr.mean!).toBeLessThan(base.hr.mean! - 6);
  });
  it("denervation (gain 0) increases blood-pressure variability less than raising gain breeds oscillation: high gain gives a Mayer-band oscillation", () => {
    const hi = measure(settled({ autonomic: { baroreflexGain: 3 } }, 90), 180);
    const base = measure(settled(), 180);
    expect(hi.map.sd!).toBeGreaterThan(base.map.sd! * 4);
    expect(hi.hrv!.lfPeakHz!).toBeGreaterThan(0.08); expect(hi.hrv!.lfPeakHz!).toBeLessThan(0.16);
  });
  it("drugs ramp in over seconds rather than stepping", () => {
    const s = settled(); s.apply({ drugs: { vasopressor: 1 } });
    const first = s.run(3).map((b) => b.map), later = s.run(60).slice(-30).map((b) => b.map);
    const avg = (a: number[]) => a.reduce((x, y) => x + y) / a.length;
    expect(avg(first)).toBeLessThan(avg(later) + 1e-9);
    expect(avg(later)).toBeGreaterThan(avg(first) + 3);
  });
});

describe("coronary coupling", () => {
  it("an acute LAD occlusion develops ischemia, lowers stroke volume and causes ectopy over tens of seconds", () => {
    const s = new Simulation({ seed: 2, lesions: [{ artery: "LAD", occluded: true }] });
    const early = s.run(5), late = (s.warmup(55), s.run(60));
    const sv = (a: BeatRecord[]) => a.reduce((x, b) => x + b.sv, 0) / a.length;
    expect(sv(late)).toBeLessThan(sv(early) * 0.8);
    expect(late.some((b) => b.pvc)).toBe(true);
  });
  it("a proximal RCA occlusion causes AV block and shock without collapsing to arrest pressure", () => {
    const s = settled({ lesions: [{ artery: "RCA", occluded: true, position: 0.1 }] }, 90);
    const st = s.state();
    expect(st.rhythm.avBlock).toBe(3);
    expect(st.meanArterialPressure).toBeGreaterThan(40); expect(st.meanArterialPressure).toBeLessThan(75);
    expect(st.circulationState).not.toBe("stable");
  });
});

describe("scenario normalisation", () => {
  it("fills defaults and keeps valid input", () => {
    const n = normalizeScenario({ lesions: [{ artery: "lad", stenosis: 0.8 }] });
    expect(n.warnings).toEqual([]);
    expect(n.scenario.lesions[0]).toMatchObject({ segId: "LAD", ds: 0.8 });
    expect(n.scenario.drugs.betaBlocker).toBe(0);
  });
  it("resolves names, drops what does not exist and says so", () => {
    const n = normalizeScenario({ anatomy: { dominance: "left" }, lesions: [{ artery: "circumflex", stenosis: 0.5 }, { artery: "PDA", stenosis: 0.9 }, { artery: "nonsense" }, { artery: "LAD", stenosis: 2 }] });
    expect(n.scenario.lesions.map((l) => l.segId)).toEqual(["LCX", "PDA_L", "LAD"]);
    expect(n.warnings.join()).toMatch(/nonsense/);
    expect(n.scenario.lesions[2].ds).toBeLessThanOrEqual(0.99);
  });
  it("clamps out-of-range numbers and reports them", () => {
    const n = normalizeScenario({ bloodLoss: 5, drugs: { betaBlocker: 3 }, autonomic: { respRate: 500 } });
    expect(n.scenario.bloodLoss).toBe(0.6); expect(n.scenario.drugs.betaBlocker).toBe(1); expect(n.scenario.autonomic.respRate).toBe(40);
    expect(n.warnings.length).toBe(3);
  });
  it("apply() merges onto the current scenario", () => {
    const s = new Simulation({ drugs: { betaBlocker: 0.5 }, bloodLoss: 0.1 });
    s.apply({ bloodLoss: 0.2 });
    expect(s.scenario().drugs!.betaBlocker).toBe(0.5); expect(s.scenario().bloodLoss).toBe(0.2);
  });
});

describe("metrics", () => {
  const rec = (n: number, rr: number, sbp: number): BeatRecord => ({ n, t: n, interval: rr, hr: 60 / rr, sbp, dbp: sbp - 40, map: sbp - 27, sv: 70, pvc: false, atrialKick: true, sympathetic: 0.3, vagal: 0.4, afferent: 0, respPhase: 0 });
  it("recovers a known baroreflex slope with the sequence method", () => {
    const beats = Array.from({ length: 40 }, (_, i) => rec(i, 0.8, 120));
    // SBP climbs 2 mmHg per beat and the next RR lengthens 12 ms per beat: slope = 6 ms/mmHg
    for (let i = 0; i < 40; i++) { beats[i].sbp = 100 + 2 * (i % 10); beats[i].interval = 0.7 + 0.012 * (((i + 9) % 10)); }
    const r = sequenceBrs(beats);
    expect(r.sequences).toBeGreaterThan(2); expect(r.brs!).toBeGreaterThan(4); expect(r.brs!).toBeLessThan(8);
  });
  it("computeMetrics handles a short record", () => {
    const m = computeMetrics([rec(0, 0.8, 120), rec(1, 0.82, 121)], 2);
    expect(m.hrv).toBeNull(); expect(m.beats).toBe(2);
  });
});

describe("GitHub's management model inside the shared core", () => {
  const settle = (sc: Record<string, unknown>, warm = 40) => { const s = new Simulation(); s.reset({ seed: 5, ...sc }, { settled: true }); s.warmup(warm); s.history = []; return s; };
  it("atrial fibrillation is irregular, has no atrial kick, and is labelled", () => {
    const s = settle({ patient: { rhythm: "af" } }), b = s.run(60);
    expect(b.every((x) => !x.atrialKick)).toBe(true);
    expect(s.metrics(60).hrv!.rmssdMs!).toBeGreaterThan(60);
    expect(s.state().rhythm.label).toMatch(/atrial fibrillation/);
  });
  it("pacing fixes the rate: the baroreflex and breathing no longer move it", () => {
    const s = settle({ support: { pacing: true, paceRate: 90 } });
    const m = (s.run(60), s.metrics(60));
    expect(m.hr.mean!).toBeGreaterThan(88); expect(m.hr.mean!).toBeLessThan(92);
    expect(m.hrv!.sdnnMs!).toBeLessThan(5);
  });
  it("an Impella's continuous flow keeps pressure up in cardiogenic shock", () => {
    const sc = { lesions: [{ artery: "LM", occluded: true }] };
    const without = settle(sc), withPump = settle({ ...sc, support: { impella: true } });
    without.run(30); withPump.run(30);
    expect(withPump.map).toBeGreaterThan(without.map + 5);
    expect(withPump.state().support.deviceFlowLpm).toBeGreaterThan(1);
  });
  it("warm-up does not infarct; running with a closed artery does", () => {
    const s = settle({ lesions: [{ artery: "LAD", occluded: true }] }, 60);
    expect(s.state().ventricle.lvInfarctFraction).toBe(0);
    s.run(60); // 120 clinical minutes
    expect(s.state().ventricle.lvInfarctFraction).toBeGreaterThan(0.05);
  });
  it("support round-trips through the scenario, and atropine from the app's toggle is reported", () => {
    const s = new Simulation({ support: { norepinephrine: 0.4, fluids: 9 } });
    expect(s.warnings.join()).toMatch(/fluids clamped/);
    s.support.atropine = true;
    const sc = s.scenario();
    expect(sc.support!.norepinephrine).toBe(0.4); expect(sc.support!.fluids).toBe(3); expect(sc.drugs!.atropine).toBe(1);
  });
});
