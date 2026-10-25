import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { BridgeSource } from "../src/sim/bridgeSource";
import { decodePatient, encodePatient } from "../src/sim/llm";
import { normalizePatient } from "../src/sim/patient";
import { PRESETS } from "../src/sim/presets";
import { buildPlaygroundSpec, patchDevice, patchSection, stateOfSpec, withBolus, withDevice, hasPlaygroundFields, heartOfPick, GROUP_INFO } from "../src/sim/playground";

vi.setConfig({ testTimeout: 120_000 });

describe("spec builder", () => {
  it("a normal adult is the Scenario alone, with the device switches off", () => {
    const { spec, warnings } = buildPlaygroundSpec({ seed: 3 }, {});
    expect(warnings).toEqual([]);
    expect(spec.kind).toBeUndefined(); expect(spec.heart).toBeUndefined(); expect(spec.devices).toBeUndefined();
    expect(spec.support).toMatchObject({ impella: false, iabp: false });
    expect(spec.seed).toBe(3);
  });
  it("a lesion pick builds heart without patient and hr; the picker wins over a stored heart", () => {
    expect(heartOfPick({ id: "mr", values: { severity: 1 } })?.valves?.mv?.reg).toBeGreaterThan(0.3);
    const { spec } = buildPlaygroundSpec({}, { structural: { id: "vsd", values: { diameter: 6 } }, heart: { valves: { av: { open: 0.5 } } }, kind: "neonate" });
    expect(spec.heart).toMatchObject({ vsd: { diameterMm: 6 }, pvri: 2 });
    expect(spec.heart).not.toHaveProperty("patient"); expect(spec.heart).not.toHaveProperty("hr"); expect(spec.heart?.valves).toBeUndefined();
    expect(buildPlaygroundSpec({}, { structural: { id: "normal", values: {} } }).spec.heart).toBeUndefined();
  });
  it("every group of controls lands in its own PatientSpec field", () => {
    let st = patchSection({}, "pericardium", { effusionMl: 300, stiffness: 2, open: false });
    st = patchSection(st, "ventilation", { mode: "positive", peep: 8 });
    st = withBolus(st, "blood", 500);
    st = patchSection(st, "fluids", { hemorrhageMlMin: 40 });
    st = patchDevice(st, "impella", { model: "5.5", level: 3, position: "deep" });
    st = patchDevice(st, "iabp", { ratio: 2 });
    st = patchDevice(st, "ecmo", { flowLpm: 4.5, sweepLpm: 3, fio2: 0.8 });
    const { spec, warnings } = buildPlaygroundSpec({ lesions: [{ artery: "LAD", stenosis: 0.8 }] }, st);
    expect(warnings).toEqual([]);
    expect(spec.pericardium).toEqual({ effusionMl: 300, stiffness: 2, open: false });
    expect(spec.ventilation).toEqual({ mode: "positive", peep: 8 });
    expect(spec.fluids).toEqual({ given: [{ kind: "blood", ml: 500 }], hemorrhageMlMin: 40 });
    expect(spec.devices?.impella).toMatchObject({ model: "5.5", level: 3, position: "deep" });
    expect(spec.devices?.iabp).toMatchObject({ ratio: 2, volumeMl: 40 });
    expect(spec.devices?.ecmo).toEqual({ flowLpm: 4.5, sweepLpm: 3, fio2: 0.8 });
    expect(spec.support).toMatchObject({ impella: true, iabp: true }); // the legacy model follows the switches
    expect(spec.lesions).toHaveLength(1);
  });
  it("switching a device off removes its settings and its legacy boolean", () => {
    const on = withDevice({}, "impella", true);
    expect(on.devices?.impella).toMatchObject({ model: "CP", level: 6 });
    const off = withDevice(on, "impella", false);
    expect(off.devices).toBeUndefined();
    expect(buildPlaygroundSpec({ support: { impella: true } }, off).spec.support?.impella).toBe(false);
  });
  it("a bolus of 0 ml removes it and keeps later doses", () => {
    expect(withBolus(withBolus({}, "colloid", 250), "colloid", 0).fluids).toBeUndefined();
    const two = { fluids: { given: [{ kind: "blood" as const, ml: 100 }, { kind: "albumin" as const, ml: 200 }] } };
    expect(withBolus(two, "crystalloid", 300).fluids?.given).toEqual([{ kind: "crystalloid", ml: 300 }, { kind: "albumin", ml: 200 }]);
    expect(withBolus(two, "blood", 0).fluids?.given).toEqual([{ kind: "albumin", ml: 200 }]);
  });
  it("out-of-range values are clamped and reported by normalisation", () => {
    const { spec, warnings } = buildPlaygroundSpec({}, { ventilation: { peep: 99 }, pericardium: { effusionMl: 5000 } });
    expect(spec.ventilation?.peep).toBe(25); expect(spec.pericardium?.effusionMl).toBe(2000);
    expect(warnings.join(";")).toMatch(/peep clamped/); expect(warnings.join(";")).toMatch(/effusionMl clamped/);
  });
  it("is pure: the inputs are not changed", () => {
    const sc = { lesions: [{ artery: "LAD", stenosis: 0.8 }], support: { impella: true } }, st = { kind: "neonate" as const, devices: { iabp: { ratio: 2 as const } } };
    const a = JSON.stringify([sc, st]);
    buildPlaygroundSpec(sc, st);
    expect(JSON.stringify([sc, st])).toBe(a);
  });
  it("stateOfSpec folds the legacy booleans into devices and rebuilds the same spec", () => {
    const st = stateOfSpec({ support: { iabp: true }, pericardium: { effusionMl: 100 } });
    expect(st.devices?.iabp).toMatchObject({ ratio: 1, volumeMl: 40 });
    const { spec } = buildPlaygroundSpec({ support: { iabp: true } }, st);
    expect(spec.pericardium).toEqual({ effusionMl: 100 }); expect(spec.support?.iabp).toBe(true);
    expect(hasPlaygroundFields({ lesions: [] })).toBe(false); expect(hasPlaygroundFields({ kind: "adult" })).toBe(true);
  });
  it("says which groups the engines do not read yet", () => {
    for (const g of ["pericardium", "fluids", "ventilation", "ecmo"]) expect(GROUP_INFO[g].modelled).toBe("no");
    for (const g of ["kind", "heart"]) expect(GROUP_INFO[g].modelled).toBe("yes");
    for (const g of ["impella", "iabp"]) expect(GROUP_INFO[g].modelled).toBe("legacy");
  });
});

describe("neonates have no coronary view", () => {
  it("a neonate drops coronary lesions with a warning, whatever the scenario carries", () => {
    const { spec, warnings } = buildPlaygroundSpec({ lesions: [{ artery: "LAD", occluded: true }, { artery: "RCA", stenosis: 0.7 }] }, { kind: "neonate", heart: { vsd: { diameterMm: 5 } } });
    expect(spec.kind).toBe("neonate"); expect(spec.lesions).toBeUndefined();
    expect(warnings.join(";")).toMatch(/neonate has no coronary tree: 2 coronary lesions were dropped/);
    expect(spec.heart).toEqual({ vsd: { diameterMm: 5 } });
  });
  it("an adult keeps them and no warning is made", () => {
    const { spec, warnings } = buildPlaygroundSpec({ lesions: [{ artery: "LAD", occluded: true }] }, { kind: "adult" });
    expect(spec.lesions).toHaveLength(1); expect(warnings).toEqual([]);
  });
  it("every neonate preset carries no coronary lesion, and adding one gets it dropped with a warning", () => {
    const neonates = PRESETS.filter((p) => p.spec.kind === "neonate");
    expect(neonates.length).toBeGreaterThanOrEqual(2);
    for (const p of neonates) {
      expect(p.spec.lesions ?? []).toEqual([]);
      const withLesion = { ...p.spec, lesions: [{ artery: "LAD", occluded: true }] };
      const { spec, warnings } = buildPlaygroundSpec(withLesion, stateOfSpec(withLesion));
      expect(spec.lesions).toBeUndefined(); expect(warnings.some((w) => /neonate has no coronary tree/.test(w))).toBe(true);
    }
  });
});

describe("presets", () => {
  it("has the required patients, with unique ids", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["anterior-stemi", "inferior-stemi-rv", "stemi-mr", "shock-impella", "tamponade", "severe-as", "vsd-neonate", "tof", "hemorrhage-fluids", "va-ecmo-poor-lv"]) expect(ids).toContain(id);
  });
  it("the ischemic MR preset sets heart.valves.mv.reg on top of the LAD occlusion", () => {
    const p = PRESETS.find((x) => x.id === "stemi-mr")!.spec;
    expect(p.heart?.valves?.mv?.reg).toBeGreaterThan(0); expect(p.lesions?.[0]).toMatchObject({ artery: "LAD", occluded: true });
  });
  for (const p of PRESETS) {
    it(`${p.id}: normalises without warnings and round-trips through a share link`, () => {
      expect(normalizePatient(p.spec).warnings).toEqual([]);
      const built = buildPlaygroundSpec(p.spec, stateOfSpec(p.spec));
      expect(built.warnings).toEqual([]);
      const back = decodePatient(encodePatient(built.spec));
      expect(back).toEqual(built.spec);
      expect(normalizePatient(back).spec).toEqual(normalizePatient(built.spec).spec);
      // loading the built spec into the controls and building again changes nothing
      expect(buildPlaygroundSpec(back, stateOfSpec(back)).spec).toEqual(built.spec);
    });
    it(`${p.id}: the bridge solve converges (sync solver)`, () => {
      const built = buildPlaygroundSpec(p.spec, stateOfSpec(p.spec)).spec;
      const sim = new Simulation(); sim.reset({ seed: 3, ...built }, { settled: true }); sim.warmup(30);
      const bridge = new BridgeSource(sim, { patient: built });
      const t0 = performance.now();
      bridge.refresh();
      const ms = performance.now() - t0, n = bridge.numbers();
      expect(bridge.solves).toBe(1);
      expect(ms).toBeLessThan(10_000);
      for (const v of [n.map, n.co, n.cvp, n.pcwp, n.hr, n.systolic, n.diastolic]) expect(Number.isFinite(v)).toBe(true);
      expect(n.co).toBeGreaterThan(0);
      if (built.kind === "neonate") { // the adult monitor does not describe a neonate: one uncalibrated solve, in neonatal ranges
        expect(bridge.analyzeCalls).toBe(1);
        expect(n.co).toBeLessThan(2); expect(n.map).toBeGreaterThan(25); expect(n.map).toBeLessThan(100); expect(n.cvp).toBeLessThan(15);
      } else {
        expect(Math.abs(bridge.calibrationError)).toBeLessThan(5);
        expect(bridge.analyzeCalls).toBeLessThan(40);
      }
    });
  }
});
