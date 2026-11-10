import { compileCase, type CaseSpec } from "./spec";

/**
 * Day 3 on the pump, and the blood count is drifting. Free hemoglobin is not on the console: the learner orders it and reads the urine. The cause is
 * a P-level too high for his volume. The lesson: lower the P-level and fill him, then confirm the free hemoglobin falls.
 */
export const HEMOLYSIS_SPEC: CaseSpec = {
  id: "hemolysis",
  title: "The blood count",
  tier: "medium",
  complaint: "Falling hemoglobin",
  devices: ["CoroPump"],
  blurb: "A pump that seems fine, a hemoglobin that is not, and nothing on the console to explain it.",
  card: {
    presents: "66-year-old man on day 3 of a CoroPump CP at P9 after an anterior infarct. Nursing flags a fall in the hemoglobin on the morning blood count and asks you to look at the pump.",
    pmh: "Hypertension, type 2 diabetes. Anticoagulated with a heparin purge. A femoral sheath is in place.",
  },
  start: { support: { coroPump: true }, bloodLoss: 0.25, devices: { coroPump: { model: "CP", level: 9, purge: { solution: "dextrose-heparin", heparinUml: 25 }, initial: { plasmaFreeHbMgDl: 90 } } }, seed: 29 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 900,
  monitor: ["hr", "bp", "coropump"],
  musts: [
    { flag: "fixed", label: "lower the P-level and fill him" },
    { flag: "plan", label: "keep the P-level as low as the ventricle needs, with follow-up" },
  ],
  checkpoints: [
    { id: "nudge", atS: 15, outcome: { reveal: ["The team waits for you. Order what you want checked from the order menu."] } },
    {
      id: "cause", atS: 20, when: [{ back: "hemolysis" }, { back: "urine-color" }], forbids: ["fixed"], repeatAfterS: 60,
      prompt: {
        text: "The free hemoglobin is high and the urine is not clear. What do you do?",
        options: [
          { label: "Lower the P-level to P5 and give a fluid bolus", points: 25, correct: true, why: "A pump running faster than the ventricle can fill pulls the inlet against the wall and shears red cells. A lower P-level and more volume remove the cause, and the free hemoglobin then falls.", outcome: { flags: ["fixed"], patch: { support: { fluids: 1 }, devices: { coroPump: { level: 5 } } }, reveal: ["The alarm quiets. Flow is steady at a lower speed."] } },
          { label: "Raise the purge heparin to 50 U/mL", points: -10, correct: false, why: "More heparin addresses a clot. Nothing here points to one: the purge pressure is normal.", outcome: { patch: { devices: { coroPump: { purge: { heparinUml: 50 } } } }, reveal: ["The purge pressure is unchanged. So is the urine."] } },
          { label: "Exchange the pump", points: -10, correct: false, why: "The pump is working. A new one at the same speed in the same ventricle injures blood the same way.", outcome: { reveal: ["The new pump alarms within the hour."] } },
          { label: "Leave it and recheck tomorrow", points: -15, correct: false, why: "Hemolysis in the kidney tubules injures them, and the cause is still running.", outcome: { reveal: ["By evening his urine output falls."] } },
        ],
      },
    },
    {
      id: "plan", requires: ["fixed"], forbids: ["plan"], atS: 400, repeatAfterS: 120,
      prompt: {
        text: "A repeat free hemoglobin is lower and the urine has cleared. How do you set the pump for the rest of the day?",
        options: [
          { label: "Use the lowest P-level that keeps the ventricle unloaded, and repeat the free hemoglobin and urine check each day", points: 20, correct: true, why: "Hemolysis tracks pump speed and filling. The aim is enough support, not maximum support, and a daily lab is how you notice it returning.", outcome: { flags: ["plan"], end: "success", reveal: ["He stays at P5 with a daily lab and urine check."] } },
          { label: "Return to P9 now that the numbers are better", points: -15, correct: false, why: "P9 is what caused the problem. The numbers improved because the speed came down.", outcome: { patch: { devices: { coroPump: { level: 9 } } }, reveal: ["The alarm returns."] } },
        ],
      },
    },
  ],
};
export const HEMOLYSIS = compileCase(HEMOLYSIS_SPEC);
