/**
 * End-diastolic readings with ectopy. A beat's "end" is the moment the next beat starts; when that next beat is a premature one
 * (common after an occlusion) the ventricle is still relaxing or ejecting then, so its LVEDP read 70-90 mmHg and the panel's
 * LVEDP and EF jumped around. Those beats are left out of the averages (hemoBeats.ts; its unit tests are in hemoBeats.test.ts).
 */
import { describe, it, expect } from "vitest";
import { loopGap } from "../src/physics/loopMath";
import { Simulation } from "../src/sim/simulation";
import { meanRate } from "../src/sim/metrics";
import { LiveSource } from "../src/sim/liveSource";
import { CASE_BY_ID } from "../src/cath/cases";

describe("anterior STEMI on the live page source", () => {
  const stemi = () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3 }, { settled: true }); s.warmup(20);
    const src = new LiveSource(s);
    s.apply({ lesions: CASE_BY_ID.ladocc.scenario.lesions });
    for (let i = 0; i < 400; i++) s.step(0.1); // 40 s: the ischemia has developed
    return { s, src };
  };
  const spread = (x: number[]) => Math.max(...x) - Math.min(...x);
  it("every readout is steady between consecutive windows, and the ectopy is reported instead (hemoBeats.ts)", () => {
    const { s, src } = stemi();
    const rows: { n: ReturnType<LiveSource["numbers"]>; roll: ReturnType<Simulation["rolling"]> }[] = [];
    for (let k = 0; k < 8; k++) { s.step(8); rows.push({ n: src.numbers(), roll: s.rolling(8) }); }
    const col = (f: (r: (typeof rows)[number]) => number) => rows.map(f);
    const lvedp = col((r) => r.n.lvedp), ef = col((r) => r.n.lvEf);
    for (const p of lvedp) { expect(p).toBeGreaterThan(18); expect(p).toBeLessThan(30); }
    for (const e of ef) { expect(e).toBeGreaterThan(0.2); expect(e).toBeLessThan(0.5); }
    expect(spread(lvedp)).toBeLessThan(3);
    expect(spread(ef)).toBeLessThan(0.06);
    expect(spread(col((r) => r.n.co))).toBeLessThan(0.3);
    expect(spread(col((r) => r.n.map))).toBeLessThan(6);
    // the monitor roll-up (core engine): SV, SBP, DBP, MAP from the same beats
    expect(spread(col((r) => r.roll.map))).toBeLessThan(6);
    expect(spread(col((r) => r.roll.sv))).toBeLessThan(6);
    // the ectopy is shown: about a third of the beats are premature, and the readouts come from steady beats
    for (const { n } of rows) {
      expect(n.ectopy).toBeDefined();
      expect(n.ectopy!.fraction).toBeGreaterThan(0.1); expect(n.ectopy!.fraction).toBeLessThan(0.6);
      expect(n.ectopy!.used).toBe("steady"); expect(n.ectopy!.beats).toBeGreaterThanOrEqual(3);
    }
    const h = s.hemo(8)!;
    expect(h.lvedp).toBeGreaterThan(18); expect(h.lvedp).toBeLessThan(30);
    expect(h.ectopy.fraction).toBeGreaterThan(0.1); expect(h.ectopy.used).toBe("steady");
  }, 120_000);
  it("the heart rate still counts every beat, premature ones included", () => {
    const { s, src } = stemi();
    for (let k = 0; k < 3; k++) {
      s.step(8);
      const win = s.history.filter((b) => b.t > s.t - 8), roll = s.rolling(8);
      expect(roll.hr).toBeCloseTo(meanRate(win), 10); // beats per minute over elapsed time
      expect(win.some((b) => b.pvc)).toBe(true);
      expect(Math.abs(src.numbers().hr - roll.hr) / roll.hr).toBeLessThan(0.1); // the page's rate is over (nearly) the same beats
    }
  }, 120_000);
});

describe("a normal heart is unchanged by the policy", () => {
  it("no ectopy: the means are those of every beat of the window (values from before the policy, seed 3, 10 s)", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3 }, { settled: true }); s.warmup(20);
    const src = new LiveSource(s);
    for (let i = 0; i < 100; i++) s.step(0.1);
    const n = src.numbers(), r = s.rolling(10);
    const exact: Record<string, number> = { hr: 71.15253274870228, map: 90.84097031672768, systolic: 110.6877111990569, diastolic: 65.62974701062505, pcwp: 7.7940070544547195, cvp: 3.403958126901737, co: 5.070446912707977, svr: 17.24443894101011, pvr: 1.03274146068917, qpQs: 1.0131040604617243 };
    for (const [k, v] of Object.entries(exact)) expect(Math.abs((n as unknown as Record<string, number>)[k] - v), k).toBeLessThan(1e-6);
    // the end-diastolic readings used to leave out the newest beat (its successor was unknown) even with none premature; now they do not
    expect(n.lvedp).toBeCloseTo(8.19, 1); expect(n.rvedp).toBeCloseTo(3.26, 1); expect(n.lvEf).toBeCloseTo(0.62, 2); expect(n.rvEf).toBeCloseTo(0.62, 2);
    expect(n.ectopy).toEqual({ fraction: 0, beats: expect.any(Number), used: "steady" });
    expect(Math.abs(r.hr - 70.20903143449816)).toBeLessThan(1e-6); expect(Math.abs(r.map - 90.79393296614508)).toBeLessThan(1e-6);
    expect(Math.abs(r.sv - 72.86177565306208)).toBeLessThan(1e-6); expect(Math.abs(r.sbp - 110.60266277341856)).toBeLessThan(1e-6);
  }, 60_000);
});

describe("pressure-volume loops with premature beats (anterior STEMI, with and without an Impella)", () => {
  const run = (impella: boolean) => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, ...CASE_BY_ID.ladocc.scenario }, { settled: true }); s.warmup(25);
    const src = new LiveSource(s);
    if (impella) s.apply({ devices: { impella: { model: "CP", level: 8, position: "correct" } }, support: { impella: true } });
    s.step(100);
    return src.beats(60);
  };
  const gap = (b: ReturnType<typeof run>[number]) => loopGap(b.loops.LV.p, b.loops.LV.v);
  for (const impella of [false, true]) {
    it(`${impella ? "with" : "without"} an Impella: a beat before a premature beat is flagged; a beat between ordinary beats is a closed cycle`, () => {
      const beats = run(impella);
      // a beat settles back to a closed cycle about three beats after a premature one
      const steady = beats.filter((b, i) => !b.pvc && !b.prematureNext && i >= 3 && !beats[i - 1].pvc && !beats[i - 2].pvc && !beats[i - 3].pvc);
      expect(steady.length).toBeGreaterThan(0);
      for (const b of steady) expect(gap(b)).toBeLessThan(0.12); // closes: the panel joins its ends
      const cut = beats.filter((b) => b.prematureNext);
      expect(cut.length).toBeGreaterThan(0);
      for (const b of cut) expect(gap(b)).toBeGreaterThan(0.12); // cut short: the panel leaves it open
      for (let i = 0; i + 1 < beats.length; i++) expect(!!beats[i].prematureNext).toBe(beats[i + 1].pvc);
    }, 120_000);
  }
  it("loopGap is 0 for a closed cycle and large for an open arc", () => {
    const th = Array.from({ length: 40 }, (_, i) => (2 * Math.PI * i) / 40);
    const v = th.map((t) => 100 + 30 * Math.cos(t)), p = th.map((t) => 60 + 40 * Math.sin(t));
    expect(loopGap(p, v)).toBeLessThan(0.2); // 40 samples round a circle: the last is one step from the first
    expect(loopGap(p.slice(0, 20), v.slice(0, 20))).toBeGreaterThan(0.8); // half a circle
  });
  it("the Impella shifts the loop left and the aortic valve passes only part of what leaves the ventricle", () => {
    const base = run(false).filter((b) => !b.pvc && !b.prematureNext).slice(-1)[0], imp = run(true).filter((b) => !b.pvc && !b.prematureNext).slice(-1)[0];
    expect(imp.edv.LV).toBeLessThan(base.edv.LV - 10);
    const total = imp.edv.LV - imp.esv.LV, native = imp.valves.AV.forwardMl - imp.valves.AV.regurgMl;
    expect(total - native).toBeGreaterThan(10); // the pump's share, which the loops panel now reports
  }, 120_000);
});
