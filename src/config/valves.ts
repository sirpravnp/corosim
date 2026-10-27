// Valve constants: native severity spans, prosthetic valves and valve interventions (B5, docs/VALVES.md).
// [lit] = from a published source (named in docs/VALVES.md); [assumed] = a teaching choice. Nothing is fitted to patient data.

export type ValveKey = "av" | "mv" | "tv" | "pv";
export const VALVE_KEYS: readonly ValveKey[] = ["av", "mv", "tv", "pv"];

/**
 * Native valve severity 0..1 to the engine's lesion: stenosis s closes the valve to `1 - span·s` of its normal area; regurgitation s
 * opens a leak of `s · regAreaFrac · normal area` (cm²). The same spans the single-lesion presets have always used.
 */
export const STENOSIS_SPAN: Record<ValveKey, number> = { av: 0.85, mv: 0.85, tv: 0.85, pv: 0.9 };
export const REGURG_AREA_FRAC: Record<ValveKey, number> = { av: 0.16, mv: 0.12, tv: 0.14, pv: 0.25 };

export type ProsthesisKind = "bioprosthetic" | "mechanical" | "transcatheter";
export const PROSTHESIS_KINDS: readonly ProsthesisKind[] = ["bioprosthetic", "mechanical", "transcatheter"];

/**
 * Effective orifice area (cm²) of a normally functioning prosthesis by labelled size (mm): [size, EOA] pairs, linear between them
 * and held at the ends. [lit, rounded] from the reference values of Pibarot and Dumesnil (Circulation 2009;119:1034) and Rosenhek /
 * Zoghbi (ASE 2009 prosthetic valve guideline) for stented bioprostheses and bileaflet mechanical valves; SAPIEN 3 / Evolut
 * transcatheter aortic values from PARTNER 3 and the Evolut Low Risk echo cores (mean EOA 1.5 to 2.0 cm², mean gradient 8 to 13 mmHg).
 * Tricuspid, pulmonary and the transcatheter mitral/tricuspid/pulmonary rows are [assumed] from the mitral and aortic ones (few
 * published series; the ASE guideline gives mitral values for the right side).
 */
export const PROSTHESIS_EOA: Record<ProsthesisKind, Record<ValveKey, readonly (readonly [number, number])[]>> = {
  bioprosthetic: {
    av: [[19, 1.2], [21, 1.5], [23, 1.7], [25, 2.0], [27, 2.3], [29, 2.5]],
    mv: [[25, 1.4], [27, 1.6], [29, 1.8], [31, 2.0], [33, 2.2]],
    tv: [[27, 1.6], [29, 1.9], [31, 2.2], [33, 2.5]],
    pv: [[19, 1.4], [21, 1.8], [23, 2.2], [25, 2.6], [27, 3.0]],
  },
  mechanical: {
    av: [[19, 1.4], [21, 1.7], [23, 2.0], [25, 2.4], [27, 2.8], [29, 3.2]],
    mv: [[25, 1.6], [27, 1.9], [29, 2.2], [31, 2.5], [33, 2.7]],
    tv: [[27, 1.8], [29, 2.1], [31, 2.4], [33, 2.7]],
    pv: [[19, 1.6], [21, 2.0], [23, 2.4], [25, 2.8], [27, 3.2]],
  },
  transcatheter: {
    av: [[20, 1.3], [23, 1.6], [26, 1.9], [29, 2.2], [34, 2.5]],
    mv: [[26, 1.8], [29, 2.2], [32, 2.5]],
    tv: [[29, 2.2], [32, 2.6], [36, 3.0]],
    pv: [[22, 2.0], [26, 2.6], [29, 3.0]],
  },
};
/** Labelled size range of each valve's prostheses, mm (the tables' ends). */
export const PROSTHESIS_SIZE: Record<ValveKey, readonly [number, number]> = { av: [19, 34], mv: [25, 33], tv: [27, 36], pv: [19, 29] };
/** The size chosen when none is asked for, mm. [assumed: common adult sizes] */
export const DEFAULT_PROSTHESIS_SIZE: Record<ProsthesisKind, Record<ValveKey, number>> = {
  bioprosthetic: { av: 23, mv: 29, tv: 31, pv: 25 }, mechanical: { av: 23, mv: 29, tv: 31, pv: 25 }, transcatheter: { av: 26, mv: 29, tv: 32, pv: 26 },
};

/**
 * Regurgitant orifice area (cm²) a working prosthesis has with nothing wrong: the closing volume and washing jets of a mechanical
 * valve are physiological (ASE 2009: about 5 to 10 % of stroke volume for a bileaflet valve; 0.03 cm² gives about 7 % at the aortic
 * closing pressure). A bioprosthesis has none; a transcatheter valve carries the trace paravalvular leak most have (PARTNER 3: none
 * or trace in about 65 %, mild in 30 %; 0.02 cm² is trace to mild). [lit, rounded]
 */
export const PROSTHESIS_CLOSING_LEAK: Record<ProsthesisKind, number> = { bioprosthetic: 0, mechanical: 0.03, transcatheter: 0.02 };
/** Valve-in-valve: a transcatheter valve inside a failed surgical bioprosthesis keeps only this share of its tabulated EOA (the surgical frame is a fixed, smaller ring). [lit, rounded] from the VIVID registry: mean gradient 15 to 16 mmHg. */
export const VALVE_IN_VALVE_EOA = 0.8;

/**
 * Prosthetic valve grading, from the ASE 2009 prosthetic guideline (Zoghbi et al., JASE 2009;22:975): a mean gradient that is normal,
 * suggests ("possible") stenosis, or is significant. Aortic < 20 / 20 to 35 / > 35 mmHg; mitral < 5 / 5 to 10 / > 10. Tricuspid uses
 * 6 and 10, pulmonary 15 and 25 [assumed]. "Possible" is graded moderate and "significant" severe.
 */
export const PROSTHESIS_GRADIENT: Record<ValveKey, { moderate: number; severe: number }> = {
  av: { moderate: 20, severe: 35 }, mv: { moderate: 5, severe: 10 }, tv: { moderate: 6, severe: 10 }, pv: { moderate: 15, severe: 25 },
};
/**
 * Prosthesis-patient mismatch, by EOA indexed to body surface area (cm²/m²): aortic moderate 0.65 to 0.85, severe < 0.65 (VARC-3,
 * Pibarot); mitral moderate 0.9 to 1.2, severe < 0.9 (Dumesnil). Not defined for the right-sided valves. [lit]
 */
export const MISMATCH: Partial<Record<ValveKey, { moderate: number; severe: number }>> = { av: { moderate: 0.85, severe: 0.65 }, mv: { moderate: 1.2, severe: 0.9 } };

/**
 * Interventions. Each is an edit to the native valve's area (cm² or a share of normal) and leak (regurgitant orifice, cm²):
 *  - Balloon valvuloplasty: area gain (cm²), ceiling (cm²) and the leak it adds. Aortic: NHLBI registry area 0.5 to 0.8 cm², gradient
 *    55 to 30 mmHg, some new aortic regurgitation; mitral (Wilkins score <= 8): area about doubles to 1.8 to 2.2 cm², new mild
 *    regurgitation common, severe in 2 to 5 %; pulmonary (valvular PS): gradient falls below 25 mmHg in most, mild PR common.
 *    The effect can be scaled (0 to 1) for a calcified or high-score valve. [lit, rounded]
 *  - Edge-to-edge repair (MitraClip / TriClip): each clip leaves the regurgitant orifice at `regKeep` of what it was and takes
 *    `areaLoss` cm² from the opening (mitral: COAPT, MR <= 2+ in 95 %, mean gradient 4 to 5 mmHg afterwards, area about 3.5 to
 *    4 cm²; tricuspid: TRILUMINATE, TR down at least one grade in 86 %). Per-clip factors are [assumed] to reproduce those results.
 *  - Annuloplasty / repair: leak falls to `regKeep` and the opening to `areaKeep` of what it was. [assumed]
 */
export const BALLOON: Partial<Record<ValveKey, { gain: number; ceiling: number; leak: number }>> = {
  av: { gain: 0.3, ceiling: 1.2, leak: 0.03 }, mv: { gain: 1.0, ceiling: 2.2, leak: 0.04 }, pv: { gain: 1.5, ceiling: 3.2, leak: 0.05 },
};
export const EDGE_TO_EDGE: Partial<Record<ValveKey, { regKeep: number; areaLoss: number; floor: number; maxClips: number }>> = {
  mv: { regKeep: 0.55, areaLoss: 0.5, floor: 1.0, maxClips: 4 }, tv: { regKeep: 0.6, areaLoss: 0.4, floor: 2.0, maxClips: 4 },
};
export const ANNULOPLASTY: Partial<Record<ValveKey, { regKeep: number; areaKeep: number }>> = { mv: { regKeep: 0.1, areaKeep: 0.9 }, tv: { regKeep: 0.15, areaKeep: 0.9 } };
