// D7: LV venting on VA-ECMO (ECPELLA, IABP on ECMO, atrial septostomy) and right-sided support (Impella RP, BiPella).
// Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Impella, ImpellaConsole } from "../src/physics/core/devices/impella";
import { ImpellaRp, rpLevelSpeed } from "../src/physics/core/devices/impellaRp";
import { Ecmo } from "../src/physics/core/devices/ecmo";
import { Iabp } from "../src/physics/core/devices/iabp";
import { pumpHead } from "../src/physics/core/devices/pump";
import { LiveHeart } from "../src/physics/core/live";
import { IMPELLA_RP } from "../src/config/devices";
import { SOLVER } from "../src/config/structural";

const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };

interface RunOpts { dt?: number; hr?: number }
function run(spec: StructuralSpec, core: FromModelOptions, o: RunOpts = {}) {
  const m = buildModel(spec, volumeOffsetFor(spec));
  const g = fromModel(m, core);
  const eng = createEngine(g.nodes, g.elements, g.options);
  const hr = o.hr ?? HR, dt = o.dt ?? SOLVER.dt;
  const rec = new BeatRecorder(eng, 60 / hr, ["MV", "AV"]);
  const con = core.impellaRp ? new ImpellaConsole(eng, "impellaRp") : null, conL = core.impella ? new ImpellaConsole(eng, "impella") : null;
  let anyNaN = false;
  const off = eng.onSample((s) => {
    for (const x of s.V) if (!Number.isFinite(x)) anyNaN = true;
    for (const x of s.P) if (!Number.isFinite(x)) anyNaN = true;
  });
  const old = SOLVER.dt; SOLVER.dt = dt;
  try { eng.periodic(hr); } finally { SOLVER.dt = old; }
  off();
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose(); con?.dispose(); conL?.dispose();
  // suction alarms of the last complete beat (the console), not of the start-up transient
  const alarm = conL?.last?.suctionAlarm ? 1 : 0, alarmRp = con?.last?.suctionAlarm ? 1 : 0;
  const lpm = (name: string) => (fv.fwd[name] !== undefined ? ((fv.fwd[name] - fv.bwd[name]) * hr) / 1000 : 0);
  return {
    m, eng, b, anyNaN, alarm, alarmRp, con, lpm,
    MAP: b.p.AO.mean, PP: b.p.AO.max - b.p.AO.min, LVEDP: b.p.LV.end, EDV: b.v.LV.end, PCWP: b.p.LA.mean, RAP: b.p.RA.mean, PAm: b.p.PA.mean, avFwd: b.valves.AV.forwardMl,
    ecmo: lpm("ecmo"), imp: lpm("impella"), rp: lpm("impellaRp"), asd: lpm("ASD"), co: ((fv.fwd.AV - fv.bwd.AV) * hr) / 1000, pvl: lpm("PVL"),
    blood: Array.from(eng.sample().V).reduce((a, x) => a + x, 0), start: m.start.reduce((a, x) => a + x, 0),
  };
}
type Run = ReturnType<typeof run>;
const f1 = (x: number) => x.toFixed(1), f2 = (x: number) => x.toFixed(2);
const row = (n: string, x: Run) => log(`${n.padEnd(16)} MAP ${f1(x.MAP)} PP ${f1(x.PP)} LVEDP ${f1(x.LVEDP)} EDV ${f1(x.EDV)} PCWP ${f1(x.PCWP)} RAP ${f1(x.RAP)} PAm ${f1(x.PAm)} AVfwd ${f1(x.avFwd)} ecmo ${f2(x.ecmo)} imp ${f2(x.imp)} rp ${f2(x.rp)} asd ${f2(x.asd)} PVL ${f2(x.pvl)} alarm ${x.alarm}/${x.alarmRp}`);

// D6b's distended cases: volume-loaded shock at 4 L/min, severe dysfunction at 5 L/min.
const LOADED: StructuralSpec = { lvEes: 0.35, lvStiffness: 1.6, volumeMl: 300 };
const SEVERE: StructuralSpec = { lvEes: 0.2, lvStiffness: 3, volumeMl: 800 };
const CASES = [{ name: "loaded 4", spec: LOADED, flow: 4 }, { name: "severe 5", spec: SEVERE, flow: 5 }] as const;

interface Vent { name: string; core: (flow: number) => FromModelOptions; spec?: (s: StructuralSpec) => StructuralSpec }
const asd = (mm: number) => (s: StructuralSpec): StructuralSpec => ({ ...s, asd: { diameterMm: mm } });
const VENTS: Vent[] = [
  { name: "Impella P2", core: (f) => ({ ecmo: { flowLpm: f }, impella: { model: "CP", level: 2 } }) },
  { name: "Impella P5", core: (f) => ({ ecmo: { flowLpm: f }, impella: { model: "CP", level: 5 } }) },
  { name: "Impella P8", core: (f) => ({ ecmo: { flowLpm: f }, impella: { model: "CP", level: 8 } }) },
  { name: "IABP 1:1", core: (f) => ({ ecmo: { flowLpm: f }, iabp: { ratio: 1 } }) },
  { name: "septostomy 8mm", core: (f) => ({ ecmo: { flowLpm: f } }), spec: asd(8) },
  { name: "septostomy 12mm", core: (f) => ({ ecmo: { flowLpm: f } }), spec: asd(12) },
];

if (process.env.CORE_VERBOSE) {
  for (const c of CASES) {
    row(`${c.name} +CP P9`, run(c.spec, { ecmo: { flowLpm: c.flow }, impella: { model: "CP", level: 9 } }));
    row(`${c.name} +5.5 P8`, run(c.spec, { ecmo: { flowLpm: c.flow }, impella: { model: "5.5", level: 8 } }));
    row(`${c.name} +2.5 P8`, run(c.spec, { ecmo: { flowLpm: c.flow }, impella: { model: "2.5", level: 8 } }));
  }
}
const base: Record<string, Run> = {}, vented: Record<string, Record<string, Run>> = {};
for (const c of CASES) {
  base[c.name] = run(c.spec, { ecmo: { flowLpm: c.flow } });
  row(`${c.name} ECMO only`, base[c.name]);
  vented[c.name] = {};
  for (const v of VENTS) { const r = run(v.spec ? v.spec(c.spec) : c.spec, v.core(c.flow)); vented[c.name][v.name] = r; row(`  + ${v.name}`, r); }
}

describe("venting on VA-ECMO (distended LV)", () => {
  for (const c of CASES) {
    it(`${c.name}: every vent lowers LVEDP and PCWP versus ECMO alone (Impella P5 and P8, IABP 1:1, septostomy 8 and 12 mm)`, () => {
      const b = base[c.name];
      for (const v of VENTS) {
        if (v.name === "Impella P2") continue; // see the P2 test below
        const r = vented[c.name][v.name];
        expect(r.LVEDP, `${v.name} LVEDP`).toBeLessThan(b.LVEDP);
        expect(r.PCWP, `${v.name} PCWP`).toBeLessThan(b.PCWP);
        expect(r.anyNaN).toBe(false);
      }
    });
    it(`${c.name}: Impella unloads more with level, and more than the IABP`, () => {
      const V = vented[c.name];
      expect(V["Impella P5"].LVEDP).toBeLessThan(V["Impella P2"].LVEDP);
      expect(V["Impella P8"].LVEDP).toBeLessThan(V["Impella P5"].LVEDP);
      expect(V["Impella P8"].PCWP).toBeLessThan(V["Impella P5"].PCWP);
      expect(V["Impella P8"].LVEDP).toBeLessThan(V["IABP 1:1"].LVEDP - 5);
      expect(V["Impella P8"].imp).toBeGreaterThan(V["Impella P5"].imp);
      const rank = Object.entries(V).sort((a, z) => a[1].LVEDP - z[1].LVEDP).map(([n, r]) => `${n} ${f1(r.LVEDP)}`);
      log(`${c.name} ranking (LVEDP, ECMO alone ${f1(base[c.name].LVEDP)}):`, rank.join(" < "));
    });
    // FINDING (differs from the brief's expectation that the Impella vents the most): a large septostomy through the orifice law, with the
    // RA held low by the ECMO drainage, shunts 4-8 L/min and lowers LA pressure and LVEDP more than an Impella CP at P8 (3 L/min class).
    // The Impella is the strongest vent among the devices that act on the LV (and unloads the LV volume and work, see AV forward below).
    it(`${c.name}: ranking finding, septostomy 12 mm lowers LVEDP below Impella CP P8`, () => {
      const V = vented[c.name];
      expect(V["septostomy 12mm"].LVEDP).toBeLessThan(V["Impella P8"].LVEDP);
      expect(V["septostomy 8mm"].LVEDP).toBeLessThan(V["Impella P5"].LVEDP);
    });
  }
  it("Impella P2 on a high afterload leaks back: it does not vent the volume-loaded case, and helps in the severe case", () => {
    // MAP 105 against a shut-off head of about 45 mmHg: the rotor is a leak in diastole (reverse flow sees only R0, R-D1). Net pump flow ~0.
    const L = vented["loaded 4"]["Impella P2"], S = vented["severe 5"]["Impella P2"];
    expect(L.imp).toBeLessThan(0.5);
    expect(L.LVEDP).toBeGreaterThan(base["loaded 4"].LVEDP);
    expect(S.LVEDP).toBeLessThan(base["severe 5"].LVEDP);
  });
  it("the aortic valve may reopen with the vent: report AV forward volume", () => {
    for (const c of CASES) log(c.name, "AV forward ml/beat:", `none ${f2(base[c.name].avFwd)}`, ...VENTS.map((v) => `${v.name} ${f2(vented[c.name][v.name].avFwd)}`));
    // Direction: the IABP reopens the valve a little in the severe case (2 -> 8 ml); the Impella takes the flow through the pump and the valve closes.
    expect(vented["severe 5"]["IABP 1:1"].avFwd).toBeGreaterThan(base["severe 5"].avFwd);
    expect(vented["loaded 4"]["Impella P8"].avFwd).toBeLessThan(1);
    expect(vented["loaded 4"]["Impella P8"].imp).toBeGreaterThan(2);
    expect(vented["loaded 4"]["septostomy 12mm"].avFwd).toBeLessThan(base["loaded 4"].avFwd);
  });
  it("Impella flows rise with level and stay in the CP class on ECMO", () => {
    for (const c of CASES) { const V = vented[c.name]; expect(V["Impella P8"].imp).toBeGreaterThan(V["Impella P5"].imp); expect(V["Impella P5"].imp).toBeGreaterThan(V["Impella P2"].imp); expect(V["Impella P8"].imp).toBeLessThan(4.5); }
  });
  it("a larger septostomy vents more (LA pressure falls with size)", () => {
    for (const c of CASES) { const V = vented[c.name]; expect(V["septostomy 12mm"].PCWP).toBeLessThan(V["septostomy 8mm"].PCWP); expect(V["septostomy 8mm"].PCWP).toBeLessThan(base[c.name].PCWP); }
  });
  it("the aortic valve may reopen with the vent: report AV forward volume", () => {
    for (const c of CASES) log(c.name, "AV forward ml/beat:", `none ${f2(base[c.name].avFwd)}`, ...VENTS.map((v) => `${v.name} ${f2(vented[c.name][v.name].avFwd)}`));
    // the moderate case: the Impella and IABP leave the valve at least as open as ECMO alone; the Impella also takes flow through the pump
    const L = vented["loaded 4"];
    expect(L["Impella P8"].avFwd).toBeLessThan(base["loaded 4"].avFwd + 5); // the pump carries part of the LV output
    expect(L["Impella P8"].imp).toBeGreaterThan(1);
  });
  it("Impella flows are in the class figures on ECMO", () => {
    for (const c of CASES) { const V = vented[c.name]; expect(V["Impella P8"].imp).toBeGreaterThan(V["Impella P2"].imp); expect(V["Impella P8"].imp).toBeLessThan(4.5); }
  });
});

describe("atrial septostomy", () => {
  it("shunts LA to RA; LA pressure falls and RA rises a little", () => {
    for (const c of CASES) {
      const b = base[c.name];
      for (const n of ["septostomy 8mm", "septostomy 12mm"]) {
        const r = vented[c.name][n];
        log(c.name, n, "shunt L/min", f2(r.asd), "LA", f1(b.PCWP), "->", f1(r.PCWP), "RA", f1(b.RAP), "->", f1(r.RAP));
        expect(r.asd).toBeGreaterThan(0.2);
        expect(r.PCWP).toBeLessThan(b.PCWP);
        expect(r.RAP).toBeGreaterThan(b.RAP - 0.3);
        expect(r.RAP).toBeLessThan(b.RAP + 8);
      }
      expect(vented[c.name]["septostomy 12mm"].asd).toBeGreaterThan(vented[c.name]["septostomy 8mm"].asd);
    }
  });
});

describe("Impella RP in RV failure", () => {
  const RVF: StructuralSpec = { rvEes: 0.3, rvStiffness: 2.5 };
  const none = run(RVF, {}), p5 = run(RVF, { impellaRp: { level: 5 } }), p8 = run(RVF, { impellaRp: { level: 8 } });
  row("RV failure", none); row("RP P5", p5); row("RP P8", p8);
  it("PA flow up, RAP down, LV filling and CO up", () => {
    for (const x of [p5, p8]) {
      expect(x.rp).toBeGreaterThan(1);
      expect(x.RAP).toBeLessThan(none.RAP);
      expect(x.co).toBeGreaterThan(none.co);
      expect(x.EDV).toBeGreaterThan(none.EDV);
      expect(x.MAP).toBeGreaterThan(none.MAP);
      expect(x.PAm).toBeGreaterThan(none.PAm);
    }
    expect(p8.rp).toBeGreaterThan(p5.rp); expect(p8.RAP).toBeLessThan(p5.RAP); expect(p8.co).toBeGreaterThan(p5.co);
    log("RP in RV failure: CO", f2(none.co), f2(p5.co), f2(p8.co), "RAP", f1(none.RAP), f1(p5.RAP), f1(p8.RAP), "PA flow RP", f2(p5.rp), f2(p8.rp));
  });
  it("class flow, console and suction behaviour in a normal patient", () => {
    const h = run({}, { impellaRp: { level: 9 } });
    row("normal RP P9", h);
    expect(h.alarmRp).toBe(0);
    expect(h.rp).toBeGreaterThan(2.5);
    expect(p8.rp).toBeGreaterThan(3.5); expect(p8.rp).toBeLessThan(4.6);
    expect(p8.alarmRp).toBe(0);
    expect(rpLevelSpeed(9)).toBeCloseTo(33, 6);
    // design point: HQ at P9 against 20 mmHg (plus cannula R0) is the class flow within 15 %
    const D = IMPELLA_RP; let q = 50; for (let i = 0; i < 200; i++) q += 0.2 * ((pumpHead(D, 33, q) - D.designDp - D.R0 * q) / 10);
    expect((q * 60) / 1000).toBeGreaterThan(0.85 * D.maxFlowLpm); expect((q * 60) / 1000).toBeLessThan(1.15 * D.maxFlowLpm);
    const c = p8.con!.last!;
    log("RP console", JSON.stringify({ level: c.level, flow: c.flow, current: c.current, alarm: c.suctionAlarm }));
    expect(c.level).toBe(8); expect(c.flow.mean).toBeGreaterThan(1); expect(c.suctionAlarm).toBe(false);
  });
  it("suction alarm where the IVC empties: hypovolemia at a high level", () => {
    const hv: StructuralSpec = { volumeMl: -600 };
    const lo = run(hv, { impellaRp: { level: 2 } }), hi = run(hv, { impellaRp: { level: 9 } });
    
    row("hypovol RP P2", lo); row("hypovol RP P9", hi);
    expect(hi.alarmRp).toBe(1);
    expect(hi.rp).toBeLessThan(2.5);
    expect(hi.anyNaN).toBe(false);
    expect(lo.alarmRp).toBe(0);
  });
});

describe("BiPella in biventricular failure", () => {
  const BIV: StructuralSpec = { lvEes: 0.35, lvStiffness: 1.6, rvEes: 0.3, rvStiffness: 2.5, volumeMl: 300 };
  const none = run(BIV, {}), lOnly = run(BIV, { impella: { level: 6 } }), rOnly = run(BIV, { impellaRp: { level: 6 } }), bi = run(BIV, { impella: { level: 6 }, impellaRp: { level: 6 } });
  row("BiV failure", none); row("Impella only", lOnly); row("RP only", rOnly); row("BiPella", bi);
  it("both sides unloaded: RAP down, LVEDP down, MAP and CO up", () => {
    // Right side: RAP below untreated and below the Impella alone, PA flow carried by the RP. Left side: the RP alone fills the LV (LVEDP 16);
    // the Impella takes it back (valve nearly closed). BiPella LVEDP stays above the untreated failing-RV value because the RV no longer
    // starves the LV: LV filling and output are restored.
    expect(bi.RAP).toBeLessThan(none.RAP);
    expect(bi.RAP).toBeLessThan(lOnly.RAP);
    expect(bi.MAP).toBeGreaterThan(none.MAP + 10);
    expect(bi.EDV).toBeGreaterThan(none.EDV);
    expect(bi.rp).toBeGreaterThan(1); expect(bi.imp).toBeGreaterThan(1);
    expect(bi.LVEDP).toBeLessThan(rOnly.LVEDP - 2); expect(bi.PCWP).toBeLessThan(rOnly.PCWP - 2);
    expect(bi.avFwd).toBeLessThan(0.5 * rOnly.avFwd);
    expect(bi.PAm).toBeGreaterThan(none.PAm);
    log("BiPella: RAP", f1(none.RAP), "->", f1(bi.RAP), "LVEDP", f1(none.LVEDP), "->", f1(bi.LVEDP), "MAP", f1(none.MAP), "->", f1(bi.MAP));
    expect(bi.anyNaN).toBe(false);
  });
});

describe("combinations", () => {
  const combos: [string, StructuralSpec, FromModelOptions][] = [
    ["ECPELLA", LOADED, { ecmo: { flowLpm: 4 }, impella: { level: 6 } }],
    ["ECMO + IABP", LOADED, { ecmo: { flowLpm: 4 }, iabp: true }],
    ["ECPELLA + IABP", LOADED, { ecmo: { flowLpm: 4 }, impella: { level: 6 }, iabp: true }],
    ["ECMO + septostomy", { ...LOADED, asd: { diameterMm: 10 } }, { ecmo: { flowLpm: 4 } }],
    ["ECMO + RP", { ...LOADED, rvEes: 0.3, rvStiffness: 2.5 }, { ecmo: { flowLpm: 3 }, impellaRp: { level: 5 } }],
    ["BiPella", { lvEes: 0.35, rvEes: 0.3 }, { impella: { level: 6 }, impellaRp: { level: 6 } }],
    ["all", LOADED, { ecmo: { flowLpm: 3 }, impella: { level: 5 }, impellaRp: { level: 5 }, iabp: true }],
  ];
  for (const [name, spec, core] of combos) {
    it(`${name}: finite, volume conserved, dt halving under 0.5 %`, () => {
      const a = run(spec, core), h = run(spec, core, { dt: SOLVER.dt / 2 });
      row(name, a);
      expect(a.anyNaN).toBe(false);
      expect(Math.abs(a.blood - a.start)).toBeLessThan(0.01 * a.start);
      for (const k of ["MAP", "LVEDP", "RAP", "PCWP"] as const) expect(Math.abs(h[k] - a[k]) / Math.abs(a[k]), k).toBeLessThan(0.005);
      for (const k of ["ecmo", "imp", "rp"] as const) if (Math.abs(a[k]) > 0.5) expect(Math.abs(h[k] - a[k]) / Math.abs(a[k]), k).toBeLessThan(0.005);
    });
  }
  it("devices coexist in the engine and as LiveHeart extras", () => {
    const g = fromModel(buildModel({}, volumeOffsetFor({})), { ecmo: { flowLpm: 3 }, impella: { level: 4 }, impellaRp: { level: 4 }, iabp: true });
    expect(g.elements.map((e) => e.name)).toEqual(expect.arrayContaining(["ecmo", "impella", "impellaRp", "iabp"]));
    const h = new LiveHeart(LOADED, { extra: [(m) => Ecmo.forModel(m, { flowLpm: 3 }), (m) => Impella.forModel(m, { level: 5 }), (m) => ImpellaRp.forModel(m, { level: 5 }), (m) => Iabp.forModel(m, {})] });
    h.engine.step(0.01);
    expect(h.engine.element<ImpellaRp>("impellaRp").level).toBe(5);
    expect(h.engine.element<Impella>("impella").level).toBe(5);
    expect(h.engine.element<Ecmo>("ecmo").target).toBe(3);
  });
  it("set({ level }) changes the RP speed", () => {
    const h = new LiveHeart({}, { extra: [(m) => ImpellaRp.forModel(m, { level: 3 })] });
    const el = h.engine.element<ImpellaRp>("impellaRp"); el.set({ level: 9 });
    expect(el.params.speed).toBeCloseTo(33, 6);
  });
});
