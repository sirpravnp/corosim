import { describe, it, expect } from "vitest";
import { Part } from "../src/anatomy/heartSurface";
import { buildPoses } from "../src/echo/poses";
import { frameFor, rasterize } from "../src/echo/paint";
import { isWall, SEPTUM } from "../src/echo/wall";

describe("ventricular wall rule", () => {
  it("draws the interventricular septum as wall between the two cavities", () => {
    expect(isWall(Part.LV, -30, 2, 10)).toBe(true);
    expect(isWall(Part.RV, -30, -1, 10)).toBe(true);
  });
  it("leaves the LV and RV cavities open away from the septum and the outer wall", () => {
    expect(isWall(Part.LV, -30, SEPTUM.lv + 6, 10)).toBe(false);
    expect(isWall(Part.RV, -30, SEPTUM.rv - 6, 10)).toBe(false);
  });
  it("keeps the outer free walls, thicker on the left", () => {
    expect(isWall(Part.LV, -8, 25, 10)).toBe(true);
    expect(isWall(Part.RV, -2, -25, 10)).toBe(true);
    expect(isWall(Part.RV, -8, -25, 10)).toBe(false);
  });
  it("does not run the septum into the atria or the aorta", () => {
    expect(isWall(Part.LA, -20, 2, 56)).toBe(false);
    expect(isWall(Part.Aorta, -12, 0, 50)).toBe(false);
  });
});

describe("papillary short-axis slice", () => {
  const pose = buildPoses().psaxPM, w = 180, h = 200, r = rasterize(pose, w, h, frameFor(pose, w / h));
  it("has wall pixels between the LV cavity and the RV cavity on every scanline that holds both", () => {
    let both = 0;
    for (let y = 0; y < h; y++) {
      let lastCav = -1, lastPart = -1, sawWallBetween = false, crossed = false;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = r.part[i];
        if (p === Part.LV || p === Part.RV) {
          if (!r.wall[i]) {
            if (lastCav >= 0 && lastPart !== p) { crossed = true; if (!sawWallBetween) return expect.fail(`no wall between chambers on row ${y}`); }
            lastCav = x; lastPart = p; sawWallBetween = false;
          } else sawWallBetween = true;
        }
      }
      if (crossed) both++;
    }
    expect(both).toBeGreaterThan(5);
  });
});
