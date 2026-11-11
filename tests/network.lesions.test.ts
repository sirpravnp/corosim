import { describe, it, expect } from "vitest";
import { buildTree } from "../src/anatomy/tree";
import { analyze, type Graft, type Lesion } from "../src/physics/network";
import { DEFAULT_LESION_LENGTH_MM } from "../src/physics/geometry";

const tree = buildTree();

const GOLDEN = {
  lad50: { ffr: 0.838311748, pa: 11998.98, vmax: 1.500850362, vmean: 0.56697553 },
  lad75: { ffr: 0.450422335, pa: 11998.98, vmax: 2.384436449, vmean: 0.483988862 },
  lm90: { ffr: 0.255923455, pa: 11998.98, vmax: 2.213923087, vmean: 0.596660004 },
} as const;

const vesselStats = (lesions: Lesion[], exertion: boolean, artery: string) => {
  const a = analyze(tree, lesions, exertion);
  const r = a.hyper.seg[artery];
  const vmax = Math.max(...r.v);
  const vmean = r.v.reduce((s, v) => s + v, 0) / r.v.length;
  return { ffr: a.ffr, pa: a.hyper.pa, vmax, vmean, a };
};

describe("network lesions", () => {
  it("single lesion results are unchanged", () => {
    const near = (x: number, y: number, tol = 1e-9) => expect(Math.abs(x - y)).toBeLessThanOrEqual(tol);
    const g50 = vesselStats([{ segId: "LAD", pos: 0.5, ds: 0.5 }], false, "LAD");
    near(g50.ffr[0], GOLDEN.lad50.ffr); near(g50.pa, GOLDEN.lad50.pa); near(g50.vmax, GOLDEN.lad50.vmax); near(g50.vmean, GOLDEN.lad50.vmean);
    const g75 = vesselStats([{ segId: "LAD", pos: 0.5, ds: 0.75 }], true, "LAD");
    near(g75.ffr[0], GOLDEN.lad75.ffr); near(g75.pa, GOLDEN.lad75.pa); near(g75.vmax, GOLDEN.lad75.vmax); near(g75.vmean, GOLDEN.lad75.vmean);
    const g90 = vesselStats([{ segId: "LM", pos: 0.5, ds: 0.9 }], false, "LM");
    near(g90.ffr[0], GOLDEN.lm90.ffr); near(g90.pa, GOLDEN.lm90.pa); near(g90.vmax, GOLDEN.lm90.vmax); near(g90.vmean, GOLDEN.lm90.vmean);
  });

  it("longer lesion costs more pressure", () => {
    const short = analyze(tree, [{ segId: "LAD", pos: 0.5, ds: 0.7, lengthMm: 14 }], false);
    const long = analyze(tree, [{ segId: "LAD", pos: 0.5, ds: 0.7, lengthMm: 30 }], false);
    const shortEnd = short.hyper.terminals.find((t) => t.key === "LAD#end")!;
    const longEnd = long.hyper.terminals.find((t) => t.key === "LAD#end")!;
    expect(longEnd.ratio).toBeLessThan(shortEnd.ratio);
    expect(long.ffr[0]).toBeLessThan(short.ffr[0]);
  });

  it("two lesions in series are worse than either alone", () => {
    const oneA = analyze(tree, [{ segId: "LAD", pos: 0.3, ds: 0.6 }], false);
    const oneB = analyze(tree, [{ segId: "LAD", pos: 0.6, ds: 0.6 }], false);
    const both = analyze(tree, [
      { segId: "LAD", pos: 0.3, ds: 0.6 },
      { segId: "LAD", pos: 0.6, ds: 0.6 },
    ], false);
    expect(both.ffr.length).toBe(2);
    // Distal FFR and perfusion reflect the tandem burden; proximal FFR can rise at lower hyperemic flow.
    expect(both.ffr[1]).toBeLessThan(oneA.ffr[0]);
    expect(both.ffr[1]).toBeLessThan(oneB.ffr[0]);
    const end = (a: typeof oneA) => a.hyper.terminals.find((t) => t.key === "LAD#end")!.ratio;
    expect(end(both)).toBeLessThan(end(oneA));
    expect(end(both)).toBeLessThan(end(oneB));
  });

  it("bed resistance multiplier starves one bed", () => {
    const base = analyze(tree, [], false);
    const starved = analyze(tree, [], false, undefined, [], 1, { "LAD#end": 4 });
    const lad = starved.hyper.terminals.find((t) => t.key === "LAD#end")!;
    const ladBase = base.hyper.terminals.find((t) => t.key === "LAD#end")!;
    expect(lad.ratio).toBeLessThan(ladBase.ratio);
    expect(lad.severity).toBeGreaterThan(ladBase.severity);
  for (const t of starved.hyper.terminals) {
      if (t.key === "LAD#end") continue;
      const tb = base.hyper.terminals.find((x) => x.key === t.key)!;
      expect(Math.abs(t.ratio - tb.ratio)).toBeLessThan(0.02);
    }
  });

  it("occlusion position uses the lesion own pos", () => {
    const pos = 0.42;
    const lesions: Lesion[] = [
      { segId: "LAD", pos: 0.5, ds: 0.6 },
      { segId: "LAD", pos, ds: 1, occluded: true },
    ];
    const { hyper } = analyze(tree, lesions, false);
    const lad = tree.byId.LAD;
    expect(hyper.seg.LAD.blockedFrom).toBeCloseTo(pos * lad.length, 6);
  });

  it("hyperemic FFR stays at reference aortic pressure without live grafts", () => {
    const lesions: Lesion[] = [{ segId: "LAD", pos: 0.5, ds: 0.75 }];
    const grafts: Graft[] = [{ segId: "LAD", pos: 20 }];
    const ref = analyze(tree, lesions, false).ffr[0];
    const lowPa = analyze(tree, lesions, false, 75, grafts).ffr[0];
    expect(lowPa).toBeCloseTo(ref, 3);
  });

  it("defaults lesion length to the legacy 14 mm window", () => {
    const explicit = analyze(tree, [{ segId: "LAD", pos: 0.5, ds: 0.75, lengthMm: DEFAULT_LESION_LENGTH_MM }], true);
    const implicit = analyze(tree, [{ segId: "LAD", pos: 0.5, ds: 0.75 }], true);
    expect(explicit.ffr[0]).toBeCloseTo(implicit.ffr[0], 12);
  });
});
