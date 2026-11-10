import { compileCase, type CaseSpec } from "./spec";

/** Ablation of ventricular tachycardia in a weak ventricle. Mapping the circuit needs the VT to run, and without support he does not tolerate it. The lesson: put the pump in before induction. */
const PUMP = { devices: { coroPump: { level: 7 } } };
const VT = { patient: { rhythm: "vt-mono" } };
const SINUS = { patient: { rhythm: "sinus" } };

export const VT_ABLATION_SPEC: CaseSpec = {
  id: "vt-ablation",
  title: "Map it while it runs",
  tier: "hard",
  complaint: "Ventricular tachycardia",
  devices: ["CoroPump"],
  blurb: "A weak ventricle, a circuit to find, and a rhythm that has to be running to find it.",
  card: {
    presents: "67-year-old man with recurrent shocks from his defibrillator for ventricular tachycardia, on the table for ablation. Heart rate 72 in sinus, BP 112/70.",
    pmh: "Old anterior infarct, ejection fraction 25%. On amiodarone and a beta blocker. The tachycardia was 180 per minute with a systolic pressure in the 70s the last time it was seen.",
  },
  start: { lesions: [{ artery: "LAD", stenosis: 0.6, position: 0.4 }], heart: { lvEes: 0.25 }, devices: { coroPump: { model: "CP", level: 0 } }, seed: 41 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  stable: [{ num: "map", op: ">=", value: 55 }, { arrest: "arrest", not: true }],
  monitor: ["hr", "bp", "ecg"],
  musts: [
    { flag: "supported", label: "place the CoroPump before the tachycardia is induced" },
    { flag: "mapped", label: "map and ablate with the circulation supported" },
  ],
  checkpoints: [
    {
      id: "plan", atS: 8, forbids: ["supported", "induced"], repeatAfterS: 40,
      prompt: {
        text: "The circuit can be mapped only while the tachycardia runs. His ventricle is weak. How do you proceed?",
        options: [
          { label: "Place a CoroPump first, then induce the tachycardia and map it", points: 25, correct: true, why: "In tachycardia a weak ventricle cannot fill or eject, so the pressure collapses within a minute. A pump carries the circulation so the circuit can be mapped without a rescue shock.", outcome: { flags: ["supported"], patch: PUMP, reveal: ["The CoroPump is in at P7. The tachycardia is induced."] } },
          { label: "Induce the tachycardia unsupported and cardiovert if the pressure falls", points: -10, correct: false, why: "Each shock ends the rhythm you are trying to map, so the procedure becomes a series of short, interrupted runs with a hypotensive patient between them.", outcome: { flags: ["induced"], patch: VT, reveal: ["The tachycardia is induced. The pressure falls fast."] } },
          { label: "Skip mapping and ablate the scar by substrate in sinus rhythm", points: 5, correct: false, why: "Substrate ablation is a valid approach and does not need the rhythm to run, but it targets the scar broadly. When mapping is the plan, support is what makes it possible.", outcome: { reveal: ["The substrate is ablated. The tachycardia is still inducible at the end."] } },
        ],
      },
    },
    { id: "run", requires: ["supported"], forbids: ["induced"], atS: 25, outcome: { flags: ["induced"], patch: VT, reveal: ["Ventricular tachycardia at 180 per minute."] } },
    {
      id: "rescue", branch: true, requires: ["induced"], forbids: ["supported"], atS: 40, repeatAfterS: 40,
      prompt: {
        text: "He is in tachycardia and his pressure is in the 40s. What do you do?",
        options: [
          { label: "Place the CoroPump now and keep mapping", points: 10, correct: true, why: "Support now restores the pressure, and the rhythm can run long enough to be mapped.", outcome: { flags: ["supported"], patch: PUMP, reveal: ["The CoroPump is placed. His pressure comes up in the tachycardia."] } },
          { label: "Cardiovert and try again", points: -5, correct: false, why: "It ends the rhythm and costs the map. The same collapse will follow the next induction.", outcome: { patch: SINUS, reveal: ["Back in sinus rhythm. The map is lost."] } },
        ],
      },
    },
    {
      id: "map", requires: ["supported", "induced"], forbids: ["mapped"], when: [{ num: "hr", op: ">", value: 150 }, { num: "map", op: ">=", value: 60 }], forS: 8, repeatAfterS: 60,
      prompt: {
        text: "He is in tachycardia at 180 and his pressure is holding. What do you do with the time?",
        options: [
          { label: "Map the circuit and ablate while the tachycardia runs, keeping support through the procedure", points: 25, correct: true, why: "That is what the pump bought: a perfused patient and a rhythm that runs long enough to find the exit site. Support stays until the rhythm is no longer inducible.", outcome: { flags: ["mapped"], patch: SINUS, end: "success", reveal: ["The circuit is mapped and ablated. The tachycardia terminates and is no longer inducible."] } },
          { label: "Cardiovert at once, since he is in a dangerous rhythm", points: -10, correct: false, why: "He is perfused. Ending the rhythm now throws away the map you set up the support to get.", outcome: { patch: SINUS, reveal: ["Back in sinus rhythm. The circuit is not mapped."] } },
        ],
      },
    },
  ],
};
export const VT_ABLATION = compileCase(VT_ABLATION_SPEC);
