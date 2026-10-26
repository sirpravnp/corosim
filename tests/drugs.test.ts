// Receptor-level drugs on the core engine (task E4): src/physics/core/drugs.ts, config/drugs.ts, wired in Simulation.
// Part 1 is the drug model alone (kinetics, receptor profiles, effects). Part 2 runs the core ACS simulation for the clinical teaching points.
// Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { Drugs, drugEffects, receptorDrive } from "../src/physics/core/drugs";
import { DRUG_NAMES, KINETICS, type DrugName } from "../src/config/drugs";
import { Simulation } from "../src/sim/simulation";
import type { Scenario } from "../src/sim/scenario";
import { CASE_BY_ID } from "../src/cath/cases";

const levels = (o: Partial<Record<DrugName, number>>) => Object.fromEntries(DRUG_NAMES.map((n) => [n, o[n] ?? 0])) as Record<DrugName, number>;
const fx = (o: Partial<Record<DrugName, number>>) => drugEffects(levels(o));

describe("drug kinetics (clinical minutes)", () => {
  it("rises first order toward the dose with the onset time constant, whatever the step", () => {
    for (const n of DRUG_NAMES) {
      const a = new Drugs(), b = new Drugs(), tau = KINETICS[n].on;
      a.step(tau, { [n]: 0.8 });
      expect(a.level[n]).toBeCloseTo(0.8 * (1 - Math.exp(-1)), 9);
      for (let i = 0; i < 50; i++) b.step(tau / 50, { [n]: 0.8 }); // the same minutes in 50 pieces
      expect(b.level[n]).toBeCloseTo(a.level[n], 9);
    }
  });
  it("falls with the (slower) offset time constant once the dose is stopped", () => {
    for (const n of DRUG_NAMES) {
      const d = new Drugs({ [n]: 1 }), tau = KINETICS[n].off;
      expect(tau).toBeGreaterThanOrEqual(KINETICS[n].on);
      d.step(tau, {});
      expect(d.level[n]).toBeCloseTo(Math.exp(-1), 9);
    }
  });
  it("is fast for the catecholamines and nitrates (minutes) and slow for milrinone and the beta-blocker (hours)", () => {
    const at = (n: DrugName, minutes: number, from: number, to: number) => { const d = new Drugs({ [n]: from }); d.step(minutes, { [n]: to }); return d.level[n]; };
    for (const n of ["norepinephrine", "epinephrine", "dobutamine", "nitroglycerin", "nitroprusside"] as const) {
      expect(at(n, 10, 0, 1)).toBeGreaterThan(0.95); // at steady state within ten minutes
      expect(at(n, 15, 1, 0)).toBeLessThan(0.05);
    }
    expect(at("milrinone", 30, 1, 0)).toBeGreaterThan(0.7); // still working half an hour after the infusion stops
    expect(at("betaBlocker", 60, 1, 0)).toBeGreaterThan(0.7);
    expect(at("milrinone", 10, 0, 1)).toBeLessThan(0.65); // and not at full effect after ten minutes
  });
  it("does not move with no clinical time", () => {
    const d = new Drugs(); d.step(0, { norepinephrine: 1 }); d.step(-5, { norepinephrine: 1 });
    expect(d.level.norepinephrine).toBe(0);
  });
});

describe("receptor profiles", () => {
  it("no drug, no effect", () => {
    const e = fx({});
    expect([e.resistance, e.venousTone, e.contractility, e.relax, e.hrScale, e.diuretic, e.demand]).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(e.betaBlock).toBe(0);
  });
  it("norepinephrine is an alpha-1 agonist with some beta-1: arteries and veins constrict, Ees and rate rise a little", () => {
    const e = fx({ norepinephrine: 1 });
    expect(e.resistance).toBeGreaterThan(1.4); expect(e.venousTone).toBeGreaterThan(1.2);
    expect(e.contractility).toBeGreaterThan(1.1); expect(e.contractility).toBeLessThan(1.3);
    expect(e.hrScale).toBeGreaterThan(1); expect(e.hrScale).toBeLessThan(1.15);
    expect(e.demand).toBeGreaterThan(1);
  });
  it("epinephrine is mostly beta: more inotropy and rate than norepinephrine, much less vasoconstriction", () => {
    const e = fx({ epinephrine: 1 }), n = fx({ norepinephrine: 1 });
    expect(e.contractility).toBeGreaterThan(n.contractility); expect(e.hrScale).toBeGreaterThan(n.hrScale);
    expect(e.resistance).toBeLessThan(n.resistance - 0.3);
  });
  it("dobutamine raises Ees and shortens tau, leaves resistance a little lower, and is blunted by a beta-blocker", () => {
    const e = fx({ dobutamine: 1 }), b = fx({ dobutamine: 1, betaBlocker: 1 });
    expect(e.contractility).toBeGreaterThan(1.4); expect(e.relax).toBeLessThan(0.85);
    expect(e.resistance).toBeLessThan(1); expect(e.resistance).toBeGreaterThan(0.85);
    expect(b.contractility).toBeCloseTo(1, 9); expect(b.hrScale).toBeCloseTo(1, 9); // the receptor is occupied
  });
  it("milrinone is an inodilator that works through a beta-blockade: Ees up, tau shorter, resistance and venous tone down", () => {
    const m = fx({ milrinone: 1 }), b = fx({ milrinone: 1, betaBlocker: 1 });
    expect(m.contractility).toBeGreaterThan(1.2); expect(m.relax).toBeLessThan(0.8);
    expect(m.resistance).toBeLessThan(0.8); expect(m.venousTone).toBeLessThan(1);
    expect(b.contractility).toBeCloseTo(m.contractility, 9); expect(b.relax).toBeGreaterThan(m.relax - 0.01); // only the blocker's own small lengthening
  });
  it("vasopressin is arterial only: resistance up, no inotropy, no chronotropy, almost no venous effect", () => {
    const e = fx({ vasopressin: 1 });
    expect(e.resistance).toBeGreaterThan(1.4);
    expect(e.contractility).toBe(1); expect(e.hrScale).toBe(1); expect(e.relax).toBe(1);
    expect(e.venousTone).toBeLessThan(1.1);
  });
  it("nitroglycerin dilates the veins before the arteries at low dose, and the veins stay ahead at every dose", () => {
    for (const d of [0.05, 0.1, 0.15, 0.3, 0.6, 1]) {
      const e = fx({ nitroglycerin: d });
      expect(1 - e.venousTone).toBeGreaterThan(1 - e.resistance);
    }
    const low = fx({ nitroglycerin: 0.15 });
    expect(low.venousTone).toBeLessThan(0.85); expect(low.resistance).toBeGreaterThan(0.95); // preload first, afterload hardly at all
    expect(fx({ nitroglycerin: 1 }).resistance).toBeLessThan(0.75); // a full dose is an arterial dilator as well
    expect(low.contractility).toBe(1);
  });
  it("nitroprusside dilates the arteries at least as much as the veins", () => {
    const e = fx({ nitroprusside: 0.5 });
    expect(1 - e.resistance).toBeGreaterThan(0.25); expect(1 - e.resistance).toBeGreaterThan(1 - e.venousTone);
  });
  it("the beta-blocker hands its blockade to the autonomic model and slows relaxation a little", () => {
    const e = fx({ betaBlocker: 0.6 });
    expect(e.betaBlock).toBeCloseTo(0.6, 9); expect(e.relax).toBeGreaterThan(1); expect(e.relax).toBeLessThan(1.1);
    expect(e.resistance).toBe(1); expect(e.contractility).toBe(1); // its direct effect on Ees and rate is in the autonomic loop, not added here
  });
  it("furosemide multiplies the urine and dilates the veins a little", () => {
    const e = fx({ furosemide: 1 });
    expect(e.diuretic).toBeGreaterThan(5); expect(e.venousTone).toBeLessThan(1); expect(e.venousTone).toBeGreaterThan(0.85);
  });
  it("the receptor drives add up across drugs", () => {
    const r = receptorDrive(levels({ norepinephrine: 0.5, phenylephrine: 0.5 }));
    expect(r.a1).toBeCloseTo(1, 9);
  });
});

// ---- the core ACS simulation ---------------------------------------------------------------------------------------
const say = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const NOISELESS = { autonomic: { noise: 0 } } as const; // the beat-to-beat noise on Ees is bigger than the effects compared by modifier
function make(sc: Scenario = {}, warm = 40) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3, ...sc }, { settled: true });
  s.warmup(warm); s.history = [];
  return s;
}
/** 40 s of simulation = 80 clinical minutes: every drug is at its steady level. */
function measure(s: Simulation, sec = 40) {
  s.run(sec);
  const r = s.rolling(30), h = s.hemo(30)!, tau = s.live!.records.slice(-20).map((b) => b.tauMs.LV).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  return { map: r.map, co: r.cardiacOutput, hr: r.hr, svr: r.map / r.cardiacOutput, msfp: s.filling()!.msfp, pcwp: h.pcwp, cvp: h.cvp, tau: tau[tau.length >> 1], ees: s.live!.modifiers.contractility, tone: s.live!.modifiers.venousTone, res: s.live!.modifiers.resistance, urine: s.fluids()!.urineRate };
}
const LAD = CASE_BY_ID.ladocc.scenario;
type M = ReturnType<typeof measure>;
const give = (support: NonNullable<Scenario["support"]>, base: Scenario = {}) => measure(make({ ...NOISELESS, ...base, support: { ...base.support, ...support } }));

describe("receptor-level drugs in the core ACS simulation: normal adult", () => {
  const base = measure(make(NOISELESS));
  const row = (name: string, m: M) => say(name.padEnd(16), `MAP ${m.map.toFixed(1)} CO ${m.co.toFixed(2)} HR ${m.hr.toFixed(0)} SVR ${m.svr.toFixed(1)} MSFP ${m.msfp.toFixed(2)} PCWP ${m.pcwp.toFixed(1)} Ees ${m.ees.toFixed(2)} tau ${m.tau?.toFixed(0)}`);
  row("baseline", base);

  it("norepinephrine raises MAP and, with the reflex intact, the mean systemic filling pressure; without a reflex the venoconstriction is plain", () => {
    const m = give({ norepinephrine: 0.6 }), full = give({ norepinephrine: 1 });
    row("norepi .6", m); row("norepi 1", full);
    expect(m.map).toBeGreaterThan(base.map + 8);
    expect(m.hr).toBeLessThan(base.hr); // reflex bradycardia against the pressure the drug made
    expect(full.msfp).toBeGreaterThan(base.msfp + 0.3); // the baroreflex withdraws most of the drug's venous tone; some is left
    const free = measure(make({ ...NOISELESS, autonomic: { noise: 0, baroreflexGain: 0 } })), freeNe = measure(make({ ...NOISELESS, autonomic: { noise: 0, baroreflexGain: 0 }, support: { norepinephrine: 0.5 } }));
    expect(freeNe.msfp).toBeGreaterThan(free.msfp + 1); expect(freeNe.map).toBeGreaterThan(free.map + 30);
  });
  it("norepinephrine raises MSFP and MAP in a bleeding patient too", () => {
    const b = measure(make({ ...NOISELESS, bloodLoss: 0.15 })), n = measure(make({ ...NOISELESS, bloodLoss: 0.15, support: { norepinephrine: 0.6 } }));
    expect(n.map).toBeGreaterThan(b.map + 8); expect(n.tone).toBeGreaterThan(b.tone); // the venous tone is up even where the pooled blood volume went down (capillary filtration)
  });
  it("nitroglycerin lowers preload (MSFP, wedge, CVP) first: at a low dose the arterial resistance the drug adds is nil", () => {
    const m = give({ nitroglycerin: 0.15 });
    row("nitro .15", m);
    expect(m.msfp).toBeLessThan(base.msfp - 1); expect(m.pcwp).toBeLessThan(base.pcwp - 1.5); expect(m.cvp).toBeLessThan(base.cvp - 0.5);
    expect(m.map).toBeLessThan(base.map); // lower preload lowers the pressure; the drug's own arterial dilation is still ~0 (see "receptor profiles")
    expect(m.co).toBeLessThan(base.co);
  });
  it("milrinone shortens tau, lowers SVR and raises the output with little change in pressure", () => {
    const m = give({ milrinone: 0.5 });
    row("milrinone .5", m);
    expect(m.tau).toBeLessThan(base.tau * 0.9); expect(m.svr).toBeLessThan(base.svr * 0.95);
    expect(m.co).toBeGreaterThan(base.co + 0.2); expect(Math.abs(m.map - base.map)).toBeLessThan(5);
    expect(m.ees).toBeGreaterThan(base.ees + 0.15);
  });
  it("dobutamine raises Ees and output with little change in pressure", () => {
    const m = give({ dobutamine: 0.5 });
    row("dobutamine .5", m);
    expect(m.ees).toBeGreaterThan(base.ees + 0.2); expect(m.co).toBeGreaterThan(base.co + 0.2); expect(Math.abs(m.map - base.map)).toBeLessThan(5);
    expect(m.hr).toBeGreaterThan(base.hr); expect(m.tau).toBeLessThan(base.tau);
  });
  it("epinephrine raises output and Ees more than pressure", () => {
    const m = give({ epinephrine: 0.5 });
    row("epinephrine .5", m);
    expect(m.co).toBeGreaterThan(base.co + 0.1); expect(m.ees).toBeGreaterThan(base.ees + 0.1); expect(m.map).toBeGreaterThan(base.map);
  });
  it("vasopressin raises SVR and pressure without inotropy", () => {
    const m = give({ vasopressin: 0.5 });
    row("vasopressin .5", m);
    expect(m.svr).toBeGreaterThan(base.svr * 1.1); expect(m.map).toBeGreaterThan(base.map + 3);
    expect(Math.abs(m.ees - base.ees)).toBeLessThan(0.05); // Ees moves only with the baroreflex, which lets it go if anything
    expect(m.hr).toBeLessThan(base.hr);
  });
  it("nitroprusside lowers pressure and SVR", () => {
    const m = give({ nitroprusside: 0.5 });
    row("nitroprusside .5", m);
    expect(m.map).toBeLessThan(base.map - 8); expect(m.svr).toBeLessThan(base.svr);
  });
  it("the beta-blocker lowers heart rate and Ees", () => {
    const m = measure(make({ ...NOISELESS, drugs: { betaBlocker: 0.6 } }));
    row("beta-blocker .6", m);
    expect(m.hr).toBeLessThan(base.hr - 5); expect(m.ees).toBeLessThan(base.ees - 0.03);
  });
  it("furosemide multiplies the urine flow in the fluid model and lowers the filling pressure, with the water still conserved", () => {
    const s = make({ ...NOISELESS, support: { furosemide: 0.8 } }), m = measure(s);
    row("furosemide .8", m);
    expect(m.urine).toBeGreaterThan(4 * base.urine); expect(m.msfp).toBeLessThan(base.msfp - 0.5);
    expect(Math.abs(s.fluids()!.conservation)).toBeLessThan(0.1);
  });
  it("the scenario's vasopressor dial is an alpha agonist above 0 and a vasodilator below", () => {
    const up = measure(make({ ...NOISELESS, drugs: { vasopressor: 1 } })), down = measure(make({ ...NOISELESS, drugs: { vasopressor: -1 } }));
    expect(up.map).toBeGreaterThan(base.map + 8); expect(down.map).toBeLessThan(base.map - 10);
  });
});

describe("receptor-level drugs in the anterior STEMI", () => {
  const base = measure(make({ ...NOISELESS, ...LAD }));
  const g = (support: NonNullable<Scenario["support"]>) => give(support, LAD);
  it("dobutamine and milrinone raise the output and lower the wedge pressure of the failing ventricle", () => {
    for (const sup of [{ dobutamine: 0.5 }, { milrinone: 0.5 }]) {
      const m = g(sup);
      say(JSON.stringify(sup), `MAP ${m.map.toFixed(1)} CO ${m.co.toFixed(2)} PCWP ${m.pcwp.toFixed(1)}`);
      expect(m.co).toBeGreaterThan(base.co + 0.3); expect(m.pcwp).toBeLessThan(base.pcwp - 2);
    }
    expect(g({ milrinone: 0.5 }).map).toBeLessThan(base.map); // the vasodilation costs pressure
  });
  it("vasopressin raises SVR and MAP and costs output (afterload on a failing ventricle)", () => {
    const m = g({ vasopressin: 0.5 });
    expect(m.svr).toBeGreaterThan(base.svr * 1.1); expect(m.map).toBeGreaterThan(base.map); expect(m.co).toBeLessThan(base.co);
  });
  it("nitroglycerin lowers the wedge pressure and MSFP, and the pressure with them", () => {
    const m = g({ nitroglycerin: 0.3 });
    expect(m.pcwp).toBeLessThan(base.pcwp - 5); expect(m.msfp).toBeLessThan(base.msfp - 1.5); expect(m.map).toBeLessThan(base.map - 5);
  });
  it("the beta-blocker lowers the heart rate and Ees of the stressed ventricle", () => {
    const m = measure(make({ ...NOISELESS, ...LAD, drugs: { betaBlocker: 0.6 } }));
    expect(m.hr).toBeLessThan(base.hr - 5); expect(m.ees).toBeLessThan(base.ees - 0.03);
  });
});

describe("onset and offset in the simulation follow the time constants", () => {
  it("norepinephrine reaches 1 - exp(-t/tau) of its dose after t clinical minutes, and falls away with the offset constant", () => {
    const s = make(NOISELESS, 10), on = KINETICS.norepinephrine.on, off = KINETICS.norepinephrine.off, mps = s.minutesPerSecond;
    expect(s.drugState()!.level.norepinephrine).toBe(0);
    s.apply({ support: { norepinephrine: 0.6 } });
    s.step(on / mps); // `on` clinical minutes
    expect(s.drugState()!.level.norepinephrine).toBeCloseTo(0.6 * (1 - Math.exp(-1)), 2);
    s.step(10 / mps);
    expect(s.drugState()!.level.norepinephrine).toBeGreaterThan(0.59);
    expect(s.drugState()!.effects.resistance).toBeGreaterThan(1.3);
    s.apply({ support: { norepinephrine: 0 } });
    s.step(off / mps);
    expect(s.drugState()!.level.norepinephrine).toBeCloseTo(0.6 * Math.exp(-1), 1);
    s.step(30 / mps);
    expect(s.drugState()!.level.norepinephrine).toBeLessThan(0.01);
  });
  it("a drug does not move while the clinical clock is stopped, and starts at its dose when it is in the scenario", () => {
    const s = make({ ...NOISELESS, support: { milrinone: 0.5 } }, 10);
    expect(s.drugState()!.level.milrinone).toBe(0.5);
    s.apply({ support: { milrinone: 0 } });
    s.step(5, { minutes: 0 });
    expect(s.drugState()!.level.milrinone).toBe(0.5);
    s.step(5, { minutes: 60 }); // an hour of clinical time: tau 90 min
    expect(s.drugState()!.level.milrinone).toBeCloseTo(0.5 * Math.exp(-60 / KINETICS.milrinone.off), 2);
  });
  it("nitroglycerin's blood-pressure effect arrives and goes within minutes: the MAP follows the level", () => {
    const s = make(NOISELESS, 30);
    s.run(10); const p0 = s.rolling(8).map;
    s.apply({ support: { nitroglycerin: 0.5 } }); s.run(20); // 40 clinical minutes
    const p1 = s.rolling(8).map;
    s.apply({ support: { nitroglycerin: 0 } }); s.run(20);
    const p2 = s.rolling(8).map;
    say("nitro on/off MAP", p0, p1, p2);
    expect(p1).toBeLessThan(p0 - 6); expect(p2).toBeGreaterThan(p1 + 6); expect(Math.abs(p2 - p0)).toBeLessThan(4);
  });
});

describe("the old multipliers are not read on the core path; the legacy engine keeps its numbers", () => {
  it("the legacy engine has no drug state and says it ignores the new drugs", () => {
    const s = new Simulation({}, { engine: "legacy" });
    s.reset({ seed: 1, support: { milrinone: 0.5 } });
    expect(s.drugState()).toBeNull();
    expect(s.warnings.some((w) => /milrinone.*core engine only/.test(w))).toBe(true);
  });
  it("the receptor-level drugs reach the scenario and the support spec", () => {
    const s = make({ support: { epinephrine: 0.3, furosemide: 0.2 } }, 5);
    expect(s.drugState()!.level.epinephrine).toBeCloseTo(0.3, 9);
    expect(s.drugState()!.level.furosemide).toBeCloseTo(0.2, 9);
  });
});
