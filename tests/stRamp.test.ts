/**
 * Proximal LAD stenosis ladder on the core engine: transmurality thresholds should ramp ST in V2
 * when ischemic mass is already high (85%), without opening ST at 70% or moving proximal occlusion.
 */
import { describe, it, expect } from "vitest";
import { runOne } from "../scripts/eval/engine";
import type { State } from "../scripts/eval/states";

const CHECK_S = 180;
const SEED = 1;

function ladStenosis(stenosis?: number): State {
  const lesion =
    stenosis === undefined
      ? { artery: "LAD", occluded: true, position: 0.2 }
      : { artery: "LAD", stenosis, position: 0.2 };
  return {
    id: `lad-${stenosis ?? "occ"}-${CHECK_S}s`,
    title: "proximal LAD stenosis ramp",
    insult: { lesions: [lesion] },
    checkpoints: [CHECK_S],
  };
}

function v2(st: State): number {
  const row = runOne(st, SEED).at[String(CHECK_S)];
  expect(row).toBeDefined();
  const v = row!["st.V2"];
  expect(typeof v).toBe("number");
  return v as number;
}

function mass(st: State): number {
  const row = runOne(st, SEED).at[String(CHECK_S)];
  return (row?.ischemicMassFraction as number) ?? 0;
}

describe("proximal LAD ST transmurality ramp (core engine, seed 1, 180 s)", () => {
  it("70% stays quiet when the territory is not ischemic", () => {
    expect(mass(ladStenosis(0.7))).toBeLessThan(0.05);
    expect(Math.abs(v2(ladStenosis(0.7)))).toBeLessThan(0.5);
  });

  it("85% with high ischemic mass shows anterior ST elevation in V2", () => {
    const st = ladStenosis(0.85);
    expect(mass(st)).toBeGreaterThan(0.3);
    expect(v2(st)).toBeGreaterThanOrEqual(1.0);
  });

  it("90% and occlusion stay in the proximal anterior STEMI range with inferior reciprocal change", () => {
    const occ = ladStenosis(undefined);
    const row = runOne(occ, SEED).at[String(CHECK_S)]!;
    expect(v2(ladStenosis(0.9))).toBeGreaterThanOrEqual(2.5);
    expect(v2(occ)).toBeGreaterThanOrEqual(2.5);
    expect(v2(occ)).toBeLessThanOrEqual(4.5);
    expect(row["st.III"] as number).toBeLessThan(0);
  });
});
