import { compileCase, type CaseSpec } from "./spec";

/** A volume-depleted patient on too high a P-level: the pump alarms and the flow falls short. The lesson: read the console, lower the P-level, give volume, and look for the cause. */
export const SUCTION_ALARM_SPEC: CaseSpec = {
  id: "suction-alarm",
  title: "The alarm at night",
  tier: "easy",
  complaint: "Device alarm",
  devices: ["CoroPump"],
  blurb: "A pump that was fine this afternoon is alarming and the flow is short.",
  card: {
    presents: "58-year-old man on day 2 after a large anterior infarct, on a CoroPump CP at P8 since the cath lab. Overnight his urine output fell and the pump began to alarm.",
    pmh: "Hypertension, hyperlipidemia. On aspirin, ticagrelor and a heparin purge. A femoral sheath is in place.",
  },
  start: { support: { coroPump: true }, bloodLoss: 0.25, devices: { coroPump: { model: "CP", level: 8 } }, seed: 13 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 300,
  monitor: ["hr", "bp", "coropump"],
  musts: [
    { flag: "cleared", label: "clear the alarm: lower the P-level and give volume" },
    { flag: "cause", label: "look for the cause before raising support again" },
  ],
  checkpoints: [
    {
      id: "alarm", atS: 15, forbids: ["cleared"], repeatAfterS: 40,
      prompt: {
        text: "The console is alarming and the flow is well below what P8 should give. The pressure is holding. What do you do?",
        options: [
          { label: "Lower the P-level to P4 and give a fluid bolus", points: 25, correct: true, why: "The inlet is being pulled against the wall because there is not enough blood in the ventricle for P8. Slowing the pump and filling the ventricle ends the alarm and the pump stops damaging blood.", outcome: { flags: ["cleared"], patch: { support: { fluids: 1 }, devices: { coroPump: { level: 4 } } }, reveal: ["The alarm clears. Flow settles near 3 L/min."] } },
          { label: "Raise the P-level to P9 to push the flow up", points: -15, correct: false, why: "A faster pump on an underfilled ventricle only pulls harder on the wall. The flow falls further and the alarm gets worse.", outcome: { patch: { devices: { coroPump: { level: 9 } } }, reveal: ["The alarm is louder and the flow drops."] } },
          { label: "Reposition the pump under echo", points: -5, correct: false, why: "The placement signal is normal. Moving a correctly placed pump risks displacing it and does not fix a filling problem.", outcome: { reveal: ["Echo shows the pump is in the right place. Nothing changes."] } },
          { label: "Exchange the pump for a new one", points: -10, correct: false, why: "The pump is working. A new one in the same underfilled ventricle will alarm the same way.", outcome: { reveal: ["The pump is exchanged. The alarm returns within minutes."] } },
        ],
      },
    },
    {
      id: "cause", requires: ["cleared"], forbids: ["cause"], atS: 70, repeatAfterS: 50,
      prompt: {
        text: "The alarm has cleared and the flow is steady at P4. What do you do next?",
        options: [
          { label: "Look for why he is short of volume: check the access site, the drains and a blood count", points: 20, correct: true, why: "A pump alarm that clears with volume is a finding, not just a nuisance. The reason he lost volume is still there, and raising support again before finding it brings the alarm back.", outcome: { flags: ["cause"], end: "success", reveal: ["The blood count has fallen and the groin is swollen. The team is called."] } },
          { label: "Set it back to P8 now that the alarm is quiet", points: -15, correct: false, why: "The same P-level on the same volume status gives the same alarm. Raise support only when the filling supports it.", outcome: { patch: { devices: { coroPump: { level: 8 } } }, reveal: ["The alarm returns within a minute."] } },
        ],
      },
    },
  ],
};
export const SUCTION_ALARM = compileCase(SUCTION_ALARM_SPEC);
