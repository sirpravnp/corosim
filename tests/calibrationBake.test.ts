import { describe, expect, it } from "vitest";
import { BAKE_SETS, bakedKey, calibrateVolume, volumeOffsetFor } from "../src/physics/structural";
import { BAKED_OFFSETS } from "../src/physics/calibration.baked";

// The blood-volume calibration is baked (src/physics/calibration.baked.ts) so a page does not pay about two seconds for it at load.
// A change to the physics or its constants changes the key (miss) or the value (drift): re-run `npx tsx scripts/bake-calibration.ts`.
describe("baked blood-volume calibration", () => {
  for (const s of BAKE_SETS) {
    const name = `${s.spec.patient ?? "adult"}${s.core ? " " + JSON.stringify(s.core) : ""}${s.build ? " " + JSON.stringify(s.build) : ""}`;
    it(`${name} is baked and equals a fresh computation`, () => {
      const key = bakedKey(s.spec, s.core, s.build), baked = BAKED_OFFSETS[key];
      expect(baked, `no baked value under ${key}: run npx tsx scripts/bake-calibration.ts`).toBeDefined();
      const fresh = calibrateVolume(s.spec, s.core, s.build);
      expect(Math.abs(baked - fresh), `baked ${baked} vs computed ${fresh}: run npx tsx scripts/bake-calibration.ts`).toBeLessThan(1e-9 * Math.max(1, Math.abs(fresh)));
      expect(volumeOffsetFor(s.spec, s.core, s.build)).toBe(baked); // served from the bake, not recomputed
    }, 60000);
  }
  it("a build that is not baked still calibrates by computing", () => {
    const build = { atrialEesScale: 0.9 };
    expect(BAKED_OFFSETS[bakedKey({}, undefined, build)]).toBeUndefined();
    expect(volumeOffsetFor({}, undefined, build)).toBe(calibrateVolume({}, undefined, build));
  }, 60000);
  it("the key changes with the options the calibration depends on", () => {
    expect(bakedKey({}, { inertance: false })).not.toBe(bakedKey({}));
    expect(bakedKey({})).toBe(bakedKey({}, {})); // an empty option set is the default
  });
});
