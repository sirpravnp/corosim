// Severe native aortic stenosis mean gradient band (condition matrix mx-valve-av-sten-1), core engine, seed 1 ~60 s.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { assessHeart, valveSet } from "../src/sim/valves";

const SEED = 1;
const RUN_S = 60;

function meanAorticGradient(seed: number, heart: { valves: ReturnType<typeof valveSet> }) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed, heart }, { settled: true, warmup: 30 });
  const src = new LiveSource(s);
  s.warmup(10);
  s.step(RUN_S);
  const beat = src.beats(6).at(-1)!;
  return leftHeartCath(src.numbers(), beat, "adult")!.gradient.mean;
}

describe("severe aortic stenosis gradients (core engine)", () => {
  it("severity 1 mean gradient sits in the 40–60 mmHg severe band at seed 1 ~60 s", () => {
    const g = meanAorticGradient(SEED, { valves: valveSet({ av: { stenosis: 1 } }) });
    expect(g).toBeGreaterThanOrEqual(40);
    expect(g).toBeLessThanOrEqual(60);
  });

  it("0.95-style severe stays in band and AS+MR drops the aortic gradient by about 3–6 mmHg", () => {
    const asAlone = meanAorticGradient(SEED, { valves: valveSet({ av: { stenosis: 1 } }) });
    const withMr = meanAorticGradient(SEED, { valves: valveSet({ av: { stenosis: 1 }, mv: { regurgitation: 0.5 } }) });
    const drop = asAlone - withMr;
    expect(drop).toBeGreaterThanOrEqual(3);
    expect(drop).toBeLessThanOrEqual(6);
    const g095 = meanAorticGradient(SEED, { valves: valveSet({ av: { stenosis: 0.95 } }) });
    expect(g095).toBeGreaterThanOrEqual(35);
  });

  it("mitral regurgitation severity 1 regurgitant fraction is about 0.45–0.52 on the settled structural read", () => {
    const rf = assessHeart({ valves: valveSet({ mv: { regurgitation: 1 } }) }).valves.find((v) => v.valve === "MV")!.regurgFraction!;
    expect(rf).toBeGreaterThanOrEqual(0.45);
    expect(rf).toBeLessThanOrEqual(0.52);
  });
});
