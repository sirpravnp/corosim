import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIVE_SOURCE } from "../src/config/liveSource";
import { o2Frame, o2Legend, myocardiumO2Color, tissueO2, tissueRelative, vesselO2Color } from "../src/sim/o2View";
import { SAT_RANGE, legendGradient, satColor } from "../src/structural/heartView";
import type { Saturations } from "../src/sim/hemoSource";

const sats = (over: Partial<Saturations> = {}): Saturations => ({
  node: { AO: 0.97 } as Saturations["node"], spo2: 0.97, preductal: 0.97, postductal: 0.97, svo2: 0.7, do2: 1000, vo2: 250, lactate: NaN,
  bed: { "LAD#0": 0.75, "LAD#end": 0.75, "RCA#0": 0.75 }, bedSource: "ischemia-derived", ...over,
});
const hex = (c: THREE.Color) => c.getHexString();

describe("O2 sat view colours", () => {
  it("a normal patient has uniformly red vessels (the scale's top end)", () => {
    const c = vesselO2Color(o2Frame(sats()), new THREE.Color());
    expect(hex(c)).toBe(hex(satColor(0.97)));
    expect(c.r).toBeGreaterThan(c.b);
  });
  it("a right-to-left shunt lowers the vessel colour toward blue", () => {
    const norm = vesselO2Color(o2Frame(sats()), new THREE.Color()), low = vesselO2Color(o2Frame(sats({ preductal: 0.7 })), new THREE.Color());
    expect(low.b).toBeGreaterThan(norm.b);
    expect(low.r).toBeLessThan(norm.r);
  });
  it("falls back to the AO node when pre-ductal is missing", () => {
    expect(o2Frame(sats({ preductal: NaN })).arterial).toBe(0.97);
  });
  it("a normal heart has red myocardium and red vessels", () => {
    const f = o2Frame(sats()), base = new THREE.Color(0x884444);
    const m = myocardiumO2Color(f, ["LAD#0", "RCA#0"], [0.5, 0.5], 1, base, new THREE.Color());
    expect(hex(m)).toBe(hex(satColor(SAT_RANGE.hi)));
    expect(m.r).toBeGreaterThan(m.b);
    expect(vesselO2Color(f, new THREE.Color()).r).toBeGreaterThan(vesselO2Color(f, new THREE.Color()).b);
  });
  it("an occluded LAD territory is blue and the other beds stay red (floor = placeholder at severity 1)", () => {
    const { base, slope } = LIVE_SOURCE.bedOxygen;
    const f = o2Frame(sats({ bed: { "LAD#0": base - slope, "LAD#end": base - slope, "RCA#0": base } }));
    const m = new THREE.Color(0x884444);
    const lad = myocardiumO2Color(f, ["LAD#0", "LAD#end"], [0.5, 0.5], 1, m, new THREE.Color());
    const rca = myocardiumO2Color(f, ["RCA#0"], [1], 1, m, new THREE.Color());
    expect(hex(lad)).toBe(hex(satColor(SAT_RANGE.lo)));
    expect(hex(rca)).toBe(hex(satColor(SAT_RANGE.hi)));
    expect(lad.b).toBeGreaterThan(lad.r);
  });
  it("mid ischemia lies between, relative to the patient's own normal", () => {
    const f = o2Frame(sats(), 0.8, 0.4);
    expect(tissueRelative(f, 0.6)).toBeCloseTo(0.5);
    expect(tissueRelative(f, 0.1)).toBe(0);
    expect(tissueRelative(f, 0.9)).toBe(1);
  });
  it("mixes beds by weight, skips beds with no value, and fades to muscle colour away from beds", () => {
    const f = o2Frame(sats());
    expect(tissueO2(f, ["LAD#0", "SAN#0"], [0.5, 0.5])).toBeCloseTo(0.75);
    expect(Number.isNaN(tissueO2(f, ["SAN#0"], [1]))).toBe(true);
    const base = new THREE.Color(0x884444);
    expect(hex(myocardiumO2Color(f, ["LAD#0"], [1], 0, base, new THREE.Color()))).toBe(hex(base));
  });
  it("before the first solve everything is grey with a waiting note", () => {
    const f = o2Frame(sats({ preductal: NaN, node: {} as Saturations["node"], bed: {} }));
    expect(f.ready).toBe(false);
    const grey = hex(satColor(NaN));
    expect(hex(vesselO2Color(f, new THREE.Color()))).toBe(grey);
    expect(hex(myocardiumO2Color(f, ["LAD#0"], [1], 1, new THREE.Color(0x884444), new THREE.Color()))).toBe(grey);
    expect(o2Legend(f).note).toMatch(/waiting/);
  });
  it("legend has two rows: blood SaO2 60-98 % on the structural gradient, and tissue O2 ischemic-normal, with the note apart", () => {
    const l = o2Legend(o2Frame(sats()));
    expect(l.blood.gradient).toBe(legendGradient());
    expect(l.tissue.gradient).toBe(legendGradient());
    expect([l.blood.lo, l.blood.mid, l.blood.hi]).toEqual(["60 %", "blood SaO₂", "98 %"]);
    expect([l.tissue.lo, l.tissue.mid, l.tissue.hi]).toEqual(["ischemic", "tissue O₂", "normal"]);
    expect(l.note).toBe("tissue O₂ estimated from ischemia");
    expect(o2Legend(o2Frame(sats({ bedSource: "supply-demand" }))).note).toBe("");
  });
});
