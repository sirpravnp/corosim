import type { PatientSpec } from "../../src/sim/patient";
import type { State } from "./states";

const mx = (
  prefix: "cor" | "anat" | "tx",
  id: string,
  title: string,
  insult: PatientSpec,
  extra: Partial<State> = {},
): State => ({ id: `mx-${prefix}-${id}`, suite: "matrix", invariantsOnly: true, title, insult, ...extra });

const lesion = (artery: string, stenosis?: number, position = 0.2) =>
  ({ artery, position, ...(stenosis === undefined ? { occluded: true } : { stenosis }) });

const lad = (stenosis?: number, position = 0.2) => lesion("LAD", stenosis, position);
const rca = (stenosis?: number, position = 0.2) => lesion("RCA", stenosis, position);
const lcx = (stenosis?: number, position = 0.3) => lesion("LCX", stenosis, position);

const dsTag = (ds: number) => String(Math.round(ds * 100));
const posTag = (p: number) => String(p).replace(".", "p");

const orderPci = (atS: number): State =>
  mx("tx", `lad-occl-pci-at-${atS}s`,
    `Proximal LAD occlusion, PCI ordered at ${atS} s.`,
    { lesions: [lad()] },
    {
      checkpoints: [atS + 40, atS + 80, 180].filter((t, i, a) => t <= 180 && a.indexOf(t) === i),
      actions: [{ atS, label: "order primary PCI", run: (s) => { s.revascularize("pci"); } }],
    });

/**
 * Condition matrix, coronary half. Filled from docs/CONDITION_MATRIX.md sections 2.1, 2.2, 3.1 and 3.2.
 * Suite `matrix`, id prefix `mx-`, invariants only.
 */
export function matrixLesionStates(): State[] {
  const grid: State[] = [];
  const epicardial = ["LM", "LAD", "LCX", "RCA"] as const;
  const stenoses = [0.5, 0.7, 0.75, 0.85, 0.9] as const;

  for (const artery of epicardial) {
    for (const ds of stenoses) {
      grid.push(mx("cor", `${artery.toLowerCase()}-ds${dsTag(ds)}-p${posTag(0.2)}`,
        `${artery} ${dsTag(ds)}% diameter stenosis at position 0.2.`,
        { lesions: [lesion(artery, ds, 0.2)] },
        { checkpoints: [60, 180] }));
    }
    grid.push(mx("cor", `${artery.toLowerCase()}-occl-p${posTag(0.2)}`,
      `${artery} occlusion at position 0.2.`,
      { lesions: [lesion(artery, undefined, 0.2)] },
      { checkpoints: [60, 180] }));
  }

  for (const artery of ["LAD", "LCX", "RCA"] as const) {
    for (const position of [0.5, 0.9] as const) {
      const pos = position;
      grid.push(mx("cor", `${artery.toLowerCase()}-occl-p${posTag(pos)}`,
        `${artery} occlusion at position ${pos}.`,
        { lesions: [lesion(artery, undefined, pos)] },
        { checkpoints: [60, 180] }));
    }
  }

  const branches = ["D1", "D2", "OM1", "OM2", "AM", "CONUS", "SAN", "AVN", "PDA", "PLV"] as const;
  for (const artery of branches) {
    grid.push(mx("cor", `${artery.toLowerCase()}-ds80-p0p3`,
      `${artery} 80% diameter stenosis at position 0.3.`,
      { lesions: [lesion(artery, 0.8, 0.3)] },
      { checkpoints: [60, 180] }));
    grid.push(mx("cor", `${artery.toLowerCase()}-occl-p0p3`,
      `${artery} occlusion at position 0.3.`,
      { lesions: [lesion(artery, undefined, 0.3)] },
      { checkpoints: [60, 180] }));
  }

  const anatomy: State[] = [
    mx("anat", "dom-co", "Co-dominant coronary tree, no lesion.", { anatomy: { dominance: "co" } }, { checkpoints: [60] }),
    mx("anat", "dom-left", "Left-dominant coronary tree, no lesion.", { anatomy: { dominance: "left" } }, { checkpoints: [60] }),
    mx("anat", "lm-trifurcation", "Left main trifurcation, no lesion.", { anatomy: { lm: "trifurcation" } }, { checkpoints: [60] }),
    mx("anat", "lm-absent", "No left main (separate LAD and LCx ostia), no lesion.", { anatomy: { lm: "absent" } }, { checkpoints: [60] }),
    mx("anat", "sanode-lcx", "Sinoatrial node supplied from LCx, no lesion.", { anatomy: { saNodeFrom: "LCx" } }, { checkpoints: [60] }),
    mx("anat", "conus-separate", "Separate conus ostium, no lesion.", { anatomy: { conusOstium: "separate" } }, { checkpoints: [60] }),
    mx("anat", "lad-short", "Short LAD course, no lesion.", { anatomy: { ladCourse: "short" } }, { checkpoints: [60] }),
    mx("anat", "lad-wrap", "Wraparound LAD course, no lesion.", { anatomy: { ladCourse: "wrap" } }, { checkpoints: [60] }),
  ];

  const interact: State[] = [
    mx("cor", "lad-ds60-rest", "LAD 60% diameter stenosis at rest.", { lesions: [lad(0.6)] }, { checkpoints: [60, 180] }),
    mx("cor", "lad-ds60-exertion", "LAD 60% stenosis with exertion.", { lesions: [lad(0.6)], exertion: true }, { checkpoints: [60, 180] }),
    mx("cor", "rca75-lcx75-rest", "RCA 75% and LCX 75% stenosis at rest.", { lesions: [rca(0.75, 0.2), lcx(0.75, 0.3)] }, { checkpoints: [60, 180] }),
    mx("cor", "rca75-lcx75-exertion", "RCA 75% and LCX 75% with exertion.", { lesions: [rca(0.75, 0.2), lcx(0.75, 0.3)], exertion: true }, { checkpoints: [60, 180] }),
    mx("cor", "rca-occl-dom-left", "Proximal RCA occlusion, left-dominant circulation.", { anatomy: { dominance: "left" }, lesions: [rca()] }, { checkpoints: [60, 180] }),
    mx("cor", "rca-occl-dom-co", "Proximal RCA occlusion, co-dominant circulation.", { anatomy: { dominance: "co" }, lesions: [rca()] }, { checkpoints: [60, 180] }),
    mx("cor", "lad-occl-lad-short", "Proximal LAD occlusion, short LAD course.", { anatomy: { ladCourse: "short" }, lesions: [lad()] }, { checkpoints: [60, 180] }),
    mx("cor", "lad-occl-lad-wrap", "Proximal LAD occlusion, wraparound LAD.", { anatomy: { ladCourse: "wrap" }, lesions: [lad()] }, { checkpoints: [60, 180] }),
    mx("cor", "lad-occl-lbbb", "Proximal LAD occlusion with left bundle branch block.", { lesions: [lad()], patient: { bbb: "lbbb" } }, { checkpoints: [60, 180] }),
    mx("cor", "lad-occl-rbbb", "Proximal LAD occlusion with right bundle branch block.", { lesions: [lad()], patient: { bbb: "rbbb" } }, { checkpoints: [60, 180] }),
    mx("cor", "lad-ds80-rca-ds80", "LAD 80% and RCA 80% stenosis at rest.", { lesions: [lad(0.8), rca(0.8)] }, { checkpoints: [60, 180] }),
    mx("cor", "lad-occl-lcx-occl", "Proximal LAD and LCX occlusion.", { lesions: [lad(), lcx()] }, { checkpoints: [60, 180] }),
    mx("cor", "san-occl-sanode-lcx", "SAN occlusion with SA node from LCx.", { anatomy: { saNodeFrom: "LCx" }, lesions: [lesion("SAN", undefined, 0.3)] }, { checkpoints: [60, 180] }),
    mx("cor", "avn-occl-dom-left", "AVN occlusion, left-dominant circulation.", { anatomy: { dominance: "left" }, lesions: [lesion("AVN", undefined, 0.3)] }, { checkpoints: [60, 180] }),
  ];

  const treatment: State[] = [
    orderPci(2),
    orderPci(30),
    orderPci(60),
    mx("tx", "lad-occl-lysis-at-20s",
      "Proximal LAD occlusion, fibrinolysis ordered at 20 s.",
      { lesions: [lad()] },
      {
        checkpoints: [50, 90, 140, 180],
        actions: [{ atS: 20, label: "order fibrinolysis", run: (s) => { s.revascularize("lysis"); } }],
      }),
    mx("tx", "lad-occl-cabg-at-5s",
      "Proximal LAD occlusion, CABG ordered at 5 s.",
      { lesions: [lad()] },
      {
        checkpoints: [150, 180],
        actions: [{ atS: 5, label: "order CABG", run: (s) => { s.revascularize("cabg"); } }],
      }),
    mx("tx", "lad-occl-norepi-50", "Proximal LAD occlusion on norepinephrine 0.5.", { lesions: [lad()], support: { norepinephrine: 0.5 } }, { checkpoints: [60, 180] }),
    mx("tx", "lad-occl-dobutamine-50", "Proximal LAD occlusion on dobutamine 0.5.", { lesions: [lad()], support: { dobutamine: 0.5 } }, { checkpoints: [60, 180] }),
    mx("tx", "rca-occl-nitro-50", "Proximal RCA occlusion on nitroglycerin 0.5.", { lesions: [rca()], support: { nitroglycerin: 0.5 } }, { checkpoints: [60, 180] }),
    mx("tx", "lad-occl-iabp-1-1", "Proximal LAD occlusion with IABP 1:1.", { lesions: [lad()], devices: { iabp: { ratio: 1, volumeMl: 40 } } }, { checkpoints: [60, 180] }),
    mx("tx", "lm-occl-coroPump-cp9", "Left main occlusion with CoroPump CP level 9.", { lesions: [lesion("LM", undefined, 0.5)], devices: { coroPump: { model: "CP", level: 9, position: "correct" } } }, { checkpoints: [60, 180] }),
    mx("tx", "rca-occl-coroPump-rp9", "Proximal RCA occlusion with CoroPump RP level 9.", { lesions: [rca()], septum: true, devices: { coroPumpRp: { level: 9 } } }, { checkpoints: [60, 180] }),
    mx("tx", "lm-occl-ecmo-4", "Left main occlusion, VA-ECMO 4 L/min, no left vent.", { lesions: [lesion("LM", undefined, 0.5)], heart: { lvEes: 0.4 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.8 } } }, { checkpoints: [60, 180] }),
    mx("tx", "lm-occl-ecpella", "Left main occlusion, VA-ECMO 4 L/min plus CoroPump CP level 6.", { lesions: [lesion("LM", undefined, 0.5)], heart: { lvEes: 0.4 }, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.8 }, coroPump: { model: "CP", level: 6, position: "correct" } } }, { checkpoints: [60, 180] }),
    mx("tx", "lad-occl-k75-arr3", "Proximal LAD occlusion, potassium 7.5, arrhythmia tendency 3.", { lesions: [lad()], electrolytes: { potassium: 7.5 }, arrhythmiaTendency: 3 }, { checkpoints: [60, 180] }),
    mx("tx", "k75-arr1-no-lesion", "Potassium 7.5 and arrhythmia tendency 1, no lesion.", { electrolytes: { potassium: 7.5 }, arrhythmiaTendency: 1 }, { checkpoints: [60] }),
    mx("tx", "lad-occl-k75-arr1", "Proximal LAD occlusion, potassium 7.5, arrhythmia tendency 1.", { lesions: [lad()], electrolytes: { potassium: 7.5 }, arrhythmiaTendency: 1 }, { checkpoints: [60, 180] }),
  ];

  return [...grid, ...anatomy, ...interact, ...treatment];
}
