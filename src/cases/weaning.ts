import { compileCase, type CaseSpec } from "./spec";

/** A recovering ventricle on day 5. The lesson: wean the P-level in steps, check the filling pressure and the pressure at each step, and do not leave a pump idling at a low speed. */
export const WEANING_SPEC: CaseSpec = {
  id: "weaning",
  title: "Coming off",
  tier: "easy",
  complaint: "Recovering shock",
  devices: ["CoroPump"],
  blurb: "The ventricle is recovering and the pump has done its job.",
  card: {
    presents: "60-year-old man on day 5 of a CoroPump CP at P6 after an anterior infarct. The pressor was stopped two days ago. Heart rate 84, BP 104/66. Echo this morning: ejection fraction about 40%, up from 15%.",
    pmh: "Hypertension. The LAD was stented on day 1.",
  },
  start: { support: { coroPump: true }, heart: { lvEes: 0.4 }, devices: { coroPump: { model: "CP", level: 6 } }, seed: 31 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 400,
  monitor: ["hr", "bp", "rhc"],
  musts: [
    { flag: "stepped", label: "wean in steps" },
    { flag: "removed", label: "take the pump out after a short low-speed trial" },
  ],
  checkpoints: [
    {
      id: "start", atS: 10, forbids: ["stepped"], repeatAfterS: 40,
      prompt: {
        text: "The ventricle has recovered and the pressor is off. How do you begin to wean the pump?",
        options: [
          { label: "Lower the P-level to P4 and watch the pressure and the wedge pressure", points: 20, correct: true, why: "Weaning is done in steps so that the ventricle takes the load back gradually. At each step you check that the pressure holds and the filling pressure does not rise.", outcome: { flags: ["stepped"], patch: { devices: { coroPump: { level: 4 } } }, reveal: ["At P4 the pressure holds and the wedge pressure is unchanged."] } },
          { label: "Take it straight to P0 and see", points: -15, correct: false, why: "Dropping all support at once gives the ventricle no time to take the load and no warning if it cannot.", outcome: { patch: { devices: { coroPump: { level: 0 } } }, reveal: ["The pressure sags and the wedge pressure rises."] } },
          { label: "Leave it at P6 until the ejection fraction is normal", points: -5, correct: false, why: "Support with no purpose adds risk of bleeding, hemolysis and clotting every day it stays in.", outcome: { reveal: ["Nothing changes. Another day goes by on the pump."] } },
        ],
      },
    },
    {
      id: "trial", requires: ["stepped"], forbids: ["removed"], atS: 120, repeatAfterS: 60,
      prompt: {
        text: "He is stable at P4 with an unchanged wedge pressure. What is the next step?",
        options: [
          { label: "Try P2 for a short, set time with echo and filling pressures, and remove the pump if he holds", points: 25, correct: true, why: "A short trial at low support shows whether the ventricle can carry the circulation. If it does, the pump comes out. If it does not, support goes back up.", outcome: { flags: ["removed"], patch: { devices: { coroPump: { level: 2 } } }, end: "success", reveal: ["He holds at P2 for the trial. The pump is removed."] } },
          { label: "Leave it at P2 overnight", points: -15, correct: false, why: "At a low speed the flow through the pump is small, and a low-flow pump is where clots form.", outcome: { patch: { devices: { coroPump: { level: 2 } } }, end: "fail", reveal: ["The purge pressure begins to climb by morning."] } },
          { label: "Remove it directly from P4 with no trial", points: 5, correct: false, why: "Reasonable if he is very stable, but a short trial at low support is the check that tells you whether it is safe.", outcome: { end: "success", reveal: ["The pump is removed. He is fine."] } },
        ],
      },
    },
  ],
};
export const WEANING = compileCase(WEANING_SPEC);
