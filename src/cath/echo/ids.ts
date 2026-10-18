/**
 * Region ids of the baked heart volume, shared with the Python that bakes it (spikes/cathlab/tools/fill2.py, soon scripts/cath/).
 * Ids below 20 are blood pools, 20 to 23 the valve planes, 24 to 32 walls and other soft tissue, 40 to 56 the 17 AHA left-ventricular segments.
 * The volume holds only some of them; the rest (great veins, pulmonary veins, appendage, ascending and descending aorta, arch) are
 * procedural tubes drawn by procedural.ts with the same ids.
 */
export const ID = {
  LV: 1, RV: 2, RA: 3, LA: 4, LAA: 5, LVOT: 6, AOROOT: 7, ASCAO: 8, SVC: 9, IVC: 10, RVOT: 11, DAO: 12,
  LUPV: 13, LLPV: 14, RUPV: 15, RLPV: 16, PA: 17, ARCH: 18,
  MV: 20, AV: 21, TV: 22, PV: 23,
  IAS: 24, RVW: 25, LAW: 26, RAW: 27, AOW: 28, PERI: 29, PMAL: 30, PMPM: 31, VW: 32,
  SEG: 40,
} as const;

/** The 17 AHA segments in volume order: six basal, six mid (anterolateral first, going clockwise seen from the apex's side), four apical, apex. */
export const SEG17: readonly string[] = [
  ...["basal", "mid"].flatMap((l) => ["anterolateral", "anterior", "anteroseptal", "inferoseptal", "inferior", "inferolateral"].map((n) => `${l} ${n}`)),
  "apical anterior", "apical septal", "apical inferior", "apical lateral", "apex",
];

export const NSEG = 17;
export const isSegment = (id: number) => id >= ID.SEG && id < ID.SEG + NSEG;
export const isLeftVentricle = (id: number) => id === ID.LV || id === ID.LVOT || isSegment(id);

/** What a region is, for the label colour: c chamber, v vessel, x valve, w wall or muscle, s LV segment. */
export type LabelKind = "c" | "v" | "x" | "w" | "s";

export const LABELS: Record<number, [string, LabelKind]> = {
  1: ["LV", "c"], 2: ["RV", "c"], 3: ["RA", "c"], 4: ["LA", "c"], 5: ["LAA", "c"], 6: ["LVOT", "c"],
  7: ["Ao root", "v"], 8: ["Asc Ao", "v"], 9: ["SVC", "v"], 10: ["IVC", "v"], 11: ["RVOT", "v"], 12: ["Desc Ao", "v"],
  13: ["LUPV", "v"], 14: ["LLPV", "v"], 15: ["RUPV", "v"], 16: ["RLPV", "v"], 17: ["PA", "v"], 18: ["Aortic arch", "v"],
  20: ["MV", "x"], 21: ["AV", "x"], 22: ["TV", "x"], 23: ["PV", "x"],
  24: ["IAS", "w"], 25: ["RV free wall", "w"], 29: ["Pericardium", "w"], 30: ["AL papillary", "w"], 31: ["PM papillary", "w"],
};
SEG17.forEach((n, i) => { LABELS[ID.SEG + i] = [n, "s"]; });

/** Ids that are blood (dark on the image). */
export const isBlood = (id: number) => id >= 1 && id <= 18;
