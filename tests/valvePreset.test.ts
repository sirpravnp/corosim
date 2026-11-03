import { describe, it, expect } from "vitest";
import { buildPlaygroundSpec, heartOfPick, valvePresetModified, withBloodVolume, withValvePreset } from "../src/sim/playground";
import { LESIONS, LESION_BY_ID, defaults } from "../src/sim/structural";
import { FIELDS } from "../src/sim/registry";
import { decodePatient, encodePatient } from "../src/sim/llm";
import { heartOf, setValveSeverity } from "../src/panels/valvesPanel";

describe("Valves tab preset", () => {
  it("fills the heart with what the lesson builds, and the spec is the same as picking the lesson", () => {
    for (const l of LESIONS.filter((x) => x.patient === "adult")) {
      const filled = buildPlaygroundSpec({}, withValvePreset({}, l.id)).spec, picked = buildPlaygroundSpec({}, { structural: { id: l.id, values: defaults(LESION_BY_ID[l.id]!) } }).spec;
      expect(filled.heart, l.id).toEqual(picked.heart);
    }
  });
  it("keeps the blood volume, and names the preset until a field is edited", () => {
    const st = withValvePreset(withBloodVolume({}, 500), "as");
    expect(st.heart?.volumeMl).toBe(500);
    expect(valvePresetModified(st)).toBe(false);
    expect(valvePresetModified(withBloodVolume(st, -200))).toBe(false); // the blood volume is the patient's own
    const edited = setValveSeverity(st, "mv", "regurgitation", 0.5);
    expect(edited.valvePreset).toBe("as");
    expect(edited.structural).toBeUndefined();
    expect(heartOf(edited).valves?.av).toBeDefined();
    expect(heartOf(edited).valves?.mv?.reg).toBeGreaterThan(0);
    expect(valvePresetModified(edited)).toBe(true);
  });
  it("the Eisenmenger preset sets the shunt, the pulmonary resistance and the RV; the label is not in the spec or the link", () => {
    const st = withValvePreset({}, "vsd-eisenmenger"), { spec } = buildPlaygroundSpec({}, st);
    expect(spec.heart).toMatchObject({ vsd: { diameterMm: 8 }, pvri: 40 });
    expect(spec.heart?.rvContractility).toBeGreaterThan(1);
    expect(JSON.stringify(spec)).not.toContain("valvePreset");
    expect(decodePatient(encodePatient(spec))).toEqual(spec);
  });
  it("normal heart clears the heart", () => {
    expect(withValvePreset(withValvePreset({}, "as"), "normal").heart).toBeUndefined();
    expect(heartOfPick({ id: "normal", values: {} })).toBeUndefined();
  });
  it("the systemic fields are on the Patient tab, the valves and defects stay on the Valves tab", () => {
    const tab = (p: string) => FIELDS.find((f) => f.path === p)?.tab;
    for (const k of ["svrScale", "pvri", "satLung", "rvContractility", "tof", "volumeMl"]) expect(tab(`heart.${k}`), k).toBe("patient");
    for (const k of ["valves.av.open", "vsd", "pda", "asd", "bt", "lvSize"]) expect(tab(`heart.${k}`), k).toBe("valves");
  });
});
