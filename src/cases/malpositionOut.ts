import { compileCase, type CaseSpec } from "./spec";

/** A pump that has slid back toward the aorta: the console shows flow, the ventricle is not unloaded, the placement signal is flat. The lesson: read the placement signal. */
export const MALPOSITION_OUT_SPEC: CaseSpec = {
  id: "malposition-out",
  title: "Flow without relief",
  tier: "medium",
  complaint: "Cardiogenic shock",
  devices: ["CoroPump"],
  blurb: "A pump is running, and she is no better than before it went in.",
  card: {
    presents: "55-year-old woman transferred overnight from a community hospital with an anterior infarct and shock. A CoroPump CP was placed there and set to P8. She still has crackles and a cool periphery.",
    pmh: "Diabetes, hypertension. Awaiting the cath lab.",
    info: ["Her wedge pressure was 26 mmHg when the pump went in and is still 26."],
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { coroPump: true }, devices: { coroPump: { model: "CP", level: 8, position: "aortic" } }, seed: 17 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 300,
  monitor: ["hr", "bp", "coropump"],
  musts: [
    { flag: "repositioned", label: "reposition the pump under echo" },
    { flag: "confirmed", label: "confirm the position and secure it" },
  ],
  checkpoints: [
    {
      id: "look", atS: 15, forbids: ["repositioned"], repeatAfterS: 40,
      prompt: {
        text: "The pump is at P8 and she is no better. Read the console. What do you do?",
        options: [
          { label: "Check the pump position on echo and reposition it", points: 25, correct: true, why: "The pump is running, but its inlet is not in the ventricle, so it is not taking blood out of it. The placement signal shows almost no ventricular pressure swing. The fix is to pull it back into the ventricle under echo.", outcome: { flags: ["repositioned"], patch: { devices: { coroPump: { reposition: true } } }, reveal: ["Echo shows the inlet above the valve. It is advanced into the ventricle. The placement signal now swings with each beat."] } },
          { label: "Raise the P-level to P9", points: -10, correct: false, why: "More speed does not help a pump that is not in the ventricle. The flow looks good but the ventricle is still not unloaded.", outcome: { patch: { devices: { coroPump: { level: 9 } } }, reveal: ["The flow reads higher. The wedge pressure does not move."] } },
          { label: "Add dobutamine for the pump-resistant failure", points: -10, correct: false, why: "Dobutamine adds work to ischemic muscle, and the problem here is the pump, not the inotropy.", outcome: { patch: { support: { dobutamine: 0.4 } }, reveal: ["Her heart rate climbs. The wedge pressure is unchanged."] } },
          { label: "Exchange the pump", points: -5, correct: false, why: "The device is working. It is in the wrong place, which needs only a reposition.", outcome: { reveal: ["The new pump drifts back to the same position."] } },
        ],
      },
    },
    {
      id: "confirm", requires: ["repositioned"], forbids: ["confirmed"], atS: 70, repeatAfterS: 50,
      prompt: {
        text: "The placement signal now swings with each beat and the wedge pressure has fallen. How do you make sure it stays that way?",
        options: [
          { label: "Mark the depth at the sheath, secure it, and recheck the placement signal after every move or transport", points: 20, correct: true, why: "These pumps migrate with patient movement, so the position is checked against a mark and by the console signal each time she is moved.", outcome: { flags: ["confirmed"], end: "success", reveal: ["The depth is marked and secured. Her wedge pressure stays down."] } },
          { label: "Nothing more: once placed correctly, it stays", points: -15, correct: false, why: "Migration is common, which is why the placement signal exists.", outcome: { end: "fail", reveal: ["During a turn that night the pump moves back and the problem returns."] } },
        ],
      },
    },
  ],
};
export const MALPOSITION_OUT = compileCase(MALPOSITION_OUT_SPEC);
