import { describe, it, expect } from "vitest";
import { analyze, StructuralSpec } from "../src/physics/structural";
import { CIRC } from "../src/physics/circulation";

const adult = analyze({});
const neo = analyze({ patient: "neonate" });

describe("normal heart", () => {
  it("matches the existing resting patient (72 bpm, SV 70 ml, MAP 90, CO about 5 L/min)", () => {
    expect(adult.converged).toBe(true);
    expect(adult.hr).toBe(CIRC.baseRate);
    expect(Math.abs(adult.pressure.AO.mean - CIRC.baseMap)).toBeLessThan(1);
    expect(Math.abs(adult.lvStrokeMl - CIRC.baseStrokeVolume)).toBeLessThan(3);
    expect(Math.abs(adult.lvOutput - 5.04)).toBeLessThan(0.25);
    expect(adult.pressure.AO.max).toBeGreaterThan(100); expect(adult.pressure.AO.max).toBeLessThan(130);
    expect(adult.pressure.AO.min).toBeGreaterThan(60); expect(adult.pressure.AO.min).toBeLessThan(80);
    expect(adult.warnings).toEqual([]);
  });
  it("has normal right-heart pressures, saturations, resistances and no shunt", () => {
    expect(adult.pressure.PA.mean).toBeGreaterThan(9); expect(adult.pressure.PA.mean).toBeLessThan(20);
    expect(adult.pressure.RV.max).toBeGreaterThan(15); expect(adult.pressure.RV.max).toBeLessThan(35);
    expect(adult.pressure.RA.mean).toBeGreaterThan(2); expect(adult.pressure.RA.mean).toBeLessThan(8);
    expect(adult.pressure.LA.mean).toBeGreaterThan(5); expect(adult.pressure.LA.mean).toBeLessThan(12);
    expect(adult.saturation.SVC).toBeGreaterThan(0.6); expect(adult.saturation.SVC).toBeLessThan(0.8);
    expect(adult.svr).toBeGreaterThan(12); expect(adult.svr).toBeLessThan(22);
    expect(adult.pvr).toBeLessThan(2);
    expect(Math.abs(adult.rightToLeft) + Math.abs(adult.leftToRight)).toBeLessThan(0.05);
    expect(adult.qpQs).toBeCloseTo(1, 2);
  });
  it("ejects for 250 to 320 ms and has small gradients across its valves", () => {
    expect(adult.valves.AV.openMs).toBeGreaterThan(250); expect(adult.valves.AV.openMs).toBeLessThan(320);
    expect(adult.valves.AV.meanGradient).toBeLessThan(8);
    expect(adult.valves.PVL.peakGradient).toBeLessThan(10);
    expect(adult.valves.MV.peakGradient).toBeLessThan(6);
    expect(adult.valves.TV.peakGradient).toBeLessThan(4);
  });
  it("a newborn has a fast rate, a low pressure and about 200 ml/kg/min", () => {
    expect(neo.hr).toBe(140);
    expect(Math.abs(neo.pressure.AO.mean - 48)).toBeLessThan(2);
    const perKg = (neo.lvOutput * 1000) / 3.5;
    expect(perKg).toBeGreaterThan(160); expect(perKg).toBeLessThan(240);
    expect(neo.warnings).toEqual([]);
  });
  it("conserves flow: the LV ejects what the RV does plus the bronchial return (1 % of the output), and the lungs pass what the body does", () => {
    // bronchial/Thebesian blood goes aorta -> pulmonary veins: it passes the LV but not the lungs, so LV = RV + BRON (D6b)
    const bron = adult.lvForwardMl - adult.rvForwardMl;
    expect(bron).toBeGreaterThan(0.005 * adult.rvForwardMl); expect(bron).toBeLessThan(0.02 * adult.rvForwardMl);
    expect(Math.abs(adult.lvOutput - adult.qs - (adult.lvForwardMl - adult.rvForwardMl) * adult.hr / 1000)).toBeLessThan(0.02);
    expect(Math.abs(adult.qp - adult.qs)).toBeLessThan(0.02);
  });
});

describe("overrides change only what they name", () => {
  it("a slower or faster heart keeps its resistance; output and pressure follow the rate", () => {
    const slow = analyze({ hr: 40 }), fast = analyze({ hr: 150 });
    expect(slow.svr).toBeCloseTo(adult.svr, 0); expect(fast.svr).toBeCloseTo(adult.svr, 0);
    expect(slow.lvOutput).toBeLessThan(adult.lvOutput * 0.8); expect(slow.pressure.AO.mean).toBeLessThan(75);
    expect(fast.lvStrokeMl).toBeLessThan(adult.lvStrokeMl); // less filling time
  });
  it("raising pulmonary resistance leaves the ventricle's design and the blood volume alone", () => {
    const hi = analyze({ patient: "neonate", pvri: 30 });
    expect(hi.bloodVolume).toBeCloseTo(neo.bloodVolume, 3);
    expect(hi.pvri).toBeGreaterThan(neo.pvri * 3);
    expect(hi.pressure.RV.max).toBeLessThan(neo.pressure.RV.max * 2.2); // the RV is the same muscle, so it cannot reach any pressure the lungs ask for
  });
  it("blood volume is conserved across lesions", () => {
    for (const s of [{ pda: { diameterMm: 4 } }, { asd: { diameterMm: 12 } }, { tof: { vsdMm: 8, rvotFrac: 0.15 } }] as StructuralSpec[])
      expect(analyze({ patient: "neonate", ...s }).bloodVolume).toBeCloseTo(neo.bloodVolume, 3);
  });
});

describe("Gorlin orifice", () => {
  it("a tighter aortic valve needs a larger gradient for the same flow, and 1.0 cm² gives a moderate-to-severe mean gradient", () => {
    const g = (area: number) => analyze({ valves: { av: { open: area / 3.8 } } }).valves.AV.meanGradient;
    expect(g(1.5)).toBeGreaterThan(g(3.8)); expect(g(1.0)).toBeGreaterThan(g(1.5));
    expect(g(1.0)).toBeGreaterThan(25); expect(g(1.0)).toBeLessThan(50);
  });
});

describe("circulations that cannot work say so", () => {
  it("tricuspid atresia with no atrial or ventricular communication", () => {
    const r = analyze({ patient: "neonate", valves: { tv: { open: 0 } } });
    expect(r.warnings.join(" ")).toMatch(/cannot sustain life/);
    expect(r.warnings.join(" ")).toMatch(/No blood reaches RV/);
    expect(Number.isNaN(r.saturation.RV)).toBe(true);
  });
  it("tricuspid atresia with an ASD but no way to the lungs is still incompatible with life", () => {
    const r = analyze({ patient: "neonate", valves: { tv: { open: 0 } }, asd: { diameterMm: 6 } });
    expect(r.warnings.join(" ")).toMatch(/reaches the lungs/);
  });
  it("with the ASD and a VSD it is survivable: the whole venous return crosses the atria, the lungs fill through the VSD, and the baby is blue; a smaller VSD is bluer with less lung flow", () => {
    const tri = (vsd: number) => analyze({ patient: "neonate", valves: { tv: { open: 0 } }, asd: { diameterMm: 6 }, vsd: { diameterMm: vsd } });
    const big = tri(4), small = tri(2.5);
    expect(big.warnings).toEqual([]); expect(small.warnings).toEqual([]);
    expect(big.shunt.asd).toBeLessThan(0); // right to left at the atria
    expect(big.rightToLeft).toBeGreaterThan(0.08);
    expect(big.saturation.AO).toBeLessThan(0.9);
    expect(small.saturation.AO).toBeLessThan(big.saturation.AO - 0.05);
    expect(small.qp).toBeLessThan(big.qp);
  });
});

describe("patent ductus arteriosus", () => {
  const pda = (mm: number, pvri: number) => analyze({ patient: "neonate", pvri, pda: { diameterMm: mm } });
  it("shunts left to right when pulmonary resistance has fallen, more through a bigger duct", () => {
    const a = pda(3, 2), b = pda(5, 2);
    expect(a.qpQs).toBeGreaterThan(1.5); expect(b.qpQs).toBeGreaterThan(a.qpQs);
    expect(a.shunt.pda).toBeGreaterThan(0); expect(a.leftToRight).toBeGreaterThan(0.2);
  });
  it("lowers the diastolic pressure and raises the pulse pressure", () => {
    const a = pda(4, 2);
    expect(a.pressure.AO.min).toBeLessThan(neo.pressure.AO.min - 5);
    expect(a.pressure.AO.max - a.pressure.AO.min).toBeGreaterThan(neo.pressure.AO.max - neo.pressure.AO.min);
  });
  it("volume-loads the left heart", () => {
    const a = pda(4, 2);
    expect(a.pressure.LA.mean).toBeGreaterThan(neo.pressure.LA.mean + 2);
    expect(a.lvForwardMl).toBeGreaterThan(neo.lvForwardMl * 1.3);
  });
  it("with very high pulmonary resistance (persistent pulmonary hypertension of the newborn) the shunt reverses and the lower body is bluer than the upper", () => {
    const hi = pda(5, 30);
    expect(hi.shunt.pda).toBeLessThan(0);
    expect(hi.postductalSat).toBeLessThan(hi.preductalSat - 0.1);
  });
});

describe("tetralogy of Fallot", () => {
  const tof = (over: Partial<NonNullable<StructuralSpec["tof"]>> = {}, svr?: number) =>
    analyze({ patient: "neonate", svrScale: svr, tof: { vsdMm: 8, rvotFrac: 0.15, ...over } });
  const base = tof();
  it("is cyanotic, with equal ventricular pressures, a gradient across the outflow and a right-to-left shunt", () => {
    expect(base.saturation.AO).toBeLessThan(0.92); expect(base.saturation.AO).toBeGreaterThan(0.75);
    expect(Math.abs(base.pressure.RV.max - base.pressure.LV.max)).toBeLessThan(2);
    expect(base.valves.PVL.peakGradient).toBeGreaterThan(20);
    expect(base.rightToLeft).toBeGreaterThan(0.1);
    expect(base.pressure.PA.mean).toBeLessThan(neo.pressure.PA.mean);
  });
  it("a spell: tightening the outflow drops the saturation sharply and the pulmonary flow with it", () => {
    const sp = tof({ spasm: 0.8 });
    expect(sp.saturation.AO).toBeLessThan(base.saturation.AO - 0.1);
    expect(sp.qp).toBeLessThan(base.qp * 0.7);
  });
  it("a fall in systemic resistance increases the right-to-left shunt", () => {
    expect(tof({}, 0.6).rightToLeft).toBeGreaterThan(base.rightToLeft * 1.3);
  });
  it("knees to chest or a pressor (higher systemic resistance) cuts the right-to-left shunt and raises saturation a little; relieving the obstruction raises it more", () => {
    const up = tof({}, 1.6);
    expect(up.rightToLeft).toBeLessThan(base.rightToLeft * 0.8);
    expect(up.saturation.AO).toBeGreaterThan(base.saturation.AO + 0.005);
    expect(tof({ rvotFrac: 0.5 }).saturation.AO).toBeGreaterThan(base.saturation.AO + 0.04);
  });
});

describe("oxygen balance", () => {
  const cases: StructuralSpec[] = [
    {}, { patient: "neonate" }, { patient: "neonate", pvri: 2, pda: { diameterMm: 4 } },
    { patient: "neonate", pvri: 30, pda: { diameterMm: 5 } }, { patient: "neonate", tof: { vsdMm: 8, rvotFrac: 0.15 } },
    { asd: { diameterMm: 12 } }, { patient: "neonate", asd: { diameterMm: 20 } },
  ];
  it("Qp:Qs by oxygen (Fick, each bed's own content) agrees with Qp:Qs by flow. This checks the bookkeeping, not an independent model.", () => {
    for (const s of cases) {
      const r = analyze(s);
      expect(Math.abs(r.qpQsFick - r.qpQs) / r.qpQs).toBeLessThan(0.05);
      expect(r.warnings).toEqual([]);
    }
  });
  it("an ASD shunts left to right and loads the right heart", () => {
    const r = analyze({ asd: { diameterMm: 12 } });
    expect(r.shunt.asd).toBeGreaterThan(0); expect(r.qpQs).toBeGreaterThan(1.2);
    expect(r.rvForwardMl).toBeGreaterThan(adult.rvForwardMl * 1.2);
  });
});
