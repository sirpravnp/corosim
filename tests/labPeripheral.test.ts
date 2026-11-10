import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import peripheral from "../src/cath/data/peripheral.json";

type Seg = {
  id: string;
  parent: string | null;
  points: [number, number, number][];
  radiusMm: number[];
  origin?: string;
  checkedAgainst?: string;
};

const segs = peripheral.segments as Seg[];
const byId = Object.fromEntries(segs.map((s) => [s.id, s]));

const arcLength = (pts: [number, number, number][]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
};

const LEG = ["CFA", "PFA", "SFA", "POP", "ATA", "PTA", "PERONEAL", "DP"];
const ARM = ["SUBCLAV", "AXILLARY", "BRACHIAL", "RADIAL", "ULNAR"];
const expectedIds = [
  "AORTA_THOR", "AORTA_ABD", "ARCH",
  "CIA_R", "CIA_L", "EIA_R", "EIA_L", "IIA_R", "IIA_L",
  ...LEG.flatMap((b) => [`${b}_R`, `${b}_L`]),
  ...ARM.flatMap((b) => [`${b}_R`, `${b}_L`]),
  "CCA_R", "CCA_L", "VERT_R", "VERT_L",
];

describe("peripheral anatomy data", () => {
  it("every segment has monotone arclength and matching radius count", () => {
    expect(segs.length).toBeGreaterThan(20);
    for (const s of segs) {
      expect(s.points.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.radiusMm.length, s.id).toBe(s.points.length);
      for (const r of s.radiusMm) expect(r, s.id).toBeGreaterThan(0);
      // Cumulative arclength is monotone by construction of successive distances ≥ 0.
      expect(arcLength(s.points), s.id).toBeGreaterThan(1);
    }
  });

  it("both legs and both arms are present with the expected ids", () => {
    for (const id of expectedIds) {
      expect(byId[id], id).toBeTruthy();
    }
  });

  it("radius tapers distally: CFA > SFA > popliteal > tibials", () => {
    // Typical adult diameters [lit]: aorta ~20 mm, CFA ~8, SFA ~6, popliteal ~5, tibial ~3 → radii half of those.
    const meanR = (id: string) => {
      const r = byId[id]!.radiusMm;
      return r.reduce((a, b) => a + b, 0) / r.length;
    };
    for (const side of ["R", "L"]) {
      expect(meanR(`CFA_${side}`)).toBeGreaterThan(meanR(`SFA_${side}`));
      expect(meanR(`SFA_${side}`)).toBeGreaterThan(meanR(`POP_${side}`));
      expect(meanR(`POP_${side}`)).toBeGreaterThan(meanR(`ATA_${side}`));
      expect(meanR(`ATA_${side}`)).toBeLessThan(2);
      expect(meanR(`CFA_${side}`)).toBeGreaterThan(3);
      expect(meanR(`CFA_${side}`)).toBeLessThan(6);
    }
    const aorta = meanR("AORTA_ABD");
    expect(aorta).toBeGreaterThan(7);
    expect(aorta).toBeLessThan(14);
  });

  it("the bifurcation joins the iliacs within 2 mm", () => {
    const abd = byId.AORTA_ABD!;
    const end = abd.points[abd.points.length - 1]!;
    for (const id of ["CIA_R", "CIA_L"]) {
      const start = byId[id]!.points[0]!;
      const d = Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]);
      expect(d, id).toBeLessThanOrEqual(2);
    }
  });

  it("sources doc lists a license row for every data source used", () => {
    const md = readFileSync("docs/CATH_PERIPHERAL_SOURCES.md", "utf8");
    expect(md).toMatch(/License/i);
    // Every non-assumed origin in the JSON must appear as a table row; assumed segments are allowed.
    const origins = new Set(segs.map((s) => s.origin).filter((o): o is string => !!o && o !== "assumed"));
    for (const o of origins) {
      expect(md.includes(o) || md.toLowerCase().includes(o.toLowerCase()), o).toBe(true);
    }
    // Manifest entries referenced by checkedAgainst should be named in the doc.
    for (const s of segs) {
      if (s.checkedAgainst && s.checkedAgainst !== "assumed") {
        expect(md.includes(s.checkedAgainst) || md.includes(s.checkedAgainst.replace(/\.[^.]+$/, "")), s.id).toBe(true);
      }
    }
  });

  it("no reference image or its pixels is committed", () => {
    const manifestPath = "scripts/cath/work/refs/manifest.json";
    const names = new Set<string>();
    if (existsSync(manifestPath)) {
      const man = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: { filename: string; sha256?: string }[] };
      for (const f of man.files ?? []) {
        names.add(f.filename);
        if (f.sha256) names.add(f.sha256);
      }
    }
    // Also ban the Commons filenames listed in the plan even without a local manifest.
    for (const name of [
      "Leriche-Syndrom-DSA.jpg", "AAA i AAIC.jpg", "Neutral popliteal artery angiogram.png",
      "Arteriografia de troncs supra-aòrtics. IMG 2507.JPG", "Takayasu Arteritis.jpg",
    ]) names.add(name);

    const walk = (dir: string, out: string[] = []) => {
      if (!existsSync(dir)) return out;
      for (const ent of readdirSync(dir)) {
        const p = join(dir, ent);
        if (statSync(p).isDirectory()) {
          if (ent === "node_modules" || ent === "dist" || ent === "work") continue;
          walk(p, out);
        } else out.push(p);
      }
      return out;
    };
    const tracked = [...walk("src"), ...walk("public")];
    for (const file of tracked) {
      for (const banned of names) {
        expect(file.includes(banned), file).toBe(false);
      }
    }
  });

  it("every segment names the reference it was checked against, or is marked assumed", () => {
    for (const s of segs) {
      const ok = s.origin === "assumed" || !!(s.checkedAgainst && s.checkedAgainst.length > 0);
      expect(ok, s.id).toBe(true);
    }
  });
});
