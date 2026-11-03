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
import { SIMBOOK_AUTOREG as A } from "../src/config/simbook";
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

  it("flow is continuous across both plateau edges", () => {
    for (const id of ["brain", "kidney", "gut"] as const) {
      const lo = A.mapLow[id], hi = A.mapHigh[id];
      expect(Math.abs(solveAutoreg(hi + 0.01).organs[id].flowLMin - solveAutoreg(hi - 0.01).organs[id].flowLMin)).toBeLessThan(0.01);
      expect(Math.abs(solveAutoreg(lo + 0.01).organs[id].flowLMin - solveAutoreg(lo - 0.01).organs[id].flowLMin)).toBeLessThan(0.01);
    }
  });

  it("flow never falls as MAP rises for passive and autoregulated beds", () => {
    let prev = solveAutoreg(40);
    for (let m = 41; m <= 160; m++) {
      const s = solveAutoreg(m);
      for (const id of ["brain", "kidney", "gut", "muscle"] as const) expect(s.organs[id].flowLMin).toBeGreaterThanOrEqual(prev.organs[id].flowLMin - 1e-9);
      prev = s;
    }
  });

  it("branch flows sum to reported CO", () => {
    const s = solveAutoreg(75);
    const sum = (["brain", "kidney", "gut", "muscle"] as const).reduce((a, id) => a + s.organs[id].flowLMin, 0);
    expect(sum).toBeCloseTo(s.cardiacOutputLMin, 4);
  });
});

describe("simbook diffusion", () => {
  it("consumption lowers oxygen and never lifts it above the capillary value", () => {
    const lo = o2Profile({ ...defaultDiffusion(), consumption: 0.5 });
    const hi = o2Profile({ ...defaultDiffusion(), consumption: 2 });
    expect(Math.max(...hi.conc)).toBeLessThanOrEqual(hi.capConc + 1e-9);
    expect(hi.conc[40]!).toBeLessThan(lo.conc[40]!);
    expect(hi.conc[hi.conc.length - 1]!).toBeLessThan(lo.conc[lo.conc.length - 1]!);
  });

  it("oxygen falls monotonically from the capillary toward the core", () => {
    const s = o2Profile(defaultDiffusion());
    for (let i = 1; i < s.conc.length; i++) expect(s.conc[i]!).toBeLessThanOrEqual(s.conc[i - 1]! + 1e-12);
  });

  it("rest reaches the core; a thick slab, no flow or high metabolism goes anoxic", () => {
    expect(o2Profile(defaultDiffusion()).anoxicDepthUm).toBeNull();
    const thick = o2Profile({ ...defaultDiffusion(), thicknessUm: 240 });
    expect(thick.anoxicDepthUm).not.toBeNull();
    expect(thick.anoxicDepthUm!).toBeLessThan(thick.effectiveThicknessUm);
    expect(o2Profile({ ...defaultDiffusion(), flowOn: false }).anoxicDepthUm).not.toBeNull();
    expect(o2Profile({ ...defaultDiffusion(), consumption: 2.5 }).anoxicDepthUm).not.toBeNull();
  });

  it("denser capillaries pull the anoxic boundary back out", () => {
    const sparse = o2Profile({ ...defaultDiffusion(), thicknessUm: 200, density: 1 });
    const dense = o2Profile({ ...defaultDiffusion(), thicknessUm: 200, density: 2.5 });
    expect(dense.anoxicDepthUm).toBeNull();
    expect(sparse.anoxicDepthUm).not.toBeNull();
  });

  it("flow on raises capillary O₂", () => {
    expect(o2Profile({ ...defaultDiffusion(), flowOn: true }).capConc).toBeGreaterThan(o2Profile({ ...defaultDiffusion(), flowOn: false }).capConc);
  });

  it("doubling the diffusion distance quadruples the diffusion time scale", () => {
    const base = { ...defaultDiffusion(), consumption: 0.4 };
    const a = o2Profile({ ...base, thicknessUm: 100 });
    const b = o2Profile({ ...base, thicknessUm: 200 });
    expect(a.anoxicDepthUm).toBeNull();
    expect(b.anoxicDepthUm).toBeNull();
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

  it("rest is balanced: some filtration, lymph keeps up, no edema", () => {
    const p = starlingProfile(defaultStarling());
    expect(p.netFiltrationMlMin).toBeGreaterThan(0);
    expect(p.netFiltrationMlMin).toBeLessThan(p.lymphReturnMlMin);
    expect(p.edema).toBe(false);
  });

  it("high venous pressure, low albumin or leaky capillaries each cause edema", () => {
    expect(starlingProfile({ ...defaultStarling(), venousPressureMmHg: 14 }).edema).toBe(true);
    expect(starlingProfile({ ...defaultStarling(), albuminScale: 0.5 }).edema).toBe(true);
    expect(starlingProfile({ ...defaultStarling(), kfScale: 2.5 }).edema).toBe(true);
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
