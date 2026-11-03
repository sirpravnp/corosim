import { describe, it, expect } from "vitest";
import { SIM_RHYTHMS, SIM_RHYTHM_CATEGORIES, simRhythmId, libraryRhythm } from "../src/physics/rhythmSource";
import { pickerValue } from "../src/page/rhythmChoices";
import { decodeScenario, encodeScenario } from "../src/sim/llm";
import { Simulation } from "../src/sim/simulation";

describe("rhythm picker (C3)", () => {
  it("offers every D4 rhythm, grouped by the D4 categories, each with a name and a summary", () => {
    expect(SIM_RHYTHMS.length).toBeGreaterThan(30);
    for (const c of SIM_RHYTHM_CATEGORIES) expect(SIM_RHYTHMS.some((p) => p.category === c)).toBe(true);
    for (const p of SIM_RHYTHMS) { expect(p.name).toBeTruthy(); expect(p.summary).toBeTruthy(); expect(simRhythmId(p.id)).not.toBeNull(); }
  });
  it("the picker value of the coronary model's own rhythms is a library id; library rhythms map to themselves", () => {
    expect(pickerValue("sinus")).toBe("nsr"); expect(pickerValue("af")).toBe("af");
    for (const p of SIM_RHYTHMS) expect(simRhythmId(pickerValue(simRhythmId(p.id)!))).toBe(simRhythmId(p.id));
    expect(libraryRhythm("vt-mono")?.name).toMatch(/ventricular tachycardia/i);
  });
  it("patient.rhythm survives a share link for every rhythm", () => {
    for (const p of SIM_RHYTHMS) {
      const want = simRhythmId(p.id)!;
      const back = decodeScenario(encodeScenario({ patient: { rhythm: want } }));
      expect(back.patient?.rhythm).toBe(want);
    }
    const sim = new Simulation({ seed: 1 }, { engine: "core" });
    sim.reset({ patient: { rhythm: "vt-mono" } });
    expect(sim.patient.rhythm).toBe("vt-mono");
    expect(sim.scenario().patient?.rhythm).toBe("vt-mono");
  });
});
