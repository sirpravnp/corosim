// Narration of cardiac arrest (task B4b): the plain sentences explain() and the tool narration use. Pure, fast.
import { describe, it, expect } from "vitest";
import { arrestWords, arrestSentence, vitalsNow, vitalsChange, type Vitals } from "../src/sim/narrate";

const block = (o: object = {}) => ({ status: "arrest", rhythmClass: "vf", arrestS: 95, noFlowS: 60, injury: 0, cpr: { on: true, output: 0.3 }, lastShock: { success: false }, shocks: 2, drugs: [{ drug: "epinephrine", dose: 1 }, { drug: "epinephrine", dose: 1 }, { drug: "amiodarone", dose: 300 }], ...o });
const vit = (arrest?: Vitals["arrest"]): Vitals => ({ rhythm: "ventricular fibrillation (coarse)", hr: 0, sbp: 50, dbp: 40, map: 45, circulation: "shock", infarct: 0, ischemicMass: 0, ef: null, noOutput: true, treated: [], ...(arrest ? { arrest } : {}) });

describe("arrest narration", () => {
  it("no block, or status none, gives nothing", () => {
    expect(arrestWords(undefined)).toBeNull();
    expect(arrestWords(block({ status: "none" }))).toBeNull();
  });
  it("an arrest in VF with CPR, shocks and drugs reads as one sentence with the next step", () => {
    const s = arrestSentence(arrestWords(block())!);
    expect(s).toMatch(/cardiac arrest \(ventricular fibrillation\) for 95 s/);
    expect(s).toMatch(/CPR under way, giving about 30% of normal output/);
    expect(s).toMatch(/2 shocks so far, the last unsuccessful/);
    expect(s).toMatch(/epinephrine 2 mg and amiodarone 300 mg/);
    expect(s).toMatch(/defibrillate/);
    expect(arrestSentence(arrestWords(block({ rhythmClass: "asystole", cpr: { on: false, output: 0 } }))!)).toMatch(/no CPR.*not shockable/);
  });
  it("ROSC and death", () => {
    expect(arrestSentence(arrestWords(block({ status: "rosc", lastShock: { success: true }, injury: 0.2 }))!)).toMatch(/Return of spontaneous circulation after a successful shock.*20% irreversible injury/);
    expect(arrestSentence(arrestWords(block({ status: "dead", noFlowS: 600 }))!)).toMatch(/has died: 600 s/);
  });
  it("the monitor phrases carry the arrest", () => {
    expect(vitalsNow(vit(arrestWords(block())!))).toMatch(/in cardiac arrest with CPR under way/);
    expect(vitalsNow(vit(arrestWords(block({ status: "dead" }))!))).toMatch(/has died/);
    expect(vitalsChange(vit(arrestWords(block())!), { ...vit(arrestWords(block({ status: "rosc" }))!), rhythm: "sinus rhythm", noOutput: false })).toMatch(/spontaneous circulation returned/);
    expect(vitalsNow(vit())).toMatch(/no cardiac output \(an arrest rhythm\)/); // no arrest block: as before
  });
});
