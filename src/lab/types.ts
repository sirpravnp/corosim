import type { V3 } from "../anatomy/curve";

/**
 * Shared contract of the cath-lab simulator. The procedure engine (`LabEngine`, built against the plan) and the UI both
 * code against these types; `StubLabEngine` (stub.ts) implements `LabEngineLike` without physics so the UI can be built first.
 * Fields may be added. Never rename or remove one without changing every consumer.
 */

// ------------------------------------------------------------------------------------------------ anatomy

export type AccessSite = "femoral-R" | "femoral-L" | "radial-R" | "radial-L";
export interface AccessVariant { arch: "I" | "II" | "III"; iliacTortuosity: number; radialLoop: boolean; aorticRootMm: number; calcifiedIliac: boolean }

/** One vessel centerline of the unified graph: access vessels plus the coronary tree. Patient frame, mm. */
export interface VSeg {
  id: string; name: string; parent: string | null;
  attach: number; // fraction along the parent where this vessel leaves
  length: number; // mm
  samples: V3[]; // equal arc length
  diameterMm: number[]; // lumen diameter at each sample
  tortuosity: number; calcification: number; // 0..1
}
export interface VGraph {
  segs: VSeg[]; byId: Record<string, VSeg>;
  /** Side branches (renals, carotids, deep femorals...). Drawn and filled with dye, but no route, wire or branch choice uses them. Optional. */
  branches?: VSeg[];
  ostium: Record<"LM" | "RCA", { segId: string; mm: number }>;
}

// ------------------------------------------------------------------------------------------------ plaque

export type Dissection = null | "A" | "B" | "C" | "D" | "E" | "F"; // NHLBI grades
export interface DeployedStent { fromMm: number; toMm: number; diameterMm: number; expansionPct: number; apposition: number; strutUm: number }
export interface Plaque {
  segId: string; centerMm: number; lengthMm: number;
  ds: number; // 0..1 diameter stenosis at the narrowest point
  referenceMm: number;
  eccentric: number; eccentricAngleDeg: number; // 0 concentric .. 1 one-sided; direction of the thick wall
  calcium: number; lipid: number; thrombus: number; // 0..1
  remodel: "positive" | "negative" | "none";
  cto?: { ageMonths: number; capHardness: number; microchannels: boolean };
  stents: DeployedStent[];
}

/** Set-up slider for a coronary lesion: segment, center and length in mm, diameter stenosis 0..1. */
export interface LesionSlider { segId: string; centerMm: number; lengthMm: number; ds: number }

// ------------------------------------------------------------------------------------------------ devices

export interface DeviceBase { id: string; name: string }
export interface Sheath extends DeviceBase { kind: "sheath"; french: 5 | 6 | 7 }
export interface GuideCatheter extends DeviceBase { kind: "guide"; french: 5 | 6 | 7; curve: "JL3.5" | "JL4" | "JL5" | "JR4" | "EBU3.5" | "XB3.5" | "AL1" | "AL2"; support: number; tipStiffness: number }
export interface Guidewire extends DeviceBase { kind: "wire"; diameterIn: 0.014; tipLoadGf: number; stiffness: "floppy" | "intermediate" | "stiff"; coating: "hydrophilic" | "polymer" | "none"; torque: number; tipTaperMm: number; support: number }
export interface Microcatheter extends DeviceBase { kind: "microcatheter"; french: number; support: number }
export interface Balloon extends DeviceBase { kind: "balloon"; nominalMm: number; lengthMm: number; type: "semi" | "noncompliant" | "cutting" | "scoring"; nominalAtm: number; ratedBurstAtm: number; slopeMmPerAtm: number }
export interface Stent extends DeviceBase { kind: "stent"; nominalMm: number; lengthMm: number; strutUm: number; material: "DES" | "BMS"; nominalAtm: number }
export type Device = Sheath | GuideCatheter | Guidewire | Microcatheter | Balloon | Stent;

// ------------------------------------------------------------------------------------------------ actions, events, state

export type Action =
  | { t: "access"; site: AccessSite; ultrasound?: boolean }
  | { t: "sheath"; french: 5 | 6 | 7 }
  | { t: "drug"; id: "heparin" | "nitro" | "adenosine" | "protamine" | "atropine"; dose: number }
  | { t: "select"; slot: "guide" | "wire" | "balloon" | "stent"; id: string }
  | { t: "target"; segId: string } // vessel the operator intends to treat
  | { t: "advance"; mm: number } // moves the active (most distal selected) device; negative withdraws
  | { t: "autoAdvance"; to: "ostium" | "LM" | "RCA" }
  | { t: "torque"; deg: number }
  | { t: "shape"; tipBendDeg: number }
  | { t: "inject"; where: "LCA" | "RCA" | "LV" | "aorta"; ml: number }
  | { t: "inflate"; atm: number; seconds: number }
  | { t: "deflate" }
  | { t: "deploy"; atm: number; seconds: number }
  | { t: "carm"; rot: number; tilt: number }
  | { t: "close"; method: "manual" | "closure-device" }
  | { t: "cpr"; on: boolean }
  | { t: "shock"; joules: number; sync?: boolean }
  | { t: "pressor"; id: "norepi" | "epi" | "phenylephrine"; dose: number }
  | { t: "fluid"; ml: number }
  | { t: "pericardiocentesis"; ml: number }
  | { t: "restart" };

export type LabEventSeverity = "info" | "caution" | "bad";
export interface LabEvent { at: number; kind: string; text: string; severity: LabEventSeverity; data?: Record<string, unknown> }

export interface LabState {
  access: AccessSite | null;
  sheathFr: number | null;
  sheath: { site: AccessSite; french: number; lengthMm: number } | null;
  act: number; // activated clotting time, seconds
  guide: { id: string; engaged: "LM" | "RCA" | null; quality: number; tipSeg: string; tipMm: number } | null;
  wire: { id: string; tipSeg: string; tipMm: number; bendDeg: number; rotDeg: number; route: string[] } | null;
  /** `inflatedAtm` 0 means deflated. The vessel is occluded while it is above 0. */
  balloon: { id: string; segId: string; centerMm: number; inflatedAtm: number } | null;
  stent: { id: string; segId: string; centerMm: number; deployed: boolean } | null;
  /** Vessel the operator intends to treat; the wire route ends here. */
  targetSeg: string | null;
  carm: { rot: number; tilt: number };
  contrastMl: number; fluoroSeconds: number; doseMGy: number; elapsedS: number;
  log: Action[];
}

/** What the UI needs from a procedure engine. `LabEngine` and `StubLabEngine` both implement it. */
export interface LabEngineLike {
  state(): Readonly<LabState>;
  graph(): VGraph; // access vessels plus coronary tree, for drawing
  plaques(): readonly Plaque[];
  apply(a: Action): LabEvent[];
  replay(actions: Action[]): LabEvent[];
  reset(): void;
  /** Replay-based undo of the last action; no-op when the log is empty. */
  undo(): LabEvent[];
  canUndo(): boolean;
  /** Practice aid: how many undos this run (shown to the user and in the score). */
  undoCount: number;
  /** Optional: let real time pass (the live lab calls it every frame). */
  tick?(seconds: number): LabEvent[];
  /** Optional: blood in the pericardium, mL. */
  effusionMl?(): number;
}
