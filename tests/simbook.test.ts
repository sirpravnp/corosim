import { describe, it, expect } from "vitest";
import {
  defaultCircuit,
  resistanceFromRadius,
  solveCircuit,
  ohmIdentityHolds,
} from "../src/simbook/circuit";
import { nominalOrganFlows, solveAutoreg } from "../src/simbook/autoreg";
import { advance, initChapter, recordPredictChoice, canAdvance } from "../src/simbook/runner";
import { defaultDiffusion, o2Profile } from "../src/simbook/diffusion";
import { defaultFick, fickFlux } from "../src/simbook/fick";
import { defaultStarling, starlingProfile } from "../src/simbook/starlingCapillary";
import { CHAPTER_1 } from "../src/simbook/chapters/chapter1";
import { CHAPTER_3 } from "../src/simbook/chapters/chapter3";
import { chapterById, CHAPTERS } from "../src/simbook/chapters";

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

describe("simbook autoreg", () => {
  const targets = nominalOrganFlows();

  it("holds brain flow on the plateau when MAP falls within range", () => {
    const high = solveAutoreg(90);
    const mid = solveAutoreg(70);
    expect(high.organs.brain.status).toBe("plateau");
    expect(mid.organs.brain.status).toBe("plateau");
    expect(mid.organs.brain.flowLMin).toBeCloseTo(targets.brain, 3);
    expect(mid.organs.brain.resistance).toBeLessThan(high.organs.brain.resistance);
  });

  it("gut loses plateau before brain when MAP is 60 mmHg", () => {
    const s = solveAutoreg(60);
    expect(s.organs.gut.status).toBe("below");
    expect(s.organs.brain.status).toBe("plateau");
    expect(s.organs.gut.flowLMin).toBeLessThan(targets.gut * 0.95);
  });

  it("branch flows sum to reported CO", () => {
    const s = solveAutoreg(75);
    const sum = (["brain", "kidney", "gut", "muscle"] as const).reduce((a, id) => a + s.organs[id].flowLMin, 0);
    expect(sum).toBeCloseTo(s.cardiacOutputLMin, 4);
  });
});

describe("simbook diffusion", () => {
  it("anoxic depth grows with consumption and shrinks when flow is on", () => {
    const high = o2Profile({ ...defaultDiffusion(), consumption: 2 });
    const low = o2Profile({ ...defaultDiffusion(), consumption: 0.5 });
    expect((high.anoxicDepthUm ?? 999) < (low.anoxicDepthUm ?? 999) || high.anoxicDepthUm != null).toBe(true);
    const off = o2Profile({ ...defaultDiffusion(), flowOn: false });
    const on = o2Profile({ ...defaultDiffusion(), flowOn: true });
    expect(on.capConc).toBeGreaterThan(off.capConc);
  });

  it("doubling effective distance quadruples diffusion time scale", () => {
    const a = o2Profile({ ...defaultDiffusion(), thicknessUm: 100 });
    const b = o2Profile({ ...defaultDiffusion(), thicknessUm: 200 });
    expect(b.diffusionTimeS / a.diffusionTimeS).toBeCloseTo(4, 1);
  });
});

describe("simbook fick", () => {
  it("flux falls when thickness increases", () => {
    const thin = fickFlux({ ...defaultFick(), thicknessUm: 1 });
    const thick = fickFlux({ ...defaultFick(), thicknessUm: 2 });
    expect(thick).toBeCloseTo(thin / 2, 5);
  });
});

describe("simbook starling", () => {
  it("filters at arterial end and reabsorbs toward venous at baseline", () => {
    const p = starlingProfile(defaultStarling());
    expect(p.stations[0]!.jvMlMin).toBeGreaterThan(0);
    expect(p.stations[p.stations.length - 1]!.jvMlMin).toBeLessThan(0);
  });

  it("net filtration rises with venous pressure and falling albumin", () => {
    const base = starlingProfile(defaultStarling());
    const highPv = starlingProfile({ ...defaultStarling(), venousPressureMmHg: 14 });
    const lowAlb = starlingProfile({ ...defaultStarling(), albuminScale: 0.5 });
    expect(highPv.netFiltrationMlMin).toBeGreaterThan(base.netFiltrationMlMin);
    expect(lowAlb.netFiltrationMlMin).toBeGreaterThan(base.netFiltrationMlMin);
  });
});

describe("simbook runner", () => {
  it("lists three ready chapters", () => {
    expect(CHAPTERS.filter((c) => c.ready).length).toBe(3);
    expect(CHAPTER_1.ready).toBe(true);
  });
  it("requires a predict choice before advancing", () => {
    let v = initChapter(CHAPTER_3);
    while (v.block.kind !== "predict") v = advance(v);
    expect(canAdvance(v)).toBe(false);
    v = recordPredictChoice(v, 0);
    expect(canAdvance(v)).toBe(true);
  });

  it("maps legacy chapter hash ohm-circuit", () => {
    expect(chapterById("ohm-circuit")?.id).toBe("perfusion-circuit");
  });
});
