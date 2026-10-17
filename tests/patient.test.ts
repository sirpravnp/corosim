import { describe, it, expect } from "vitest";
import { ALL_LEADS, LEAD_AXES, LEADS, POSTERIOR_GAIN, POSTERIOR_LEADS } from "../src/config/ecg";
import { Beat, generateBeats, sampleLeadsVec, stLevelVec } from "../src/physics/ecg";
import { Conduction, rhythmState } from "../src/physics/rhythm";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { bedSites } from "../src/physics/ecgLink";

const none: [number, number, number] = [0, 0, 0];
const beat = (bbb?: "rbbb" | "lbbb"): Beat => ({ t: 5, rr: 0.83, pvc: false, bbb });
const one = (b: Beat) => [b];
const at = (b: Beat, dt: number) => sampleLeadsVec(b.t + dt, one(b), none, 0);

describe("posterior leads", () => {
  it("add V7–V9 behind the twelve, pointing back and left, attenuated for the distance", () => {
    expect(ALL_LEADS).toHaveLength(15); expect(POSTERIOR_LEADS).toEqual(["V7", "V8", "V9"]);
    for (const l of POSTERIOR_LEADS) { const a = LEAD_AXES[l]; expect(Math.hypot(...a)).toBeCloseTo(POSTERIOR_GAIN, 2); expect(a[2]).toBeLessThan(-0.2); expect(a[0]).toBeGreaterThanOrEqual(0); }
    expect(LEAD_AXES.V9[2]).toBeLessThan(LEAD_AXES.V7[2]); // V9 is the most posterior
  });
  it("a normal beat is sampled in all fifteen leads, smaller round the back", () => {
    const s = at(beat(), 0);
    for (const l of ALL_LEADS) expect(Number.isFinite(s[l])).toBe(true);
    expect(s.V7).toBeLessThan(s.V6);
  });
});

describe("right bundle branch block", () => {
  const n = beat(), r = beat("rbbb");
  it("adds a late R' in V1 and a broad terminal S in I and V6, with the early QRS unchanged", () => {
    expect(at(r, 0.05).V1).toBeGreaterThan(at(n, 0.05).V1 + 0.4);
    expect(at(r, 0.05).I).toBeLessThan(at(n, 0.05).I - 0.3);
    expect(at(r, 0.05).V6).toBeLessThan(at(n, 0.05).V6 - 0.2);
    expect(at(r, 0).V6).toBeCloseTo(at(n, 0).V6, 1);
  });
  it("widens the QRS past 120 ms", () => {
    const width = (b: Beat) => { let first = 1, last = -1; for (let dt = -0.08; dt <= 0.14; dt += 0.002) { const s = at(b, dt); if (Math.hypot(s.I, s.aVF, s.V2) > 0.15) { first = Math.min(first, dt); last = Math.max(last, dt); } } return last - first; };
    expect(width(n)).toBeLessThan(0.1);
    expect(width(r)).toBeGreaterThan(0.12);
  });
  it("turns the T wave down in V1 and leaves the lateral ST near the baseline", () => {
    expect(at(r, 0.3).V1).toBeLessThan(at(n, 0.3).V1);
    expect(Math.abs(stLevelVec("V6", r, one(r), none, 0) * 10)).toBeLessThan(0.8);
  });
});

describe("left bundle branch block", () => {
  const n = beat(), l = beat("lbbb");
  it("has a QS in V1 and a tall broad R in I and V6, with no septal q", () => {
    expect(at(l, 0.015).V1).toBeLessThan(-0.6);
    expect(at(l, 0.015).V6).toBeGreaterThan(0.6);
    expect(at(l, -0.03).V6).toBeGreaterThanOrEqual(0); // no q
    expect(at(n, -0.03).V6).toBeLessThan(0); // the normal beat has one
  });
  it("puts discordant ST-T on every lead before any lesion: up in V1–V2, down in I and V6", () => {
    const st = (lead: "V1" | "V2" | "I" | "V6") => stLevelVec(lead, l, one(l), none, 0) * 10;
    expect(st("V1")).toBeGreaterThan(0.8); expect(st("V2")).toBeGreaterThan(0.5);
    expect(st("I")).toBeLessThan(-0.5); expect(st("V6")).toBeLessThan(-0.3);
    expect(at(l, 0.33).V6).toBeLessThan(0); expect(at(l, 0.33).V1).toBeGreaterThan(0); // T discordant too
  });
  it("still adds an injury current on top: an anterior injury lifts V2 further, Sgarbossa-style", () => {
    const inj: [number, number, number] = [0.05, -0.08, 0.15];
    expect(stLevelVec("V2", l, one(l), inj, 0)).toBeGreaterThan(stLevelVec("V2", l, one(l), none, 0) + 0.1);
  });
});

describe("atrial fibrillation", () => {
  const sites = bedSites(buildTree(TYPICAL));
  const calm = rhythmState(sites, {}, 0, { rhythm: "af", bbb: "none" });
  it("has no P waves and an irregularly irregular ventricular response around the AF rate", () => {
    const beats = new Conduction(3).advance(120, calm).filter((b) => !b.pvc);
    expect(beats.length).toBeGreaterThan(100);
    expect(beats.every((b) => b.noP)).toBe(true);
    const rr = beats.slice(1).map((b, i) => b.t - beats[i].t);
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length, sd = Math.sqrt(rr.reduce((a, x) => a + (x - mean) ** 2, 0) / rr.length);
    expect(60 / mean).toBeGreaterThan(80); expect(60 / mean).toBeLessThan(115);
    expect(sd / mean).toBeGreaterThan(0.15); // far beyond sinus arrhythmia
  });
  it("puts a fibrillatory baseline on the tracing between beats", () => {
    const quiet = sampleLeadsVec(2.0, [], none, 0, 0.035), flat = sampleLeadsVec(2.0, [], none, 0, 0);
    expect(flat.II).toBe(0);
    let peak = 0; for (let t = 0; t < 2; t += 0.004) peak = Math.max(peak, Math.abs(sampleLeadsVec(t, [], none, 0, 0.035).II));
    expect(peak).toBeGreaterThan(0.015); expect(peak).toBeLessThan(0.08);
    expect(Number.isFinite(quiet.V1)).toBe(true);
  });
  it("ignores the SA-node artery, slows with AV-node ischemia, and escapes regularly in complete block", () => {
    const san = rhythmState(sites, { "SAN#end": 1 }, 0, { rhythm: "af", bbb: "none" });
    expect(Math.abs(san.afRate - calm.afRate)).toBeLessThan(2); // its 0.5% of muscle counts as burden; nothing else
    expect(san.sinusRate).toBeLessThan(calm.sinusRate); // the sinus node did slow; nobody is listening
    const slow = rhythmState(sites, { "AVN#end": 0.6 }, 0, { rhythm: "af", bbb: "none" });
    expect(slow.afRate).toBeLessThan(calm.afRate * 0.7);
    const chb = rhythmState(sites, { "AVN#end": 1 }, 0, { rhythm: "af", bbb: "none" });
    const beats = new Conduction(4).advance(60, chb);
    expect(beats.every((b) => b.noP && !b.pOnly)).toBe(true);
    const rr = beats.slice(1).map((b, i) => b.t - beats[i].t);
    expect(Math.max(...rr) - Math.min(...rr)).toBeLessThan(0.1);
    expect(Math.abs(60 / rr[0] - chb.escapeRate)).toBeLessThan(2);
  });
  it("carries the bundle branch block onto every conducted beat, in either rhythm", () => {
    for (const rhythm of ["sinus", "af"] as const) {
      const st = rhythmState(sites, {}, 0, { rhythm, bbb: "lbbb" });
      const beats = new Conduction(5).advance(30, st).filter((b) => !b.pvc && !b.pOnly);
      expect(beats.length).toBeGreaterThan(20);
      expect(beats.every((b) => b.bbb === "lbbb")).toBe(true);
    }
    expect(generateBeats(10, () => 0).every((b) => b.bbb === undefined)).toBe(true);
  });
  it("the twelve standard leads are unchanged as a set", () => expect(LEADS).toHaveLength(12));
});
