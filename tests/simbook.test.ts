import { describe, it, expect } from "vitest";
import {
  defaultCircuit,
  resistanceFromRadius,
  solveCircuit,
  ohmIdentityHolds,
} from "../src/simbook/circuit";
import { advance, initChapter, recordPredictChoice, canAdvance } from "../src/simbook/runner";
import { CHAPTER_4 } from "../src/simbook/chapters/chapter4";

describe("simbook circuit", () => {
  it("MAP − CVP = CO × SVR at nominal settings", () => {
    const p = defaultCircuit();
    const s = solveCircuit(p);
    expect(ohmIdentityHolds(s, p.cardiacOutputLMin)).toBe(true);
    expect(s.mapMmHg).toBeGreaterThan(p.cvpMmHg);
  });

  it("halving radius multiplies resistance by 16", () => {
    const r0 = 68;
    const full = resistanceFromRadius(r0, 1);
    const half = resistanceFromRadius(r0, 0.5);
    expect(half / full).toBeCloseTo(16, 6);
  });

  it("branch flows sum to cardiac output", () => {
    const p = defaultCircuit();
    p.organs.find((o) => o.id === "gut")!.radius = 0.5;
    const s = solveCircuit(p);
    const sum = Object.values(s.flows).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(p.cardiacOutputLMin, 2);
  });

  it("constricting one bed raises SVR and MAP at fixed CO", () => {
    const base = solveCircuit(defaultCircuit());
    const p = defaultCircuit();
    p.organs.find((o) => o.id === "gut")!.radius = 0.5;
    const tight = solveCircuit(p);
    expect(tight.svr).toBeGreaterThan(base.svr);
    expect(tight.mapMmHg).toBeGreaterThan(base.mapMmHg);
  });
});

describe("simbook runner", () => {
  it("requires a predict choice before advancing", () => {
    let v = initChapter(CHAPTER_4);
    while (v.block.kind !== "predict") v = advance(v);
    expect(canAdvance(v)).toBe(false);
    v = recordPredictChoice(v, 0);
    expect(canAdvance(v)).toBe(true);
  });
});
