import { describe, it, expect } from "vitest";
import { CHANGE_PRESETS, START_PRESETS, mergePatch } from "../src/library/presets";
import { normalizePatient } from "../src/sim/patient";

describe("builder presets", () => {
  it("are all accepted by the simulator without a warning", () => {
    for (const p of [...START_PRESETS, ...CHANGE_PRESETS]) expect(normalizePatient(p.patch).warnings, p.label).toEqual([]);
  });
  it("merge into what is there", () => {
    const a = mergePatch({ devices: { impella: { level: 6 } } }, { devices: { ecmo: { flowLpm: 4 } } });
    expect(a).toEqual({ devices: { impella: { level: 6 }, ecmo: { flowLpm: 4 } } });
    expect(mergePatch({ lesions: [{ artery: "LAD" }] }, { lesions: [{ artery: "RCA" }] })).toEqual({ lesions: [{ artery: "RCA" }] });
  });
});
