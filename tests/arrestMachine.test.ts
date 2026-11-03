import { describe, it, expect } from "vitest";
import { ARREST } from "../src/config/arrest";
import {
  createArrest, createRng, defibSuccessProbability, give, perfusion, restart, setCpr, shock, step,
  type ArrestState, type RhythmClass,
} from "../src/sim/arrest";

/** Run until dead or limit; returns seconds. */
function runToDeath(s: ArrestState, limitS = 5000, dt = 1): number {
  let t = 0;
  while (s.status !== "dead" && t < limitS) { step(s, dt, { output: 0 }); t += dt; }
  return t;
}

function settle(s: ArrestState, secs: number) { for (let i = 0; i < secs; i++) step(s, 1, { output: 0 }); }

describe("arrest machine", () => {
  it("untreated VF dies at the configured no-flow time and stays dead until restart", () => {
    const s = createArrest("vf");
    const t = runToDeath(s);
    expect(s.status).toBe("dead");
    expect(t).toBeGreaterThanOrEqual(ARREST.deathAfterNoFlowS);
    expect(t).toBeLessThanOrEqual(ARREST.deathAfterNoFlowS + 2);
    expect(s.injury).toBe(1);
    step(s, 1, { output: 1, rhythmClass: "perfusing" });
    expect(s.status).toBe("dead");
    restart(s, "vf");
    expect(s.status).toBe("arrest");
    expect(s.noFlowS).toBe(0);
    expect(s.injury).toBe(0);
  });

  it("injury begins after about 4 min of no flow and never recovers", () => {
    const s = createArrest("vf");
    settle(s, 200);
    expect(s.injury).toBe(0);
    settle(s, 150);
    expect(s.injury).toBeGreaterThan(0);
    const inj = s.injury;
    setCpr(s, { on: true });
    for (let i = 0; i < 30; i++) step(s, 1, { output: 0.9, rhythmClass: "perfusing" });
    expect(s.injury).toBeGreaterThanOrEqual(inj);
  });

  it("CPR perfusion is about 0.2-0.3 at good technique and lower for poor technique or pauses", () => {
    const s = createArrest("vf");
    setCpr(s, { on: true, rate: 110, depthCm: 5.5, quality: 1 });
    settle(s, 60);
    const good = perfusion(s);
    expect(good).toBeGreaterThan(0.25);
    expect(good).toBeLessThanOrEqual(0.3);
    setCpr(s, { depthCm: 3 });
    expect(perfusion(s)).toBeLessThan(good * 0.5);
    setCpr(s, { depthCm: 5.5, rate: 80 });
    expect(perfusion(s)).toBeLessThan(good);
    setCpr(s, { rate: 110, quality: 0.5 });
    expect(perfusion(s)).toBeCloseTo(good * 0.5, 2);
    setCpr(s, { on: false });
    expect(perfusion(s)).toBe(0);
    // interruptions: restart after a pause rebuilds output gradually
    settle(s, 10);
    setCpr(s, { on: true, quality: 1 });
    expect(perfusion(s)).toBeLessThan(good * 0.5);
    settle(s, 5);
    expect(perfusion(s)).toBeGreaterThan(good * 0.5);
  });

  it("good CPR extends time to death; poor CPR extends it less", () => {
    const none = runToDeath(createArrest("vf"));
    const good = createArrest("vf"); setCpr(good, { on: true });
    const poor = createArrest("vf"); setCpr(poor, { on: true, depthCm: 3, rate: 140, quality: 0.4 });
    const tGood = runToDeath(good), tPoor = runToDeath(poor);
    expect(tGood).toBeGreaterThan(none * 1.5);
    expect(tPoor).toBeGreaterThan(none);
    expect(tGood).toBeGreaterThan(tPoor);
  });

  function resus(seed: number): { status: string; shocks: number } {
    const s = createArrest("vf"); const rng = createRng(seed);
    settle(s, 30);
    setCpr(s, { on: true });
    for (let i = 0; i < 120; i++) step(s, 1, { output: 0 }, rng);
    let shocks = 0;
    for (let k = 0; k < 4 && (s.rhythmClass as RhythmClass) !== "perfusing"; k++) {
      shock(s, { joules: 200, sync: false }, rng); shocks++;
      for (let i = 0; i < 120 && (s.rhythmClass as RhythmClass) !== "perfusing"; i++) step(s, 1, { output: 0 }, rng);
    }
    for (let i = 0; i < 40; i++) step(s, 1, { output: (s.rhythmClass as RhythmClass) === "perfusing" ? 0.8 : 0 }, rng);
    return { status: s.status, shocks };
  }

  it("VF -> CPR -> shock -> ROSC is possible and seeded-deterministic", () => {
    const outcomes = Array.from({ length: 20 }, (_, i) => resus(i + 1));
    expect(outcomes.some((o) => o.status === "rosc")).toBe(true);
    expect(Array.from({ length: 20 }, (_, i) => resus(i + 1))).toEqual(outcomes);
    // same seed -> same shock sequence
    const a = createRng(7), b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("ROSC needs perfusing rhythm with output >= 0.5 sustained", () => {
    const s = createArrest("vf");
    s.rhythmClass = "perfusing";
    for (let i = 0; i < 20; i++) step(s, 1, { output: 0.3 });
    expect(s.status).toBe("arrest");
    for (let i = 0; i < 5; i++) step(s, 1, { output: 0.7 });
    expect(s.status).toBe("arrest");
    for (let i = 0; i < 10; i++) step(s, 1, { output: 0.7 });
    expect(s.status).toBe("rosc");
  });

  it("defibrillation success falls with untreated VF duration", () => {
    const early = createArrest("vf"), late = createArrest("vf");
    settle(late, 300);
    const p0 = defibSuccessProbability(early, 200), p5 = defibSuccessProbability(late, 200);
    expect(p0 - p5).toBeGreaterThan(0.3);
    expect((p0 - defibSuccessProbability((settle(early, 60), early), 200))).toBeGreaterThan(0.07);
    expect(p0 - defibSuccessProbability(early, 200)).toBeLessThan(0.1);
    // empirically too
    const hits = (s: ArrestState) => { let n = 0; for (let i = 0; i < 400; i++) { const c = { ...s, cpr: { ...s.cpr }, drugs: [] }; if (shock(c, { joules: 200, sync: false }, createRng(i)).success) n++; } return n; };
    expect(hits(createArrest("vf"))).toBeGreaterThan(hits(late));
  });

  it("success rises with CPR quality and energy", () => {
    const base = createArrest("vf"); settle(base, 120);
    const cpr = createArrest("vf"); setCpr(cpr, { on: true }); settle(cpr, 120);
    expect(defibSuccessProbability(cpr, 200)).toBeGreaterThan(defibSuccessProbability(base, 200));
    expect(defibSuccessProbability(base, 200)).toBeGreaterThan(defibSuccessProbability(base, 120));
    expect(defibSuccessProbability(base, 120)).toBeGreaterThan(defibSuccessProbability(base, 50));
  });

  it("asystole and PEA never shock to ROSC", () => {
    for (const r of ["asystole", "pea"] as RhythmClass[]) {
      for (let i = 0; i < 200; i++) {
        const s = createArrest(r);
        const res = shock(s, { joules: 200, sync: false }, createRng(i));
        expect(res.success).toBe(false);
        expect(s.rhythmClass).toBe(r);
      }
    }
  });

  it("synchronized cardioversion only works on a perfusing tachyarrhythmia; sync in VF does not discharge", () => {
    const vf = createArrest("vf");
    const r = shock(vf, { joules: 200, sync: true }, createRng(1));
    expect(r.success).toBe(false); expect(r.discharged).toBe(false); expect(vf.rhythmClass).toBe("vf");

    let ok = 0;
    for (let i = 0; i < 200; i++) {
      const s = createArrest("perfusing"); s.tachyarrhythmia = true;
      if (shock(s, { joules: 100, sync: true }, createRng(i)).success) ok++;
    }
    expect(ok).toBeGreaterThan(100);
    const calm = createArrest("perfusing");
    expect(shock(calm, { joules: 100, sync: true }, createRng(1)).success).toBe(false);

    // unsynchronized shock on a perfusing tachyarrhythmia can induce VF
    let vfInduced = 0;
    for (let i = 0; i < 300; i++) {
      const s = createArrest("perfusing"); s.tachyarrhythmia = true;
      shock(s, { joules: 200, sync: false }, createRng(i));
      if (s.rhythmClass === "vf") vfInduced++;
    }
    expect(vfInduced).toBeGreaterThan(0);
  });

  it("drugs move odds in the stated direction", () => {
    const mk = () => { const s = createArrest("vf"); settle(s, 180); return s; };
    const base = defibSuccessProbability(mk(), 200);
    const a1 = mk(); give(a1, "amiodarone");
    const a2 = mk(); give(a2, "amiodarone", 300); give(a2, "amiodarone", 150);
    const l = mk(); give(l, "lidocaine");
    const e = mk(); give(e, "epinephrine");
    expect(defibSuccessProbability(a1, 200)).toBeGreaterThan(base);
    expect(defibSuccessProbability(a2, 200)).toBeGreaterThan(defibSuccessProbability(a1, 200));
    expect(defibSuccessProbability(l, 200)).toBeGreaterThan(base);
    expect(defibSuccessProbability(e, 200)).toBeGreaterThan(base);
    expect(a2.drugs.map((d) => d.dose)).toEqual([300, 150]);
    expect(give(createArrest("vf"), "amiodarone", -1).ok).toBe(false);

    // epinephrine raises CPR output slightly, within its window only
    const c0 = createArrest("vf"); setCpr(c0, { on: true }); settle(c0, 60);
    const before = perfusion(c0);
    give(c0, "epinephrine");
    const during = perfusion(c0);
    expect(during).toBeGreaterThan(before);
    expect(during - before).toBeLessThan(0.05);
    settle(c0, 330);
    // (dead by now is fine; check the window using a perfusing-free state instead)
    const c1 = createArrest("vf"); setCpr(c1, { on: true }); settle(c1, 60); give(c1, "epinephrine");
    for (let i = 0; i < 301; i++) step(c1, 1, { output: 0 });
    if (c1.status !== "dead") expect(perfusion(c1)).toBeCloseTo(before, 1);

    // epinephrine raises spontaneous ROSC odds in PEA under CPR
    const rate = (withEpi: boolean) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const s = createArrest("pea"); setCpr(s, { on: true }); settle(s, 40);
        if (withEpi) give(s, "epinephrine");
        const rng = createRng(1000 + i);
        for (let t = 0; t < 120 && s.rhythmClass === "pea"; t++) step(s, 1, { output: 0 }, rng);
        if (s.rhythmClass === "perfusing") n++;
      }
      return n;
    };
    expect(rate(true)).toBeGreaterThan(rate(false));
  });

  it("epinephrine given within 3 min of the last dose adds no window", () => {
    const s = createArrest("vf");
    give(s, "epinephrine");
    settle(s, 60);
    const r = give(s, "epinephrine");
    expect(r.note).toMatch(/sooner/);
    settle(s, 250);
    // window from the first dose (t=0) has expired by t=310
    const p = defibSuccessProbability(s, 200);
    expect(p).toBeLessThanOrEqual(ARREST.shock.maxSuccess);
  });
});
