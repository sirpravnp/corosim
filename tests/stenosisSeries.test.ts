// Proximal LAD diameter stenosis at rest: ischemic mass should grow with severity, not step at ~75%, and severe stenosis
// should show the same anterior ST pattern as a proximal occlusion (V2 and aVL up, III down).
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";

const ladStenosis = (ds: number) => ({
  lesions: [{ artery: "LAD" as const, stenosis: ds, position: 0.2 }],
  exertion: false,
});

function settled(sc: ReturnType<typeof ladStenosis> | { lesions: { artery: "LAD"; occluded: true; position: number }[]; exertion: boolean }, sec = 180) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 1, ...sc }, { settled: true, warmup: 30 });
  s.run(sec);
  return { state: s.state(), ecg: s.ecg() };
}

describe("proximal LAD stenosis series (seed 1, rest)", () => {
  const occ = settled({ lesions: [{ artery: "LAD", occluded: true, position: 0.2 }], exertion: false });
  const s70 = settled(ladStenosis(0.7));
  const s75 = settled(ladStenosis(0.75));
  const s90 = settled(ladStenosis(0.9));

  it("70% at rest is not the full territorial ischemic mass; 90% exceeds 75%", () => {
    const full = occ.state.ischemicMassFraction;
    expect(s70.state.ischemicMassFraction).toBeGreaterThan(0.008);
    expect(s70.state.ischemicMassFraction).toBeLessThan(full * 0.85);
    expect(s90.state.ischemicMassFraction).toBeGreaterThan(s75.state.ischemicMassFraction + 0.05);
  });

  it("severe proximal stenosis matches an occlusion for ST elevation signs in V2, aVL and III", () => {
    const st = s90.ecg.stMm;
    const ref = occ.ecg.stMm;
    expect(st.V2).toBeGreaterThan(1);
    expect(st.aVL).toBeGreaterThan(1);
    expect(st.III).toBeLessThan(-1);
    expect(Math.sign(st.V2)).toBe(Math.sign(ref.V2));
    expect(Math.sign(st.aVL)).toBe(Math.sign(ref.aVL));
    expect(Math.sign(st.III)).toBe(Math.sign(ref.III));
  });
});
