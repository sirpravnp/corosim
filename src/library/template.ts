import { caseToMarkdown } from "../cases/markdown";
import type { CaseSpec } from "../cases/spec";

/** A small complete case, as the document format writes it: the template people download to start from. */
export const exampleCase = (): CaseSpec => ({
  id: "example-chest-pain", title: "Example: pressure in the chest", tier: "easy", complaint: "Chest pain", devices: [],
  blurb: "One line for the case list: who the patient is and what the case teaches.",
  card: { presents: "55-year-old man with 90 minutes of substernal pressure. Heart rate 102, BP 98/77.", pmh: "Smoker. No regular medicines. No allergies.", info: ["The ECG shows ST elevation in V1 to V4."] },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }], seed: 3 },
  points: { survive: 30, stable: 25, harm: 20 }, limitS: 900,
  musts: [{ flag: "pciOrdered", label: "activate the cath lab for primary PCI" }],
  checkpoints: [
    {
      id: "plan", atS: 5, forbids: ["pciOrdered"], repeatAfterS: 40,
      prompt: { text: "Anterior ST elevation and 90 minutes of pain. What is your plan?", options: [
        { label: "Aspirin and heparin, and activate the cath lab now", points: 20, correct: true, why: "An occluded artery means muscle dies by the minute.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["The cath lab is activated."] } },
        { label: "Send a troponin and repeat the ECG in an hour", points: -15, correct: false, why: "A STEMI is a clinical and ECG diagnosis.", outcome: { reveal: ["An hour passes. The pain is no better."] } },
      ] },
    },
    { id: "pressure-falls", when: [{ num: "map", op: "<", value: 60 }], forS: 20, outcome: { reveal: ["His pressure is falling."] } },
    { id: "after-pci", when: [{ is: "pci" }], outcome: { end: "success", reveal: ["The artery is open. He goes to the coronary care unit."] } },
  ],
});
export const blankTemplate = () => caseToMarkdown(exampleCase());
