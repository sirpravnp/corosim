import { compileCase, type CaseSpec } from "./spec";

/**
 * High-risk PCI of the left main in a weak ventricle. The lesson is unloading: with the balloon up the left ventricle loses its blood supply and its
 * filling pressure climbs, and a CoroPump put in first keeps it down. The pressure itself holds either way (the baroreflex), so the learner reads LVEDP.
 */
const PUMP = { devices: { coroPump: { level: 6 } } };
const BALLOON = { lesions: [{ artery: "LM", occluded: true }] };

export const PROTECTED_PCI_SPEC: CaseSpec = {
  id: "protected-pci",
  title: "Before the balloon",
  tier: "medium",
  complaint: "Elective PCI",
  devices: ["CoroPump"],
  blurb: "A left main stenosis in a weak ventricle, and a balloon about to go up.",
  card: {
    presents: "68-year-old man on the table for planned PCI of a 90% left main stenosis. He has had no chest pain this week. Heart rate 78, BP 118/72.",
    pmh: "Ischemic cardiomyopathy, ejection fraction 25%. Prior inferior infarct. Declined bypass surgery; the heart team chose PCI.",
    info: ["The left main supplies almost all of the left ventricle. The wire is across the lesion and the balloon is ready."],
  },
  start: { heart: { lvEes: 0.3 }, devices: { coroPump: { model: "CP", level: 0 } }, seed: 5 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 300,
  monitor: ["hr", "bp", "lhc"],
  musts: [
    { flag: "protected", label: "place the CoroPump before the balloon goes up" },
    { flag: "stented", label: "stent the left main with support running" },
  ],
  checkpoints: [
    {
      id: "plan", atS: 5, forbids: ["protected", "balloonUp"], repeatAfterS: 30,
      prompt: {
        text: "The balloon is about to go up in the left main. His ventricle is weak. How do you proceed?",
        options: [
          { label: "Place a CoroPump first, then inflate", points: 25, correct: true, why: "Occluding the left main stops blood flow to nearly the whole ventricle. A weak ventricle cannot eject, so its filling pressure climbs. A pump in the ventricle lowers that pressure and keeps the output going while the balloon is up.", outcome: { flags: ["protected"], patch: PUMP, reveal: ["The CoroPump is in and running at P6. The left ventricular end-diastolic pressure falls."] } },
          { label: "Proceed without support and have a pressor ready", points: -15, correct: false, why: "A pressor lifts the pressure but does nothing for the filling pressure of a ventricle that has lost its blood supply. It also adds work to ischemic muscle.", outcome: { flags: ["balloonUp"], patch: BALLOON, reveal: ["The balloon is inflated in the left main."] } },
          { label: "Place an intra-aortic balloon pump instead", points: 5, correct: false, why: "A balloon pump helps a little with coronary perfusion and afterload but gives no forward flow of its own. It does not unload a ventricle with a big ischemic territory as a CoroPump does.", outcome: { flags: ["balloonUp"], patch: { ...BALLOON, support: { iabp: true } }, reveal: ["The balloon pump is on. The left main balloon is inflated."] } },
          { label: "Give a beta blocker to slow the heart and protect it", points: -20, correct: false, why: "A beta blocker takes contractility from a ventricle that is already failing.", outcome: { flags: ["balloonUp"], patch: { ...BALLOON, drugs: { betaBlocker: 0.5 } }, reveal: ["His heart rate slows. The balloon is inflated in the left main."] } },
        ],
      },
    },
    { id: "inflate", requires: ["protected"], forbids: ["balloonUp"], atS: 30, outcome: { flags: ["balloonUp"], patch: BALLOON, reveal: ["The balloon is inflated in the left main."] } },
    {
      id: "bailout", branch: true, requires: ["balloonUp"], forbids: ["protected"], atS: 50, repeatAfterS: 40,
      prompt: {
        text: "With the balloon up, the left ventricular end-diastolic pressure is climbing and the ventricle barely moves. What do you do?",
        options: [
          { label: "Place a CoroPump now", points: 10, correct: true, why: "Support given late still unloads the ventricle. It is better placed before the balloon goes up, when the margin is widest.", outcome: { flags: ["protected"], patch: PUMP, reveal: ["The CoroPump is placed. The filling pressure starts to fall."] } },
          { label: "Deflate and wait for it to settle", points: -5, correct: false, why: "Deflating gives up the procedure and the same problem returns at the next inflation.", outcome: { reveal: ["The balloon is down, and the pressure stays high."] } },
        ],
      },
    },
    { id: "stent", requires: ["protected", "balloonUp"], atS: 90, outcome: { flags: ["stenting"], order: "pci", reveal: ["Stent deployed in the left main."] } },
    {
      id: "after", requires: ["stenting"], when: [{ is: "pci" }],
      prompt: {
        text: "The left main is open and the pressure is steady. What do you do with the pump?",
        options: [
          { label: "Lower it step by step, then remove it in the lab if the pressures hold", points: 20, correct: true, why: "The pump was there to bridge the balloon time. With the artery open and the pressures holding off support, it comes out and the access site is closed.", outcome: { flags: ["stented"], end: "success", reveal: ["The pump is weaned and removed. The left main is open."] } },
          { label: "Leave it at P6 for several days to be safe", points: -10, correct: false, why: "A pump left in without a need carries bleeding, limb and hemolysis risk and adds nothing once the artery is open.", outcome: { flags: ["stented"], end: "fail", reveal: ["The pump stays in. Days of bleeding and access complications follow."] } },
        ],
      },
    },
  ],
};
export const PROTECTED_PCI = compileCase(PROTECTED_PCI_SPEC);
