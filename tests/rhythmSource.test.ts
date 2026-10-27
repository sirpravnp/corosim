// Rhythm unification (task B2), without hemodynamics: the EKG library's generator as the Simulator's beat source. How each library
// event becomes a beat for the live heart, the silent ticks of VF and asystole, flutter's atrial events, ischemic ectopy on a
// library rhythm, switching rhythm mid-stream, and the ECG strip drawing the library's own complexes. The live-heart side is in
// rhythmUnification.test.ts (slow).
import { describe, it, expect } from "vitest";
import { BeatStream } from "../src/physics/beatStream";
import { rhythmState, HEALTHY, RhythmState } from "../src/physics/rhythm";
import { SIM_RHYTHMS, SIM_RHYTHM_CATEGORIES, simRhythmId, isLibraryRhythm, libraryVentricularRate, LibraryRhythm } from "../src/physics/rhythmSource";
import { RHYTHM_MECH } from "../src/config/rhythms";
import { ECTOPY } from "../src/config/ectopy";
import { EkgEngine } from "../src/ekg/engine";
import { PRESET_BY_ID } from "../src/ekg/presets";
import { EcgStrip } from "../src/ecgStrip";
import { normalizeScenario } from "../src/sim/scenario";
import type { Beat } from "../src/physics/ecg";
import type { EctopySource } from "../src/physics/ectopy";

const state = (rhythm: string): RhythmState => rhythmState([], {}, 0, { ...HEALTHY, rhythm });
function run(rhythm: string, seconds = 30, seed = 1) {
  const s = new BeatStream(seed, 0.5, 0.05), st = state(rhythm);
  for (let t = 0; t <= seconds; t += 0.02) s.extend(t, st);
  return { s, beats: s.beats.filter((b) => b.t <= seconds) };
}
const vent = (bs: Beat[]) => bs.filter((b) => !b.pOnly && !b.silent);

describe("the Simulator's rhythms (D4)", () => {
  it("are the library presets of the rhythm and conduction categories, not the coronary patterns or STEMI mimics", () => {
    expect(SIM_RHYTHMS.length).toBeGreaterThanOrEqual(35);
    for (const p of SIM_RHYTHMS) expect(SIM_RHYTHM_CATEGORIES).toContain(p.category);
    for (const id of ["flutter-21", "svt", "junctional", "vt-mono", "vt-poly", "torsades", "vf-coarse", "asystole", "paced", "chb", "wenckebach", "mobitz2", "avb-21", "lbbb", "hyperk"]) expect(isLibraryRhythm(id), id).toBe(true);
    for (const id of ["stemi-anterior", "pericarditis", "brugada"]) expect(simRhythmId(id), id).toBeNull();
  });
  it("'sinus', 'nsr' and 'af' stay the coronary model's own rhythms; scenarios accept any Simulator rhythm and warn on others", () => {
    expect(simRhythmId("nsr")).toBe("sinus");
    expect(simRhythmId("af")).toBe("af");
    expect(isLibraryRhythm("af")).toBe(false);
    expect(normalizeScenario({ patient: { rhythm: "vt-mono" } }).scenario.patient.rhythm).toBe("vt-mono");
    expect(normalizeScenario({ patient: { rhythm: "nsr" } }).scenario.patient.rhythm).toBe("sinus");
    const bad = normalizeScenario({ patient: { rhythm: "pericarditis" } });
    expect(bad.scenario.patient.rhythm).toBe("sinus");
    expect(bad.warnings.join(" ")).toMatch(/pericarditis/);
  });
  it("the ventricular rate of each rhythm is what its generator makes: flutter 2:1 is 150, 2:1 block halves the sinus rate, VF has none", () => {
    expect(libraryVentricularRate("flutter-21")).toBeCloseTo(150, 0);
    expect(libraryVentricularRate("avb-21")).toBeCloseTo(42, -1);
    expect(libraryVentricularRate("vt-mono")).toBeCloseTo(172, -1);
    expect(libraryVentricularRate("vf-coarse")).toBe(0);
    expect(libraryVentricularRate("asystole")).toBe(0);
  });
});

describe("library events as beats for the heart", () => {
  it("the beat stream carries the same events as the EKG page's engine for the same rhythm", () => {
    // same generator: the EKG page's QRS complexes are the strip's (times and kinds), seed for seed
    const lib = new LibraryRhythm("wenckebach", 1, 0);
    const mine = lib.advance(20, state("wenckebach")).filter((b) => b.ekg).map((b) => [b.ekg!.beat.kind, +b.t.toFixed(4)]);
    expect(mine.length).toBeGreaterThan(20);
    for (const [k, t] of mine) expect(["sv", "p"]).toContain(k), expect(t).toBeGreaterThan(0);
    const e = new EkgEngine(PRESET_BY_ID.wenckebach.spec, (1 * 7919 + 17) >>> 0);
    e.ensure(20);
    const page = e.beats.filter((b) => b.t <= 19).map((b) => [b.kind, +b.t.toFixed(4)]);
    expect(mine.slice(0, page.length)).toEqual(page);
  });
  it("VT: wide ventricular beats with no P before them, weaker and slower contraction, P waves marching through (AV dissociation)", () => {
    const { beats } = run("vt-mono");
    const v = vent(beats);
    expect(v.every((b) => b.origin === "ventricular" && b.noP && !b.pvc && b.strength === RHYTHM_MECH.ventricular && b.systole === RHYTHM_MECH.ventricularSystole)).toBe(true);
    expect(beats.filter((b) => b.pOnly && !b.silent).length).toBeGreaterThan(10);
    expect((60 * v.length) / 30).toBeGreaterThan(160);
  });
  it("polymorphic VT and torsades contract worse than monomorphic VT; paced beats a little worse than normal", () => {
    expect(vent(run("vt-poly").beats).every((b) => b.strength === RHYTHM_MECH.polymorphic)).toBe(true);
    expect(vent(run("torsades").beats).some((b) => b.strength === RHYTHM_MECH.polymorphic)).toBe(true);
    const p = vent(run("paced").beats);
    expect(p.every((b) => b.origin === "paced" && b.strength === RHYTHM_MECH.paced)).toBe(true);
    expect(RHYTHM_MECH.polymorphic).toBeLessThan(RHYTHM_MECH.ventricular);
    expect(RHYTHM_MECH.ventricular).toBeLessThan(RHYTHM_MECH.paced);
  });
  it("VF and asystole: no ventricular beat, only silent strength-0 ticks once a second (asystole keeps its P waves)", () => {
    for (const id of ["vf-coarse", "vf-fine", "asystole"]) {
      const { beats } = run(id);
      expect(vent(beats).length, id).toBe(0);
      const ticks = beats.filter((b) => b.silent && !b.pOnly);
      expect(ticks.length, id).toBeGreaterThanOrEqual(29);
      expect(ticks.every((b) => b.strength === 0), id).toBe(true);
    }
    expect(run("asystole").beats.filter((b) => b.pOnly && !b.silent).length).toBeGreaterThan(15);
  });
  it("flutter 2:1: a weak atrial event at every flutter wave (300/min), each conducted beat with one 120 ms before it", () => {
    const { beats } = run("flutter-21");
    const f = beats.filter((b) => b.pOnly && b.silent), v = vent(beats);
    expect((60 * f.length) / 30).toBeCloseTo(300, -1);
    expect(f.every((b) => b.atrialStrength === RHYTHM_MECH.flutterAtrial)).toBe(true);
    expect((60 * v.length) / 30).toBeCloseTo(150, -1);
    for (const b of v.slice(2)) expect(f.some((x) => Math.abs(x.t - x.pr! - (b.t - 0.12)) < 1e-6)).toBe(true);
    expect(v.every((b) => b.noP && b.origin === "atrial")).toBe(true);
  });
  it("AV nodal re-entry and junctional rhythm: no P before the QRS, a retrograde P just after it (the atria contract against closed valves)", () => {
    for (const id of ["svt", "junctional"]) {
      const v = vent(run(id).beats);
      expect(v.every((b) => b.noP && b.origin === "junctional" && b.retroP! > 0.05 && b.retroP! < 0.1), id).toBe(true);
    }
  });
  it("AF: no P waves, an irregular ventricular response; complete heart block: P waves dissociated from a regular escape", () => {
    const v = vent(run("af-rvr").beats), rr = v.slice(1).map((b, i) => b.t - v[i].t), m = rr.reduce((a, b) => a + b, 0) / rr.length;
    expect(v.every((b) => b.noP)).toBe(true);
    expect(Math.sqrt(rr.reduce((a, x) => a + (x - m) ** 2, 0) / rr.length) / m).toBeGreaterThan(0.1);
    const c = run("chb").beats, cv = vent(c);
    expect(c.filter((b) => b.pOnly).length).toBeGreaterThan(1.7 * cv.length);
    expect(cv.every((b) => b.noP && b.origin === "junctional")).toBe(true);
  });
  it("the sinus-node rhythms follow the coronary model's rate and the reflex; re-entrant rhythms do not", () => {
    const fast = { ...state("sinus-brady"), sinusRate: 72 * 1.5 }, slow = state("sinus-brady");
    const count = (st: RhythmState, id: string) => { const s = new BeatStream(1, 0.5, 0.05); for (let t = 0; t <= 30; t += 0.02) s.extend(t, { ...st, rhythm: id }); return vent(s.beats.filter((b) => b.t <= 30)).length; };
    expect(count(fast, "sinus-brady")).toBeGreaterThan(1.35 * count(slow, "sinus-brady"));
    expect(count(fast, "svt")).toBe(count(slow, "svt"));
    const mod = { rate: () => 1.3, jitter: () => 0 }, s = new BeatStream(1, 0.5, 0.05);
    for (let t = 0; t <= 30; t += 0.02) s.extend(t, slow, mod);
    expect(vent(s.beats.filter((b) => b.t <= 30)).length).toBeGreaterThan(1.2 * count(slow, "sinus-brady"));
  });
});

describe("ischemic ectopy on a library rhythm", () => {
  const always: EctopySource & { calls: number } = { calls: 0, decide(tR: number, rr: number) { this.calls++; return this.calls % 4 === 0 ? [tR + 0.6 * rr] : []; } };
  it("PVCs follow the beats the ventricles take from the conduction system, with a compensatory pause; none in VT or VF", () => {
    for (const id of ["avb1", "af-rvr", "flutter-21", "paced", "chb"]) {
      const s = new BeatStream(1, 0.5, 0.05);
      always.calls = 0;
      (s as unknown as { conduction: { ectopy: EctopySource } }).conduction.ectopy = always;
      const st = state(id);
      for (let t = 0; t <= 30; t += 0.02) s.extend(t, st);
      const v = vent(s.beats).sort((a, b) => a.t - b.t), pvcs = v.filter((b) => b.pvc);
      expect(pvcs.length, id).toBeGreaterThanOrEqual(4);
      for (const p of pvcs) { const next = v.find((b) => b.t > p.t); if (next) expect(next.t - p.t, id).toBeGreaterThanOrEqual(ECTOPY.refractoryS - 1e-9); }
    }
    for (const id of ["vt-mono", "vf-coarse", "torsades"]) {
      const s = new BeatStream(1, 0.5, 0.05);
      always.calls = 0;
      (s as unknown as { conduction: { ectopy: EctopySource } }).conduction.ectopy = always;
      const st = state(id);
      for (let t = 0; t <= 30; t += 0.02) s.extend(t, st);
      expect(s.beats.filter((b) => b.pvc && !b.ekg).length, id).toBe(0);
    }
  });
});

describe("switching rhythm in a running stream", () => {
  it("sinus -> VT -> sinus: the new rhythm starts where the generated beats end, with no backlog of beats", () => {
    const s = new BeatStream(1, 0.5, 0.05);
    const at = (t: number) => (t < 10 ? state("sinus") : t < 20 ? state("vt-mono") : state("sinus"));
    for (let t = 0; t <= 30; t += 0.02) s.extend(t, at(t));
    const v = vent(s.beats.filter((b) => b.t <= 30)).sort((a, b) => a.t - b.t);
    for (let i = 1; i < v.length; i++) expect(v[i].t - v[i - 1].t).toBeGreaterThan(0.2);
    const inVt = v.filter((b) => b.t > 11 && b.t < 20), after = v.filter((b) => b.t > 22);
    expect(inVt.every((b) => b.origin === "ventricular")).toBe(true);
    expect(after.every((b) => !b.ekg && !b.strength)).toBe(true);
    expect(after.length).toBeGreaterThan(8);
    expect(s.baseline(15)).not.toBeNull();
    expect(s.baseline(25)).toBeNull();
  });
});

describe("the ECG strip draws the library's own complexes from the shared stream", () => {
  const strip = (id: string) => {
    const s = new BeatStream(1, 0.6, 0.4), st = state(id), e = new EcgStrip({} as HTMLCanvasElement, s);
    for (let t = 0; t <= 12; t += 0.04) { s.extend(t, st); e.step(0.04, [0, 0, 0], 0, st.rhythm); }
    const II: number[] = [];
    for (let t = 6; t < 10; t += 0.004) { const v = e.vector(t); II.push(0.5 * v[0] + 0.866 * v[1]); }
    return { e, II, s };
  };
  it("VF: a continuous chaotic signal with no beats; flutter: the sawtooth; sinus on the library: normal complexes", () => {
    const vf = strip("vf-coarse"), fl = strip("flutter-21"), sr = strip("sinus-brady");
    const span = (x: number[]) => Math.max(...x) - Math.min(...x);
    expect(span(vf.II)).toBeGreaterThan(0.4);
    expect(vf.II.filter((x) => Math.abs(x) > 0.05).length / vf.II.length).toBeGreaterThan(0.5); // never a flat baseline
    expect(fl.e.rhythm().hr).toBeCloseTo(150, -1);
    expect(sr.e.rhythm().hr).toBeGreaterThan(38);
    expect(sr.e.rhythm().hr).toBeLessThan(56);
    expect(span(sr.II)).toBeGreaterThan(0.8);
  });
  it("the strip's heart rate is the stream's ventricular beats: a VF strip reads 0", () => {
    expect(strip("vf-coarse").e.rhythm().hr).toBe(0);
    expect(strip("vt-mono").e.rhythm().hr).toBeGreaterThan(160);
  });
});
