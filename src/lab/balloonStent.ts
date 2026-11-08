import { PLAQUE } from "../config/plaque";
import { dissectionRisk as extraDissectionRisk } from "./complications";
import { deployStent, dilate } from "./plaque";
import type { Balloon, LabEvent, LabState, Plaque, Stent, VGraph } from "./types";

export function planSizing(refMm: number, lesionLenMm: number): { stentMm: number; lengthMm: number } {
  const stentMm = Math.min(4, Math.max(2.25, Math.round(refMm * 1.05 * 100) / 100));
  const lengthMm = Math.min(38, Math.max(8, Math.ceil((lesionLenMm + 4) / 2) * 2));
  return { stentMm, lengthMm };
}

const plaqueNear = (plaques: Plaque[], segId: string, mm: number) =>
  plaques.find((p) => p.segId === segId && Math.abs(p.centerMm - mm) < p.lengthMm / 2 + 3);

const branchOstial = (g: VGraph, parent: string, fromMm: number, toMm: number, stentDiameterMm: number) => {
  const out: { branchSeg: string; ostialDs: number }[] = [];
  for (const s of g.segs.filter((c) => c.parent === parent)) {
    const bif = s.attach * g.byId[parent].length;
    if (bif >= fromMm - 2 && bif <= toMm + 2) {
      const stentD = stentDiameterMm || g.byId[parent].diameterMm[0];
      const branchD = Math.min(...s.diameterMm);
      const ostialDs = Math.min(0.8, Math.max(0.3, 0.3 + 0.4 * (1 - branchD / stentD)));
      out.push({ branchSeg: s.id, ostialDs });
    }
  }
  return out;
};

export function inflateBalloon(
  st: LabState,
  b: Balloon,
  atm: number,
  seconds: number,
  plaques: Plaque[],
  wireCenterMm: number,
  wireSeg: string,
  rand: () => number,
): { plaques: Plaque[]; events: LabEvent[]; occludesFlow: boolean } {
  const events: LabEvent[] = [];
  let next = [...plaques];
  const occludesFlow = atm > 0;
  if (atm > b.ratedBurstAtm) {
    events.push({
      at: st.elapsedS, kind: "balloon-rupture", severity: "bad",
      text: `Balloon rupture above ${b.ratedBurstAtm} atm.`,
      data: { dissectionBoost: 3 },
    });
    return { plaques: next, events, occludesFlow: false };
  }
  if (atm <= 0) return { plaques: next, events, occludesFlow: false };
  const i = next.findIndex((p) => plaqueNear([p], wireSeg, wireCenterMm));
  if (i < 0) return { plaques: next, events, occludesFlow };
  const p = next[i];
  const dia = b.nominalMm + b.slopeMmPerAtm * Math.max(0, atm - b.nominalAtm);
  const res = dilate(p, {
    type: b.type, diameterMm: dia, atXMm: wireCenterMm, lengthMm: b.lengthMm, pressureAtm: atm,
  }, rand);
  next[i] = res.plaque;
  if (res.dissection) {
    events.push({ at: st.elapsedS, kind: "dissection", severity: "caution", text: `Dissection grade ${res.dissection}.` });
  }
  if (extraDissectionRisk(atm, b.ratedBurstAtm) > 0.6 && rand() < 0.2) {
    events.push({ at: st.elapsedS, kind: "dissection", severity: "bad", text: "High-pressure dissection." });
  }
  st.elapsedS += seconds;
  return { plaques: next, events, occludesFlow };
}

export function deployStentAt(
  st: LabState,
  s: Stent,
  atm: number,
  seconds: number,
  plaques: Plaque[],
  g: VGraph,
  wireCenterMm: number,
  wireSeg: string,
  rand: () => number,
): { plaques: Plaque[]; events: LabEvent[]; jailed: { branchSeg: string; ostialDs: number }[] } {
  const events: LabEvent[] = [];
  let next = [...plaques];
  const half = s.lengthMm / 2;
  const jailed = branchOstial(g, wireSeg, wireCenterMm - half, wireCenterMm + half, s.nominalMm);
  const i = next.findIndex((p) => plaqueNear([p], wireSeg, wireCenterMm));
  if (i < 0) return { plaques: next, events, jailed };
  const p = next[i];
  const ratio = s.nominalMm / p.referenceMm;
  if (ratio > 1.35) events.push({ at: st.elapsedS, kind: "oversized", severity: "bad", text: "Stent oversized for the vessel." });
  if (ratio < 0.75) events.push({ at: st.elapsedS, kind: "malapposed", severity: "bad", text: "Stent under-expanded.", data: { apposition: 0.65 } });
  const res = deployStent(p, {
    diameterMm: s.nominalMm, lengthMm: s.lengthMm, atXMm: wireCenterMm, strutUm: s.strutUm, pressureAtm: atm,
  }, rand);
  next[i] = res.plaque;
  if (s.lengthMm + 4 < p.lengthMm) {
    const endDs = 0.3;
    next[i] = { ...next[i], ds: Math.max(endDs, next[i].ds * 0.5) };
    events.push({ at: st.elapsedS, kind: "edge-disease", severity: "caution", text: "Geographic miss with edge disease." });
  }
  st.elapsedS += seconds;
  return { plaques: next, events, jailed };
}
