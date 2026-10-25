// B4: the pericardial scenarios on the core engine, as the playground presets run them (tamponade, constrictive pericarditis, RV infarct with
// septal shift) and pericardiocentesis as an action. Every sign is read off the traces and readings of a running `Simulation`. Set CORE_VERBOSE=1 to print.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";
import { PRESET_BY_ID } from "../src/sim/presets";
import { crossLinks, ekgPresetFor } from "../src/sim/crossLinks";
import { analyzeJvp, type JvpResult } from "../src/physics/jvp";
import { pulsusParadoxus, type RespBeat } from "../src/physics/respiratory";
import { ALTERNANS, alternansAmplitude } from "../src/config/pericardium";
import { PRESET_BY_ID as EKG_BY_ID } from "../src/ekg/presets";
import { TOOLS } from "../src/mcp/tools";
import type { Thorax } from "../src/physics/core/thorax";
import type { LiveBeat } from "../src/physics/core/live";

const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const f = (x: number, d = 1) => x.toFixed(d);
const spec = (id: string): PatientSpec => ({ seed: 3, ...PRESET_BY_ID[id]!.spec });
const BREATHING: PatientSpec = { ventilation: { mode: "spontaneous" }, autonomic: { respDepth: 1.5 } };

/** A settled patient on the core engine, warmed up. */
const ward = (p: PatientSpec, warm = 25) => { const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3, ...p }, { settled: true }); s.warmup(warm); return s; };

/**
 * Observe the patient for `sec` seconds: beat records, plus at the end of diastole of each beat (the mean over the 60 ms before the next
 * ventricular event) the pericardial pressure and the septal displacement, and the inspiratory fraction of each beat.
 */
function observe(s: Simulation, sec = 40) {
  const live = s.live!, eng = live.engine, ts: number[] = [], pp: number[] = [], vs: number[] = [];
  const off = eng.onSample((x) => { ts.push(x.t); pp.push(x.taps.pericardium?.pericardialPressure ?? 0); vs.push((x.taps.septum as { septalVolumeMl: number } | undefined)?.septalVolumeMl ?? NaN); });
  s.run(sec); off();
  const offset = eng.t - live.time, th = (() => { try { return eng.element<Thorax>("thorax"); } catch { return null; } })();
  const recs = live.records.filter((b) => b.t + offset > ts[0] + 1 && b.t - s.liveDelta > s.t - sec);
  const endOf = (series: number[], te: number) => { let sum = 0, n = 0; for (let k = 0; k < ts.length; k++) if (ts[k] > te - 0.06 && ts[k] <= te) { sum += series[k]; n++; } return n ? sum / n : NaN; };
  const avg = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const per = (g: (b: LiveBeat) => number) => recs.map(g);
  const pEnd: number[] = [], sEnd: number[] = [];
  for (let i = 0; i + 1 < recs.length; i++) { const te = recs[i + 1].t + offset; pEnd.push(endOf(pp, te)); sEnd.push(endOf(vs, te)); }
  const lung = recs.map((b) => th?.at(b.t + offset + b.interval / 2).lung ?? 0);
  const ra = per((b) => b.p.RA.mean);
  const insp = (x: number[]) => avg(x.filter((_, i) => lung[i] > 0.5)) - avg(x.filter((_, i) => lung[i] <= 0.5));
  const beats: RespBeat[] = recs.map((b) => ({ t: b.t, systolic: b.p.DAO.max, diastolic: b.p.DAO.min, strokeVolume: b.strokeVolume }));
  const roll = s.rolling(sec);
  return {
    recs, s,
    RA: avg(ra), RVd: avg(per((b) => b.p.RV.end)), PAd: avg(per((b) => b.p.PA.min)), PCWP: avg(per((b) => b.p.LA.mean)), LVd: avg(per((b) => b.p.LV.end)),
    LVEDV: avg(per((b) => b.edv.LV)), RVEDV: avg(per((b) => b.edv.RV)), SV: avg(per((b) => b.strokeVolume)),
    MAP: roll.map, CO: roll.cardiacOutput, HR: roll.hr,
    peri: avg(pEnd.filter(Number.isFinite)), vspt: avg(sEnd.filter(Number.isFinite)),
    dRA: insp(ra),
    pulsus: pulsusParadoxus(beats, 60 / s.autonomic.controls.respRate, recs[0].t).value,
  };
}
type Obs = ReturnType<typeof observe>;
const row = (n: string, x: Obs) => `${n.padEnd(14)} RA ${f(x.RA)} RVd ${f(x.RVd)} PAd ${f(x.PAd)} PCWP ${f(x.PCWP)} LVd ${f(x.LVd)} P_peri(ed) ${f(x.peri)} | LVEDV ${f(x.LVEDV, 0)} RVEDV ${f(x.RVEDV, 0)} V_spt(ed) ${f(x.vspt)} | MAP ${f(x.MAP, 0)} CO ${f(x.CO, 2)} HR ${f(x.HR, 0)} pulsus ${f(x.pulsus)} dRA ${f(x.dRA, 2)}`;

/** The JVP of each whole beat in the live RA trace (the last `n`). */
function jvpBeats(s: Simulation, n = 10): JvpResult[] {
  const live = s.live!, out: JvpResult[] = [];
  for (let back = 1; back <= n; back++) {
    const a = live.records[live.records.length - 1 - back], b = live.records[live.records.length - back];
    if (!a || !b) break;
    const ra = live.read("RA", "pressure", a.t)!;
    const idx = [...ra.t].map((x, i) => (x >= a.t && x < b.t ? i : -1)).filter((i) => i >= 0);
    out.push(analyzeJvp({ t: idx.map((i) => ra.t[i] - a.t), p: idx.map((i) => ra.v[i]), atrial: live.atrialBetween(a.t, b.t).map((x) => x - a.t), rr: b.t - a.t }));
  }
  return out;
}
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ---------------------------------------------------------------------------------------------------------------------------------
describe("tamponade (preset)", () => {
  const s = ward(spec("tamponade")), t = observe(s, 40);
  const n = observe(ward({ ...BREATHING }), 40);
  log(`${row("normal", n)}\n${row("tamponade", t)}`);
  it("is a tamponade: Beck's triad (low pressure and output, high venous pressure, fast pulse)", () => {
    expect(t.MAP).toBeLessThan(0.8 * n.MAP); expect(t.CO).toBeLessThan(0.6 * n.CO); expect(t.HR).toBeGreaterThan(n.HR + 10);
    expect(t.RA).toBeGreaterThan(n.RA + 5);
  });
  it("the diastolic pressures equalise: RA mean, RV diastolic, PA diastolic, wedge and the sac pressure at end-diastole are within 5 mmHg of each other", () => {
    const all = [t.RA, t.RVd, t.PAd, t.PCWP, t.peri];
    log(`equalisation: ${all.map((x) => f(x)).join(" ")} spread ${f(Math.max(...all) - Math.min(...all))} (normal spread ${f(Math.max(n.RA, n.RVd, n.PAd, n.PCWP) - Math.min(n.RA, n.RVd, n.PAd, n.PCWP))})`);
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(5);
    expect(Math.max(t.RA, t.RVd, t.PAd, t.PCWP, t.LVd) - Math.min(t.RA, t.RVd, t.PAd, t.PCWP, t.LVd)).toBeLessThan(6); // the left ventricle too, in the model slightly above
    expect(Math.max(n.RVd, n.PAd, n.PCWP) - Math.min(n.RVd, n.PAd, n.PCWP)).toBeGreaterThan(3); // not so in the normal heart (the PA diastolic is 4 above the RV's)
  });
  it("the equalisation is already there at 150-200 ml (the engine tables of B1 had it at 300): spread of the four pressures by effusion", () => {
    const rows = [100, 150, 200].map((e) => { const o = observe(ward({ ...spec("tamponade"), pericardium: { effusionMl: e } }, 20), 25); return { e, o, sp: Math.max(o.RA, o.RVd, o.PAd, o.PCWP) - Math.min(o.RA, o.RVd, o.PAd, o.PCWP) }; });
    for (const { e, o, sp } of rows) log(`${e} ml: RA ${f(o.RA)} RVd ${f(o.RVd)} PAd ${f(o.PAd)} PCWP ${f(o.PCWP)} P_peri(ed) ${f(o.peri)} spread ${f(sp)} | CO ${f(o.CO, 2)} MAP ${f(o.MAP, 0)}`);
    for (const { e, o, sp } of rows.slice(1)) { expect(sp, `${e} ml`).toBeLessThan(5); expect(Math.max(sp, Math.abs(o.peri - o.RVd)), `${e} ml with the sac`).toBeLessThan(5); }
  });
  it("pulsus paradoxus over 10 mmHg with spontaneous breathing, against a few mmHg in the normal patient", () => {
    expect(t.pulsus).toBeGreaterThan(10); expect(n.pulsus).toBeLessThan(10); expect(t.pulsus).toBeGreaterThan(n.pulsus + 4);
  });
  it("blunted y descent: the right atrial trace is raised and the y descent is shallower than the normal patient's by a quarter or more", () => {
    const jt = jvpBeats(s), jn = jvpBeats(ward({ ...BREATHING }, 15));
    const dt = median(jt.map((j) => j.y?.depth ?? 0)), dn = median(jn.map((j) => j.y?.depth ?? 0));
    log(`y depth: tamponade ${f(dt)} (classes: ${jt.map((j) => (j.classes.includes("bluntedY") ? "B" : "-")).join("")}) normal ${f(dn)}`);
    expect(jt.filter((j) => j.classes.includes("raised")).length).toBeGreaterThan(0.8 * jt.length);
    expect(dt).toBeLessThan(0.75 * dn);
  });
  // Known gap: the y descent shrinks with the effusion (normal 5.2 mmHg, 4.3 at 250 ml, 3.6 at 270, 2.6 at 300) but the JVP class "bluntedY" asks for under 2 mmHg,
  // which only the extreme 300 ml patient (MAP 53, CO 1.3) approaches: the right atrial waveform amplitude is the follow-up already noted in
  // docs/HEMODYNAMICS_TASKS.md (physics follow-ups). Remove `.fails` when it holds.
  it.fails("the preset's y descent is classed as blunted in most beats", () => {
    const jt = jvpBeats(s); expect(jt.filter((j) => j.classes.includes("bluntedY")).length).toBeGreaterThan(0.5 * jt.length);
  });
  it("electrical alternans: the preset's effusion is above the threshold, the simulator's ECG alternates and the EKG page link opens the alternans preset", () => {
    const eff = t.s.pericardium()!.effusionMl;
    expect(eff).toBeGreaterThan(ALTERNANS.thresholdMl);
    expect(t.s.ecg().electricalAlternans).toBeGreaterThan(0);
    const amps = s.stream.beats.filter((b) => !b.pOnly && !b.pvc && b.alt !== undefined).map((b) => b.alt!);
    expect(amps.length).toBeGreaterThan(3);
    for (let i = 1; i < amps.length; i++) expect(Math.sign(amps[i] - 1)).toBe(-Math.sign(amps[i - 1] - 1)); // big, small, big...
    expect(ekgPresetFor(spec("tamponade"))).toBe("alternans"); expect(EKG_BY_ID[ALTERNANS.presetId]).toBeDefined();
    expect(crossLinks("sim", spec("tamponade"), "../").find((l) => l.page === "ekg")!.href).toContain("#p=alternans");
  });
  it("alternans follows the size of the effusion: none up to the threshold, full a ramp above, none in an opened sac", () => {
    expect(alternansAmplitude(0)).toBe(0); expect(alternansAmplitude(ALTERNANS.thresholdMl)).toBe(0); expect(alternansAmplitude(180)).toBe(0);
    expect(alternansAmplitude(ALTERNANS.thresholdMl + ALTERNANS.rampMl)).toBeCloseTo(ALTERNANS.maxAmplitude, 9);
    expect(alternansAmplitude(1000)).toBeCloseTo(ALTERNANS.maxAmplitude, 9);
    expect(alternansAmplitude(300, true)).toBe(0);
    expect(ekgPresetFor({ pericardium: { effusionMl: 200 } })).toBe("nsr");
    expect(ekgPresetFor({ pericardium: { effusionMl: 400, open: true } })).toBe("nsr");
    expect(ekgPresetFor({ kind: "neonate", pericardium: { effusionMl: 400 } })).toBe("nsr");
    const small = ward({ pericardium: { effusionMl: 150 } }, 10); small.run(3);
    expect(small.ecg().electricalAlternans).toBe(0);
    expect(small.stream.beats.every((b) => b.alt === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("constrictive pericarditis (preset)", () => {
  const s = ward(spec("constrictive-pericarditis"), 25), c = observe(s, 40);
  const n = observe(ward({ ...BREATHING }), 40);
  log(`${row("normal", n)}\n${row("constriction", c)}`);
  it("a raised venous pressure with both ventricles filling to nearly the same pressure, and a preserved output", () => {
    expect(c.RA).toBeGreaterThan(n.RA + 10);
    expect(Math.abs(c.LVd - c.RVd)).toBeLessThan(5); expect(Math.abs(n.LVd - n.RVd)).toBeGreaterThan(3);
    expect(c.CO).toBeGreaterThan(0.7 * n.CO);
  });
  it("steep y descent: the right atrial y falls 10 mmHg or more from v, fast, in most beats (the JVP class 'steepY')", () => {
    const j = jvpBeats(s, 14), steep = j.filter((x) => x.classes.includes("steepY"));
    log(`y depth/slope per beat: ${j.map((x) => `${f(x.y?.depth ?? NaN)}/${f(x.y?.slope ?? NaN, 0)}`).join(" ")}`);
    expect(steep.length).toBeGreaterThan(0.5 * j.length);
    expect(median(j.map((x) => x.y?.depth ?? 0))).toBeGreaterThanOrEqual(10);
    expect(j.filter((x) => x.classes.includes("raised")).length).toBeGreaterThan(0.9 * j.length);
  });
  it("dip-and-plateau (square root sign) on the right ventricular diastolic trace: a fast early fall, then a quick rise to a flat plateau", () => {
    // the early-diastolic minimum after the systolic peak (the dip), the pressure it rises to within 0.15-0.3 s (the plateau, up to the atrial kick) and how fast and how flat that is
    const shape = (sim: Simulation) => {
      const L = sim.live!, a = L.records[L.records.length - 3], b = L.records[L.records.length - 2];
      const rv = L.read("RV", "pressure", a.t)!, ix = [...rv.t].map((x, i) => (x >= a.t && x < b.t ? i : -1)).filter((i) => i >= 0);
      const t = ix.map((i) => rv.t[i] - a.t), pv = ix.map((i) => rv.v[i]), kick = L.atrialBetween(a.t, b.t).map((x) => x - a.t).find((x) => x > 0.5 * (b.t - a.t)) ?? b.t - a.t;
      const pk = pv.indexOf(Math.max(...pv)), im = pk + pv.slice(pk).indexOf(Math.min(...pv.slice(pk))), dip = pv[im];
      const win = ix.map((_, i) => i).filter((i) => i > im && t[i] >= t[im] + 0.15 && t[i] < Math.min(t[im] + 0.3, kick - 0.02)), pl = win.length ? win.map((i) => pv[i]) : [pv[pv.length - 1]]; // a normal ventricle's minimum is at the end of the beat: no window
      const level = pl.slice().sort((x, y) => x - y)[Math.floor(pl.length / 2)], risen = pv.findIndex((x, i) => i > im && x >= dip + 0.9 * (level - dip));
      return { dip, level, rise: level - dip, riseTime: t[risen] - t[im], flat: Math.max(...pl) - Math.min(...pl), dipAt: t[im] };
    };
    const c1 = shape(s), n1 = shape(ward({ ...BREATHING }, 15));
    log(`RV diastole: dip ${f(c1.dip)} -> plateau ${f(c1.level)} (rise ${f(c1.rise)} in ${f(c1.riseTime, 2)} s, flat within ${f(c1.flat)}); normal rise ${f(n1.rise)} in ${f(n1.riseTime, 2)} s`);
    expect(c1.rise).toBeGreaterThan(8); // a deep dip below the plateau
    expect(c1.riseTime).toBeLessThan(0.16); // reached fast
    expect(c1.flat).toBeLessThan(0.15 * c1.level); // and held: a plateau
    expect(c1.rise).toBeGreaterThan(2 * n1.rise + 4); // not the gentle rise of a normal ventricle
  });
  it("Kussmaul's sign: the right atrial pressure rises on inspiration, while the normal patient's falls", () => {
    log(`dRA: constriction ${f(c.dRA, 2)} normal ${f(n.dRA, 2)}`);
    expect(n.dRA).toBeLessThan(-0.5);
    expect(c.dRA).toBeGreaterThan(0); // a rise, not only a failure to fall
    expect(c.dRA).toBeGreaterThan(n.dRA + 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("RV infarct with septal shift (preset)", () => {
  const nSep = observe(ward({ septum: true }), 30);
  const r = observe(ward(spec("rv-infarct-septal"), 40), 30);
  const rOff = observe(ward({ ...spec("rv-infarct-septal"), septum: false }, 40), 30);
  log(`${row("normal+septum", nSep)}\n${row("RV infarct", r)}\n${row("RV inf. no sep", rOff)}`);
  it("the septum bows into the left ventricle at end-diastole (it bows into the right in the normal heart)", () => {
    expect(nSep.vspt).toBeGreaterThan(5); expect(r.vspt).toBeLessThan(0);
  });
  it("the left ventricle fills less: end-diastolic volume down 10 % or more from normal, and lower than without the septal shift", () => {
    expect(r.LVEDV).toBeLessThan(0.9 * nSep.LVEDV); expect(r.LVEDV).toBeLessThan(rOff.LVEDV - 5);
    expect(r.RVEDV).toBeGreaterThan(1.1 * nSep.RVEDV); // the dilated right ventricle
  });
  it("the right-sided filling pressure is high and the wedge is not: low output with clear lungs, and the output is lower with the shift", () => {
    expect(r.RA).toBeGreaterThan(8); expect(r.RA).toBeGreaterThan(r.PCWP - 2); expect(r.PCWP).toBeLessThan(15);
    expect(r.CO).toBeLessThan(0.6 * nSep.CO); expect(r.MAP).toBeLessThan(0.8 * nSep.MAP);
    expect(r.CO).toBeLessThan(rOff.CO);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("pericardiocentesis", () => {
  const base = spec("tamponade");
  const before = observe(ward(base), 30);
  const after = (ml: number) => { const s = ward(base); const got = s.drainPericardium(ml); return { s, got, o: observe(s, 30) }; };
  const d50 = after(50), d100 = after(100);
  log(`${row("tamponade", before)}\n${row("drained 50", d50.o)}\n${row("drained 100", d100.o)}`);
  it("removing 50-100 ml raises the pressure and the output substantially and lowers the right atrial pressure", () => {
    for (const d of [d50, d100]) {
      expect(d.o.MAP).toBeGreaterThan(before.MAP + 8); expect(d.o.CO).toBeGreaterThan(1.3 * before.CO);
      expect(d.o.RA).toBeLessThan(before.RA - 1.5); expect(d.o.peri).toBeLessThan(before.peri);
      expect(d.o.HR).toBeLessThan(before.HR);
    }
    expect(d100.o.MAP).toBeGreaterThan(d50.o.MAP); expect(d100.o.CO).toBeGreaterThan(d50.o.CO); expect(d100.o.RA).toBeLessThan(d50.o.RA);
    expect(d100.o.pulsus).toBeLessThan(before.pulsus);
    expect(d100.o.s.ecg().electricalAlternans).toBe(0); // 170 ml is below the alternans threshold
  });
  it("the sac keeps what is left, the spec in force carries no drain, and a second drain is capped at the effusion", () => {
    expect(d50.got).toBeCloseTo(50, 3); expect(d50.s.pericardium()!.effusionMl).toBeCloseTo(220, 1);
    expect(d100.s.pericardium()!.effusionMl).toBeCloseTo(170, 1);
    const live = d100.s.live;
    d100.s.setPatient(spec("tamponade")); // the preset again: the effusion is the spec's 270 ml once more, nothing was kept of the drain
    expect(d100.s.live).toBe(live); expect(d100.s.pericardium()!.effusionMl).toBeCloseTo(270, 1);
    const rest = d100.s.drainPericardium(1000); expect(rest).toBeCloseTo(270, 1); expect(d100.s.pericardium()!.effusionMl).toBeCloseTo(0, 3);
    expect(d100.s.drainPericardium(10)).toBe(0);
  });
  it("is a patch like any other (apply with pericardium.drainMl), and also drains a sac that keeps filling", () => {
    const s = ward({ ...base, pericardium: { effusionMl: 200, effusionRateMlMin: 30 } }, 15);
    s.step(10, { minutes: 4 }); // 120 ml more: the sac holds about 320 ml, the spec still says 200
    const grown = s.pericardium()!.effusionMl;
    expect(grown).toBeGreaterThan(300);
    s.apply({ pericardium: { drainMl: 100 } });
    expect(s.pericardium()!.effusionMl).toBeCloseTo(grown - 100, 0);
    s.apply({ pericardium: { stiffness: 1 } }); // a later patch does not bring the drained fluid back
    expect(s.pericardium()!.effusionMl).toBeLessThan(grown - 90);
  });
  it("on a patient with no sac it does nothing and does not build one; the legacy engine ignores it", () => {
    const s = ward({}, 10), live = s.live;
    expect(s.drainPericardium(100)).toBe(0); expect(s.live).toBe(live); expect(s.pericardium()).toBeNull();
    const legacy = new Simulation({}); legacy.reset({ seed: 3, pericardium: { effusionMl: 200 } }); expect(legacy.drainPericardium(100)).toBe(0);
  });
  it("corosim_adjust takes pericardium.drainMl through the tool, off the remembered effusion, and never stores it", () => {
    const sim = new Simulation({ seed: 3 }), tool = (name: string, a: Record<string, unknown>) => TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, a) as any;
    tool("corosim_set_scenario", { scenario: { pericardium: { effusionMl: 270 }, septum: true, ventilation: { mode: "spontaneous" } }, engine: "core", warmupSeconds: 15 });
    expect(sim.pericardium()!.effusionMl).toBeCloseTo(270, 0);
    const r = tool("corosim_adjust", { patch: { pericardium: { drainMl: 100 } }, runSeconds: 10 });
    expect(sim.pericardium()!.effusionMl).toBeCloseTo(170, 0);
    expect(r.applied.pericardium).toEqual({ effusionMl: 170 });
    expect(r.applied.septum).toBe(true);
    const r2 = tool("corosim_adjust", { patch: { pericardium: { drainMl: 500 } }, runSeconds: 2 });
    expect(sim.pericardium()!.effusionMl).toBeCloseTo(0, 0); expect(r2.applied.pericardium).toEqual({ effusionMl: 0 });
  }, 60000);
});
