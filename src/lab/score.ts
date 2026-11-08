import { contrastEffect } from "./coupling";
import { byId, CATALOG } from "../config/labDevices";
import type { LabEngine } from "./engine";
import type { LabCase } from "../cath/lab/cases";

export function scoreProcedure(engine: LabEngine, c: LabCase): {
  total: number;
  items: { id: string; label: string; points: number; max: number; note: string }[];
  debrief: string[];
} {
  const st = engine.state();
  const items: { id: string; label: string; points: number; max: number; note: string }[] = [];
  const debrief: string[] = [];
  const add = (id: string, label: string, max: number, ok: boolean, good: string, bad: string) => {
    items.push({ id, label, max, points: ok ? max : 0, note: ok ? good : bad });
    debrief.push(ok ? good : bad);
  };

  add("access", "Access choice and closure", 10, !!st.access, "Appropriate vascular access.", "Access not established.");
  const actOk = st.act >= 250 && st.act <= 320;
  add("act", "Anticoagulation (ACT 250–300)", 5, actOk, "Anticoagulation adequate before wiring.", "ACT outside the 250–300 s window.");
  const gq = st.guide?.quality ?? 0;
  add("guide", "Guide selection and engagement", 10, gq >= 0.6, "Guide engaged with good support.", "Guide engagement or curve could be improved.");
  const badWire = st.log.length > 0 && engine.plaques().every((p) => p.ds < 0.5);
  add("wire", "Wire handling", 10, badWire || !st.log.some(() => false), "No perforation or prolapse logged.", "Wire complications noted.");
  const ref = engine.plaques()[0]?.referenceMm ?? 3;
  const stent = st.stent?.id ? byId[st.stent.id] : null;
  const stentOk = stent && Math.abs((stent as { nominalMm: number }).nominalMm / ref - 1.05) < 0.2;
  add("sizing", "Device sizing", 20, !!stentOk, "Stent sizing near 1.0–1.1 × reference.", "Review stent diameter versus reference.");
  add("deploy", "Deployment technique", 10, st.stent?.deployed === true, "Stent deployed.", "Stent not deployed.");
  const resultOk = engine.plaques().some((p) => p.ds <= 0.1);
  add("result", "Angiographic result", 20, resultOk, "Residual stenosis acceptable.", "Residual disease remains.");
  add("complications", "Complications managed", 10, true, "No untreated complication flagged.", "Address complications promptly.");
  const neph = contrastEffect(st.contrastMl, c.egfr).nephropathyRisk;
  add("steward", "Contrast and radiation stewardship", 5, neph < 0.3 && st.contrastMl / c.egfr < 3.7, "Contrast use appropriate for renal function.", "Contrast volume high for eGFR.");

  const total = items.reduce((s, x) => s + x.points, 0);
  for (const id of [c.recommended.guide, c.recommended.wire, c.recommended.balloon, c.recommended.stent].filter(Boolean)) {
    if (id && !CATALOG.some((d) => d.id === id)) debrief.push(`Catalog missing recommended device ${id}.`);
  }
  return { total, items, debrief: debrief.map((l) => l.replace(/^\w/, (c) => c.toUpperCase())) };
}
