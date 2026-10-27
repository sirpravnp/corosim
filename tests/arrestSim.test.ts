// Cardiac arrest wired into the Simulation on the core engine (task B4b): detection, CPR as a force on the heart, shocks, drugs,
// ROSC, death and restart. The machine's own rules are tested in arrestMachine.test.ts. Slow (the core engine, and ten minutes of
// untreated VF): listed in tests/slow.json.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { explain } from "../src/sim/explain";
import { ARREST } from "../src/config/arrest";

const core = (spec: object) => new Simulation(spec, { engine: "core" });
const co = (s: Simulation) => s.rolling(8).cardiacOutput;

describe("arrest in the Simulation (core engine)", () => {
  it("VF is detected as an arrest with no flow; CPR gives measurable flow, about a quarter of normal", () => {
    const s = core({ seed: 3 });
    s.warmup(5); s.run(8);
    const base = co(s);
    expect(s.state().arrest!.status).toBe("none");
    s.apply({ patient: { rhythm: "vf-coarse" } });
    s.run(15);
    const vf = s.state();
    expect(vf.arrest!.status).toBe("arrest");
    expect(vf.arrest!.rhythmClass).toBe("vf");
    expect(co(s)).toBeLessThan(0.05 * base);
    expect(vf.meanArterialPressure).toBeLessThan(30);
    expect(s.startCpr().ok).toBe(true);
    s.run(20);
    const cprCo = co(s), cpr = s.state();
    expect(cpr.arrest!.cpr.on).toBe(true);
    expect(cprCo / base).toBeGreaterThan(0.2);
    expect(cprCo / base).toBeLessThan(0.4);
    expect(cpr.meanArterialPressure).toBeGreaterThan(vf.meanArterialPressure + 15);
    // poor CPR (shallow, slow) gives less
    s.setCpr({ depthCm: 3.5, rate: 85 }); s.run(15);
    expect(co(s)).toBeLessThan(0.8 * cprCo);
    s.stopCpr(); s.run(15);
    expect(co(s)).toBeLessThan(0.1 * base);
  });

  it("VF -> CPR -> shock -> ROSC end to end: the patient's own rhythm returns with output, status rosc", () => {
    const s = core({ seed: 3 });
    s.warmup(5); s.run(5);
    const base = co(s);
    s.apply({ patient: { rhythm: "vf-coarse" } });
    s.run(20); // collapse, team arrives
    s.startCpr(); s.run(60);
    expect(s.giveDrug("epinephrine").ok).toBe(true);
    let shocks = 0;
    for (; shocks < 5; shocks++) {
      const r = s.shock({ joules: 200 });
      expect(r.discharged).toBe(true);
      if (r.success) break;
      s.run(30); // CPR continues between shocks
    }
    expect(shocks).toBeLessThan(5);
    s.stopCpr();
    s.run(30);
    const st = s.state();
    expect(st.rhythm.label).toBe("sinus");
    expect(st.arrest!.status).toBe("rosc");
    expect(st.arrest!.lastShock!.success).toBe(true);
    expect(st.dead).toBe(false);
    expect(co(s) / base).toBeGreaterThan(0.6);
    expect(st.meanArterialPressure).toBeGreaterThan(60);
    expect(st.arrest!.injury).toBe(0);
  });

  it("VF untreated -> death at the no-flow limit: readouts freeze, restartPatient starts again", () => {
    const s = core({ seed: 5, patient: { rhythm: "vf-coarse" } });
    let t = 0;
    while (!s.dead && s.t < ARREST.deathAfterNoFlowS + 60) { s.run(30); t = s.t; }
    expect(s.dead).toBe(true);
    const st = s.state();
    expect(st.dead).toBe(true);
    expect(st.arrest!.status).toBe("dead");
    expect(st.arrest!.injury).toBe(1);
    expect(t).toBeGreaterThan(ARREST.deathAfterNoFlowS * 0.9);
    // frozen: nothing evolves, every action is refused
    const frozen = JSON.stringify(s.state());
    s.run(20);
    expect(JSON.stringify(s.state())).toBe(frozen);
    expect(s.startCpr().ok).toBe(false);
    expect(s.shock({ joules: 200 }).discharged).toBe(false);
    expect(s.giveDrug("epinephrine").ok).toBe(false);
    expect(explain(s).mechanisms.join(" ")).toMatch(/died/);
    s.restartPatient();
    expect(s.dead).toBe(false);
    expect(s.t).toBe(0);
    s.run(5);
    expect(s.state().arrest!.status).toBe("arrest"); // the same scenario: VF again
  }, 120_000);

  it("synchronized cardioversion converts a perfusing VT; in VF the synchronized mode does not discharge", () => {
    const s = core({ seed: 3, patient: { rhythm: "vt-mono" } });
    s.run(10);
    expect(s.state().arrest!.status).toBe("none"); // VT with a pulse is not an arrest
    expect(s.rhythmClass()).toEqual({ rhythmClass: "perfusing", tachyarrhythmia: true });
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) { ok = s.shock({ joules: 200, sync: true }).success; s.run(2); }
    expect(ok).toBe(true);
    s.run(10);
    expect(s.state().rhythm.label).toBe("sinus");
    expect(s.state().arrest!.status).toBe("none");

    const v = core({ seed: 3, patient: { rhythm: "vf-coarse" } });
    v.run(5);
    const r = v.shock({ joules: 200, sync: true });
    expect(r.discharged).toBe(false);
    expect(v.state().arrest!.rhythmClass).toBe("vf");
  });

  it("an unsynchronized shock on a perfusing VT can induce VF, which is then an arrest", () => {
    const s = core({ seed: 7, patient: { rhythm: "vt-mono" } });
    s.run(5);
    let induced = false;
    for (let i = 0; i < 80 && !induced; i++) {
      const r = s.shock({ joules: 200 });
      if (r.newRhythmClass === "vf") induced = true;
      else if (s.state().rhythm.label === "sinus") s.apply({ patient: { rhythm: "vt-mono" } }); // converted: back to VT for the next try
    }
    expect(induced).toBe(true);
    s.run(10);
    expect(s.state().arrest!.status).toBe("arrest");
    expect(s.state().arrest!.rhythmClass).toBe("vf");
  });

  it("a VF episode of the arrhythmia model (B3b) is an arrest, and a successful shock ends the episode", () => {
    const s = core({ seed: 2 });
    s.warmup(5);
    expect(s.arrhythmia!.induce("vf")).toBe(true);
    for (let i = 0; i < 20 && s.arrhythmia!.current?.kind !== "vf"; i++) s.run(1);
    s.run(5);
    expect(s.state().arrest!.rhythmClass).toBe("vf");
    s.startCpr(); s.run(10);
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) { ok = s.shock({ joules: 200 }).success; if (!ok) s.run(20); }
    expect(ok).toBe(true);
    expect(s.arrhythmia!.current).toBeNull();
    s.stopCpr(); s.run(20);
    expect(s.state().arrest!.status).toBe("rosc");
  });

  it("the legacy engine has no arrest: no block in state(), and the actions return a note", () => {
    const s = new Simulation({ seed: 1 });
    s.run(3);
    expect("arrest" in s.state()).toBe(false);
    expect(s.state().dead).toBe(false);
    expect(s.startCpr()).toMatchObject({ ok: false });
    expect(s.shock({ joules: 200 }).discharged).toBe(false);
  });
});
