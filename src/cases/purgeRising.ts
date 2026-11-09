import { compileCase, type CaseSpec } from "./spec";

/**
 * Day 3 on the pump, purge pressure climbing toward its limit with no heparin in the purge. The learner reads the console, orders the free hemoglobin
 * and checks the urine, and works out that a clot is forming in the pump. Heparin and a bicarbonate purge stop it growing; only a new pump removes it.
 */
export const PURGE_RISING_SPEC: CaseSpec = {
  id: "purge-rising",
  title: "Day three",
  tier: "medium",
  complaint: "Cardiogenic shock",
  devices: ["CoroPump"],
  blurb: "A pump that has been running for days, and one number on its console that keeps going up.",
  card: {
    presents: "64-year-old man on day 3 of a CoroPump CP at P6 for an anterior infarct and shock. His pressure is steady on a low dose of dobutamine. The night nurse asks you to look at the console.",
    pmh: "Hypertension. Oozing at the access site on day 1, so the purge has been dextrose with no heparin since.",
  },
  start: {
    lesions: [{ artery: "LAD", occluded: true, position: 0.15 }],
    support: { dobutamine: 0.3, coroPump: true },
    devices: { coroPump: { model: "CP", level: 6, purge: { solution: "dextrose-heparin", heparinUml: 0, line: "clear" }, initial: { thrombusBurden: 0.58, plasmaFreeHbMgDl: 60 } } },
    seed: 23,
  },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 1500,
  monitor: ["hr", "bp", "coropump"],
  musts: [
    { flag: "stopped", label: "stop the growth: more heparin and a bicarbonate purge" },
    { flag: "exchanged", label: "exchange the pump" },
  ],
  checkpoints: [
    { id: "nudge", atS: 350, outcome: { reveal: ["The console alarm is sounding. The team asks what you want checked before deciding."] } },
    {
      id: "alarm", atS: 360, when: [{ back: "hemolysis" }, { back: "urine-color" }], forbids: ["stopped"], repeatAfterS: 60,
      prompt: {
        text: "The purge pressure is above its alarm limit and still climbing. You have the free hemoglobin and the urine color. What do you do first?",
        options: [
          { label: "Raise the purge heparin to 50 U/mL and change to a bicarbonate purge", points: 25, correct: true, why: "Purge pressure rises when the pump is clotting from the inside. More heparin and a bicarbonate solution slow the growth. The raised free hemoglobin and the urine color fit a clot shearing red cells.", outcome: { flags: ["stopped"], patch: { devices: { coroPump: { purge: { heparinUml: 50, solution: "bicarbonate" } } } }, reveal: ["The purge is changed. The pressure stops climbing, but it does not come down."] } },
          { label: "Flush the purge line", points: -5, correct: false, why: "The line is clear. The resistance is in the pump, so flushing the line changes nothing.", outcome: { patch: { devices: { coroPump: { purge: { clearLine: true } } } }, reveal: ["The line is flushed. The pressure is unchanged."] } },
          { label: "Lower the P-level to P2 to reduce the load", points: -15, correct: false, why: "A slow pump runs at low flow, and low flow is where clots grow fastest.", outcome: { patch: { devices: { coroPump: { level: 2 } } }, reveal: ["The flow falls and the pressure rises faster."] } },
          { label: "Watch it for a few more hours", points: -15, correct: false, why: "The pressure is already over its limit and rising. The window for slowing the clot is now.", outcome: { reveal: ["The pressure keeps climbing."] } },
        ],
      },
    },
    {
      id: "exchange", requires: ["stopped"], forbids: ["exchanged"], atS: 900, repeatAfterS: 120,
      prompt: {
        text: "Hours later the purge pressure is still over its limit despite the new purge. The free hemoglobin has not come down. What now?",
        options: [
          { label: "Exchange the pump", points: 25, correct: true, why: "A clot that is already large does not dissolve with heparin. It keeps shearing blood and can stop the rotor. The only fix is a new pump, which restarts with a clear purge and no clot.", outcome: { flags: ["exchanged"], patch: { devices: { coroPump: { exchange: true } } }, end: "success", reveal: ["The pump is exchanged. The purge pressure is normal and the urine clears."] } },
          { label: "Keep the pump and give still more heparin", points: -15, correct: false, why: "The heparin is already at 50 U/mL. A larger clot will not be cleared by more of the same.", outcome: { reveal: ["The pressure keeps rising and the rotor current climbs."] } },
          { label: "Turn the pump off and see if he manages", points: -20, correct: false, why: "He still needs the support, and a stopped pump in the ventricle can clot completely.", outcome: { patch: { devices: { coroPump: { level: 0 } } }, reveal: ["His pressure falls within minutes."] } },
        ],
      },
    },
  ],
};
export const PURGE_RISING = compileCase(PURGE_RISING_SPEC);
