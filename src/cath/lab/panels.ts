import type { Device, LabEvent, LabState, Plaque } from "../../lab/types";

/** Pure view-models for the lab page: what the shelf offers, what the monitor shows, the event feed. No DOM, so the tests and the page share them. */

export type Tone = "" | "warn" | "bad";
export type Slot = "guide" | "wire" | "balloon" | "stent";

export interface ShelfSlot { slot: Slot; label: string; enabled: boolean; reason?: string; options: { id: string; name: string }[]; selected: string | null }

/** True once the wire tip is past the far edge of any lesion on its route. */
export function acrossLesion(st: Readonly<LabState>, plaques: readonly Plaque[]): boolean {
  const w = st.wire;
  if (!w) return false;
  const tipAt = w.route.indexOf(w.tipSeg);
  if (tipAt < 0) return false;
  return plaques.some((p) => {
    const at = w.route.indexOf(p.segId);
    if (at < 0) return false;
    return tipAt > at || (tipAt === at && w.tipMm >= p.centerMm + p.lengthMm / 2 - 2);
  });
}

const LABEL: Record<Slot, string> = { guide: "Guide catheter", wire: "Guidewire", balloon: "Balloon", stent: "Stent" };

export function deviceShelf(st: Readonly<LabState>, catalog: readonly Device[], plaques: readonly Plaque[]): ShelfSlot[] {
  const across = acrossLesion(st, plaques);
  const gate: Record<Slot, [boolean, string]> = {
    guide: [!!st.access, "Gain access first."],
    wire: [!!st.guide?.engaged, "Engage a guide first."],
    balloon: [across, "Cross the lesion with the wire first."],
    stent: [across, "Cross the lesion with the wire first."],
  };
  const chosen: Record<Slot, string | null> = { guide: st.guide?.id ?? null, wire: st.wire?.id ?? null, balloon: st.balloon?.id ?? null, stent: st.stent?.id ?? null };
  return (["guide", "wire", "balloon", "stent"] as Slot[]).map((slot) => {
    const [enabled, reason] = gate[slot];
    return {
      slot, label: LABEL[slot], enabled, ...(enabled ? {} : { reason }),
      options: catalog.filter((d) => d.kind === slot).map((d) => ({ id: d.id, name: d.name })), selected: chosen[slot],
    };
  });
}

export interface Vitals { hr: number | null; map: number | null; sbp: number | null; dbp: number | null; ffr: number | null; rhythm?: string | null; arrest?: boolean }
export interface Tile { id: string; label: string; value: string; unit: string; tone: Tone }

const num = (v: number | null, digits = 0) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits));

export function monitorModel(v: Vitals, st: Readonly<LabState>): Tile[] {
  const hrTone: Tone = v.hr === null ? "" : v.hr > 130 || v.hr < 40 ? "bad" : v.hr > 110 || v.hr < 50 ? "warn" : "";
  const mapTone: Tone = v.map === null ? "" : v.map < 60 ? "bad" : v.map < 70 ? "warn" : "";
  const ffrTone: Tone = v.ffr === null ? "" : v.ffr <= 0.75 ? "bad" : v.ffr <= 0.8 ? "warn" : "";
  return [
    ...(v.rhythm ? [{ id: "rhythm", label: "Rhythm", value: v.rhythm, unit: "", tone: (v.arrest ? "bad" : "") as Tone }] : []),
    { id: "hr", label: "Heart rate", value: num(v.hr), unit: "bpm", tone: hrTone },
    { id: "map", label: "Mean pressure", value: num(v.map), unit: "mmHg", tone: mapTone },
    { id: "bp", label: "Pressure", value: v.sbp === null || v.dbp === null ? "—" : `${num(v.sbp)}/${num(v.dbp)}`, unit: "mmHg", tone: "" },
    { id: "ffr", label: "FFR", value: num(v.ffr, 2), unit: "", tone: ffrTone },
    { id: "act", label: "ACT", value: st.access ? num(st.act) : "—", unit: "s", tone: st.access && st.act < 250 ? "warn" : "" },
  ];
}

/** Events in time order, the latest `cap` of them. */
export function eventFeed(events: readonly LabEvent[], cap = 200): LabEvent[] {
  return [...events].sort((a, b) => a.at - b.at).slice(-cap);
}

export function procedureSummary(st: Readonly<LabState>) {
  const s = Math.round(st.fluoroSeconds);
  return { contrastMl: st.contrastMl, fluoroLabel: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, doseMGy: Math.round(st.doseMGy), act: Math.round(st.act) };
}

/** One line telling the learner what the usual next step is, from where the procedure stands. */
export function nextStep(st: Readonly<LabState>, plaques: readonly Plaque[]): string {
  if (!st.access) return "Choose an access site and gain access.";
  if (!st.sheathFr) return "Place a sheath.";
  if (st.act < 250) return "Give heparin: aim for an ACT of 250 s or more before the wire goes in.";
  if (!st.guide) return "Choose a guide catheter and engage the left main.";
  if (!st.guide.engaged) return "The guide is not in the ostium. Advance it, or try another curve.";
  if (!st.wire) return "Choose a guidewire.";
  if (st.balloon && st.balloon.inflatedAtm > 0) return "Balloon inflated: the vessel is occluded. Deflate soon.";
  if (st.stent?.deployed) return "Postdilate if the stent is underexpanded, then check the pressure wire and close access.";
  if (!acrossLesion(st, plaques)) return "Advance the wire across the lesion.";
  if (!st.balloon && !st.stent) return "Predilate with a balloon, or go straight to a stent.";
  if (!st.stent?.deployed) return "Choose a stent sized to the vessel and deploy it.";
  return "Postdilate if the stent is underexpanded, then check the pressure wire and close access.";
}

/** Standard angiographic views: a number key sets the C-arm. LAO and cranial are positive; keys 1 to 5 pick them in order. */
export const STANDARD_VIEWS: { name: string; rot: number; tilt: number }[] = [
  { name: "AP", rot: 0, tilt: 0 }, { name: "LAO 40, cranial 30", rot: 40, tilt: 30 }, { name: "RAO 30, cranial 25", rot: -30, tilt: 25 },
  { name: "RAO 30, caudal 25", rot: -30, tilt: -25 }, { name: "LAO 45, caudal 30 (spider)", rot: 45, tilt: -30 },
];
