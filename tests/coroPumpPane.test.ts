import { describe, expect, it } from "vitest";
import { alarmLines, coroPumpCpo, coroPumpFigureCaptions, coroPumpLabsLine, coroPumpNumbers, coroPumpShown } from "../src/panels/coroPump";
import { DASH } from "../src/panels/numbers";
import { casePanels } from "../src/page/caseMonitor";
import { itemById } from "../src/cases/orders";
import type { CoroPumpReadout } from "../src/sim/coreDevices";

const readout = (o: Partial<CoroPumpReadout> = {}): CoroPumpReadout => ({
  on: true, model: "CP", position: "correct", level: 6, speedKrpm: 38, flowLpm: 3.14, flowMinLpm: 2.6, flowMaxLpm: 3.7,
  motorCurrentMa: 480, currentPulsatilityMa: 60, placementMmHg: 70, placementAmplitudeMmHg: 34,
  suctionLevel: 0, suctionFraction: 0, suctionAlarm: false, inletMeanMmHg: 40, inletMinMmHg: 20, inletMaxMmHg: 60, inletAmplitudeMmHg: 40,
  positionAlarm: false,
  purge: { solution: "dextrose-heparin", heparinUml: 25, line: "clear", flowMlHr: 15.2, pressureMmHg: 449.6 },
  hemolysis: { plasmaFreeHbMgDl: 8, urineColor: "clear" },
  thrombusBurden: 0.4, waveform: null, alarms: [], ...o,
});

describe("CoroPump console pane", () => {
  it("formats flow as 3.1 L/min and purge as 450 mmHg, 15 ml/hr", () => {
    const n = coroPumpNumbers(readout());
    expect(n.flow).toBe("3.1 L/min");
    expect(n.level).toBe("P6");
    expect(n.purgePressure).toBe("450 mmHg");
    expect(n.purgeFlow).toBe("15 ml/hr");
  });
  it("shows alarms as text with a label, not color alone", () => {
    expect(alarmLines(readout({ alarms: ["PURGE PRESSURE HIGH", "PURGE FLOW LOW"] }))).toEqual(["Alarm: PURGE PRESSURE HIGH", "Alarm: PURGE FLOW LOW"]);
    expect(alarmLines(readout())).toEqual(["No alarms"]);
  });
  it("hides the pane when readout is null", () => {
    expect(coroPumpShown(null)).toBe(false);
    expect(coroPumpShown(readout({ on: false }))).toBe(false);
    expect(coroPumpShown(readout())).toBe(true);
  });
  it("never shows the thrombus burden in any text the pane makes", () => {
    const r = readout({ thrombusBurden: 0.8765 });
    const all = JSON.stringify([coroPumpNumbers(r), alarmLines(r), coroPumpLabsLine(r, false)]);
    expect(all).not.toMatch(/0\.8765|87|thrombus/i);
  });
  it("in free play the labs line gives free hemoglobin and urine color", () => {
    expect(coroPumpLabsLine(readout({ hemolysis: { plasmaFreeHbMgDl: 62.4, urineColor: "tea" } }), false)).toBe("Plasma free hemoglobin 62 mg/dL. Urine: tea-colored.");
  });
  it("in a case the labs line is null: the learner orders the hemolysis lab and reads urine color from the bedside item", () => {
    expect(coroPumpLabsLine(readout({ hemolysis: { plasmaFreeHbMgDl: 120, urineColor: "dark" } }), true)).toBeNull();
    expect(itemById("hemolysis")?.group).toBe("lab");
    expect(itemById("urine-color")?.group).toBe("bedside");
  });
  it("in a case the pane shows only when the monitor lists coropump or the learner ordered it", () => {
    const panelOf = (id: string) => itemById(id)?.panel;
    expect(casePanels(["hr", "bp", "ecg"], panelOf)).not.toContain("coropump");
    expect(casePanels(["hr", "coropump"], panelOf)).toContain("coropump");
    expect(itemById("coropump")?.group).toBe("panel");
  });
  it("cardiac power output is MAP times pump flow over 451, in watts", () => {
    const r = readout({ flowLpm: 3.0, waveform: { dtMs: 10, inletMmHg: [], aorticMmHg: Array(100).fill(90), currentMa: [] } });
    expect(coroPumpCpo(r)).toBeCloseTo(0.6, 2);
  });
  it("cardiac power output is null without a waveform or with a non-finite flow", () => {
    expect(coroPumpCpo(readout({ waveform: null }))).toBeNull();
    expect(coroPumpCpo(readout({ flowLpm: NaN, waveform: { dtMs: 10, inletMmHg: [], aorticMmHg: Array(100).fill(90), currentMa: [] } }))).toBeNull();
  });
  it("motor current reads peak over trough from the waveform", () => {
    const currentMa = Array.from({ length: 100 }, (_, i) => (i === 0 ? 750 : i === 1 ? 600 : 650));
    const n = coroPumpNumbers(readout({ waveform: { dtMs: 10, inletMmHg: [], aorticMmHg: [], currentMa } }));
    expect(n.motorCurrent).toBe("750/600 mA");
    expect(n.cpo).toBe(DASH);
  });
  it("motor current falls back to the mean when there is no waveform", () => {
    expect(coroPumpNumbers(readout()).motorCurrent).toBe("480 mA");
  });
  it("formats cardiac power output with two decimals and a unit, and shows a dash without a waveform", () => {
    const r = readout({ flowLpm: 3.0, waveform: { dtMs: 10, inletMmHg: [], aorticMmHg: Array(100).fill(90), currentMa: [] } });
    expect(coroPumpNumbers(r).cpo).toBe("0.60 W");
    expect(coroPumpNumbers(readout()).cpo).toBe(DASH);
  });
  it("captions the pressure figure as Figure 3 and the current figure as Figure 4", () => {
    expect(coroPumpFigureCaptions.pressure.startsWith("Figure 3. ")).toBe(true);
    expect(coroPumpFigureCaptions.pressure).toMatch(/Aortic and inlet pressure, mmHg/);
    expect(coroPumpFigureCaptions.current.startsWith("Figure 4. ")).toBe(true);
  });
});
