import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { Scenario } from "../src/sim/scenario";
import { angioModel, timi, wireModel, echoModel, cathReport, ffrCall } from "../src/sim/cath";
import { AHA_SEGMENTS } from "../src/config/cath";

const patient = (sc: Scenario = {}) => { const sim = new Simulation({ seed: 7, ...sc }); sim.warmup(60); return sim; };
const lad = (stenosis: number, position = 0.5): Scenario => ({ lesions: [{ artery: "LAD", stenosis, position }] });
const occluded = (artery: string, position: number): Scenario => ({ lesions: [{ artery, occluded: true, position }] });
const score = (sim: Simulation) => Object.fromEntries(echoModel(sim).segments.map((s) => [s.name, s.motion]));
const names = (sim: Simulation, motion: string) => echoModel(sim).segments.filter((s) => s.motion === motion).map((s) => s.name);

describe("angiogram", () => {
  it("a normal patient has TIMI 3 flow in every main artery", () => {
    const sim = patient(), m = angioModel(sim);
    for (const a of ["LAD", "LCX", "RCA"]) { const t = timi(sim, a, m); expect(t.grade, a).toBe(3); expect(t.frames!, a).toBeGreaterThan(5); expect(t.frames!, a).toBeLessThanOrEqual(40); }
  });
  it("an occluded vessel is TIMI 0 and the dye never reaches beyond it", () => {
    const sim = patient(occluded("LAD", 0.2)), m = angioModel(sim), a = m.byId.LAD;
    expect(timi(sim, "LAD", m)).toMatchObject({ grade: 0, frames: null });
    expect(a.blockedFrom).not.toBeNull();
    a.arrival.forEach((t, i) => { if ((i / (a.arrival.length - 1)) * a.length >= a.blockedFrom!) expect(t).toBe(Infinity); else expect(Number.isFinite(t)).toBe(true); });
    for (const child of ["D1", "D2"]) if (m.byId[child].attach > 0.2) expect(m.byId[child].arrival.every((t) => t === Infinity)).toBe(true);
    expect(timi(sim, "RCA", m).grade).toBe(3); // the other vessels fill normally
  });
  it("arrival times never decrease along a vessel, and a child starts when the dye passes its origin", () => {
    const m = angioModel(patient(lad(0.7)));
    for (const a of m.segments) {
      for (let i = 1; i < a.arrival.length; i++) expect(a.arrival[i], `${a.id}[${i}]`).toBeGreaterThanOrEqual(a.arrival[i - 1]);
      if (a.parent) expect(a.arrival[0]).toBe(m.byId[a.parent].arrival[Math.round(a.attach * (a.arrival.length - 1))]);
    }
  });
  it("a tighter stenosis fills later", () => {
    const frames = [0, 0.75, 0.9].map((ds) => timi(patient(ds ? lad(ds) : {}), "LAD").frames!);
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThan(frames[i - 1]);
    expect(timi(patient(lad(0.9)), "LAD").grade).toBeLessThanOrEqual(2);
  });
  it("gives every vessel a finite diameter and velocity, and a centre for the C-arm", () => {
    const m = angioModel(patient());
    for (const a of m.segments) { expect(a.samples.length).toBe(a.diameterMm.length); expect(a.diameterMm.every((d) => d > 0.3 && d < 8)).toBe(true); expect(a.velocity.every(Number.isFinite)).toBe(true); }
    expect(m.centre.every(Number.isFinite)).toBe(true);
  });
});

describe("pressure wire", () => {
  it("a normal vessel has FFR above 0.9", () => {
    const w = wireModel(patient(), "LAD");
    expect(w.ffr!).toBeGreaterThan(0.9);
    expect(w.occluded).toBe(false);
  });
  it("FFR from the wire model is the simulation's own FFR", () => {
    for (const ds of [0.4, 0.6, 0.75, 0.9]) {
      const sim = patient(lad(ds)), w = wireModel(sim, "LAD");
      expect(+w.ffr!.toFixed(2), `ds ${ds}`).toBe(sim.state().ffr[0].ffr);
    }
  });
  it("FFR falls with severity, pressure drops across the lesion on pullback, and recovers none upstream of it", () => {
    const ffr = [0.3, 0.5, 0.7, 0.9].map((ds) => wireModel(patient(lad(ds)), "LAD").ffr!);
    for (let i = 1; i < ffr.length; i++) expect(ffr[i]).toBeLessThan(ffr[i - 1]);
    const w = wireModel(patient(lad(0.75)), "LAD");
    const before = w.at({ mm: w.lesionAt! - 12 }), after = w.at({ mm: w.lesionAt! + 12 });
    expect(before.hyperRatio).toBeGreaterThan(0.9);
    expect(after.hyperRatio).toBeLessThan(0.7);
    expect(before.hyperMmHg - after.hyperMmHg).toBeGreaterThan(20); // a gradient across the lesion, mmHg
    expect(w.paHyperMmHg).toBeCloseTo(90, 0);
  });
  it("hyperemia drags the distal pressure below its resting value", () => {
    const w = wireModel(patient(lad(0.6)), "LAD"), end = w.at(1);
    expect(end.hyperRatio).toBeLessThan(end.restRatio);
  });
  it("cannot cross an occlusion and reports no FFR", () => {
    const w = wireModel(patient(occluded("LAD", 0.3)), "LAD");
    expect(w.occluded).toBe(true); expect(w.ffr).toBeNull();
    const p = w.at(1);
    expect(p.stopped).toBe(true); expect(p.s).toBeLessThan(w.blockedFrom!);
  });
  it("names the grey zone", () => {
    expect(ffrCall(0.9)).toBe("not flow-limiting"); expect(ffrCall(0.78)).toBe("grey zone"); expect(ffrCall(0.6)).toBe("flow-limiting");
  });
});

describe("echo wall motion", () => {
  it("a normal heart moves normally in all 17 segments", () => {
    const e = echoModel(patient());
    expect(e.segments.length).toBe(AHA_SEGMENTS.length);
    expect(e.segments.every((s) => s.motion === "normal")).toBe(true);
    expect(e.scoreIndex).toBe(1);
  });
  it("LAD occlusion: anterior, anteroseptal and apical segments are akinetic, the inferior ones normal", () => {
    const sim = patient(occluded("LAD", 0.2)), s = score(sim);
    for (const n of ["basal anterior", "mid anterior", "basal anteroseptal", "mid anteroseptal", "apical anterior", "apical septal", "apex"]) expect(s[n], n).toBe("akinetic");
    for (const n of ["basal inferior", "mid inferior", "basal inferolateral", "mid inferolateral"]) expect(s[n], n).toBe("normal");
  });
  it("RCA occlusion is the reverse: inferior and inferoseptal akinetic, anterior normal", () => {
    const s = score(patient(occluded("RCA", 0.25)));
    for (const n of ["basal inferior", "mid inferior", "basal inferoseptal", "mid inferoseptal"]) expect(s[n], n).toBe("akinetic");
    for (const n of ["basal anterior", "mid anterior", "apical anterior", "apex", "basal anteroseptal"]) expect(s[n], n).toBe("normal");
  });
  it("circumflex occlusion hits the lateral wall", () => {
    const s = score(patient(occluded("LCX", 0.2)));
    for (const n of ["basal inferolateral", "mid inferolateral"]) expect(s[n], n).toBe("akinetic");
    for (const n of ["basal anterior", "mid anteroseptal", "mid inferior", "basal inferior", "apex"]) expect(s[n], n).toBe("normal");
  });
  it("in a left-dominant system the circumflex also feeds the inferior wall", () => {
    const sim = patient({ anatomy: { dominance: "left" }, ...occluded("LCX", 0.2) });
    expect(names(sim, "akinetic")).toContain("mid inferior");
  });
  it("EF and heart rate come from the simulation, and a bigger infarct lowers EF and raises the score index", () => {
    const sim = patient(occluded("LAD", 0.2)), e = echoModel(sim), st = sim.state();
    expect(e.ejectionFraction).toBe(st.ventricle.ejectionFraction);
    expect(e.heartRate).toBe(st.rolling10s.hr);
    expect(e.ejectionFraction).toBeLessThan(echoModel(patient()).ejectionFraction);
    expect(e.scoreIndex).toBeGreaterThan(1.5);
  });
});

describe("cath report", () => {
  it("summarises a lesion with QCA, flow and FFR", () => {
    const r = cathReport(patient(lad(0.75)));
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f).toMatchObject({ artery: "LAD", occluded: false, diameterStenosisPct: 75, timi: { grade: 3 }, ffrCall: "flow-limiting" });
    expect(f.minimumMm).toBeLessThan(f.referenceMm * 0.35);
    expect(r.flow.map((t) => t.artery)).toEqual(["LM", "LAD", "LCX", "RCA"]);
    expect(r.nextSteps.length).toBeGreaterThan(0);
  });
  it("reports the flow beyond a left main lesion in the vessels it feeds", () => {
    const f = cathReport(patient({ lesions: [{ artery: "LM", stenosis: 0.9, position: 0.5 }] })).findings[0];
    expect(f.timi.grade).toBeLessThanOrEqual(2);
  });
  it("says TIMI 0 for an occlusion and lists the abnormal segments", () => {
    const r = cathReport(patient(occluded("RCA", 0.25)));
    expect(r.findings[0]).toMatchObject({ occluded: true, ffr: null, timi: { grade: 0 } });
    expect(r.echo.abnormal.some((s) => s.name === "mid inferior")).toBe(true);
  });
});
