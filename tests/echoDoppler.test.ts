import { describe, it, expect } from "vitest";
import { installCtHeartNode } from "../src/echo/ctNode";
import { buildPoses } from "../src/echo/poses";
import { CASE_BY_ID } from "../src/echo/cases";
import { beatOf, EchoBeat } from "../src/echo/beat";
import { jetsAt } from "../src/echo/flow";
import { pwNyquist, standardDoppler } from "../src/echo/doppler";
import { acquire } from "../src/echo/scan";
import { frameFor } from "../src/echo/paint";
import { frameAt } from "../src/echo/beat";
import { Tissue } from "../src/echo/tissue";
import { Part } from "../src/anatomy/heartSurface";

/**
 * Doppler on the simulated spectra, measured the way a sonographer measures, against the structural engine's own numbers: the echo
 * should read back the patient the engine solved.
 */
installCtHeartNode();
const poses = buildPoses();
const opts = (b: EchoBeat) => ({ asdOpen: b.heart.asdMm > 0, stenotic: { AV: b.heart.valves.av.openMax < 0.8, MV: b.heart.valves.mv.openMax < 0.8 } });
const beats: Record<string, EchoBeat> = {};
const beat = (id: string) => (beats[id] ??= beatOf(CASE_BY_ID[id]!));
const report = (id: string) => standardDoppler(beat(id), poses, opts(beat(id)));

describe("spectral Doppler measurements read back the engine's patient", () => {
  it("stroke volume from the LVOT VTI matches the engine's forward stroke volume within 10 %", () => {
    for (const id of ["normal", "as", "dcm"]) {
      const r = report(id), sv = beat(id).report.lvForwardMl;
      expect(Math.abs(r.lvot.strokeVolume - sv) / sv, id).toBeLessThan(0.1);
    }
  });
  it("a normal aortic valve peaks at 1 to 2 m/s with a valve area over 2 cm^2; calcific stenosis above 4 m/s, a mean gradient within 15 % of the engine's, an area under 1 cm^2", () => {
    const n = report("normal"), a = report("as"), engine = beat("as").report.valves.AV.meanGradient;
    expect(n.aortic.vmax).toBeGreaterThan(1); expect(n.aortic.vmax).toBeLessThan(2); expect(n.aortic.ava).toBeGreaterThan(2);
    expect(a.aortic.vmax).toBeGreaterThan(3.8);
    expect(Math.abs(a.aortic.meanGradient - engine) / engine).toBeLessThan(0.15);
    expect(a.aortic.ava).toBeLessThan(1);
  });
  it("mitral stenosis: a mean gradient within 15 % of the engine's", () => {
    const r = report("ms"), engine = beat("ms").report.valves.MV.meanGradient;
    expect(Math.abs(r.mitral.meanGradient - engine) / engine).toBeLessThan(0.15);
  });
  it("RV pressure from the tricuspid jet (4 v^2 + RA pressure) is within 15 % of the engine's RV systolic pressure", () => {
    const r = report("rv-overload"), engine = beat("rv-overload").report.pressure.RV.max;
    expect(r.tricuspid.rvsp).not.toBeNull();
    expect(Math.abs(r.tricuspid.rvsp! - engine) / engine).toBeLessThan(0.15);
  });
  it("filling: a normal heart has E/A over 1 and e' over 7 cm/s; dilated cardiomyopathy a restrictive pattern (E/A over 2, E/e' over 14)", () => {
    const n = report("normal"), d = report("dcm");
    expect(n.mitral.ea).toBeGreaterThan(1); expect(n.annulus.septalE * 100).toBeGreaterThan(7);
    expect(d.mitral.ea).toBeGreaterThan(2); expect(d.annulus.eOverEprime).toBeGreaterThan(14);
  });
  it("the PW Nyquist limit falls with depth (about 1.2 m/s at 10 cm for 2.5 MHz)", () => {
    expect(pwNyquist(100)).toBeCloseTo(1.19, 1);
    expect(pwNyquist(50)).toBeGreaterThan(pwNyquist(150));
  });
});

describe("color Doppler", () => {
  it("shows mitral regurgitation as a fast, turbulent jet into the left atrium in systole (aliased, with variance)", () => {
    const b = beat("mr"), t = 0.15 * b.period, pose = poses.a4c, fr = frameFor(pose, 0.9);
    const pol = acquire(pose, fr.depth, { heart: b.heart, frame: frameAt(b, t) }, { window: "apical", lines: 96, color: { jets: jetsAt(b.wave, t, opts(b)), box: { a0: -0.4, a1: 0.4, r0: 20, r1: fr.depth }, nyquist: 0.65 } });
    let la = 0, turbulent = 0;
    for (let i = 0; i < pol.colorU!.length; i++) {
      if (Number.isNaN(pol.colorU![i]) || pol.part[i] !== Part.LA || pol.tissue[i] !== Tissue.Blood) continue;
      la++; if (pol.colorVar![i] > 0.3) turbulent++;
    }
    expect(la).toBeGreaterThan(150);
    expect(turbulent / la).toBeGreaterThan(0.3);
  });
  it("shows no color in a normal left atrium in systole (no regurgitation)", () => {
    const b = beat("normal"), t = 0.15 * b.period, pose = poses.a4c, fr = frameFor(pose, 0.9);
    const pol = acquire(pose, fr.depth, { heart: b.heart, frame: frameAt(b, t) }, { window: "apical", lines: 96, color: { jets: jetsAt(b.wave, t, opts(b)), box: { a0: -0.4, a1: 0.4, r0: 20, r1: fr.depth }, nyquist: 0.65 } });
    let la = 0;
    for (let i = 0; i < pol.colorU!.length; i++) if (!Number.isNaN(pol.colorU![i]) && pol.part[i] === Part.LA && pol.colorVar![i] > 0.3) la++;
    expect(la).toBeLessThan(20);
  });
});
