import { describe, it, expect } from "vitest";
import { installCtHeartNode } from "../src/echo/ctNode";
import { buildPoses, toHeart, toPatient, Pose } from "../src/echo/poses";
import { teePose, teeViews } from "../src/echo/tee";
import { CASE_BY_ID } from "../src/echo/cases";
import { beatOf, frameAt, EchoBeat } from "../src/echo/beat";
import { frameFor, rasterize } from "../src/echo/paint";
import { structureLabels, StructureLabel } from "../src/echo/labels";
import { ctLandmarksHeart } from "../src/echo/ctEcho";
import { FrameSample, Tissue, classifyFrame } from "../src/echo/tissue";
import { MorphPart } from "../src/anatomy/heartSurface";
import { VIEWS } from "../src/echo/views";

/**
 * Structure labels on the echo image: each must sit inside the structure it names, and each standard view must name the structures
 * that view is taught to show (and not ones it does not).
 */
installCtHeartNode();
const tte = buildPoses(), tee = teeViews(), L = ctLandmarksHeart();
const ctx = (pose: Pose) => ({ pose, av: toPatient(L.av), pv: toPatient(L.pv) });
const poseOf = (id: string) => { const v = VIEWS.find((x) => x.id === id)!; return v.approach === "tte" ? tte[v.pose] : teePose(tee[v.pose]); };
const beats: Record<string, EchoBeat> = {};
const beat = (id: string) => (beats[id] ??= beatOf(CASE_BY_ID[id]!));
function labels(viewId: string, caseId = "normal"): StructureLabel[] {
  const pose = poseOf(viewId), b = beat(caseId), fr = frameFor(pose, 640 / 560);
  return structureLabels(rasterize(pose, 160, 140, fr, { heart: b.heart, frame: frameAt(b, 0) }), ctx(pose));
}
const PART: Record<string, number> = { LV: MorphPart.LV, LVOT: MorphPart.LV, RV: MorphPart.RV, RVOT: MorphPart.RV, RA: MorphPart.RA, LA: MorphPart.LA, Ao: MorphPart.Aorta, DAo: MorphPart.DAO, PA: MorphPart.PA, SVC: MorphPart.SVC, IVC: MorphPart.IVC, PV: MorphPart.PV };

describe("structure labels", () => {
  it.each(["normal", "effusion", "dcm"])("%s: every label in every view sits in the blood (or fluid) of the structure it names", (caseId) => {
    const b = beat(caseId), hit: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] };
    for (const v of VIEWS) {
      const pose = poseOf(v.id);
      for (const l of labels(v.id, caseId)) {
        const p = [0, 1, 2].map((a) => pose.probe[a] + pose.beam[a] * l.depth + pose.lateral[a] * l.lateral) as [number, number, number];
        classifyFrame(toHeart(p), b.heart, frameAt(b, 0), hit);
        if (l.text === "PE") { expect(hit.tissue, `${caseId} ${v.id} PE`).toBe(Tissue.Fluid); continue; }
        expect(hit.tissue, `${caseId} ${v.id} ${l.text}`).toBe(Tissue.Blood);
        expect(hit.part, `${caseId} ${v.id} ${l.text}`).toBe(PART[l.text]);
      }
    }
  });

  // what each standard view is taught to show, and structures it should not
  const EXPECT: [string, string[], string[]][] = [
    ["plax", ["RV", "LV", "LA", "Ao"], ["RA"]],
    ["psax-av", ["Ao", "LA", "RA", "PA"], ["LV", "LVOT"]],
    ["psax-pm", ["LV", "RV"], ["LA", "RA", "Ao"]],
    ["a4c", ["LV", "RV", "LA", "RA"], ["Ao"]],
    ["a5c", ["LV", "Ao", "LA"], []],
    ["a2c", ["LV", "LA"], ["RV", "RA"]],
    ["a3c", ["LV", "LA", "Ao"], ["RA"]],
    ["subcostal", ["LV", "RV", "LA", "RA"], []],
    ["ivc", ["IVC", "RA"], []],
    ["suprasternal", ["Ao", "DAo"], []],
    ["me4c", ["LA", "RA", "LV", "RV"], ["Ao"]],
    ["me2c", ["LA", "LV"], ["RV", "RA", "Ao"]],
    ["me-lax", ["LA", "LV", "Ao"], ["RA"]],
    ["me-av-sax", ["Ao", "LA", "RA"], ["LV", "LVOT"]],
    ["me-bicaval", ["LA", "RA", "SVC", "IVC"], []],
    ["tg-sax", ["LV", "RV"], ["LA", "RA"]],
    ["desc-aorta", ["DAo"], ["LV", "RV"]],
  ];
  it.each(EXPECT)("%s names %j and not %j", (id, has, not) => {
    const got = labels(id).map((l) => l.text);
    for (const t of has) expect(got, `${id}: ${got.join(" ")}`).toContain(t);
    for (const t of not) expect(got, `${id}: ${got.join(" ")}`).not.toContain(t);
  });

  it("names pericardial fluid in a large effusion and not in a normal heart", () => {
    expect(labels("plax", "effusion").map((l) => l.text)).toContain("PE");
    expect(labels("plax").map((l) => l.text)).not.toContain("PE");
  });
});
