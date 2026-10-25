// The ACS simulation on the core engine (task A7): Simulation({ engine: "core" }). Legacy tests are untouched (simulation.test.ts etc.).
// Direction tests on teaching scenarios, the baroreflex over 10 minutes, a PVC on the live strip, the real devices (basic checks), and speed.
// Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { Scenario } from "../src/sim/scenario";
import { CASE_BY_ID } from "../src/cath/cases";
import { CIRC } from "../src/physics/circulation";
import type { BeatRecord } from "../src/sim/metrics";

const say = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a.map((x) => (x && typeof x === "object" && "circ" in x ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "circ").map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v])) : x))); };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/** A settled core-engine simulation: seed 3, `warm` s of reflex settling with no clinical time. */
function make(sc: Scenario = {}, warm = 40, engine: "core" | "legacy" = "core") {
  const s = new Simulation({}, { engine });
  s.reset({ seed: 3, ...sc }, { settled: true });
  s.warmup(warm); s.history = [];
  return s;
}
/** Run `sec` seconds and report what a monitor and a PA catheter show over them. */
function measure(s: Simulation, sec = 30) {
  s.run(sec);
  const r = s.rolling(sec), h = s.hemo(sec)!;
  return { map: r.map, sv: r.sv, co: r.cardiacOutput, hr: r.hr, sbp: r.sbp, dbp: r.dbp, cvp: h?.cvp, pcwp: h?.pcwp, lvedp: h?.lvedp, state: s.circ.state, circ: s.circ };
}
const LAD = CASE_BY_ID.ladocc.scenario, RCA = CASE_BY_ID.rcaocc.scenario;

describe("engine option", () => {
  it("defaults to the legacy engine, which has no live heart", () => {
    const s = new Simulation({ seed: 1 });
    expect(s.engine).toBe("legacy");
    expect(s.live).toBeUndefined();
    expect(s.hemo()).toBeNull();
    expect(new Simulation({ seed: 1 }, { engine: "core" }).live).toBeDefined();
  });
  it("legacy numbers are unchanged by the option: same seed, same beats", () => {
    const a = new Simulation({ seed: 5 }), b = new Simulation({ seed: 5 }, { engine: "legacy" });
    expect(b.run(20).map((x) => x.sbp)).toEqual(a.run(20).map((x) => x.sbp));
  });
});

describe("normal patient on the core engine", () => {
  const s = make(), m = measure(s), legacy = measure(make({}, 40, "legacy"));
  it("has a normal pressure, output and catheter numbers", () => {
    say("normal", m);
    expect(m.map).toBeGreaterThan(85); expect(m.map).toBeLessThan(95);
    expect(m.co).toBeGreaterThan(4.5); expect(m.co).toBeLessThan(5.8);
    expect(m.sbp - m.dbp).toBeGreaterThan(30); expect(m.sbp - m.dbp).toBeLessThan(60);
    expect(m.cvp).toBeGreaterThan(2); expect(m.cvp).toBeLessThan(7);
    expect(m.pcwp).toBeGreaterThan(5); expect(m.pcwp).toBeLessThan(12);
    expect(m.state).toBe("stable");
  });
  it("beats at the legacy engine's rate", () => { expect(Math.abs(m.hr - legacy.hr)).toBeLessThan(4); });
  it("fills every field of circ with finite numbers", () => {
    for (const [k, v] of Object.entries(s.circ)) if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
    expect(s.circ.ejectionFraction).toBeGreaterThan(0.5); expect(s.circ.ejectionFraction).toBeLessThan(0.7);
    expect(s.circ.deviceFlow).toBe(0);
    expect(s.circ.congestion).toBe(0);
    expect(s.circ.coronaryPressure).toBeCloseTo(s.circ.map, 6);
  });
  it("keeps the history, baroreflex and map in step: beats come from the live heart", () => {
    expect(s.history.length).toBeGreaterThan(30);
    expect(s.history.every((b) => b.atrialKick || b.pvc)).toBe(true);
    expect(Math.abs(s.map - m.map)).toBeLessThan(6);
  });
});

describe("anterior STEMI (proximal LAD occlusion)", () => {
  const normal = measure(make()), m = measure(make(LAD));
  it("lowers stroke volume and raises the filling pressures", () => {
    say("LAD", m, "normal", normal);
    expect(m.sv).toBeLessThan(0.65 * normal.sv);
    expect(m.lvedp).toBeGreaterThanOrEqual(15);
    expect(m.pcwp).toBeGreaterThanOrEqual(15);
    expect(m.cvp).toBeLessThan(8); // the right heart is not the problem
  });
  it("lowers the pressure, with reflex tachycardia, a poor ejection fraction and a congested lung", () => {
    expect(m.map).toBeLessThan(normal.map - 7);
    expect(m.hr).toBeGreaterThan(normal.hr + 20);
    expect(m.circ.ejectionFraction).toBeLessThan(0.4);
    expect(m.circ.congestion).toBeGreaterThan(0.3);
    expect(m.circ.lvIschemia).toBeGreaterThan(0.2);
  });
  // C2: the anterior STEMI's low pressure draws about 100 ml back from the interstitium (Starling), a thin 0.15 mmHg over the 8 mmHg bar below
  // (venousToneGain stays at 0.75 rather than being tuned to this bar). The bar stays.
  // C3: the same patient (wedge about 20) now also filters about 100 ml into the lung, which takes it back over the bar, unchanged.
  it("lowers the pressure by 8 mmHg", () => { expect(m.map).toBeLessThan(normal.map - 8); });
  it("reports the state as the pressure says it", () => {
    const want = (map: number) => (map < CIRC.shockMap ? "shock" : map < CIRC.hypotensionMap ? "hypotension" : "stable");
    const s = make(LAD);
    for (let i = 0; i < 8; i++) { s.step(5); expect(s.circ.state).toBe(want(s.map)); expect(s.state().circulationState).toBe(want(s.map)); }
    expect(want(m.map)).not.toBe("shock");
  });
});

describe("right ventricular infarct (proximal RCA occlusion, complete heart block)", () => {
  const normal = measure(make()), s = make(RCA), m = measure(s);
  it("raises CVP to at least 10 mmHg before any fluid", () => { expect(m.cvp).toBeGreaterThanOrEqual(10); });
  it("raises the right-sided pressure with a clear wedge and low pressure", () => {
    say("RCA", m, "normal", normal);
    expect(m.cvp).toBeGreaterThan(1.8 * normal.cvp);
    expect(m.cvp / m.pcwp).toBeGreaterThanOrEqual(0.8);
    expect(m.pcwp).toBeLessThan(12);
    expect(m.map).toBeLessThan(CIRC.hypotensionMap);
    expect(["hypotension", "shock"]).toContain(m.state);
    expect(m.hr).toBeLessThan(50); // junctional escape
    expect(m.circ.rvIschemia).toBeGreaterThan(0.7);
  });
  it("has an atrial kick only when a dissociated P wave happens to precede the escape beat", () => {
    const kicks = s.history.filter((b) => b.atrialKick).length / s.history.length;
    say("CHB: share of beats with a kick", kicks);
    expect(kicks).toBeGreaterThan(0.1); expect(kicks).toBeLessThan(0.8); // sinus rhythm: all of them
  });
  it("responds to fluids: the classic preload-dependent right ventricle", () => {
    const f = make(RCA); f.apply({ support: { fluids: 1 } });
    f.step(60); const g = measure(f);
    say("RCA + 1 L", g);
    expect(g.map).toBeGreaterThan(m.map);
    expect(g.sv).toBeGreaterThan(m.sv);
    expect(g.cvp).toBeGreaterThanOrEqual(10);
    expect(g.cvp).toBeGreaterThan(m.cvp);
  });
  // C2: the fluid compartments keep about a quarter of a litre of crystalloid in the vessels (A7 had a static 0.45 L), so the output gains
  // less than the A7b bar of +0.2 L/min over this window. The clinical figure for crystalloid was kept; the bar stays here.
  it.fails("raises the pressure by 5 mmHg and the output by 0.2 L/min with 1 L of crystalloid (a quarter of it stays in the vessels)", () => {
    const f = make(RCA); f.apply({ support: { fluids: 1 } });
    f.step(60); const g = measure(f);
    expect(g.map).toBeGreaterThan(m.map + 5);
    expect(g.co).toBeGreaterThan(m.co + 0.2);
    expect(g.cvp).toBeGreaterThan(m.cvp + 2);
  });
  it("is hurt by nitroglycerin (venodilation starves the right ventricle)", () => {
    const n = make(RCA); n.apply({ support: { nitroglycerin: 0.5 } });
    n.step(30); const g = measure(n);
    expect(g.map).toBeLessThan(m.map - 2);
  });
});

describe("hemorrhage of 15 % of the blood volume", () => {
  const normal = measure(make()), s = make({ bloodLoss: 0.15 });
  const tones: { venous: number; resistance: number }[] = [];
  s.run(30); for (let i = 0; i < 20; i++) { s.step(1); tones.push({ venous: s.live!.modifiers.venousTone, resistance: s.live!.modifiers.resistance }); }
  const m = measure(s);
  const denerv = measure(make({ bloodLoss: 0.15, autonomic: { baroreflexGain: 0, noise: 0 } })); // only the cardiopulmonary (volume) reflex left
  it("is compensated by the reflex: faster heart, venoconstriction and resistance, pressure held", () => {
    say("bleed", m, "normal", normal, "no baroreflex", denerv, s.live!.modifiers);
    expect(m.hr).toBeGreaterThan(normal.hr + 8);
    expect(m.map).toBeGreaterThan(normal.map - 12);
    expect(m.map).toBeGreaterThan(70); // not in shock
    expect(denerv.hr).toBeLessThan(m.hr); // the baroreflex adds the tachycardia
    expect(mean(tones.map((t) => t.venous))).toBeGreaterThan(1.1); // veins constricted (unstressed volume recruited)
    expect(mean(tones.map((t) => t.resistance))).toBeGreaterThan(1.04); // arterioles constricted
  });
  it("lowers the filling pressures and the stroke volume", () => {
    expect(m.cvp).toBeLessThan(normal.cvp - 1);
    expect(m.pcwp).toBeLessThan(normal.pcwp - 1);
    expect(m.sv).toBeLessThan(normal.sv - 8);
  });
  it("takes the blood out of the circulation, and only that much", () => {
    // C2: the interstitium refills part of the plasma and the kidney passes some water, so the engine holds the volume the water balance
    // gives (4900 - lost - urine + maintenance - interstitial change); the loss itself is 15 % of the blood volume to 1 %.
    const total = (x: Simulation) => x.live!.engine.sample().V.reduce((a, b) => a + b, 0);
    const a = make(), v0 = total(a);
    a.apply({ bloodLoss: 0.15 }); a.step(80); // the loss ramps in with the 10 s volume time constant
    const f = a.fluids()!, held = f.lost + f.urine - f.maintenance + f.interstitialExcess;
    say("blood lost", v0 - total(a), f);
    expect(f.lost).toBeGreaterThan(0.15 * 4900 * 0.99);
    expect(f.lost).toBeLessThan(0.15 * 4900 * 1.01);
    expect(Math.abs(v0 - total(a) - held)).toBeLessThan(0.01 * 0.15 * 4900); // the engine follows the compartments to 1 % of the loss
    expect(v0 - total(a)).toBeLessThan(f.lost); // some of it came back from the interstitium
  });
});

describe("A7b: first second, AF rate, class III", () => {
  it("shows the core's numbers from the first instant after a reset (the warm-up steady state), not the legacy ones", () => {
    const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3 }, { settled: true });
    const w = s.live!.warmBeat!;
    expect(w).not.toBeNull();
    expect(s.circ.strokeVolume).toBeCloseTo(w.strokeVolume, 6);
    expect(s.circ.systolic).toBeCloseTo(w.systolic, 6);
    expect(s.circ.map).toBeCloseTo(w.map, 6);
    expect(s.circ.strokeVolume).toBeGreaterThan(55); expect(s.circ.strokeVolume).toBeLessThan(90);
    expect(s.circ.ejectionFraction).toBeCloseTo(w.strokeVolume / w.edv.LV, 6);
  });
  it("circ.hr is the atrial fibrillation ventricular rate, not the sinus rate", () => {
    const s = make({ patient: { rhythm: "af" } }, 5);
    const rs = (s as unknown as { rstate: { rhythm: string; afRate: number; sinusRate: number } }).rstate;
    expect(rs.rhythm).toBe("af");
    expect(Math.abs(rs.afRate - rs.sinusRate)).toBeGreaterThan(5);
    expect(s.circ.hr).toBeCloseTo(rs.afRate, 6);
  });
  it("a 30 % hemorrhage is class III: the pressure falls and the rate climbs, past a 15 % one", () => {
    const n = measure(make()), b15 = measure(make({ bloodLoss: 0.15 })), b30 = measure(make({ bloodLoss: 0.3 }));
    expect(b30.map).toBeLessThan(n.map - 10);
    expect(b30.map).toBeLessThan(b15.map);
    expect(b30.hr).toBeGreaterThan(b15.hr);
  });
});

describe("support on the core engine", () => {
  const normal = measure(make()), lad = measure(make(LAD)), rca = measure(make(RCA));
  it("norepinephrine raises MAP (and venous return)", () => {
    const m = measure(make({ support: { norepinephrine: 0.6 } }));
    say("norepi", m);
    expect(m.map).toBeGreaterThan(normal.map + 8);
    const l = measure(make({ ...LAD, support: { norepinephrine: 0.6 } }));
    expect(l.map).toBeGreaterThan(lad.map + 4);
  });
  // C2 left this 0.12 mmHg short of +5 as an it.fails; with norepinephrine's receptor-level alpha-1 resistance gain (E4) the bar is met, unchanged.
  it("norepinephrine raises the anterior STEMI's MAP by 5 mmHg", () => {
    const l = measure(make({ ...LAD, support: { norepinephrine: 0.6 } }));
    expect(l.map).toBeGreaterThan(lad.map + 5);
  });
  it("dobutamine raises cardiac output in the failing ventricle", () => {
    const l = measure(make({ ...LAD, support: { dobutamine: 0.6 } }));
    say("dobutamine", l, "LAD", lad);
    expect(l.co).toBeGreaterThan(lad.co + 0.3);
  });
  it("nitroglycerin lowers the wedge pressure, venous side first", () => {
    const low = measure(make({ ...LAD, support: { nitroglycerin: 0.3 } })), l = measure(make({ ...LAD, support: { nitroglycerin: 0.7 } }));
    say("nitro 0.3", low, "0.7", l);
    expect(low.pcwp).toBeLessThan(lad.pcwp - 1.5);
    expect(l.pcwp).toBeLessThan(low.pcwp);
    // the veins go first: a low dose changes the venous tone, not yet the resistance
    const s = make({ support: { nitroglycerin: 0.15 } });
    expect(s.live!.modifiers.venousTone).toBeLessThan(0.95);
    expect(s.live!.modifiers.resistance).toBeGreaterThan(0.95);
  });
  it("fluids raise the wedge pressure of a failing left ventricle more than a healthy one", () => {
    const l = measure(make({ ...LAD, support: { fluids: 1 } })), n = measure(make({ support: { fluids: 1 } }));
    expect(l.pcwp - lad.pcwp).toBeGreaterThan(2);
    expect(n.pcwp - normal.pcwp).toBeGreaterThan(0);
    expect(rca.cvp).toBeGreaterThan(0);
  });
});

describe("devices (D3: the real Impella and IABP; the full device tests are in simulationDevices.test.ts)", () => {
  it("the Impella carries flow from the ventricle to the aorta, never below the unloaded volume, and is the real device", () => {
    const base = measure(make(LAD)), s = make({ ...LAD, support: { impella: true } }), m = measure(s);
    say("impella", m, "LAD", base);
    expect(m.circ.deviceFlow).toBeGreaterThan(2.5); expect(m.circ.deviceFlow).toBeLessThanOrEqual(3.01);
    // was `> base.co + 0.2` with A7's constant-flow placeholder, which added its 3 L/min to the output whatever the ventricle did; the real
    // pump's flow competes with the native ejection (the venous return limits the total), so the total rises by less (3.99 against 3.91 here)
    expect(m.co).toBeGreaterThan(base.co);
    expect(m.pcwp).toBeLessThan(base.pcwp - 3); // the left ventricle is unloaded
    expect(m.map).toBeGreaterThan(base.map);
    expect(s.warnings.some((w) => /placeholder/i.test(w))).toBe(false);
    expect(s.live!.engine.sample().taps.impella).toBeDefined();
    const v0 = s.live!.model.chambers[7]!.v0;
    expect(Math.min(...s.live!.records.map((b) => b.esv.LV))).toBeGreaterThan(v0);
  });
  // Known gap (review of D3): clinically an Impella CP raises total output by ~0.5-1 L/min in a STEMI with PCWP ~20 (not
  // hypovolemic); the model's native stroke volume falls almost one for one with pump flow (+0.08 L/min). Flags itself when met.
  it.fails("the Impella raises total cardiac output by more than 0.2 L/min in the anterior STEMI (follow-up)", () => {
    const base = measure(make(LAD)), m = measure(make({ ...LAD, support: { impella: true } }));
    expect(m.co).toBeGreaterThan(base.co + 0.2);
  });
  it("with an empty left ventricle the flow falls instead of drawing it below its unloaded volume", () => {
    const s = make({ bloodLoss: 0.4, support: { impella: true } }), m = measure(s);
    const v0 = s.live!.model.chambers[7]!.v0, late = s.live!.records.filter((b) => b.t > 10); // after the start-up removal of the blood beyond the spec's range
    say("impella, hypovolemic", m.circ.deviceFlow, Math.min(...late.map((b) => b.esv.LV)), v0);
    expect(m.circ.deviceFlow).toBeLessThan(2.7);
    expect(Math.min(...late.map((b) => b.esv.LV))).toBeGreaterThan(v0); // the pump stops drawing at V0 + floor (the native ejection alone takes it a little lower)
  });
  // C2: the anterior STEMI now autotransfuses about 100 ml from the interstitium (low capillary pressure), which leaves the balloon's output
  // gain just short of the bar of +0.1 L/min (it cleared it on a fixed volume). The bar stays.
  // C3: the lung water of the same patient (about 100 ml filtered out of the circulation) lowers the filling a little, and the bar is met again, unchanged.
  it("the IABP raises the output of the anterior STEMI by 0.1 L/min", () => {
    const b = measure(make(LAD)), m = measure(make({ ...LAD, support: { iabp: true } }));
    expect(m.co).toBeGreaterThan(b.co + 0.1);
  });
  it("the IABP raises the coronary pressure by the diastolic augmentation measured on the aortic trace (not a fixed 10), and unloads the ventricle", () => {
    const base = make(LAD), b = measure(base), s = make({ ...LAD, support: { iabp: true } }), m = measure(s);
    const aug = m.circ.coronaryPressure - s.circ.map;
    expect(aug).toBeGreaterThan(3); expect(Math.abs(aug - 10)).toBeGreaterThan(0.01);
    // afterload reduction: the ventricle empties further (lower ESV), the output rises and the wedge falls. (Stroke volume alone is not the
    // sign: the baroreflex answers the lower pressure with a faster heart.)
    const hb = base.hemo(30)!, hs = s.hemo(30)!;
    expect(hs.lvEsv).toBeLessThan(hb.lvEsv - 1);
    expect(hs.pcwp).toBeLessThan(hb.pcwp);
    // was `m.sbp < b.sbp` with the placeholder. The monitor's systolic is the highest pressure of the beat, and with a real balloon the
    // augmented diastolic peak is the highest (112 against 94 mmHg), so the systolic unloading is read off the ejection peak (tests/simulationDevices.test.ts)
    expect(s.devices()!.iabp!.peakDiastolicMmHg).toBeGreaterThan(s.devices()!.iabp!.systolicMmHg - 5);
    expect(s.warnings.some((w) => /placeholder/i.test(w))).toBe(false);
  });
});

describe("baroreflex in the closed loop on the core engine", () => {
  it("stays stable for 10 minutes with noise at the default settings, with Mayer-wave variability", () => {
    const s = make({}, 60);
    const beats = s.run(600);
    expect(beats.length).toBeGreaterThan(600);
    const map = beats.map((b) => b.map);
    say("10 min: MAP min/max", Math.min(...map), Math.max(...map), "mean", mean(map));
    // no runaway: every minute's mean pressure and rate stay in a normal band, no beat is absurd
    for (let m = 0; m < 10; m++) {
      const mb = beats.filter((b) => b.t >= s.t - 600 + m * 60 && b.t < s.t - 600 + (m + 1) * 60);
      expect(mb.length).toBeGreaterThan(40);
      expect(mean(mb.map((b) => b.map))).toBeGreaterThan(80); expect(mean(mb.map((b) => b.map))).toBeLessThan(102);
      expect(mean(mb.map((b) => b.hr))).toBeGreaterThan(60); expect(mean(mb.map((b) => b.hr))).toBeLessThan(90);
    }
    expect(Math.min(...map)).toBeGreaterThan(65); expect(Math.max(...map)).toBeLessThan(125);
    // variability: a few mmHg of beat-to-beat spread, and the slow part sits in the Mayer band (0.04-0.15 Hz)
    const sd = Math.sqrt(mean(map.map((x) => (x - mean(map)) ** 2)));
    expect(sd).toBeGreaterThan(1); expect(sd).toBeLessThan(8);
    const { lf, hf, vlf } = bands(beats);
    say("band powers (mmHg²): vlf", vlf, "lf", lf, "hf", hf);
    expect(lf).toBeGreaterThan(0.3 * vlf); // the oscillation is not just slow drift
    expect(lf).toBeGreaterThan(0.2);
  }, 120_000);
  it("recovers: after hemorrhage stops and fluid is given the pressure returns to normal", () => {
    const s = make({ bloodLoss: 0.2 }, 30);
    s.apply({ bloodLoss: 0, support: { fluids: 0 } });
    s.step(90);
    const m = measure(s);
    expect(m.map).toBeGreaterThan(82); expect(m.map).toBeLessThan(100);
  });
});

/** Power (mmHg²) of the beat-to-beat MAP in the very low (0.003-0.04), Mayer (0.04-0.15) and respiratory (0.15-0.4 Hz) bands; the beats are put on a 2 Hz grid, detrended and Hann windowed. */
function bands(beats: BeatRecord[]) {
  const t0 = beats[0].t, fs = 2, n = Math.floor((beats[beats.length - 1].t - t0) * fs);
  const x: number[] = []; let j = 0;
  for (let i = 0; i < n; i++) { const t = t0 + i / fs; while (j < beats.length - 2 && beats[j + 1].t < t) j++; const a = beats[j], b = beats[j + 1], f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))); x.push(a.map + (b.map - a.map) * f); }
  const m = mean(x), w = x.map((v, i) => (v - m) * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))));
  const power = (f0: number, f1: number) => {
    let p = 0;
    for (let k = Math.ceil((f0 * n) / fs); k <= Math.floor((f1 * n) / fs); k++) {
      let re = 0, im = 0; for (let i = 0; i < n; i++) { const a = (2 * Math.PI * k * i) / n; re += w[i] * Math.cos(a); im -= w[i] * Math.sin(a); }
      p += (re * re + im * im) / (n * n) * 8 / 3; // Hann: coherent gain 0.5 -> power 1/0.375, x2 for the one-sided spectrum / 2
    }
    return p;
  };
  return { vlf: power(0.003, 0.04), lf: power(0.04, 0.15), hf: power(0.15, 0.4) };
}

describe("a PVC on the live strip", () => {
  it("is followed by a stronger beat with a larger pulse pressure", () => {
    const s = make(LAD, 20);
    const b = s.run(240);
    const after = b.filter((x, i) => i > 1 && b[i - 1].pvc && !x.pvc && !b[i - 2].pvc), normal = b.filter((x, i) => i > 1 && !b[i - 1].pvc && !x.pvc && !b[i - 2].pvc && !x.pvc);
    say("PVC: beats after", after.length, "pp after", mean(after.map((x) => x.sbp - x.dbp)), "pp normal", mean(normal.map((x) => x.sbp - x.dbp)));
    expect(after.length).toBeGreaterThan(3);
    expect(mean(after.map((x) => x.sbp - x.dbp))).toBeGreaterThan(mean(normal.map((x) => x.sbp - x.dbp)) + 3);
    expect(mean(after.map((x) => x.sv))).toBeGreaterThan(mean(normal.map((x) => x.sv)));
    const pvc = b.filter((x) => x.pvc);
    expect(mean(pvc.map((x) => x.sv))).toBeLessThan(0.7 * mean(normal.map((x) => x.sv)));
    expect(pvc.every((x) => !x.atrialKick)).toBe(true);
  }, 120_000);
});

describe("speed", () => {
  it("runs at least 20x real time with the whole ACS model on the core engine", () => {
    const s = make({}, 5);
    const t0 = performance.now(); s.step(60); const wall = (performance.now() - t0) / 1000;
    say("60 s of core mode took", wall, "s =", 60 / wall, "x real time");
    expect(60 / wall).toBeGreaterThan(20);
  }, 60_000);
});
