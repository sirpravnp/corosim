// Compares today's engines against the snapshots in tests/fixtures/ (made by scripts/regen-fixtures.ts).
// Structural: relative 0.5 % with an absolute floor per unit. ACS traces: relative 1 % per sample with a floor.
import { describe, it, expect } from "vitest";
import structural from "./fixtures/structural.json";
import acs from "./fixtures/acs.json";
import { structuralSnapshot, acsTrace, ACS_SCENARIOS, Flat, AcsSample } from "./fixtures/compute";

/** Absolute floor by field: pressures/volumes/gradients 0.05 (mmHg, ml, L/min, WU), saturations and fractions 0.005. */
const floor = (key: string) => (/saturation|Ef$/.test(key) ? 0.005 : 0.05);

function mismatch(label: string, key: string, want: unknown, got: unknown, relTol: number, abs: number): string | null {
  if (typeof want === "number" && typeof got === "number") {
    return Math.abs(got - want) <= Math.max(relTol * Math.abs(want), abs) ? null : `${label} ${key}: fixture ${want}, now ${got}`;
  }
  return want === got ? null : `${label} ${key}: fixture ${JSON.stringify(want)}, now ${JSON.stringify(got)}`;
}

describe("regression: structural lesions at default sliders", () => {
  const fixtures = structural as unknown as Record<string, Flat>;
  for (const id of Object.keys(fixtures)) {
    it(`${id} matches the fixture within 0.5 %`, () => {
      const now = structuralSnapshot(id), want = fixtures[id];
      expect(Object.keys(now).sort(), `${id}: field set changed`).toEqual(Object.keys(want).sort());
      const bad = Object.keys(want).map((k) => mismatch(id, k, want[k], now[k], 0.005, floor(k))).filter(Boolean);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
});

describe("regression: ACS scenario traces (seed, 60 s after warmup)", () => {
  const scenarios = (acs as unknown as { scenarios: Record<string, { trace: AcsSample[] }> }).scenarios;
  it("fixture and test cover the same scenarios", () => { expect(Object.keys(scenarios).sort()).toEqual(Object.keys(ACS_SCENARIOS).sort()); });
  for (const name of Object.keys(scenarios)) {
    it(`${name} trace matches the fixture within 1 % per sample`, () => {
      const want = scenarios[name].trace, now = acsTrace(ACS_SCENARIOS[name]);
      expect(now.length, `${name}: trace length`).toBe(want.length);
      const bad: string[] = [];
      want.forEach((w, i) => {
        for (const k of Object.keys(w) as (keyof AcsSample)[]) {
          const m = mismatch(`${name} t=${w.t}s`, k, w[k], now[i][k], 0.01, k === "co" ? 0.05 : 0.5);
          if (m) bad.push(m);
        }
      });
      expect(bad.slice(0, 20), bad.slice(0, 20).join("\n")).toEqual([]);
    });
  }
});
