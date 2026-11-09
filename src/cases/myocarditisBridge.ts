import { compileCase, type CaseSpec } from "./spec";

/** A young patient with a very weak ventricle and no coronary lesion, whose pressure holds only with a pump. The lesson: a pump is a bridge to recovery, and catecholamines and beta blockers are the wrong tools. */
const PUMP = { devices: { coroPump: { level: 6 } } };

export const MYOCARDITIS_BRIDGE_SPEC: CaseSpec = {
  id: "myocarditis-bridge",
  title: "Twenty-six and failing",
  tier: "hard",
  complaint: "Heart failure",
  devices: ["CoroPump"],
  blurb: "A young man with a flu-like illness, clean coronaries and a pressure that will not hold.",
  card: {
    presents: "26-year-old man with five days of fever and aches, then breathlessness and chest tightness. Heart rate 124, BP 86/60, cool hands. Troponin is high. Coronary angiography shows no lesion. Echo: ejection fraction about 15%.",
    pmh: "Previously healthy. No medications. No drug use.",
  },
  start: { heart: { lvEes: 0.2, lvStiffness: 4.5 }, devices: { coroPump: { model: "CP", level: 0 } }, seed: 37 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  monitor: ["hr", "bp", "ecg"],
  musts: [
    { flag: "bridged", label: "support the ventricle with a CoroPump" },
    { flag: "reassess", label: "plan recovery checks, not permanent support" },
  ],
  checkpoints: [
    {
      id: "first", atS: 10, forbids: ["bridged"], repeatAfterS: 40,
      prompt: {
        text: "His pressure is marginal and his output is poor on no support. Coronary angiography is clean. What do you do?",
        options: [
          { label: "Place a CoroPump to support the ventricle while it recovers", points: 25, correct: true, why: "An inflamed ventricle often recovers over days to weeks. A pump carries the circulation and rests the muscle while it does, and the pressure holds without more drugs.", outcome: { flags: ["bridged"], patch: PUMP, reveal: ["The CoroPump is placed at P6. His pressure comes up."] } },
          { label: "Start high-dose epinephrine and dobutamine", points: -15, correct: false, why: "Catecholamines raise the pressure but drive the heart rate up and add work to inflamed myocardium, and raise the risk of arrhythmia.", outcome: { patch: { support: { epinephrine: 0.6, dobutamine: 0.6 } }, reveal: ["His heart rate climbs and runs of ectopy start."] } },
          { label: "Start a beta blocker for the fast heart rate", points: -20, correct: false, why: "His rate is fast to keep a failing ventricle's output up. A beta blocker takes that away.", outcome: { patch: { drugs: { betaBlocker: 0.5 } }, reveal: ["His pressure falls."] } },
          { label: "Watch him overnight in the ward", points: -20, correct: false, why: "A pressure this low with cool hands is shock. Waiting risks organ failure and arrest.", outcome: { reveal: ["By morning his lactate is climbing and his urine output has stopped."] } },
        ],
      },
    },
    {
      id: "plan", requires: ["bridged"], forbids: ["reassess"], atS: 90, repeatAfterS: 60,
      prompt: {
        text: "On the pump his pressure is stable in the 70s. How do you frame the plan?",
        options: [
          { label: "Treat the cause, support him as a bridge to recovery, and recheck the ventricle by echo every day to decide when to wean", points: 25, correct: true, why: "The aim is recovery. Daily echo shows when the ventricle is ready to take the load back, and the pump is withdrawn as it does.", outcome: { flags: ["reassess"], end: "success", reveal: ["He goes to the cardiac ICU. The ejection fraction begins to improve on day four."] } },
          { label: "Convert to a long-term ventricular assist device now", points: -15, correct: false, why: "Many of these ventricles recover. A permanent device is for those that do not, and that is known only after days of support.", outcome: { end: "fail", reveal: ["He is listed for an assist device he may not have needed."] } },
          { label: "Take the pump out as soon as the pressure looks normal", points: -15, correct: false, why: "A normal pressure on a pump says the pump is working, not that the ventricle has recovered.", outcome: { end: "fail", reveal: ["He goes back into shock within the hour."] } },
        ],
      },
    },
  ],
};
export const MYOCARDITIS_BRIDGE = compileCase(MYOCARDITIS_BRIDGE_SPEC);
