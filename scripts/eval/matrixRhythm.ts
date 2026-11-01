import type { PatientSpec } from "../../src/sim/patient";
import type { State } from "./states";

const mx = (id: string, title: string, insult: PatientSpec, extra: Partial<State> = {}): State =>
  ({ id: `mx-rhythm-${id}`, suite: "matrix", invariantsOnly: true, title, insult, ...extra });

const cp60: Partial<State> = { checkpoints: [60] };
const cpArrest: Partial<State> = { checkpoints: [5, 20, 40] };
const cpCoronary: Partial<State> = { checkpoints: [60, 180] };

const ladProxOcc = { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] };
const rcaProxOcc = { lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] };

const rhythm = (id: string, rhythmId: string, title?: string, extra: Partial<State> = {}): State =>
  mx(id, title ?? `Rhythm ${rhythmId}, healthy heart`, { patient: { rhythm: rhythmId } }, extra);

/** Section 2.3: one state per rhythm in CONDITION_MATRIX §1.3. Section 3.5: pacing, arrest, electrolytes, ectopy. */
export function matrixRhythmStates(): State[] {
  const arrestRhythms = new Set(["vf-coarse", "vf-fine", "asystole", "vt-poly", "torsades"]);

  const singles: State[] = [
    rhythm("nsr", "sinus", "Coronary-model sinus (nsr), healthy heart"),
    rhythm("sinus-brady", "sinus-brady"),
    rhythm("sinus-tachy", "sinus-tachy"),
    rhythm("sinus-arrhythmia", "sinus-arrhythmia"),
    rhythm("af", "af", "Atrial fibrillation (coronary model), healthy heart"),
    rhythm("af-rvr", "af-rvr"),
    rhythm("flutter-21", "flutter-21"),
    rhythm("flutter-var", "flutter-var"),
    rhythm("mat", "mat"),
    rhythm("junctional", "junctional"),
    rhythm("accel-junctional", "accel-junctional"),
    rhythm("svt", "svt"),
    rhythm("wpw", "wpw"),
    rhythm("avb1", "avb1"),
    rhythm("wenckebach", "wenckebach"),
    rhythm("mobitz2", "mobitz2"),
    rhythm("avb-21", "avb-21"),
    rhythm("chb", "chb"),
    rhythm("chb-wide", "chb-wide"),
    rhythm("rbbb", "rbbb"),
    rhythm("lbbb", "lbbb"),
    rhythm("lafb", "lafb"),
    rhythm("bifascicular", "bifascicular"),
    rhythm("pvc-bigeminy", "pvc-bigeminy"),
    rhythm("aivr", "aivr"),
    rhythm("vt-mono", "vt-mono"),
    rhythm("vt-poly", "vt-poly", undefined, cpArrest),
    rhythm("torsades", "torsades", undefined, cpArrest),
    rhythm("vf-coarse", "vf-coarse", "VF coarse, no CPR", cpArrest),
    rhythm("vf-fine", "vf-fine", "VF fine, no CPR", cpArrest),
    rhythm("asystole", "asystole", "Asystole, no CPR", cpArrest),
    rhythm("paced", "paced"),
    rhythm("hyperk", "hyperk", "Library hyperk morphology (not serum potassium)"),
    rhythm("hyperk-sine", "hyperk-sine", "Library hyperk sine wave (not serum potassium)"),
    rhythm("hypok", "hypok"),
    rhythm("long-qt", "long-qt"),
    rhythm("hypothermia", "hypothermia"),
  ].map((s) => {
    const rid = (s.insult.patient?.rhythm ?? "") as string;
    if (arrestRhythms.has(rid)) return s;
    if (s.checkpoints) return s;
    return { ...s, checkpoints: [60] };
  });

  const interactions: State[] = [
    mx("chb-paced-70", "Library complete heart block with external pacing at 70 bpm",
      { patient: { rhythm: "chb" }, support: { pacing: true, paceRate: 70 } }, cp60),
    mx("rca-occlusion-paced-70", "Proximal RCA occlusion with pacing at 70 (ischemic block)",
      { ...rcaProxOcc, support: { pacing: true, paceRate: 70 } }, cpCoronary),
    mx("af-paced-70", "Atrial fibrillation with external pacing at 70 bpm",
      { patient: { rhythm: "af" }, support: { pacing: true, paceRate: 70 } }, cp60),
    mx("vt-mono-lad-occlusion", "Monomorphic VT on proximal LAD occlusion",
      { patient: { rhythm: "vt-mono" }, ...ladProxOcc }, { checkpoints: [20, 60] }),
    mx("vf-cpr-epi-shock", "VF coarse: CPR at 5 s, epinephrine at 15 s, 200 J shock at 25 s",
      { patient: { rhythm: "vf-coarse" } },
      {
        checkpoints: [20, 30, 40],
        actions: [
          { atS: 5, label: "CPR", run: (s) => { s.startCpr({ rate: 110, depthCm: 5, quality: 0.8 }); } },
          { atS: 15, label: "epinephrine 1 mg", run: (s) => { s.giveDrug("epinephrine", 1); } },
          { atS: 25, label: "shock 200 J", run: (s) => { s.shock({ joules: 200 }); } },
        ],
      }),
    mx("k42-mg02-arr3", "Potassium 4.2, magnesium 0.2, arrhythmia tendency 3, no lesion",
      { electrolytes: { potassium: 4.2, magnesium: 0.2 }, arrhythmiaTendency: 3 }, cp60),
    mx("k75-mg30", "Potassium 7.5, magnesium 3.0, arrhythmia tendency 1, no lesion",
      { electrolytes: { potassium: 7.5, magnesium: 3.0 }, arrhythmiaTendency: 1 }, cp60),
    mx("k75-mg09", "Potassium 7.5, magnesium 0.9, arrhythmia tendency 1, no lesion (Mg comparison)",
      { electrolytes: { potassium: 7.5, magnesium: 0.9 }, arrhythmiaTendency: 1 }, cp60),
    mx("ectopy0-lad-occlusion", "Proximal LAD occlusion, ectopy tendency 0",
      { ...ladProxOcc, ectopyTendency: 0 }, cpCoronary),
    mx("ectopy3-lad-occlusion", "Proximal LAD occlusion, ectopy tendency 3",
      { ...ladProxOcc, ectopyTendency: 3 }, cpCoronary),
  ];

  return [...singles, ...interactions];
}
