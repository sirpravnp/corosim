// End-to-end death trials on the core engine (docs/ARREST.md, "What kills"): lethal scenarios die at every clinical clock speed, at
// clinical times that make sense, without hanging; the same patients treated in time live. Each trial is stepped the way the page
// steps it (0.25 s frames, minutes = dt x speed x minutesPerSecond) and asserts a bound on steps and wall time, so a hang or a
// runaway fails the test instead of freezing the suite. Times are clinical minutes (sim.clinicalMinutes).
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { INFARCT } from "../src/config/management";
import { ARREST } from "../src/config/arrest";
import { CASE_BY_ID } from "../src/cath/cases";
import type { PatientSpec } from "../src/sim/patient";

const LAD = CASE_BY_ID.ladocc.scenario;
const DT = 0.25, WALL_MS = 300_000, TIMEOUT = 400_000;
type Act = (s: Simulation, simS: number, mem: Record<string, unknown>) => void;
interface Result { arrestMin: number | null; deathMin: number | null; cause: string | null; steps: number; simS: number; wallMs: number; minMap: number; sim: Simulation; criticalSeen: boolean }

function trial(spec: PatientSpec, speed: number, o: { maxClinMin: number; maxSimS: number; act?: Act }): Result {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3, ...spec }, { settled: true }); s.warmup(15);
  const c0 = s.clinicalMinutes, w0 = Date.now(), mem: Record<string, unknown> = {}, maxSteps = Math.ceil(o.maxSimS / DT);
  let steps = 0, arrestMin: number | null = null, minMap = Infinity, criticalSeen = false;
  while (!s.dead && steps < maxSteps && s.clinicalMinutes - c0 < o.maxClinMin && Date.now() - w0 < WALL_MS) {
    o.act?.(s, steps * DT, mem);
    s.step(DT, { minutes: DT * speed * INFARCT.minutesPerSecond });
    steps++;
    if (arrestMin === null && s.arrest?.status === "arrest") arrestMin = s.clinicalMinutes - c0;
    if (s.state().criticalTime) criticalSeen = true;
    if (Number.isFinite(s.map)) minMap = Math.min(minMap, s.map);
  }
  return { arrestMin, deathMin: s.dead ? s.clinicalMinutes - c0 : null, cause: s.deathCause, steps, simS: steps * DT, wallMs: Date.now() - w0, minMap, sim: s, criticalSeen };
}
const log = (name: string, r: Result) => { if (process.env.CORE_VERBOSE) console.log(`${name}: arrest ${r.arrestMin?.toFixed(1)} min, death ${r.deathMin?.toFixed(1)} min (${r.cause}), ${r.steps} steps, ${(r.wallMs / 1000).toFixed(0)} s wall`); };
/** No hang: the trial ended within its step budget and the wall-time cap, and the pressure never went NaN. */
const bounded = (r: Result, maxSimS: number) => { expect(r.steps).toBeLessThanOrEqual(Math.ceil(maxSimS / DT)); expect(r.wallMs).toBeLessThan(WALL_MS); expect(Number.isFinite(r.sim.map)).toBe(true); };

describe("lethal scenarios die at every clock speed", () => {
  for (const speed of [1, 3, 6]) {
    it(`exsanguination, healthy heart, 200 ml/min @${speed}x: PEA once about half the blood is gone, death 10 min later on the no-flow clock`, () => {
      const r = trial({ fluids: { hemorrhageMlMin: 200 } }, speed, { maxClinMin: 120, maxSimS: 1500 }); log(`exsang @${speed}x`, r);
      bounded(r, 1500);
      expect(r.cause).toBe("noFlow");
      expect(r.arrestMin!).toBeGreaterThan(6); expect(r.arrestMin!).toBeLessThan(20); // 1.2-4 L lost
      expect(r.deathMin! - r.arrestMin!).toBeGreaterThan(0.9 * ARREST.deathAfterNoFlowS / 60); expect(r.deathMin! - r.arrestMin!).toBeLessThan(1.2 * ARREST.deathAfterNoFlowS / 60);
      expect(r.criticalSeen).toBe(true);
      expect(r.minMap).toBeGreaterThanOrEqual(-0.5); // the circulation empties, it does not go far below zero
    }, TIMEOUT);
    it(`anterior STEMI + 100 ml/min hemorrhage @${speed}x (the reported case): arrest and death within an hour, not 28 h`, () => {
      const r = trial({ ...LAD, fluids: { hemorrhageMlMin: 100 } }, speed, { maxClinMin: 180, maxSimS: 1500 }); log(`STEMI+hem @${speed}x`, r);
      bounded(r, 1500);
      expect(r.cause).toBe("noFlow");
      expect(r.arrestMin!).toBeGreaterThan(15); expect(r.arrestMin!).toBeLessThan(40);
      expect(r.deathMin!).toBeLessThan(55);
    }, TIMEOUT);
  }
  for (const speed of [1, 6]) {
    it(`untreated VF @${speed}x: dead at 10 clinical minutes of no flow`, () => {
      const r = trial({ patient: { rhythm: "vf-coarse" } }, speed, { maxClinMin: 60, maxSimS: 1000 }); log(`VF @${speed}x`, r);
      bounded(r, 1000);
      expect(r.cause).toBe("noFlow");
      expect(r.deathMin!).toBeGreaterThan(9); expect(r.deathMin!).toBeLessThan(11);
      // the arrest panel's clock is the clinical clock (to the 15 s warm-up, which counts arrest time but no clinical time)
      expect(Math.abs(r.sim.arrestState().arrestS - r.deathMin! * 60)).toBeLessThan(20);
    }, TIMEOUT);
  }
  for (const speed of [1, 6]) {
    it(`tamponade, 300 ml and accumulating 30 ml/min @${speed}x: PEA within minutes, the sac never past 2 L, death on the no-flow clock`, () => {
      const r = trial({ pericardium: { effusionMl: 300, effusionRateMlMin: 30 } }, speed, { maxClinMin: 120, maxSimS: 1200 }); log(`tamponade @${speed}x`, r);
      bounded(r, 1200);
      expect(r.cause).toBe("noFlow");
      expect(r.arrestMin!).toBeLessThan(15);
      expect(r.deathMin! - r.arrestMin!).toBeLessThan(1.2 * ARREST.deathAfterNoFlowS / 60);
      expect(r.sim.pericardium()!.effusionMl).toBeLessThan(2000 + 1);
    }, TIMEOUT);
  }
  it("VF with good CPR and nothing else @6x: CPR buys time, but death still comes within half an hour", () => {
    const r = trial({ patient: { rhythm: "vf-coarse" } }, 6, { maxClinMin: 60, maxSimS: 2000, act: (s, t, m) => { if (t > 1 && !m.cpr) { m.cpr = true; s.startCpr(); } } }); log("VF+CPR @6x", r);
    bounded(r, 2000);
    expect(r.cause).toBe("noFlow");
    expect(r.deathMin!).toBeGreaterThan(11); expect(r.deathMin!).toBeLessThan(30);
  }, TIMEOUT);
});

describe("the same patients treated in time live", () => {
  for (const speed of [1, 6]) {
    it(`anterior STEMI + hemorrhage: stopping the bleed and 2 L of blood when MAP falls under 55 @${speed}x`, () => {
      const r = trial({ ...LAD, fluids: { hemorrhageMlMin: 100 } }, speed, { maxClinMin: 120, maxSimS: 900, act: (s, _t, m) => {
        if (s.map < 55 && !m.rx) { m.rx = true; s.apply({ fluids: { hemorrhageMlMin: 0, given: [{ kind: "blood", ml: 2000, atMin: 0, overMin: 10 }] } }); }
      } }); log(`rescue hem @${speed}x`, r);
      bounded(r, 900);
      expect(r.deathMin).toBeNull(); expect(r.arrestMin).toBeNull();
      expect(r.sim.map).toBeGreaterThan(65);
    }, TIMEOUT);
  }
  it("VF: CPR at 5 s and a 200 J shock at 60 s (repeated every 2 min) gives ROSC, not death", () => {
    const r = trial({ patient: { rhythm: "vf-coarse" } }, 1, { maxClinMin: 20, maxSimS: 1300, act: (s, t, m) => {
      if (t > 5 && !m.cpr) { m.cpr = true; s.startCpr(); }
      const st = s.arrestState();
      if (st.status === "arrest" && (st.rhythmClass === "vf" || st.rhythmClass === "pulselessVt") && t > 60 && t - ((m.last as number) ?? -1e9) > 120) { m.last = t; s.shock({ joules: 200 }); }
      if (st.status === "rosc" && st.cpr.on) s.stopCpr();
    } }); log("rescue VF", r);
    bounded(r, 1300);
    expect(r.deathMin).toBeNull();
    expect(r.sim.arrestState().status).toBe("rosc");
  }, TIMEOUT);
});
