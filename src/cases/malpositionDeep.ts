import { compileCase, type CaseSpec } from "./spec";

/** A pump pushed too deep: it alarms, flow is erratic, and the red cells are being sheared against the wall. The lesson: reposition, then check what the position did. */
export const MALPOSITION_DEEP_SPEC: CaseSpec = {
  id: "malposition-deep",
  title: "Alarm after transport",
  tier: "medium",
  complaint: "Device alarm",
  devices: ["CoroPump"],
  blurb: "He came back from the scanner and the pump has not been quiet since.",
  card: {
    presents: "63-year-old man on day 3 of a CoroPump CP at P9 for anterior infarct shock. He returned from a CT scan an hour ago. The pump alarm has been going off since and the flow looks ragged.",
    pmh: "Hypertension, smoker. The LAD has not yet been opened.",
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], support: { coroPump: true }, devices: { coroPump: { model: "CP", level: 9, position: "deep", initial: { plasmaFreeHbMgDl: 20 } } }, seed: 19 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  monitor: ["hr", "bp", "coropump"],
  musts: [
    { flag: "repositioned", label: "pull the pump back under echo" },
    { flag: "checked", label: "check what the position did to the blood" },
  ],
  checkpoints: [
    {
      id: "alarm", atS: 15, forbids: ["repositioned"], repeatAfterS: 40,
      prompt: {
        text: "The pump is alarming and the flow is erratic since transport. Read the console. What do you do?",
        options: [
          { label: "Check the pump on echo and pull it back", points: 25, correct: true, why: "The inlet is pressed against the wall of the ventricle after the move. The alarm and erratic flow come from that, not from the patient's volume, and a pull-back under echo fixes the cause.", outcome: { flags: ["repositioned"], patch: { devices: { coroPump: { reposition: true } } }, reveal: ["Echo shows the inlet against the apex. It is pulled back, and the alarm stops."] } },
          { label: "Lower the P-level only", points: 5, correct: false, why: "A slower pump eases the symptom, but the inlet is still at the wall. The cause remains and the alarm returns whenever the speed goes up.", outcome: { patch: { devices: { coroPump: { level: 5 } } }, reveal: ["The alarm quiets at P5. The flow is lower and the inlet is still against the wall."] } },
          { label: "Give a fluid bolus for the alarm", points: -10, correct: false, why: "He is not short of volume. A bolus into a failing ventricle goes to the lungs.", outcome: { patch: { support: { fluids: 1 } }, reveal: ["The alarm does not change. His breathing worsens."] } },
          { label: "Exchange the pump", points: -5, correct: false, why: "The pump itself works. It needs repositioning, not replacing.", outcome: { reveal: ["The new pump settles in the same deep position after the move."] } },
        ],
      },
    },
    {
      id: "checked", requires: ["repositioned"], forbids: ["checked"], atS: 80, repeatAfterS: 50,
      prompt: {
        text: "The alarm has stopped and the placement signal looks right. He was alarming at P9 for an hour. What do you do?",
        options: [
          { label: "Order a plasma free hemoglobin and look at the urine color", points: 20, correct: true, why: "A pump pressed against the wall tears red cells. The damage is not on the console, so it has to be looked for in the blood and the urine.", outcome: { flags: ["checked"], end: "success", reveal: ["The plasma free hemoglobin is raised and the urine is tea-colored. The team keeps the pump at a lower P-level and rechecks the lab."] } },
          { label: "Return to P9 now that the alarm is quiet", points: -15, correct: false, why: "A P9 setting is rarely needed once the ventricle is unloaded, and each hour at high speed adds shear on the red cells.", outcome: { end: "fail", reveal: ["By morning his urine is dark and his hemoglobin has dropped."] } },
        ],
      },
    },
  ],
};
export const MALPOSITION_DEEP = compileCase(MALPOSITION_DEEP_SPEC);
