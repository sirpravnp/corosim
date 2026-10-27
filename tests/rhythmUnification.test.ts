// Rhythm unification (task B2) on the core engine: every Simulator rhythm (plan decision D4) runs live from the EKG library's
// generator, reaches the ventricles with plausible output and pressure, and the ECG shows the same beats the heart ejects. Slow
// (about 2 s per rhythm on the core engine): listed in tests/slow.json. The event conversion itself is in rhythmSource.test.ts.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { SIM_RHYTHMS, libraryVentricularRate } from "../src/physics/rhythmSource";
import type { BeatRecord } from "../src/sim/metrics";

interface Run { id: string; sim: Simulation; hr: number; map: number; co: number; sv: number; srcHr: number; srcCo: number; beats: BeatRecord[]; ra: number; atrial: number }
function live(id: string, opts: { seed?: number; seconds?: number; spec?: object } = {}): Run {
  const sim = new Simulation({}, { engine: "core" });
  sim.reset({ seed: opts.seed ?? 1, ...opts.spec, patient: { rhythm: id } });
  const src = new LiveSource(sim);
  sim.warmup(8);
  const beats = sim.run(opts.seconds ?? 14);
  const r = sim.rolling(10), n = src.numbers(), lv = sim.live!, from = lv.time - 10;
  const ra = lv.read("RA", "pressure", from)!;
  return { id, sim, hr: r.hr, map: r.map, co: r.cardiacOutput, sv: r.sv, srcHr: n.hr, srcCo: n.co, beats, ra: Math.max(...ra.v), atrial: lv.atrialBetween(from, lv.time).length };
}

const SINUS = live("sinus");
const runs = new Map<string, Run>(SIM_RHYTHMS.map((p) => [p.id, live(p.id)]));
const get = (id: string) => runs.get(id)!;
const ARREST = ["vf-coarse", "vf-fine", "asystole"];

describe("every Simulator rhythm runs live on the core engine", () => {
  it("the sinus reference is a normal adult", () => {
    expect(SINUS.map).toBeGreaterThan(80); expect(SINUS.map).toBeLessThan(100);
    expect(SINUS.co).toBeGreaterThan(4.5); expect(SINUS.co).toBeLessThan(6);
  });
  for (const p of SIM_RHYTHMS) {
    it(`${p.id}: the heart beats at the rhythm's rate with a plausible output and pressure`, () => {
      const r = get(p.id);
      if (p.id !== "nsr" && p.id !== "af") expect(r.sim.state().rhythm.label).toBe(p.name); // nsr and af are the coronary model's own rhythms
      if (ARREST.includes(p.id)) return; // below
      expect(r.map, "MAP").toBeGreaterThan(55); expect(r.map, "MAP").toBeLessThan(110);
      expect(r.co, "CO").toBeGreaterThan(2.3); expect(r.co, "CO").toBeLessThan(7);
      const want = libraryVentricularRate(p.id);
      // sinus-node rhythms move with the reflex (a slow rhythm lowers the pressure and the reflex speeds it a little); torsades alternates runs and pauses
      if (p.id !== "torsades") expect(Math.abs(r.hr - want) / want, `rate ${r.hr.toFixed(0)} against ${want.toFixed(0)}`).toBeLessThan(0.2);
      if (p.id !== "torsades") expect(Math.abs(r.srcHr - r.hr) / r.hr, "the panels' rate is the monitor's").toBeLessThan(0.15); // torsades: the two windows catch different shares of run and pause
    });
  }
});

describe("rhythm-specific hemodynamics", () => {
  it("VF and asystole: no flow, the pressure falls to the mean filling pressure, heart rate 0", () => {
    for (const id of ARREST) {
      const r = get(id);
      expect(r.co, id).toBeLessThan(0.2);
      expect(r.srcCo, id).toBeLessThan(0.2);
      expect(r.map, id).toBeLessThan(25);
      expect(r.hr, id).toBe(0);
      expect(r.srcHr, id).toBe(0);
      expect(r.sim.ecg().ventricularRate, id).toBe(0);
      expect(r.beats.every((b) => b.silent && b.sv < 3), id).toBe(true);
    }
  });
  it("VF: the pressure falls within seconds of the onset, from a normal circulation", () => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ seed: 2 }); sim.warmup(6); sim.run(4);
    const before = sim.rolling(4).map;
    sim.apply({ patient: { rhythm: "vf-coarse" } });
    sim.run(12);
    expect(before).toBeGreaterThan(80);
    expect(sim.rolling(4).map).toBeLessThan(25);
    expect(sim.rolling(4).cardiacOutput).toBeLessThan(0.2);
  });
  it("VT is rate-limited: monomorphic VT loses output and pressure, polymorphic VT more, an idioventricular rhythm less", () => {
    const vt = get("vt-mono"), poly = get("vt-poly"), aivr = get("aivr");
    expect(vt.co).toBeLessThan(0.9 * SINUS.co);
    expect(vt.sv).toBeLessThan(0.5 * SINUS.sv);
    expect(vt.map).toBeLessThan(SINUS.map - 5);
    expect(poly.co).toBeLessThan(0.65 * SINUS.co);
    expect(poly.map).toBeLessThan(vt.map);
    expect(aivr.co).toBeGreaterThan(vt.co * 0.9);
    // pulse pressure narrows in VT
    const pp = (r: Run) => { const b = r.beats.filter((x) => !x.silent).slice(-10); return b.reduce((s, x) => s + x.sbp - x.dbp, 0) / b.length; };
    expect(pp(vt)).toBeLessThan(0.6 * pp(SINUS));
  });
  it("flutter 2:1 conducts at 150 with flutter waves in the atria (300/min); variable block slower", () => {
    const f = get("flutter-21");
    expect(f.hr).toBeGreaterThan(140); expect(f.hr).toBeLessThan(160);
    expect((60 * f.atrial) / 10).toBeGreaterThan(270);
    expect(get("flutter-var").hr).toBeLessThan(120);
  });
  it("AF: an irregular response and no atrial events; the stroke volume varies beat to beat", () => {
    const a = get("af-rvr"), v = a.beats.filter((b) => !b.silent && !b.pvc).map((b) => b.sv), m = v.reduce((s, x) => s + x, 0) / v.length;
    expect(a.atrial).toBe(0);
    expect(Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) / m).toBeGreaterThan(0.1);
  });
  it("AV nodal re-entry and junctional rhythm: the atria contract against closed valves (cannon waves: RA peak above sinus)", () => {
    expect(get("svt").ra).toBeGreaterThan(SINUS.ra + 2);
    expect(get("junctional").ra).toBeGreaterThan(SINUS.ra + 2);
    expect(get("svt").hr).toBeGreaterThan(170);
  });
  it("complete heart block: the atria beat faster than the ventricles, the output falls with the escape rate", () => {
    const c = get("chb"), w = get("chb-wide");
    expect(c.atrial).toBeGreaterThan(1.6 * (c.hr / 6));
    expect(c.co).toBeLessThan(0.85 * SINUS.co);
    expect(w.co).toBeLessThan(c.co);
    expect(c.sv).toBeGreaterThan(1.15 * SINUS.sv); // a long diastole fills more
  });
  it("ventricular pacing: output a little below sinus (dyssynchrony, no AV synchrony)", () => {
    const p = get("paced");
    expect(p.co).toBeLessThan(SINUS.co);
    expect(p.co).toBeGreaterThan(0.8 * SINUS.co);
  });
  it("a sinus-node library rhythm still answers the baroreflex: bleeding speeds sinus bradycardia", () => {
    // the library's 46/min, already raised a little by the reflex at the lower pressure of a slow rate; a bleed raises it further
    const bled = live("sinus-brady", { spec: { bloodLoss: 0.25 } }), brady = get("sinus-brady");
    expect(brady.hr).toBeGreaterThan(47);
    expect(bled.hr).toBeGreaterThan(brady.hr + 1.5);
    expect(bled.map).toBeLessThan(brady.map);
  });
});

describe("the ECG shows the beats the heart ejects", () => {
  it("every ventricular complex on the strip is a beat of the live heart, at the same time, and nothing else is", () => {
    for (const id of ["sinus", "af-rvr", "flutter-21", "svt", "vt-mono", "torsades", "chb", "wenckebach", "pvc-bigeminy", "paced"]) {
      const r = id === "sinus" ? SINUS : get(id), sim = r.sim;
      const hist = sim.history.filter((b) => !b.silent && b.t > sim.t - 11 && b.t < sim.t - 1.5).map((b) => b.t);
      const strip = sim.stream.beats.filter((b) => !b.pOnly && !b.silent && b.t > sim.t - 11 && b.t < sim.t - 1.5).map((b) => b.t);
      expect(hist.length, id).toBeGreaterThan(5);
      expect(hist.length, id).toBe(strip.length);
      hist.forEach((t, i) => expect(Math.abs(t - strip[i]), id).toBeLessThan(2e-3));
    }
  });
});

describe("ischemic ectopy keeps working under a library rhythm, and switching rhythms is seamless", () => {
  it("a proximal LAD occlusion in a susceptible patient gives PVCs on first-degree AV block, none in VT", () => {
    const LAD = { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] };
    const count = (id: string) => { const r = live(id, { seed: 9, seconds: 40, spec: LAD }); return r.beats.filter((b) => b.pvc).length; };
    expect(count("avb1")).toBeGreaterThan(0);
    expect(count("vt-mono")).toBe(0);
  });
  it("sinus -> SVT -> sinus while running: the rate follows within seconds, no burst of beats at the switch", () => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ seed: 3 }); sim.warmup(6); sim.run(6);
    sim.apply({ patient: { rhythm: "svt" } });
    const a = sim.run(10);
    const svtHr = sim.rolling(5).hr;
    sim.apply({ patient: { rhythm: "sinus" } });
    const b = sim.run(10);
    expect(svtHr).toBeGreaterThan(170);
    expect(sim.rolling(5).hr).toBeLessThan(100);
    for (const run of [a, b]) for (const x of run) expect(x.interval).toBeGreaterThan(0.25);
  });
  it("the legacy engine does not run library rhythms: it warns and stays in sinus rhythm", () => {
    const s = new Simulation({ seed: 1, patient: { rhythm: "vt-mono" } });
    expect(s.patient.rhythm).toBe("sinus");
    expect(s.warnings.join(" ")).toMatch(/core engine only/);
  });
});
