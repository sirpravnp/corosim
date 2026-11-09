// Scenarios the first evaluation did not ask. Each one is a question about the solver, not a specification:
// expectation cells stay blank, and this suite is off the nightly job (run it with --suite probe).
//
// Pairs to read against a state that already exists:
//   stenosis ladder vs lad-50-rest, lad-80-rest, lad-prox-occlusion
//   probe-pci-order-* and probe-cabg-order-5 vs lad-occlusion-then-pci and lad-prox-occlusion (infarct at the last checkpoint)
//   probe-hemorrhage-30-x3 / x6 vs hemorrhage-30 at the same clinical minute
//   probe-k75-arr3-lad vs edge-k-7.5, edge-arrhythmia-3 and lad-prox-occlusion
//   probe-leg-raise-bleed vs hemorrhage-30 (leg raise is stored and never read)
//   probe-baro-0-bleed / probe-baro-4-bleed vs hemorrhage-30
//   probe-rca-left-dom vs rca-prox-occlusion
//   probe-chb-paced-70 vs chb, and probe-rca-paced-70 vs rca-prox-occlusion
import type { Simulation } from "../../src/sim/simulation";
import type { PatientSpec } from "../../src/sim/patient";
import { valveSet } from "../../src/sim/valves";
import type { State } from "./states";

const probe = (id: string, title: string, insult: PatientSpec, extra: Partial<State> = {}): State =>
  ({ id: `probe-${id}`, suite: "probe", invariantsOnly: true, title, insult, ...extra });

const lesion = (artery: string, stenosis?: number, position = 0.2) =>
  ({ artery, position, ...(stenosis === undefined ? { occluded: true } : { stenosis }) });

const lad = (stenosis?: number, position = 0.2) => lesion("LAD", stenosis, position);
const rca = (stenosis?: number, position = 0.25) => lesion("RCA", stenosis, position);

const pct = (ds: number) => Math.round(ds * 100);

/** Diameter stenosis at rest. The question is whether ischemic mass, FFR, EF and the ST map move continuously. */
const restStenosis = (artery: string, ds: number, position = 0.2): State =>
  probe(`${artery.toLowerCase()}-${pct(ds)}-rest`,
    `${artery} ${pct(ds)}% diameter stenosis at rest. Does the territory, FFR, output and ST map sit between the neighbouring stenoses, or jump?`,
    { lesions: [lesion(artery, ds, position)] });

const exertStenosis = (artery: string, ds: number): State =>
  probe(`${artery.toLowerCase()}-${pct(ds)}-exertion`,
    `${artery} ${pct(ds)}% stenosis with exertion on. Demand should move a lesion that is quiet at rest.`,
    { lesions: [lesion(artery, ds)], exertion: true });

const orderPci = (atS: number): State => probe(`pci-order-${atS}`,
  `Proximal LAD occlusion, PCI ordered at ${atS} s. The engine then waits 60 clinical minutes. Later orders should leave a larger infarct than earlier ones.`,
  { lesions: [lad()] },
  { checkpoints: [atS + 40, atS + 80, 180].filter((t, i, a) => t <= 180 && a.indexOf(t) === i),
    actions: [{ atS, label: "order primary PCI", run: (s) => { s.revascularize("pci"); } }] });

export function probeStates(): State[] {
  const stenosis: State[] = [];
  for (const ds of [0.6, 0.65, 0.7, 0.75, 0.85, 0.9, 0.95]) stenosis.push(restStenosis("LAD", ds));
  for (const ds of [0.6, 0.7, 0.75, 0.9]) stenosis.push(exertStenosis("LAD", ds));
  for (const ds of [0.7, 0.8, 0.9]) stenosis.push(restStenosis("RCA", ds));
  stenosis.push(restStenosis("LCX", 0.8, 0.3));
  stenosis.push(probe("d1-occlusion", "Diagonal branch occlusion. A small anterior territory, not a proximal LAD.", { lesions: [lesion("D1")] }));
  stenosis.push(probe("om1-occlusion", "Obtuse marginal occlusion. A small lateral territory.", { lesions: [lesion("OM1")] }));
  stenosis.push(probe("lad-mid-occlusion", "Mid LAD occlusion (position 0.5), between the proximal and distal occlusions already run.", { lesions: [lad(undefined, 0.5)] }));
  stenosis.push(probe("lad70-rca70", "LAD 70% and RCA 70% together. Two compensated lesions may stop compensating.", { lesions: [lad(0.7), rca(0.7)] }));
  stenosis.push(probe("lad80-lcx70", "LAD 80% and circumflex 70%.", { lesions: [lad(0.8), lesion("LCX", 0.7, 0.3)] }));
  stenosis.push(probe("lad-occ-rca80", "Proximal LAD occlusion plus RCA 80%.", { lesions: [lad(), rca(0.8)] }));

  const anatomy: State[] = [
    probe("rca-left-dom", "Proximal RCA occlusion, left-dominant circulation. The inferior LV should be smaller than in the right-dominant occlusion.", { anatomy: { dominance: "left" }, lesions: [rca()] }),
    probe("rca-co-dom", "Proximal RCA occlusion, co-dominant circulation.", { anatomy: { dominance: "co" }, lesions: [rca()] }),
    probe("lad-wrap-occ", "Wraparound LAD, proximal occlusion. Inferior leads should join the anterior pattern.", { anatomy: { ladCourse: "wrap" }, lesions: [lad()] }),
    probe("lad-short-occ", "Short LAD, proximal occlusion. The territory should be smaller than a normal-course proximal occlusion.", { anatomy: { ladCourse: "short" }, lesions: [lad()] }),
    probe("lad-lbbb", "Proximal LAD occlusion on a left bundle branch block. ST criteria and the wide QRS should both be visible.", { lesions: [lad()], patient: { bbb: "lbbb" } }),
    probe("lad-rbbb", "Proximal LAD occlusion on a right bundle branch block.", { lesions: [lad()], patient: { bbb: "rbbb" } }),
  ];

  const reperfusion: State[] = [
    orderPci(2),
    orderPci(30),
    orderPci(60),
    probe("cabg-order-5", "Proximal LAD occlusion, CABG ordered at 5 s. The engine waits 240 clinical minutes, so the infarct clock runs through the operation.", { lesions: [lad()] },
      { checkpoints: [150, 180], actions: [{ atS: 5, label: "order CABG", run: (s) => { s.revascularize("cabg"); } }] }),
    probe("lysis-order-20", "Proximal LAD occlusion, fibrinolysis ordered at 20 s (plus the 40 clinical minute delay). One seed is a sample, not a rate.", { lesions: [lad()] },
      { checkpoints: [50, 90, 140], actions: [{ atS: 20, label: "order fibrinolysis", run: (s) => { s.revascularize("lysis"); } }] }),
    probe("lysis-then-pci", "Proximal LAD occlusion, fibrinolysis at 5 s, then PCI at 50 s whether or not the clot opened.", { lesions: [lad()] },
      { checkpoints: [90, 150], actions: [
        { atS: 5, label: "fibrinolysis", run: (s) => { s.revascularize("lysis"); } },
        { atS: 50, label: "PCI", run: (s) => { s.revascularize("pci"); } },
      ] }),
  ];

  const onIschemia: State[] = [
    probe("lad-norepi", "Proximal LAD occlusion on norepinephrine 0.5. Pressure should rise; the infarct should not shrink.", { lesions: [lad()], support: { norepinephrine: 0.5 } }),
    probe("lad-dobutamine", "Proximal LAD occlusion on dobutamine 0.5. Output may rise while demand ischemia and the infarct get worse.", { lesions: [lad()], support: { dobutamine: 0.5 } }),
    probe("lad-nitro", "Proximal LAD occlusion on nitroglycerin 0.5.", { lesions: [lad()], support: { nitroglycerin: 0.5 } }),
    probe("lad-betablocker", "Proximal LAD occlusion on beta blockade 0.8. Rate and demand should fall.", { lesions: [lad()], drugs: { betaBlocker: 0.8 } }),
    probe("lad-fluids", "Proximal LAD occlusion given 1.5 L crystalloid. Filling pressure is already high.", { lesions: [lad()], support: { fluids: 1.5 } }),
    probe("lad-phenyl", "Proximal LAD occlusion on a pure vasoconstrictor (vasopressor dial 1).", { lesions: [lad()], drugs: { vasopressor: 1 } }),
    probe("rca-fluids", "Proximal RCA occlusion given 1.5 L crystalloid. Preload is the RV-infarct question.", { lesions: [rca()], support: { fluids: 1.5 }, septum: true }),
    probe("rca-norepi", "Proximal RCA occlusion on norepinephrine 0.5, septum coupled.", { lesions: [rca()], support: { norepinephrine: 0.5 }, septum: true }),
    probe("lm-pressors", "Left main occlusion on norepinephrine 0.8 and dobutamine 0.5.", { lesions: [lesion("LM", undefined, 0.5)], support: { norepinephrine: 0.8, dobutamine: 0.5 } }),
    probe("k75-arr3-lad", "Potassium 7.5 and arrhythmia tendency 3 on a proximal LAD occlusion. Each dial alone reproduced the healthy heart.", { lesions: [lad()], electrolytes: { potassium: 7.5 }, arrhythmiaTendency: 3 }),
    probe("k25-ectopy3-lad", "Potassium 2.5 and ectopy tendency 3 on a proximal LAD occlusion.", { lesions: [lad()], electrolytes: { potassium: 2.5 }, ectopyTendency: 3 }),
    probe("mg03-arr3-lad", "Magnesium 0.3 and arrhythmia tendency 3 on a proximal LAD occlusion.", { lesions: [lad()], electrolytes: { magnesium: 0.3 }, arrhythmiaTendency: 3 }),
    probe("k75-mg04-arr3-lad", "Potassium 7.5, magnesium 0.4 and arrhythmia tendency 3 on a proximal LAD occlusion.", { lesions: [lad()], electrolytes: { potassium: 7.5, magnesium: 0.4 }, arrhythmiaTendency: 3 }),
  ];

  const rhythm: State[] = [
    probe("af-rvr", "Atrial fibrillation with a rapid ventricular response, no lesion.", { patient: { rhythm: "af-rvr" } }),
    probe("flutter-21", "Atrial flutter with 2:1 conduction.", { patient: { rhythm: "flutter-21" } }),
    probe("svt", "AV nodal re-entrant tachycardia.", { patient: { rhythm: "svt" } }),
    probe("wenckebach", "Mobitz I. The coronary model also grows its own AV block under RCA ischemia; this is the library rhythm.", { patient: { rhythm: "wenckebach" } }),
    probe("mobitz2", "Mobitz II.", { patient: { rhythm: "mobitz2" } }),
    probe("torsades", "Torsades de pointes, no treatment.", { patient: { rhythm: "torsades" } }, { checkpoints: [10, 30, 60] }),
    probe("vt-poly", "Polymorphic VT, no treatment.", { patient: { rhythm: "vt-poly" } }, { checkpoints: [10, 30, 60] }),
    probe("asystole", "Asystole, no CPR and no drug.", { patient: { rhythm: "asystole" } }, { checkpoints: [10, 30, 60] }),
    probe("hypothermia", "Hypothermia preset on an otherwise healthy heart.", { patient: { rhythm: "hypothermia" } }),
    probe("hyperk-rhythm", "Library hyperkalemia tracing. This is a rhythm preset, not electrolytes.potassium.", { patient: { rhythm: "hyperk" } }),
    probe("hyperk-sine", "Severe hyperkalemia sine wave, library preset.", { patient: { rhythm: "hyperk-sine" } }, { checkpoints: [10, 30, 60] }),
    probe("paced-library", "Library ventricular paced rhythm at 70, pacing support left off.", { patient: { rhythm: "paced" } }),
    probe("chb-paced-70", "Library complete heart block with pacing forced on at 70. External pacing over a library rhythm is currently described as not modelled.", { patient: { rhythm: "chb" }, support: { pacing: true, paceRate: 70 } }),
    probe("rca-paced-70", "Proximal RCA occlusion with pacing at 70. Capture should be judged on the ventricular escape, not the atrial rate.", { lesions: [rca()], support: { pacing: true, paceRate: 70 } }),
    probe("af-hemorrhage-30", "New atrial fibrillation plus 30% blood loss.", { patient: { rhythm: "af" }, bloodLoss: 0.3 }),
    probe("as-af-rvr", "Severe aortic stenosis in atrial fibrillation with a rapid rate. A stiff valve and a short diastole.", { patient: { rhythm: "af-rvr" }, heart: { valves: valveSet({ av: { stenosis: 0.95 } }) } }),
  ];

  const arrest: State[] = [
    probe("vf-cpr", "VF, CPR started at 5 s, no shock.", { patient: { rhythm: "vf-coarse" } },
      { checkpoints: [15, 40], actions: [{ atS: 5, label: "start CPR", run: (s) => { s.startCpr({ rate: 110, depthCm: 5, quality: 0.8 }); } }] }),
    probe("vf-cpr-epi-shock", "VF, CPR at 5 s, epinephrine at 15 s, 200 J shock at 25 s.", { patient: { rhythm: "vf-coarse" } },
      { checkpoints: [20, 30, 50], actions: [
        { atS: 5, label: "CPR", run: (s) => { s.startCpr({ rate: 110, depthCm: 5, quality: 0.8 }); } },
        { atS: 15, label: "epinephrine 1 mg", run: (s) => { s.giveDrug("epinephrine", 1); } },
        { atS: 25, label: "shock 200 J", run: (s) => { s.shock({ joules: 200 }); } },
      ] }),
    probe("asystole-cpr-epi", "Asystole, CPR at 5 s and epinephrine at 15 s. A shock is not part of this state.", { patient: { rhythm: "asystole" } },
      { checkpoints: [20, 45], actions: [
        { atS: 5, label: "CPR", run: (s) => { s.startCpr(); } },
        { atS: 15, label: "epinephrine 1 mg", run: (s) => { s.giveDrug("epinephrine", 1); } },
      ] }),
    probe("sinus-unsync-shock", "Unsynchronized 200 J shock on a perfusing sinus rhythm at 10 s. The machine may induce VF.", { patient: { rhythm: "sinus" } },
      { checkpoints: [15, 40], actions: [{ atS: 10, label: "unsync shock 200 J", run: (s) => { s.shock({ joules: 200, sync: false }); } }] }),
    probe("af-rvr-cardiovert", "Synchronized 100 J cardioversion of AF with a rapid rate at 10 s.", { patient: { rhythm: "af-rvr" } },
      { checkpoints: [15, 40], actions: [{ atS: 10, label: "sync shock 100 J", run: (s) => { s.shock({ joules: 100, sync: true }); } }] }),
    probe("vt-sync-shock", "Synchronized 100 J shock for monomorphic VT at 10 s.", { patient: { rhythm: "vt-mono" } },
      { checkpoints: [15, 40], actions: [{ atS: 10, label: "sync shock 100 J", run: (s) => { s.shock({ joules: 100, sync: true }); } }] }),
  ];

  const volume: State[] = [
    probe("bleed-then-blood", "30% blood loss, then 800 ml of blood at 15 s.", { bloodLoss: 0.3 },
      { actions: [{ atS: 15, label: "transfuse 800 ml", run: (s) => { s.apply({ fluids: { given: [{ kind: "blood", ml: 800 }] } }); } }] }),
    probe("bleed-then-crystalloid", "45% blood loss, then 1.5 L crystalloid at 15 s.", { bloodLoss: 0.45 },
      { actions: [{ atS: 15, label: "1.5 L crystalloid", run: (s) => { s.apply({ support: { fluids: 1.5 } }); } }] }),
    probe("bleed45-norepi", "45% blood loss already on norepinephrine 0.6.", { bloodLoss: 0.45, support: { norepinephrine: 0.6 } }),
    probe("bleed-then-stop", "Bleeding at 100 ml/min, stopped at 15 s.", { fluids: { hemorrhageMlMin: 100 } },
      { checkpoints: [10, 20, 60, 120], actions: [{ atS: 15, label: "stop the bleed", run: (s) => { s.apply({ fluids: { hemorrhageMlMin: 0 } }); } }] }),
    probe("leak", "Capillary leak 0.8, no pressor and no volume. A sepsis-shaped loss without a lesion.", { fluids: { capillaryLeak: 0.8 } }),
    probe("leak-resus", "Capillary leak 0.8 with norepinephrine 0.6 and 2 L crystalloid.", { fluids: { capillaryLeak: 0.8 }, support: { norepinephrine: 0.6, fluids: 2 } }),
    probe("leg-raise-bleed", "30% blood loss with passive leg raise on. The control is shown on the page and read by nothing in the physics.", { bloodLoss: 0.3, fluids: { legRaise: true } }),
    probe("baro-0-bleed", "30% blood loss with the baroreflex gain at 0. The tachycardia should shrink if it is a reflex.", { bloodLoss: 0.3, autonomic: { baroreflexGain: 0 } }),
    probe("baro-4-bleed", "30% blood loss with the baroreflex gain at 4.", { bloodLoss: 0.3, autonomic: { baroreflexGain: 4 } }),
    probe("peep-rv", "PEEP 15 cmH2O, positive pressure, a weak right ventricle, septum coupled.", { ventilation: { mode: "positive", peep: 15 }, heart: { rvEes: 0.4 }, septum: true }),
  ];

  const rightHeart: State[] = [
    probe("pvr-8", "Pulmonary vascular resistance raised to 8 Wood units·m², septum coupled.", { heart: { pvri: 8 }, septum: true }),
    probe("pvr-20", "Pulmonary vascular resistance 20 Wood units·m², a massive pulmonary-embolism shape, septum coupled.", { heart: { pvri: 20 }, septum: true }),
    probe("rv-fail", "Isolated weak right ventricle (Ees 0.35), septum coupled, no lung disease.", { heart: { rvEes: 0.35, rvContractility: 0.4 }, septum: true }),
    probe("rv-infarct", "Proximal RCA occlusion, weak RV, septum coupled. The RV-infarct pattern.", { lesions: [rca()], heart: { rvEes: 0.4, rvContractility: 0.5 }, septum: true }),
    probe("tamponade-80", "Pericardial effusion 80 ml.", { pericardium: { effusionMl: 80 }, septum: true }),
    probe("tamponade-160", "Pericardial effusion 160 ml.", { pericardium: { effusionMl: 160 }, septum: true }),
    probe("tamponade-then-drain", "Effusion 200 ml, then 100 ml drained at 15 s. Pulsus and the pressure should ease; the rate of accumulation stays.", { pericardium: { effusionMl: 200 }, septum: true },
      { actions: [{ atS: 15, label: "drain 100 ml", run: (s) => { s.apply({ pericardium: { drainMl: 100 } }); } }] }),
    probe("tamponade-accum", "Effusion starting at 40 ml and accumulating at 5 ml per clinical minute.", { pericardium: { effusionMl: 40, effusionRateMlMin: 5 }, septum: true }),
    probe("constriction", "Pericardial stiffness 3, a constrictive sac with 40 ml in it.", { pericardium: { effusionMl: 40, stiffness: 3 } }),
  ];

  const valves: State[] = [
    probe("as-hemorrhage", "Severe aortic stenosis plus 30% blood loss. Fixed output, less room to compensate.", { bloodLoss: 0.3, heart: { valves: valveSet({ av: { stenosis: 0.95 } }) } }),
    probe("mr-papillary", "Proximal LAD occlusion plus acute severe mitral regurgitation. A papillary-muscle shape.", { lesions: [lad()], heart: { valves: valveSet({ mv: { regurgitation: 0.8 } }) } }),
    probe("ms-af-rvr", "Mitral stenosis in AF with a rapid rate.", { patient: { rhythm: "af-rvr" }, heart: { valves: valveSet({ mv: { stenosis: 0.75 } }) } }),
    probe("ar-exertion", "Aortic regurgitation with exertion on.", { exertion: true, heart: { valves: valveSet({ av: { regurgitation: 0.6 } }) } }),
    probe("tof", "Tetralogy: 14 mm VSD, RVOT fraction 0.45, 50% override.", { heart: { tof: { vsdMm: 14, rvotFrac: 0.45, override: 0.5, rvHypertrophy: 1.4 } } }),
    probe("vsd-15", "Ventricular septal defect 15 mm. The 8 mm defect is already in the valve suite.", { heart: { vsd: { diameterMm: 15 } } }),
  ];

  const devices: State[] = [
    probe("lm-iabp", "Left main occlusion with an intra-aortic balloon.", { lesions: [lesion("LM", undefined, 0.5)], devices: { iabp: { ratio: 1, volumeMl: 40 } } }),
    probe("lm-iabp-early", "Left main occlusion with the balloon inflating 40 ms early.", { lesions: [lesion("LM", undefined, 0.5)], devices: { iabp: { ratio: 1, volumeMl: 40, inflateMs: -40 } } }),
    probe("lad-coroPump-p2", "Proximal LAD occlusion, CoroPump CP at P2.", { lesions: [lad()], devices: { coroPump: { model: "CP", level: 2, position: "correct" } } }),
    probe("lad-coroPump-p8", "Proximal LAD occlusion, CoroPump CP at P8.", { lesions: [lad()], devices: { coroPump: { model: "CP", level: 8, position: "correct" } } }),
    probe("lad-coropump-aortic", "Proximal LAD occlusion, CoroPump sitting in the aorta.", { lesions: [lad()], devices: { coroPump: { model: "CP", level: 6, position: "aortic" } } }),
    probe("lad-coropump-deep", "Proximal LAD occlusion, CoroPump too deep.", { lesions: [lad()], devices: { coroPump: { model: "CP", level: 6, position: "deep" } } }),
    probe("rca-rp-9", "Proximal RCA occlusion, CoroPump RP at level 9, septum coupled.", { lesions: [rca()], septum: true, devices: { coroPumpRp: { level: 9 } } }),
    probe("rca-rp-0", "Proximal RCA occlusion, CoroPump RP present at level 0. Level 0 on a present RP pump ran backward in the sweep.", { lesions: [rca()], septum: true, devices: { coroPumpRp: { level: 0 } } }),
    probe("lm-coroPump-55", "Left main occlusion, CoroPump 5.5 at P8.", { lesions: [lesion("LM", undefined, 0.5)], devices: { coroPump: { model: "5.5", level: 8, position: "correct" } } }),
    probe("lm-ecmo", "Left main occlusion, VA-ECMO set to 4 L/min, poor LV, no left-sided vent.", { lesions: [lesion("LM", undefined, 0.5)], heart: { lvEes: 0.4 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.8 } } }),
    probe("lm-ecpella", "Left main occlusion, VA-ECMO 4 L/min plus CoroPump CP at P6.", { lesions: [lesion("LM", undefined, 0.5)], heart: { lvEes: 0.4 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.8 }, coroPump: { model: "CP", level: 6, position: "correct" } } }),
    probe("lad-ecmo-later", "Proximal LAD occlusion with ECMO in the heart at 0 L/min, then set to 4 L/min at 20 s.", { lesions: [lad()], devices: { ecmo: { flowLpm: 0, sweepLpm: 2, fio2: 0.6 } } },
      { actions: [{ atS: 20, label: "ECMO 4 L/min", run: (s) => { s.apply({ devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 } } }); } }] }),
  ];

  const gas: State[] = [
    probe("hypoxia", "Lung saturation 0.80, no lesion and no shunt.", { heart: { satLung: 0.8 } }),
    probe("peep-10", "Positive pressure ventilation, PEEP 10, a healthy heart.", { ventilation: { mode: "positive", peep: 10, tidalMlKg: 8 } }),
  ];

  const clocks: State[] = [
    probe("hemorrhage-30-x3", "30% blood loss at 3x. Checkpoints are about 12, 42, 120 and 360 clinical minutes. Compare heart rate and pressure with hemorrhage-30 at 1x.", { bloodLoss: 0.3 },
      { speed: 3, checkpoints: [2, 7, 20, 60] }),
    probe("hemorrhage-30-x6", "30% blood loss at 6x. Checkpoints are about 12, 36, 120 and 360 clinical minutes.", { bloodLoss: 0.3 },
      { speed: 6, checkpoints: [1, 3, 10, 30] }),
    probe("lad-prox-x6", "Proximal LAD occlusion at 6x, same clinical windows as probe-hemorrhage-30-x6. Infarct fraction should match 1x; heart rate may not.", { lesions: [lad()] },
      { speed: 6, checkpoints: [1, 3, 10, 30] }),
  ];

  return [...stenosis, ...anatomy, ...reperfusion, ...onIschemia, ...rhythm, ...volume, ...rightHeart, ...valves, ...devices, ...gas, ...clocks, ...arrest];
}
