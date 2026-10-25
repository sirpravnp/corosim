import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { BridgeSource } from "../src/sim/bridgeSource";
import { patientFromLesionHash } from "../src/sim/structural";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { rightHeartCath } from "../src/sim/rightHeartCath";
import { PATIENTS } from "../src/config/structural";
import { analyze } from "../src/physics/structural";
import type { BeatSummary } from "../src/sim/hemoSource";

vi.setConfig({ testTimeout: 60_000 });

/** A bridge over an ordinary (adult) ACS simulation but a neonatal heart, run long enough to solve and emit beats. */
function neonate(hash: string, sec = 12) {
  const sim = new Simulation(); sim.reset({ seed: 3 }, { settled: true }); sim.warmup(40); sim.history = [];
  const patient = patientFromLesionHash(hash), bridge = new BridgeSource(sim, { patient }), got: BeatSummary[] = [];
  bridge.onBeat((b) => got.push(b));
  sim.run(sec); bridge.refresh();
  return { sim, bridge, got, patient };
}

describe("neonatal VSD through the bridge (P2e)", () => {
  const { sim, bridge, got, patient } = neonate("#lesion=vsd&diameter=7");
  const n = bridge.numbers(), base = PATIENTS.neonate;
  it("is standalone: on its own baseline, not calibrated to the adult monitor", () => {
    expect(patient.kind).toBe("neonate");
    expect(bridge.standalone).toBe(true); expect(bridge.patientKind).toBe("neonate");
    expect(sim.map).toBeGreaterThan(70); // the monitor is an adult
    expect(bridge.volume).toBe(0); expect(bridge.svrMul).toBe(1); expect(bridge.eesMul).toBe(1);
    expect(n.hr).toBeCloseTo(base.hr, 6);
  });
  it("gives neonatal-range pressures", () => {
    // A 7 mm VSD steals systemic flow, so the structural engine's own MAP (35.5) sits below the normal neonate's 48; it is the
    // structural page's number, not a calibration miss. Within 15 % of the baseline engine solve with the same lesion's page value:
    const page = analyze({ ...patient.heart, patient: "neonate", hr: base.hr }).pressure.AO.mean;
    expect(Math.abs(n.map - page)).toBeLessThan(0.15 * page);
    expect(n.map).toBeGreaterThan(0.6 * base.map); expect(n.map).toBeLessThan(1.15 * base.map);
    expect(Math.abs(analyze({ patient: "neonate", hr: base.hr }).pressure.AO.mean - base.map)).toBeLessThan(0.15 * base.map);
    expect(n.lvedp).toBeLessThan(12);
    expect(n.systolic).toBeLessThan(80);
  });
  it("matches the structural page's own solve", () => {
    const r = analyze({ ...patient.heart, patient: "neonate", hr: base.hr });
    expect(n.map).toBeCloseTo(r.pressure.AO.mean, 6); expect(n.qpQs).toBeCloseTo(r.qpQs, 6);
  });
  it("still shows the shunt: Qp:Qs above 1 and a ventricular step-up", () => {
    expect(n.qpQs).toBeGreaterThan(1.3);
    const r = rightHeartCath(bridge)!;
    expect(r.oximetry.deltas.ventricular).toBeGreaterThan(0.07);
    expect(r.oximetry.stepUps.some((s) => s.level === "ventricular")).toBe(true);
  });
  it("replays beats at the neonate's own rate, with strictly increasing trace time", () => {
    expect(got.length).toBeGreaterThan(10);
    expect(60 / got[got.length - 1].rr).toBeCloseTo(base.hr, 0);
    const tr = bridge.trace("AO", 5);
    for (let i = 1; i < tr.t.length; i++) expect(tr.t[i]).toBeGreaterThan(tr.t[i - 1]);
  });
  it("grades a normal neonatal mitral and aortic valve against the neonatal baseline: no stenosis", () => {
    const l = leftHeartCath(bridge.numbers(), bridge.beats(1)[0], bridge.patientKind)!;
    expect(l.severity.mitral).toBe("none"); expect(l.severity.aortic).toBe("none");
  });
});

describe("neonatal tetralogy of Fallot through the bridge", () => {
  const { bridge } = neonate("#lesion=tof", 8);
  it("is cyanotic, as on the structural page", () => {
    const s = bridge.saturations();
    expect(s.spo2).toBeLessThan(0.9);
    expect(s.spo2).toBeCloseTo(analyze({ ...patientFromLesionHash("#lesion=tof").heart, patient: "neonate", hr: PATIENTS.neonate.hr }).preductalSat, 6);
    expect(bridge.numbers().map).toBeGreaterThan(40); expect(bridge.numbers().map).toBeLessThan(60);
  });
});

describe("an adult patient is unchanged", () => {
  it("is not standalone", () => {
    const sim = new Simulation(); sim.reset({ seed: 3 }, { settled: true });
    const b = new BridgeSource(sim); expect(b.standalone).toBe(false); expect(b.patientKind).toBe("adult");
  });
});
