// B3: intrathoracic pressure, ventilation, pulsus paradoxus, PPV and SVV on the full adult model (core/thorax.ts, physics/respiratory.ts).
// Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { defaultPr, fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { LiveHeart } from "../src/physics/core/live";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Thorax, type ThoraxParams } from "../src/physics/core/thorax";
import { pulsusParadoxus, pulsePressureVariation, strokeVolumeVariation, beatsByBreath, type RespBeat } from "../src/physics/respiratory";
import { SOLVER } from "../src/config/structural";
import { THORAX } from "../src/config/thorax";

const HR = 72, T = 60 / HR;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const f = (x: number, d = 1) => x.toFixed(d);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

interface RunOpt {
  thorax?: Partial<ThoraxParams> | null; // default spontaneous at 12/min; null: no thorax element
  septum?: boolean; peri?: NonNullable<FromModelOptions["pericardium"]>;
  volumeMl?: number; // blood added (negative: removed), ml
  dt?: number; settle?: number; breaths?: number; // solver step; beats of settling before recording; breaths recorded
}
/**
 * Steady breathing on the adult model at 72 bpm: warm up at HR with the thorax off, breathe for `settle` beats, then record
 * `breaths` breaths beat by beat. Beats are the peripheral arterial pressure (the descending aorta, outside the chest, as a radial
 * line would read) and the stroke volume through the aortic valve. 12 breaths/min at 72 bpm is exactly six beats per breath.
 */
function run(o: RunOpt = {}) {
  const th: Partial<ThoraxParams> | null = o.thorax === undefined ? { mode: "spontaneous", rate: 12 } : o.thorax;
  const core: FromModelOptions = { ...(o.septum ? { septum: true } : {}), ...(o.peri ? { pericardium: o.peri } : {}) };
  // the blood volume is calibrated for a normal heart (septum if on), no sac and no thorax; the lesion and the volume change come on top
  const m = buildModel({ volumeMl: o.volumeMl }, volumeOffsetFor({}, o.septum ? { septum: true } : {}));
  const g = fromModel(m, { ...core, ...(th ? { thorax: { ...th, mode: "off" as const } } : {}) });
  const eng = createEngine(g.nodes, g.elements, g.options);
  const dt0 = o.dt ?? SOLVER.dt, nSteps = Math.max(50, Math.round(T / dt0)), dt = T / nSteps;
  const old = SOLVER.dt; SOLVER.dt = dt0;
  try { eng.periodic(HR); } finally { SOLVER.dt = old; }
  const thorax = th ? eng.element<Thorax>("thorax") : null;
  if (thorax && th) thorax.set(th);
  const rate = th?.rate ?? 12, breathT = 60 / rate, perBreath = Math.round(breathT / T);
  const settle = o.settle ?? 60, total = settle + (o.breaths ?? 4) * perBreath;
  const rec = new BeatRecorder(eng, T, ["AV"]);
  const pr = defaultPr(T);
  const beats: RespBeat[] = [], map: number[] = [], mapD: number[] = [], ra: number[] = [], pa: number[] = [], lvedp: number[] = [], sv: number[] = [], lung: number[] = [];
  let nan = false, t0 = eng.t;
  for (let k = 0; k < total; k++) {
    const tb = eng.t;
    if (k === settle) t0 = tb;
    eng.resetFlowVolumes();
    eng.schedule({ kind: "ventricular", t: tb }); eng.schedule({ kind: "atrial", t: tb + T - pr });
    for (let s = 0; s < nSteps; s++) eng.step(dt);
    if (k < settle) continue;
    const b = rec.beat(), fv = eng.flowVolumes(), S = fv.fwd.AV - fv.bwd.AV;
    if (![b.p.AO.mean, b.p.DAO.max, b.p.RA.mean, S].every(Number.isFinite)) nan = true;
    beats.push({ t: tb, systolic: b.p.DAO.max, diastolic: b.p.DAO.min, strokeVolume: S });
    map.push(b.p.AO.mean); mapD.push(b.p.DAO.mean); ra.push(b.p.RA.mean); pa.push(b.p.PA.mean); lvedp.push(b.p.LV.end); sv.push(S);
    lung.push(thorax ? thorax.at(tb + T / 2).lung : 0);
  }
  rec.dispose();
  const avg = (x: number[]) => x.reduce((a, v) => a + v, 0) / x.length;
  const inspExp = (x: number[]) => avg(x.filter((_, i) => lung[i] > 0.5)) - avg(x.filter((_, i) => lung[i] <= 0.5));
  return {
    eng, beats, t0, breathT, nan,
    MAP: avg(map), MAPd: avg(mapD), CVP: avg(ra), PA: avg(pa), LVEDP: avg(lvedp), SV: avg(sv), CO: (avg(sv) * HR) / 1000,
    /** Mean right atrial pressure in the inspiratory half of the breath minus the expiratory half, mmHg (beat means). */
    dRA: inspExp(ra),
    pulsus: pulsusParadoxus(beats, breathT, t0), ppv: pulsePressureVariation(beats, breathT, t0), svv: strokeVolumeVariation(beats, breathT, t0),
  };
}
type Run = ReturnType<typeof run>;
const summary = (x: Run) => `MAP ${f(x.MAP)} CO ${f(x.CO, 2)} CVP ${f(x.CVP)} PA ${f(x.PA)} LVEDP ${f(x.LVEDP)} | pulsus ${f(x.pulsus.value)} PPV ${f(100 * x.ppv.value)}% SVV ${f(100 * x.svv.value)}%`;

const VENT = { mode: "positive" as const, rate: 12, tidalMlKg: 8 };
/** Blood volume (ml, relative to the calibrated normal) at which the ventilated patient regains the normal pressure (MAP 95 against 90): the euvolemic ventilated patient. */
const EUV = 250;
/** The same patient, bled by 350 ml (7 % of the blood volume): hypovolemic. */
const HYPO = EUV - 350;

describe("thorax: pressure waveforms", () => {
  const th = new Thorax([0], [1], { mode: "spontaneous", rate: 12 });
  it("spontaneous: pleural -5 at end-expiration, -9 at peak inspiration (depth 1); the model's zero is the mean", () => {
    const e = th.at(0), i = th.at(2.5);
    expect(e.pleural).toBeCloseTo(-5, 6); expect(i.pleural).toBeCloseTo(-5 - THORAX.spontaneousSwing, 6);
    expect(e.chest).toBeCloseTo(THORAX.spontaneousSwing / 2, 6); expect(i.chest).toBeCloseTo(-THORAX.spontaneousSwing / 2, 6);
    let sum = 0, sa = 0; for (let k = 0; k < 500; k++) { const x = th.at((k * 5) / 500); sum += x.chest; sa += x.abdomen; }
    expect(Math.abs(sum / 500)).toBeLessThan(1e-9); expect(Math.abs(sa / 500)).toBeLessThan(1e-9);
    expect(i.abdomen - e.abdomen).toBeGreaterThan(0.5); expect(i.abdomen - e.abdomen).toBeLessThan(3); // the diaphragm descends
    th.set({ depth: 2 }); expect(th.at(2.5).pleural).toBeLessThan(-12); th.set({ depth: 1 });
  });
  it("positive: pleural pressure rises 5-10 mmHg in inspiration at 8 ml/kg; PEEP is transmitted in part", () => {
    th.set({ mode: "positive", tidalMlKg: 8, peep: 0 });
    const swing = th.at(2.5).chest - th.at(0).chest;
    expect(swing).toBeGreaterThan(5); expect(swing).toBeLessThan(10);
    const at0 = th.at(0).chest;
    th.set({ peep: 10 });
    const up = th.at(0).chest - at0;
    expect(up).toBeCloseTo(THORAX.peepTransmission * 10 * THORAX.mmHgPerCmH2O, 6);
    expect(up).toBeGreaterThan(0); expect(up).toBeLessThan(10 * THORAX.mmHgPerCmH2O);
    expect(th.at(2.5).abdomen).toBeGreaterThan(0); // the abdomen rises too
  });
  it("an external phase continues at the set rate", () => {
    th.set({ mode: "spontaneous" });
    th.setPhase(Math.PI, 10); // peak inspiration at t = 10
    expect(th.at(10).lung).toBeCloseTo(1, 6);
    expect(th.at(12.5).lung).toBeCloseTo(0, 6); // half a 5 s breath later: end-expiration
    expect(th.at(15).lung).toBeCloseTo(1, 6);
    th.clearPhase();
  });
  it("mode off applies nothing", () => {
    th.set({ mode: "off" });
    const x = th.at(1.3); expect(x.chest).toBe(0); expect(x.abdomen).toBe(0);
  });
});

describe("thorax: wiring", () => {
  it("fromModel adds the thorax only on request, and the LiveHeart `thoracic` modifier reaches it", () => {
    const g0 = fromModel(buildModel({}, 0));
    expect(createEngine(g0.nodes, g0.elements, g0.options).element.bind(null, "thorax")).toThrow();
    const h = new LiveHeart({}, { core: { thorax: { mode: "off" } } });
    const th = h.engine.element<Thorax>("thorax");
    h.setModifiers({ thoracic: 5 }); expect(th.params.offsetMmHg).toBe(5);
    h.setModifiers({}); expect(th.params.offsetMmHg).toBe(0);
    expect(() => new LiveHeart({}).setModifiers({ thoracic: 5 })).not.toThrow(); // no thorax built: stored only
  });
  it("the thorax puts the pressure on chest nodes and not on abdominal ones; the sac's pressure adds on top", () => {
    const m = buildModel({}, 0), g = fromModel(m, { pericardium: { effusionMl: 100 }, thorax: { mode: "positive", rate: 12, tidalMlKg: 8 } });
    const eng = createEngine(g.nodes, g.elements, g.options);
    const th = eng.element<Thorax>("thorax"), s = eng.sample(), x = th.at(eng.t);
    const by = (n: string) => s.Pext[eng.node(n)];
    expect(by("PA")).toBeCloseTo(x.chest, 9); expect(by("SVC")).toBeCloseTo(x.chest, 9);
    expect(by("IVC")).toBeCloseTo(x.abdomen, 9); expect(by("DAO")).toBeCloseTo(x.abdomen, 9);
    expect(by("LV")).toBeCloseTo(x.chest + s.taps.pericardium.pericardialPressure, 9);
  });
});

describe("respiratory outputs", () => {
  const mk = (sys: number[], dia: number[], sv: number[]): RespBeat[] => sys.map((s, i) => ({ t: i * 0.8, systolic: s, diastolic: dia[i], strokeVolume: sv[i] }));
  // two breaths of 4 beats (3.2 s)
  const beats = mk([100, 96, 90, 98, 100, 96, 90, 98], [60, 60, 60, 60, 60, 60, 60, 60], [70, 66, 60, 68, 70, 66, 60, 68]);
  it("pulsus is max minus min systolic per breath; PPV and SVV are (max - min)/mean", () => {
    expect(pulsusParadoxus(beats, 3.2).value).toBeCloseTo(10, 9);
    expect(pulsusParadoxus(beats, 3.2).breaths).toBe(2);
    const pp = [40, 36, 30, 38]; expect(pulsePressureVariation(beats, 3.2).value).toBeCloseTo(10 / (pp.reduce((a, b) => a + b) / 4), 9);
    const sv = [70, 66, 60, 68]; expect(strokeVolumeVariation(beats, 3.2).value).toBeCloseTo(10 / (sv.reduce((a, b) => a + b) / 4), 9);
  });
  it("a constant beat series gives zero; breaths with too few beats are skipped", () => {
    const c = mk([100, 100, 100, 100], [60, 60, 60, 60], [70, 70, 70, 70]);
    expect(pulsusParadoxus(c, 3.2).value).toBe(0); expect(pulsePressureVariation(c, 3.2).value).toBe(0);
    expect(beatsByBreath(beats.slice(0, 5), 3.2)).toHaveLength(1);
    expect(Number.isNaN(pulsusParadoxus([], 3.2).value)).toBe(true);
  });
});

const base = run({ thorax: null, breaths: 2, settle: 30 });
const spont = run();

describe("thorax: normal heart, spontaneous breathing at 12/min", () => {
  it("pulsus paradoxus is a few mmHg (< 10) and the breath-averaged numbers stay within 3 % of no thorax", () => {
    log(`no thorax   : ${summary(base)}\nspontaneous : ${summary(spont)}`);
    expect(spont.nan).toBe(false);
    expect(spont.pulsus.breaths).toBeGreaterThanOrEqual(3);
    expect(spont.pulsus.value).toBeLessThan(10); expect(spont.pulsus.value).toBeGreaterThan(0.5);
    for (const k of ["MAP", "CO", "CVP", "PA", "LVEDP"] as const) expect(rel(spont[k], base[k]), k).toBeLessThan(0.03);
  });
  it("the right atrial pressure falls on inspiration", () => {
    log(`normal: RA(insp - exp) ${f(spont.dRA, 2)} mmHg`);
    expect(spont.dRA).toBeLessThan(-0.8);
  });
});

describe("thorax: tamponade", () => {
  const eff = { effusionMl: 200 };
  const off = run({ peri: eff }), on = run({ peri: eff, septum: true });
  const off15 = run({ peri: eff, thorax: { mode: "spontaneous", rate: 12, depth: 1.5 } }), on15 = run({ peri: eff, septum: true, thorax: { mode: "spontaneous", rate: 12, depth: 1.5 } });
  const nSep = run({ septum: true });
  it("pulsus paradoxus exceeds 10 mmHg with a 200 ml effusion, septum off and on (table)", () => {
    log(`normal            : pulsus ${f(spont.pulsus.value)} (septum on ${f(nSep.pulsus.value)})\n200 ml septum off : ${summary(off)}\n200 ml septum on  : ${summary(on)}\n200 ml depth 1.5 off ${f(off15.pulsus.value)} on ${f(on15.pulsus.value)}`);
    expect(off.nan || on.nan).toBe(false);
    expect(off.pulsus.value).toBeGreaterThan(10); expect(on.pulsus.value).toBeGreaterThan(10);
    expect(off.pulsus.value).toBeGreaterThan(spont.pulsus.value + 3);
    expect(off.CO).toBeLessThan(0.6 * base.CO); // it is tamponade
    expect(off15.pulsus.value).toBeGreaterThan(off.pulsus.value); // deeper breaths, larger pulsus
  });
  it("ventricular interdependence makes it larger with the septum on", () => {
    expect(on.pulsus.value).toBeGreaterThan(off.pulsus.value);
    expect(on15.pulsus.value).toBeGreaterThan(off15.pulsus.value);
    expect(nSep.pulsus.value).toBeGreaterThan(spont.pulsus.value); // also in the normal heart
  });
});

describe("thorax: positive-pressure ventilation, PPV and SVV", () => {
  const euv = run({ thorax: VENT, volumeMl: EUV }), hypo = run({ thorax: VENT, volumeMl: HYPO });
  it("the euvolemic ventilated patient has the normal pressure (MAP within 6 % of the spontaneous normal)", () => {
    log(`euvolemic +${EUV}: ${summary(euv)}\nhypovolemic ${HYPO}: ${summary(hypo)}`);
    expect(rel(euv.MAP, base.MAP)).toBeLessThan(0.06);
  });
  it("PPV and SVV are small when euvolemic (< 10 %) and large in hypovolemia (> 13 %): the fluid-responsiveness sign", () => {
    expect(euv.nan || hypo.nan).toBe(false);
    expect(euv.ppv.value).toBeLessThan(0.1); expect(euv.svv.value).toBeLessThan(0.1);
    expect(hypo.ppv.value).toBeGreaterThan(0.13); expect(hypo.svv.value).toBeGreaterThan(0.13);
    expect(hypo.ppv.value).toBeGreaterThan(1.5 * euv.ppv.value);
    expect(hypo.MAP).toBeLessThan(0.85 * euv.MAP); // and the hypovolemic patient is hypotensive
  });
  it("fluid loading lowers PPV (monotone over blood volume)", () => {
    const mid = run({ thorax: VENT, volumeMl: 0 });
    log(`volume 0: ${summary(mid)}`);
    expect(hypo.ppv.value).toBeGreaterThan(mid.ppv.value); expect(mid.ppv.value).toBeGreaterThan(euv.ppv.value);
  });
});

describe("thorax: PEEP 10 cmH2O", () => {
  const p0 = run({ thorax: VENT, volumeMl: HYPO }), p10 = run({ thorax: { ...VENT, peep: 10 }, volumeMl: HYPO });
  const e0 = run({ thorax: VENT, volumeMl: EUV }), e10 = run({ thorax: { ...VENT, peep: 10 }, volumeMl: EUV });
  it("CVP rises and CO falls modestly in hypovolemia (and in the euvolemic patient)", () => {
    log(`hypovolemic PEEP 0 : ${summary(p0)}\nhypovolemic PEEP 10: ${summary(p10)}\neuvolemic PEEP 0 : ${summary(e0)}\neuvolemic PEEP 10: ${summary(e10)}`);
    expect(p10.CVP).toBeGreaterThan(p0.CVP + 2);
    expect(p10.CO).toBeLessThan(0.97 * p0.CO); expect(p10.CO).toBeGreaterThan(0.65 * p0.CO);
    expect(e10.CVP).toBeGreaterThan(e0.CVP + 2); expect(e10.CO).toBeLessThan(e0.CO);
  });
});

describe("thorax: constriction and the Kussmaul sign", () => {
  const con = run({ peri: { stiffness: 6 } });
  it("the right atrial pressure does not fall on inspiration in constriction, while it falls in the normal heart", () => {
    log(`normal RA(insp - exp) ${f(spont.dRA, 2)} mmHg | constriction (stiffness 6) ${f(con.dRA, 2)} mmHg | ${summary(con)}`);
    expect(spont.dRA).toBeLessThan(-0.8);
    expect(con.dRA).toBeGreaterThan(-0.5); // fails to fall (stays within half a mmHg of flat)
    expect(con.dRA).toBeGreaterThan(spont.dRA + 0.7);
  });
  // Known gap (review of B3): the true Kussmaul sign is a RISE in right atrial pressure on inspiration; the model reaches only
  // "fails to fall" (-0.24 mmHg). A rise needs a stronger inspiratory venous return into a non-compliant right heart. Flags itself when met.
  it.fails("the right atrial pressure rises on inspiration in constriction (true Kussmaul sign; follow-up)", () => {
    expect(con.dRA).toBeGreaterThan(0);
  });
  it("the shield is 1/6 at stiffness 6 and 1 for an opened sac", () => {
    const g = fromModel(buildModel({}, 0), { pericardium: { stiffness: 6 }, thorax: {} });
    const th = g.elements.find((e) => e instanceof Thorax) as Thorax;
    expect(th.shield()).toBeCloseTo(1 / 6, 9);
    const g2 = fromModel(buildModel({}, 0), { pericardium: { open: true, stiffness: 6 }, thorax: {} });
    expect((g2.elements.find((e) => e instanceof Thorax) as Thorax).shield()).toBe(1);
  });
});

describe("thorax: numerics", () => {
  it("halving dt changes the breath-averaged MAP, CO and pulsus by < 0.5 % (spontaneous and ventilated)", () => {
    const cases: [string, RunOpt][] = [["spontaneous", {}], ["ventilated hypovolemic", { thorax: VENT, volumeMl: HYPO }]];
    for (const [name, o] of cases) {
      const a = run({ ...o, breaths: 3 }), b = run({ ...o, breaths: 3, dt: SOLVER.dt / 2 });
      log(`${name}: dt ${SOLVER.dt}: MAP ${f(a.MAP, 3)} CO ${f(a.CO, 3)} pulsus ${f(a.pulsus.value, 3)} | dt/2: MAP ${f(b.MAP, 3)} CO ${f(b.CO, 3)} pulsus ${f(b.pulsus.value, 3)}`);
      expect(a.nan || b.nan).toBe(false);
      for (const k of ["MAP", "CO"] as const) expect(rel(b[k], a[k]), `${name} ${k}`).toBeLessThan(0.005);
      expect(rel(b.pulsus.value, a.pulsus.value), `${name} pulsus`).toBeLessThan(0.005);
    }
  }, 120000);
});
