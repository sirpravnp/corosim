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

  it("70% at rest is partial; 90% is a larger ischemic mass than 75%", () => {
    const full = occ.state.ischemicMassFraction;
    expect(s70.state.ischemicMassFraction).toBeGreaterThan(0.02);
    expect(s70.state.ischemicMassFraction).toBeLessThan(full * 0.5);
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

describe("clinical clock at 1x, 3x and 6x", () => {
  function atTenMinutes(speed: number) {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 1 }, { settled: true, warmup: 30 });
    s.warmup(10);
    s.step(20);
    s.speed = speed;
    s.apply({ bloodLoss: 0.3 });
    s.run(10 / (speed * s.minutesPerSecond));
    const r = s.rolling(10);
    return { hr: r.hr, map: r.map };
  }
  const base = atTenMinutes(1);

  it("30% hemorrhage at 10 clinical minutes stays near the 1x heart rate and pressure", () => {
    for (const speed of [3, 6]) {
      const x = atTenMinutes(speed);
      expect(Math.abs(x.hr - base.hr) / base.hr).toBeLessThan(0.05);
      expect(Math.abs(x.map - base.map) / base.map).toBeLessThan(0.08);
    }
  });
});
