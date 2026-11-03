// The VT/VF model inside the full Simulation on the core engine (task B3b): a proximal LAD occlusion in patients made arrhythmia-prone
// (arrhythmiaTendency 3), primary PCI at 2 clinical hours, an induced VT, and a stable stenosis. Slow (the core engine): listed in
// tests/slow.json. Rates over many seeds are in arrhythmiaRates.test.ts (rig), the mechanics in arrhythmia.test.ts.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { explain } from "../src/sim/explain";
import { ARRHYTHMIA } from "../src/config/arrhythmia";
import type { ArrhythmiaEvent } from "../src/physics/arrhythmia";

const LAD = [{ artery: "LAD", occluded: true, position: 0.1 }];

interface Run {
  seed: number; occlusion: ArrhythmiaEvent[]; vf?: { map: number; co: number; library?: string; text: string; hr: number | null };
  afterPci: ArrhythmiaEvent[]; aivrSeen?: { label: string; rate?: number; sinus: number; text: string }; final: string | null;
}

function course(seed: number): Run {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed, arrhythmiaTendency: 3 });
  s.warmup(10);
  s.apply({ lesions: LAD });
  const a = s.arrhythmia!;
  let vf: Run["vf"];
  for (let i = 0; i < 90 && !vf; i++) {
    s.run(1);
    const cur = a.current;
    if (cur?.kind === "vf" && s.t - cur.since > 32) { // past the monitor's 30 s flow window (it averages over the premature beats before the onset)
      const st = s.state();
      vf = { map: st.meanArterialPressure, co: s.rolling(4).cardiacOutput, library: st.rhythm.library, text: explain(s).mechanisms.join(" "), hr: st.rolling10s.hr };
    }
  }
  if (s.clinicalMinutes < 120) s.run((120 - s.clinicalMinutes) / s.minutesPerSecond);
  const occlusion = a.log.slice();
  a.terminate(s.t); // the cath lab team shocks a VF on arrival (defibrillation is task B4)
  s.revascularize("pci");
  a.terminate(s.t); // and again any arrhythmia of the door-to-balloon wait, to watch the reperfusion alone
  const n = a.log.length;
  let aivrSeen: Run["aivrSeen"];
  for (let i = 0; i < 40; i++) {
    s.run(1);
    if (!aivrSeen && a.current?.kind === "aivr" && s.t - a.current.since > 3) {
      const st = s.state();
      aivrSeen = { label: st.rhythm.label, rate: st.rhythm.ventricularRate, sinus: st.rhythm.sinusRate, text: explain(s).mechanisms.join(" ") };
    }
  }
  return { seed, occlusion, vf, afterPci: a.log.slice(n), aivrSeen, final: a.current?.kind ?? null };
}

describe("core engine: VT, VF and AIVR in the Simulation", () => {
  const runs = [1, 2, 4, 6].map(course);

  it("arrhythmia-prone patients with a proximal LAD occlusion have runs of VT, and some develop VF, in the first clinical hours", () => {
    expect(runs.every((r) => r.occlusion.length > 0)).toBe(true);
    expect(runs.some((r) => r.occlusion.some((e) => e.kind === "vf"))).toBe(true);
    for (const r of runs) for (const e of r.occlusion) if (e.couplingVsT !== undefined) expect(e.couplingVsT).toBeGreaterThan(0.7);
  });
  it("VF on the core engine: the library's VF on the monitor, no output, the pressure collapses, and the explanation says cardiac arrest", () => {
    const v = runs.find((r) => r.vf)?.vf;
    expect(v).toBeDefined();
    expect(v!.library).toMatch(/^vf/);
    expect(v!.map).toBeLessThan(30);
    expect(v!.co).toBeLessThan(0.5);
    expect(v!.text).toMatch(/ventricular fibrillation/i);
    expect(v!.text).toMatch(/cardiac arrest/);
  });
  it("after primary PCI, accelerated idioventricular rhythm in most of these patients: a ventricular rhythm at 55-110/min just above the sinus rate, ending by itself", () => {
    const with_ = runs.filter((r) => r.afterPci.some((e) => e.kind === "aivr"));
    expect(with_.length).toBeGreaterThanOrEqual(2);
    for (const r of with_) for (const e of r.afterPci.filter((x) => x.kind === "aivr")) {
      expect(e.cause).toBe("reperfusion");
      expect(e.rate).toBeGreaterThanOrEqual(ARRHYTHMIA.aivr.minRate); expect(e.rate).toBeLessThanOrEqual(ARRHYTHMIA.aivr.maxRate);
    }
    const seen = runs.find((r) => r.aivrSeen)?.aivrSeen;
    expect(seen).toBeDefined();
    expect(seen!.label.toLowerCase()).toMatch(/idioventricular/);
    expect(seen!.rate!).toBeGreaterThanOrEqual(seen!.sinus);
    expect(seen!.text).toMatch(/accelerated idioventricular rhythm/i);
    expect(runs.some((r) => r.afterPci.some((e) => e.kind === "aivr" && e.end !== undefined))).toBe(true);
  });
  it("a monomorphic VT induced on top of the occlusion lowers the stroke volume and the pressure, and breaks up into VF within minutes", () => {
    let degenerated = 0, measured = 0;
    for (const seed of [1, 2, 3]) {
      const s = new Simulation({}, { engine: "core" });
      s.reset({ seed, arrhythmiaTendency: 0, lesions: LAD }, { settled: true });
      s.run(5);
      const before = s.rolling(5);
      s.apply({ arrhythmiaTendency: 1 });
      s.minutesPerSecond = 0; // the clinical clock stopped: the VT's course only, no new run
      expect(s.arrhythmia!.induce("mono")).toBe(true);
      s.run(10);
      if (s.arrhythmia!.current?.kind === "mono") { // a VT may stop by itself in the first seconds (mean 4 min)
        const during = s.rolling(5);
        measured++;
        expect(during.sv).toBeLessThan(0.6 * before.sv);
        expect(during.sbp).toBeLessThan(before.sbp - 10);
      }
      s.run(290);
      if (s.arrhythmia!.log.some((e) => e.kind === "vf" && e.cause === "degeneration")) degenerated++;
    }
    expect(measured).toBeGreaterThanOrEqual(2);
    expect(degenerated).toBeGreaterThanOrEqual(1);
  });
  it("no arrhythmia in a stable 70% LAD stenosis at rest, even in an arrhythmia-prone patient", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 6, arrhythmiaTendency: 3, lesions: [{ artery: "LAD", stenosis: 0.7, position: 0.15 }] }, { settled: true });
    s.run(60);
    expect(s.arrhythmia!.log.length).toBe(0);
    expect(s.state().rhythm.arrhythmia?.counts).toEqual({ nsvt: 0, mono: 0, poly: 0, vf: 0, aivr: 0 });
  });
});
