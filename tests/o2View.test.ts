import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { o2Frame, o2Legend, myocardiumO2Color, tissueO2, vesselO2Color } from "../src/sim/o2View";
import { legendGradient, satColor } from "../src/structural/heartView";
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
  it("an occluded LAD territory is blue, other beds are not", () => {
    const f = o2Frame(sats({ bed: { "LAD#0": 0.3, "LAD#end": 0.3, "RCA#0": 0.75 } }));
    const base = new THREE.Color(0x884444);
    const lad = myocardiumO2Color(f, ["LAD#0", "LAD#end"], [0.5, 0.5], 1, base, new THREE.Color());
    const rca = myocardiumO2Color(f, ["RCA#0"], [1], 1, base, new THREE.Color());
    expect(hex(lad)).toBe(hex(satColor(0.3)));
    expect(lad.b).toBeGreaterThan(lad.r);
    expect(rca.r).toBeGreaterThan(lad.r);
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
    expect(o2Legend(f).mid).toMatch(/waiting/);
  });
  it("legend reuses the structural gradient, labels 60 % / 98 %, and notes the ischemia estimate", () => {
    const l = o2Legend(o2Frame(sats()));
    expect(l.gradient).toBe(legendGradient());
    expect([l.lo, l.hi]).toEqual(["60 %", "98 %"]);
    expect(l.mid).toBe("tissue O₂ estimated from ischemia");
    expect(o2Legend(o2Frame(sats({ bedSource: "supply-demand" }))).mid).toBe("");
  });
});
