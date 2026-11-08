import { describe, it, expect } from "vitest";
import { CATALOG, byId, balloonDiameter } from "../src/config/devices";
import type { Balloon, Guidewire, Stent } from "../src/lab/types";

describe("device catalog", () => {
  it("has unique ids", () => {
    const ids = CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every catalog entry by id", () => {
    for (const d of CATALOG) expect(byId[d.id]).toBe(d);
  });

  it("grows balloon diameter with pressure and hits nominal at nominalAtm", () => {
    const balloons = CATALOG.filter((d): d is Balloon => d.kind === "balloon");
    for (const b of balloons) {
      expect(balloonDiameter(b, b.nominalAtm)).toBeCloseTo(b.nominalMm, 9);
      const lo = balloonDiameter(b, b.nominalAtm - 2);
      const hi = balloonDiameter(b, b.nominalAtm + 4);
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it("keeps stents within length and diameter bounds", () => {
    const stents = CATALOG.filter((d): d is Stent => d.kind === "stent");
    for (const s of stents) {
      expect(s.lengthMm).toBeLessThanOrEqual(38);
      expect(s.nominalMm).toBeGreaterThanOrEqual(2.25);
    }
  });

  it("orders CTO wire tip load above floppy", () => {
    const floppy = byId["wire-floppy"] as Guidewire;
    const cto = byId["wire-stiff-cto"] as Guidewire;
    expect(cto.tipLoadGf).toBeGreaterThan(floppy.tipLoadGf);
  });
});
