import { describe, it, expect } from "vitest";
import { LEADS, LEAD_AXES, ISCHEMIA } from "../src/config/ecg";
import { generateBeats, sampleLeads, stLevel, synthesize, heartRate } from "../src/physics/ecg";
import { severityTarget, stepSeverity } from "../src/physics/ischemia";
import { occludedFlow, defaultPatient, restingFlow, hyperemicFlow, minResistance } from "../src/physics/hemodynamics";
import { defaultLesion, lesionProfile, stentedProfile } from "../src/physics/geometry";
import { LESION } from "../src/config/anatomy";

const ref = LESION.referenceDiameter;
const prof = (ds: number) => lesionProfile({ ...defaultLesion(), diameterStenosis: ds });
const calm = generateBeats(20, () => 0, 1);
const sinus = calm[5];
const stmm = (lead: (typeof LEADS)[number], s: number, terr: "LAD" | "RCA" | "LCx" = "LAD") => {
  const bs = generateBeats(20, () => s, 1).filter((b) => !b.pvc);
  return stLevel(lead, bs[4], bs, s, terr) * 10; // mV → mm
};

describe("lead geometry", () => {
  it("satisfies Einthoven (II = I + III) and the augmented-limb sum (aVR + aVL + aVF = 0)", () => {
    const s = sampleLeads(sinus.t, calm, 0);
    expect(s.II).toBeCloseTo(s.I + s.III, 9);
    expect(s.aVR + s.aVL + s.aVF).toBeCloseTo(0, 9);
    for (let k = 0; k < 3; k++) expect(LEAD_AXES.II[k]).toBeCloseTo(LEAD_AXES.I[k] + LEAD_AXES.III[k], 9);
  });
  it("has all 12 leads", () => expect(LEADS).toHaveLength(12));
});

describe("normal sinus morphology", () => {
  const atR = sampleLeads(sinus.t, calm, 0);
  it("has an upright QRS in I, II, aVF, V5, V6 and inverted in aVR", () => {
    for (const l of ["I", "II", "aVF", "V5", "V6"] as const) expect(atR[l]).toBeGreaterThan(0.3);
    expect(atR.aVR).toBeLessThan(0);
  });
  it("shows R-wave progression: V1→V6 rises monotonically, negative in V1, positive in V6", () => {
    const v = (["V1", "V2", "V3", "V4", "V5", "V6"] as const).map((l) => atR[l]);
    v.forEach((x, i) => i && expect(x).toBeGreaterThan(v[i - 1]));
    expect(v[0]).toBeLessThan(0);
    expect(v[5]).toBeGreaterThan(0);
  });
  it("has an isoelectric ST segment in every lead", () => {
    for (const l of LEADS) expect(Math.abs(stLevel(l, sinus, calm, 0))).toBeLessThan(0.03);
  });
  it("T wave is upright in I, II and V2–V6", () => {
    const tPeak = sampleLeads(sinus.t + 0.27, calm, 0);
    for (const l of ["I", "II", "V3", "V4", "V5", "V6"] as const) expect(tPeak[l]).toBeGreaterThan(0.05);
  });
});

describe("rate", () => {
  it("beat count matches heart rate within 5%", () => {
    const b = generateBeats(60, () => 0, 3);
    expect(b.length).toBeGreaterThan(72 * 0.95);
    expect(b.length).toBeLessThan(72 * 1.05);
  });
  it("heart rate rises with ischemia", () => expect(heartRate(1)).toBeGreaterThan(heartRate(0)));
  it("is deterministic for a given seed", () => {
    expect(generateBeats(30, () => 0.8, 7)).toEqual(generateBeats(30, () => 0.8, 7));
  });
});

describe("ischemia → ST by culprit territory", () => {
  it("LAD severe: V2 elevation ≈ 4 mm (3–5), V1–V4 and aVL up, inferior leads reciprocal down", () => {
    expect(stmm("V2", 1)).toBeGreaterThan(3);
    expect(stmm("V2", 1)).toBeLessThan(5);
    for (const l of ["V1", "V3", "V4", "aVL"] as const) expect(stmm(l, 1)).toBeGreaterThan(1.5);
    for (const l of ["II", "III", "aVF"] as const) expect(stmm(l, 1)).toBeLessThan(-1);
  });
  it("RCA: inferior elevation with III > II, reciprocal aVL depression", () => {
    expect(stmm("III", 1, "RCA")).toBeGreaterThan(stmm("II", 1, "RCA"));
    expect(stmm("II", 1, "RCA")).toBeGreaterThan(2);
    expect(stmm("aVL", 1, "RCA")).toBeLessThan(-1);
  });
  it("LCx: posterior pattern – V1–V3 depression with lateral elevation", () => {
    for (const l of ["V1", "V2"] as const) expect(stmm(l, 1, "LCx")).toBeLessThan(-1.5);
    expect(stmm("V6", 1, "LCx")).toBeGreaterThan(1);
  });
  it("ST grows monotonically with severity", () => {
    const v = [0, 0.25, 0.5, 0.75, 1].map((s) => stmm("V2", s));
    v.forEach((x, i) => i && expect(x).toBeGreaterThan(v[i - 1]));
  });
});

describe("PVCs", () => {
  it("do not occur at low severity, and appear at high severity", () => {
    expect(generateBeats(120, () => 0.3, 5).some((b) => b.pvc)).toBe(false);
    expect(generateBeats(120, () => 1, 5).some((b) => b.pvc)).toBe(true);
  });
  it("are premature with a wide, tall QRS", () => {
    const b = generateBeats(120, () => 1, 5);
    const i = b.findIndex((x) => x.pvc);
    expect(b[i].t - b[i - 1].t).toBeLessThan(b[i - 1].rr);
    const peak = (beat: (typeof b)[number], l: (typeof LEADS)[number]) => {
      let m = 0;
      for (let k = -0.05; k < 0.2; k += 0.004) m = Math.max(m, Math.abs(sampleLeads(beat.t + k, [beat], 0)[l]));
      return m;
    };
    expect(peak(b[i], "II")).toBeGreaterThan(peak(b[i - 1], "II"));
  });
});

describe("ischemia dynamics", () => {
  it("reaches full severity in ≈20 s of occlusion and decays with τ ≈ 8 s", () => {
    let s = 0;
    for (let t = 0; t < ISCHEMIA.riseSeconds; t += 0.1) s = stepSeverity(s, 1, 0.1);
    expect(s).toBeCloseTo(1, 1);
    let r = 1;
    for (let t = 0; t < ISCHEMIA.recoveryTau; t += 0.05) r = stepSeverity(r, 0, 0.05);
    expect(r).toBeCloseTo(Math.exp(-1), 2);
  });
  it("severityTarget: 0 when supply ≥ demand, 1 at the configured ratio", () => {
    expect(severityTarget(1, 1)).toBe(0);
    expect(severityTarget(1.5, 1)).toBe(0);
    expect(severityTarget(0.4, 1)).toBeCloseTo(1, 6);
    expect(severityTarget(0, 1)).toBe(1);
  });
});

describe("hemodynamics → ECG link", () => {
  const pt = defaultPatient();
  it("a resting patient with a 90% lesion and autoregulation reserve shows no ischemia at rest if bed is fed", () => {
    expect(severityTarget(restingFlow(prof(0.7), ref, pt).Qbed, pt.restingFlow)).toBe(0);
  });
  it("balloon occlusion with no collaterals gives zero supply → full severity", () => {
    const o = occludedFlow(pt);
    expect(o.Q).toBe(0);
    expect(severityTarget(o.Qbed, pt.restingFlow)).toBe(1);
  });
  it("collaterals soften occlusion", () => {
    const o = occludedFlow({ ...pt, collateralConductanceFrac: 0.6 });
    expect(o.Qbed).toBeGreaterThan(0);
    expect(severityTarget(o.Qbed, pt.restingFlow)).toBeLessThan(1);
  });
  it("exertion (demand 2.5× rest) is ischemic with the untreated lesion and fixed by a stent", () => {
    const demand = pt.restingFlow * 2.5;
    const before = severityTarget(hyperemicFlow(prof(0.7), ref, pt).Qbed, demand);
    const after = severityTarget(hyperemicFlow(stentedProfile(prof(0.7), 3.0e-3), ref, pt).Qbed, demand);
    expect(before).toBeGreaterThan(0.3);
    expect(after).toBeLessThan(before);
  });
  it("sanity: min resistance is positive", () => expect(minResistance(pt)).toBeGreaterThan(0));
});

describe("synthesize", () => {
  it("returns the 12 standard and 3 posterior channels, equal length, at the requested rate", () => {
    const r = synthesize({ seconds: 4, fs: 250, severity: () => 0 });
    expect(Object.keys(r.leads)).toHaveLength(15);
    for (const l of LEADS) expect(r.leads[l]).toHaveLength(1000);
  });
  it("occlusion then reperfusion: V2 ST rises then falls back", () => {
    const sev = (t: number) => (t < 25 ? Math.min(1, t / 20) : Math.max(0, Math.exp(-(t - 25) / 8)));
    const bs = generateBeats(90, sev, 2).filter((b) => !b.pvc);
    const at = (t: number) => {
      const b = bs.reduce((p, c) => (Math.abs(c.t - t) < Math.abs(p.t - t) ? c : p));
      return stLevel("V2", b, bs, sev(b.t)) * 10;
    };
    expect(at(2)).toBeLessThan(0.5);
    expect(at(24)).toBeGreaterThan(3);
    expect(at(70)).toBeLessThan(0.5);
  });
});
