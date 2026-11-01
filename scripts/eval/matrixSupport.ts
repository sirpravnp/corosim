import type { Simulation } from "../../src/sim/simulation";
import type { PatientSpec } from "../../src/sim/patient";
import type { State } from "./states";

const ladOcc = { artery: "LAD" as const, occluded: true as const, position: 0.2 };
const lmOcc = { artery: "LM" as const, occluded: true as const, position: 0.5 };

const cp60: number[] = [60];
const cp60_180: number[] = [60, 180];

/** Matrix support section: suite `matrix`, prefix `mx-sup-`, invariants only. */
const mx = (slug: string, title: string, insult: PatientSpec, extra: Partial<State> = {}): State => {
  const { checkpoints: cps, ...rest } = extra;
  return {
    id: `mx-sup-${slug}`,
    suite: "matrix",
    invariantsOnly: true,
    title,
    insult,
    checkpoints: cps ?? cp60,
    ...rest,
  };
};

function singles(): State[] {
  const out: State[] = [];

  for (const [slug, mm, title] of [
    ["asd-5", 5, "ASD 5 mm"],
    ["asd-15", 15, "ASD 15 mm"],
    ["asd-30", 30, "ASD 30 mm"],
  ] as const) out.push(mx(slug, title, { heart: { asd: { diameterMm: mm } } }));

  for (const [slug, mm, title] of [
    ["vsd-3", 3, "VSD 3 mm"],
    ["vsd-8", 8, "VSD 8 mm"],
    ["vsd-20", 20, "VSD 20 mm"],
  ] as const) out.push(mx(slug, title, { heart: { vsd: { diameterMm: mm } } }));

  for (const [slug, mm, title] of [
    ["pda-2", 2, "PDA 2 mm"],
    ["pda-4", 4, "PDA 4 mm"],
    ["pda-8", 8, "PDA 8 mm"],
  ] as const) out.push(mx(slug, title, { heart: { pda: { diameterMm: mm } } }));

  for (const [slug, mm, title] of [
    ["bt-3", 3, "Blalock–Taussig shunt 3 mm"],
    ["bt-5", 5, "Blalock–Taussig shunt 5 mm"],
  ] as const) out.push(mx(slug, title, { heart: { bt: { diameterMm: mm } } }));

  out.push(mx("tof-moderate", "Tetralogy of Fallot, moderate", {
    heart: { tof: { vsdMm: 14, rvotFrac: 0.45, override: 0.5, rvHypertrophy: 1.4 } },
  }));
  out.push(mx("tof-spasm", "Tetralogy of Fallot with infundibular spasm", {
    heart: { tof: { vsdMm: 14, rvotFrac: 0.45, override: 0.5, spasm: 0.5, rvHypertrophy: 1.4 } },
  }));

  for (const [slug, pvri, title] of [
    ["pvri-3", 3, "PVRI 3 Wood·m²"],
    ["pvri-8", 8, "PVRI 8 Wood·m²"],
    ["pvri-20", 20, "PVRI 20 Wood·m²"],
  ] as const) out.push(mx(slug, title, { heart: { pvri } }));

  out.push(mx("svr-0p5", "Systemic vascular resistance scale 0.5", { heart: { svrScale: 0.5 } }));
  out.push(mx("svr-2", "Systemic vascular resistance scale 2", { heart: { svrScale: 2 } }));

  out.push(mx("satlung-0p75", "Lung saturation 0.75", { heart: { satLung: 0.75 } }));
  out.push(mx("satlung-0p98", "Lung saturation 0.98", { heart: { satLung: 0.98 } }));

  out.push(mx("vol-neg500", "Blood volume −500 ml", { heart: { volumeMl: -500 } }));
  out.push(mx("vol-pos500", "Blood volume +500 ml", { heart: { volumeMl: 500 } }));

  for (const ch of ["lv", "rv", "la", "ra"] as const) {
    out.push(mx(`${ch}size-0p5`, `${ch.toUpperCase()} size scale 0.5`, { heart: { [`${ch}Size`]: 0.5 } } as PatientSpec));
    out.push(mx(`${ch}size-1p8`, `${ch.toUpperCase()} size scale 1.8`, { heart: { [`${ch}Size`]: 1.8 } } as PatientSpec));
  }

  out.push(mx("lvees-0p4", "LV elastance 0.4", { heart: { lvEes: 0.4 } }));
  out.push(mx("lvees-2", "LV elastance 2", { heart: { lvEes: 2 } }));
  out.push(mx("rvees-0p4", "RV elastance 0.4", { heart: { rvEes: 0.4 } }));
  out.push(mx("rvees-2", "RV elastance 2", { heart: { rvEes: 2 } }));
  out.push(mx("lvstiff-0p5", "LV stiffness 0.5", { heart: { lvStiffness: 0.5 } }));
  out.push(mx("lvstiff-2", "LV stiffness 2", { heart: { lvStiffness: 2 } }));
  out.push(mx("rvstiff-0p5", "RV stiffness 0.5", { heart: { rvStiffness: 0.5 } }));
  out.push(mx("rvstiff-2", "RV stiffness 2", { heart: { rvStiffness: 2 } }));
  out.push(mx("rvcontract-0p4", "RV contractility 0.4", { heart: { rvContractility: 0.4 } }));
  out.push(mx("rvcontract-2", "RV contractility 2", { heart: { rvContractility: 2 } }));
  out.push(mx("septum-on", "Ventricular septum coupled", { septum: true }));

  for (const [slug, ml, title] of [
    ["eff-100", 100, "Pericardial effusion 100 ml"],
    ["eff-400", 400, "Pericardial effusion 400 ml"],
    ["eff-800", 800, "Pericardial effusion 800 ml"],
  ] as const) out.push(mx(slug, title, { pericardium: { effusionMl: ml, stiffness: 1 } }));

  out.push(mx("effusion-400-septum", "Effusion 400 ml, septum on", {
    pericardium: { effusionMl: 400, stiffness: 1 }, septum: true,
  }));
  out.push(mx("effusion-400-open", "Effusion 400 ml, open pericardium", {
    pericardium: { effusionMl: 400, stiffness: 1, open: true },
  }));

  out.push(mx("eff-rate-20", "Effusion accumulating 20 ml/min", { pericardium: { effusionRateMlMin: 20 } }));
  out.push(mx("peri-stiff-0p5", "Pericardial stiffness 0.5", { pericardium: { stiffness: 0.5 } }));
  out.push(mx("peri-stiff-4", "Pericardial stiffness 4", { pericardium: { stiffness: 4 } }));
  out.push(mx("peri-open", "Open pericardium, no effusion", { pericardium: { open: true } }));

  for (const [slug, bl, title] of [
    ["bloodloss-neg0p3", -0.3, "Blood volume overload fraction −0.3"],
    ["bloodloss-neg0p2", -0.2, "Blood volume overload fraction −0.2"],
    ["bloodloss-0p15", 0.15, "Acute blood loss 15%"],
    ["bloodloss-0p3", 0.3, "Acute blood loss 30%"],
    ["bloodloss-0p45", 0.45, "Acute blood loss 45%"],
    ["bloodloss-0p6", 0.6, "Acute blood loss 60%"],
  ] as const) out.push(mx(slug, title, { bloodLoss: bl }));

  out.push(mx("hemorrhage-20", "Ongoing hemorrhage 20 ml/min", { fluids: { hemorrhageMlMin: 20 } }));
  out.push(mx("hemorrhage-100", "Ongoing hemorrhage 100 ml/min", { fluids: { hemorrhageMlMin: 100 } }, { checkpoints: cp60_180 }));

  out.push(mx("fluid-crystalloid-1l", "1 L crystalloid over 5 clinical minutes", {
    fluids: { given: [{ kind: "crystalloid", ml: 1000, atMin: 0, overMin: 5 }] },
  }));
  out.push(mx("fluid-blood-500", "500 ml blood bolus", { fluids: { given: [{ kind: "blood", ml: 500 }] } }));
  out.push(mx("fluid-albumin-500", "500 ml albumin bolus", { fluids: { given: [{ kind: "albumin", ml: 500 }] } }));

  for (const [slug, v, title] of [
    ["support-fluids-0p5", 0.5, "Crystalloid support dial 0.5 L"],
    ["support-fluids-1p5", 1.5, "Crystalloid support dial 1.5 L"],
    ["support-fluids-3", 3, "Crystalloid support dial 3 L"],
  ] as const) out.push(mx(slug, title, { support: { fluids: v } }));

  out.push(mx("cap-leak-0p6", "Capillary leak 0.6", { fluids: { capillaryLeak: 0.6 } }));
  out.push(mx("leg-raise", "Passive leg raise on", { fluids: { legRaise: true } }));

  out.push(mx("beta-blocker-0p8", "Beta blocker 0.8", { drugs: { betaBlocker: 0.8 } }));
  out.push(mx("atropine-1", "Atropine 1", { drugs: { atropine: 1 } }));
  out.push(mx("vasopressor-neg1", "Vasopressor dial −1", { drugs: { vasopressor: -1 } }));
  out.push(mx("vasopressor-1", "Vasopressor dial 1", { drugs: { vasopressor: 1 } }));

  for (const [slug, v, title] of [
    ["norepi-0p5", 0.5, "Norepinephrine 0.5, healthy"],
    ["norepi-1", 1, "Norepinephrine 1, healthy"],
    ["dobu-0p5", 0.5, "Dobutamine 0.5, healthy"],
    ["dobu-1", 1, "Dobutamine 1, healthy"],
    ["nitro-0p5", 0.5, "Nitroglycerin 0.5, healthy"],
    ["nitro-1", 1, "Nitroglycerin 1, healthy"],
    ["epi-0p5", 0.5, "Epinephrine 0.5, healthy"],
    ["milrinone-0p5", 0.5, "Milrinone 0.5, healthy"],
    ["vasopressin-0p5", 0.5, "Vasopressin 0.5, healthy"],
    ["nitroprusside-0p5", 0.5, "Nitroprusside 0.5, healthy"],
    ["furosemide-1", 1, "Furosemide 1, healthy"],
    ["diltiazem-0p5", 0.5, "Diltiazem 0.5, healthy"],
  ] as const) {
    const key = slug.startsWith("norepi") ? "norepinephrine"
      : slug.startsWith("dobu") ? "dobutamine"
      : slug.startsWith("nitro-") ? "nitroglycerin"
      : slug.startsWith("nitroprusside") ? "nitroprusside"
      : slug.startsWith("epi") ? "epinephrine"
      : slug.startsWith("milrinone") ? "milrinone"
      : slug.startsWith("vasopressin") ? "vasopressin"
      : slug.startsWith("furosemide") ? "furosemide"
      : "diltiazem";
    out.push(mx(slug, title, { support: { [key]: v } }));
  }

  for (const [slug, rate, title] of [
    ["pace-70", 70, "Ventricular pacing at 70"],
    ["pace-40", 40, "Ventricular pacing at 40"],
    ["pace-110", 110, "Ventricular pacing at 110"],
  ] as const) out.push(mx(slug, title, { support: { pacing: true, paceRate: rate } }));

  out.push(mx("ectopy-1", "Ectopy tendency 1", { ectopyTendency: 1 }));
  out.push(mx("ectopy-3", "Ectopy tendency 3", { ectopyTendency: 3 }));
  out.push(mx("arrhythmia-1", "Arrhythmia tendency 1", { arrhythmiaTendency: 1 }));
  out.push(mx("arrhythmia-3", "Arrhythmia tendency 3", { arrhythmiaTendency: 3 }));

  out.push(mx("k-4p2", "Potassium 4.2 mmol/L (quiet control)", { electrolytes: { potassium: 4.2 } }, { checkpoints: cp60_180 }));
  out.push(mx("k-2p0", "Potassium 2.0 mmol/L", { electrolytes: { potassium: 2.0 } }, { checkpoints: cp60_180 }));
  out.push(mx("k-3p0", "Potassium 3.0 mmol/L", { electrolytes: { potassium: 3.0 } }));
  out.push(mx("k-6p0", "Potassium 6.0 mmol/L", { electrolytes: { potassium: 6.0 } }));
  out.push(mx("k-7p5-arr1", "Potassium 7.5, arrhythmia tendency 1, no lesion", {
    electrolytes: { potassium: 7.5 }, arrhythmiaTendency: 1,
  }, { checkpoints: cp60_180 }));

  out.push(mx("mg-0p2", "Magnesium 0.2 mmol/L", { electrolytes: { magnesium: 0.2 } }));
  out.push(mx("mg-3p0", "Magnesium 3.0 mmol/L", { electrolytes: { magnesium: 3.0 } }));

  out.push(mx("baro-gain-0", "Baroreflex gain 0 at rest", { autonomic: { baroreflexGain: 0 } }));
  out.push(mx("baro-gain-4", "Baroreflex gain 4 at rest", { autonomic: { baroreflexGain: 4 } }));
  out.push(mx("baro-set-neg10", "Baroreflex set-point shift −10", { autonomic: { setPointShift: -10 } }));
  out.push(mx("baro-set-pos10", "Baroreflex set-point shift +10", { autonomic: { setPointShift: 10 } }));

  // Shunts with elevated PVRI (section 2.5)
  out.push(mx("asd15-pvri20", "ASD 15 mm with PVRI 20", { heart: { asd: { diameterMm: 15 }, pvri: 20 } }));
  out.push(mx("vsd8-pvri20", "VSD 8 mm with PVRI 20", { heart: { vsd: { diameterMm: 8 }, pvri: 20 } }));
  out.push(mx("pda4-pvri20", "PDA 4 mm with PVRI 20", { heart: { pda: { diameterMm: 4 }, pvri: 20 } }));

  // IABP levels (healthy heart)
  out.push(mx("iabp-1to1", "IABP 1:1, 40 ml", { devices: { iabp: { ratio: 1, volumeMl: 40 } } }));
  out.push(mx("iabp-1to2", "IABP 1:2, 40 ml", { devices: { iabp: { ratio: 2, volumeMl: 40 } } }));
  out.push(mx("iabp-1to3", "IABP 1:3, 40 ml", { devices: { iabp: { ratio: 3, volumeMl: 40 } } }));
  out.push(mx("iabp-inflate-neg40", "IABP inflate 40 ms early", { devices: { iabp: { ratio: 1, volumeMl: 40, inflateMs: -40 } } }));
  out.push(mx("iabp-inflate-pos40", "IABP inflate 40 ms late", { devices: { iabp: { ratio: 1, volumeMl: 40, inflateMs: 40 } } }));
  out.push(mx("iabp-vol-20", "IABP balloon 20 ml", { devices: { iabp: { ratio: 1, volumeMl: 20 } } }));
  out.push(mx("iabp-vol-40", "IABP balloon 40 ml", { devices: { iabp: { ratio: 1, volumeMl: 40 } } }));

  // Impella CP on healthy via support dial (P6 correct)
  out.push(mx("impella-cp-p6", "Impella CP level 6, correct position, healthy", { support: { impella: true } }));

  for (const [slug, model, title] of [
    ["impella-2p5-p9", "2.5", "Impella 2.5 at P9, healthy"],
    ["impella-cp-p9", "CP", "Impella CP at P9, healthy"],
    ["impella-5p5-p9", "5.5", "Impella 5.5 at P9, healthy"],
  ] as const) {
    out.push(mx(slug, title, { devices: { impella: { model, level: 9, position: "correct" } } }));
  }

  out.push(mx("impella-pos-aortic", "Impella CP P6, aortic position, healthy", {
    devices: { impella: { model: "CP", level: 6, position: "aortic" } },
  }));
  out.push(mx("impella-pos-deep", "Impella CP P6, deep position, healthy", {
    devices: { impella: { model: "CP", level: 6, position: "deep" } },
  }));
  out.push(mx("impella-p0-device", "Impella CP present at P0, healthy", {
    devices: { impella: { model: "CP", level: 0, position: "correct" } },
  }));

  out.push(mx("impella-rp-p0", "Impella RP present at level 0, healthy", { devices: { impellaRp: { level: 0 } } }));
  out.push(mx("impella-rp-p9", "Impella RP level 9, healthy", { devices: { impellaRp: { level: 9 } } }));

  for (const [slug, flow, title] of [
    ["ecmo-2", 2, "VA-ECMO 2 L/min, healthy"],
    ["ecmo-4", 4, "VA-ECMO 4 L/min, healthy"],
    ["ecmo-6", 6, "VA-ECMO 6 L/min, healthy"],
  ] as const) {
    out.push(mx(slug, title, { devices: { ecmo: { flowLpm: flow, sweepLpm: 2, fio2: 0.6 } } }));
  }
  out.push(mx("ecmo-sweep-0", "VA-ECMO 4 L/min, sweep 0", { devices: { ecmo: { flowLpm: 4, sweepLpm: 0, fio2: 0.6 } } }));
  out.push(mx("ecmo-sweep-5", "VA-ECMO 4 L/min, sweep 5", { devices: { ecmo: { flowLpm: 4, sweepLpm: 5, fio2: 0.6 } } }));
  out.push(mx("ecmo-fio2-0p21", "VA-ECMO 4 L/min, FiO2 0.21", { devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.21 } } }));
  out.push(mx("ecmo-fio2-1", "VA-ECMO 4 L/min, FiO2 1", { devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 1 } } }));
  out.push(mx("ecpella", "ECPELLA: ECMO 4 L/min plus Impella CP P6", {
    devices: {
      ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 },
      impella: { model: "CP", level: 6, position: "correct" },
    },
  }));

  out.push(mx("vent-positive", "Positive-pressure ventilation, PEEP 5", { ventilation: { mode: "positive", peep: 5, tidalMlKg: 8 } }));
  out.push(mx("vent-peep-5", "Spontaneous breathing, PEEP 5", { ventilation: { mode: "spontaneous", peep: 5 } }));
  out.push(mx("vent-peep15-spont", "PEEP 15, spontaneous mode", { ventilation: { mode: "spontaneous", peep: 15 } }));
  out.push(mx("vent-peep15-pos", "PEEP 15, positive pressure", { ventilation: { mode: "positive", peep: 15, tidalMlKg: 8 } }));
  out.push(mx("vent-tidal-4", "Tidal volume 4 ml/kg, positive pressure", { ventilation: { mode: "positive", peep: 5, tidalMlKg: 4 } }));
  out.push(mx("vent-tidal-8", "Tidal volume 8 ml/kg, positive pressure", { ventilation: { mode: "positive", peep: 5, tidalMlKg: 8 } }));

  return out;
}

function interactions(): State[] {
  const out: State[] = [];

  out.push(mx("bleed30-baro0", "30% blood loss, baroreflex gain 0", { bloodLoss: 0.3, autonomic: { baroreflexGain: 0 } }));
  out.push(mx("bleed30-baro4", "30% blood loss, baroreflex gain 4", { bloodLoss: 0.3, autonomic: { baroreflexGain: 4 } }));
  out.push(mx("bleed30-legraise", "30% blood loss with passive leg raise", { bloodLoss: 0.3, fluids: { legRaise: true } }));
  out.push(mx("bleed30-norepi0p5", "30% blood loss plus norepinephrine 0.5", { bloodLoss: 0.3, support: { norepinephrine: 0.5 } }));
  out.push(mx("hem100-norepi1", "Hemorrhage 100 ml/min plus norepinephrine 1", {
    fluids: { hemorrhageMlMin: 100 }, support: { norepinephrine: 1 },
  }, { checkpoints: cp60_180 }));

  out.push(mx("bleed30-speed1", "30% blood loss at speed 1, read at 10 clinical minutes", { bloodLoss: 0.3 }, { speed: 1, checkpoints: [5] }));
  out.push(mx("bleed30-speed3", "30% blood loss at speed 3, read at 10 clinical minutes", { bloodLoss: 0.3 }, { speed: 3, checkpoints: [2] }));
  out.push(mx("bleed30-speed6", "30% blood loss at speed 6, read at 10 clinical minutes", { bloodLoss: 0.3 }, { speed: 6, checkpoints: [1] }));

  out.push(mx("eff400-septum-off", "Effusion 400 ml, septum off", { pericardium: { effusionMl: 400, stiffness: 1 }, septum: false }));
  out.push(mx("eff400-septum-on", "Effusion 400 ml, septum on", { pericardium: { effusionMl: 400, stiffness: 1 }, septum: true }));

  out.push(mx("eff400-accum-drain", "Effusion 400 ml accumulating 20 ml/min, drain 150 ml at 60 s", {
    pericardium: { effusionMl: 400, effusionRateMlMin: 20, stiffness: 1 }, septum: true,
  }, {
    actions: [{ atS: 60, label: "pericardiocentesis 150 ml", run: (s: Simulation) => { s.apply({ pericardium: { drainMl: 150 } }); } }],
  }));

  out.push(mx("eff800-pea", "Effusion 800 ml, PEA-range output", {
    pericardium: { effusionMl: 800, stiffness: 1 }, septum: true,
  }));

  out.push(mx("pvri8-septum-nitro", "PVRI 8, septum on, nitroglycerin 0.5", {
    heart: { pvri: 8 }, septum: true, support: { nitroglycerin: 0.5 },
  }));

  out.push(mx("peep15-pos-bleed30", "PEEP 15 positive pressure plus 30% blood loss", {
    ventilation: { mode: "positive", peep: 15, tidalMlKg: 8 }, bloodLoss: 0.3,
  }));

  out.push(mx("hypox-edema", "satLung 0.75, volume overload and stiff LV", {
    heart: { satLung: 0.75, lvStiffness: 2 }, bloodLoss: -0.2,
  }));

  // Section 3.6 — devices with coronary lesions
  out.push(mx("lad-impella-correct", "Proximal LAD occlusion, Impella CP P6 correct", {
    lesions: [ladOcc], devices: { impella: { model: "CP", level: 6, position: "correct" } },
  }));
  out.push(mx("lad-impella-aortic", "Proximal LAD occlusion, Impella CP aortic position", {
    lesions: [ladOcc], devices: { impella: { model: "CP", level: 6, position: "aortic" } },
  }));
  out.push(mx("lad-impella-deep", "Proximal LAD occlusion, Impella CP deep position", {
    lesions: [ladOcc], devices: { impella: { model: "CP", level: 6, position: "deep" } },
  }));

  out.push(mx("lad-iabp-timing0", "Proximal LAD occlusion, IABP 1:1 correct timing", {
    lesions: [ladOcc], devices: { iabp: { ratio: 1, volumeMl: 40, inflateMs: 0 } },
  }));
  out.push(mx("lad-iabp-inflate-pos40", "Proximal LAD occlusion, IABP inflate +40 ms late", {
    lesions: [ladOcc], devices: { iabp: { ratio: 1, volumeMl: 40, inflateMs: 40 } },
  }));

  out.push(mx("lm-ecmo-fio2-0p21", "LM occlusion, ECMO 4 L/min, FiO2 0.21", {
    lesions: [lmOcc], devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.21 } },
  }));
  out.push(mx("lm-ecmo-fio2-1", "LM occlusion, ECMO 4 L/min, FiO2 1", {
    lesions: [lmOcc], devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 1 } },
  }));

  out.push(mx("ecmo4-bleed45", "ECMO 4 L/min plus 45% blood loss", {
    bloodLoss: 0.45, devices: { ecmo: { flowLpm: 4, sweepLpm: 2, fio2: 0.6 } },
  }));

  out.push(mx("impella-support-p0", "Impella support on with CP level 0", {
    support: { impella: true }, devices: { impella: { model: "CP", level: 0, position: "correct" } },
  }));

  return out;
}

/**
 * Condition matrix, volume, pericardium, drugs, devices, shunts and ventilation.
 * Filled from docs/CONDITION_MATRIX.md sections 2.5, 3.4 and 3.6.
 */
export function matrixSupportStates(): State[] {
  return [...singles(), ...interactions()];
}
