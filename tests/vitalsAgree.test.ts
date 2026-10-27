// One vital-signs snapshot: the Monitor's text, the Hemodynamics rows and the left-heart-cath rows show the same number for the same label
// at every frame, with and without ectopy. Slow (core engine): listed in tests/slow.json.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { monitorText } from "../src/sim/vitals";
import { numberRows } from "../src/panels/numbers";
import { cathRows } from "../src/panels/leftHeartCath";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { recentHemodynamicBeats, SETTLE_BEATS } from "../src/sim/hemoBeats";
import { CIRC } from "../src/physics/circulation";
import type { PatientSpec } from "../src/sim/patient";

const LAD = [{ artery: "LAD", occluded: true, position: 0.2 }];
const row = (rows: [string, string][], k: string) => rows.find((r) => r[0] === k)![1];

function frames(spec: PatientSpec, occlude: boolean) {
  const sim = new Simulation({}, { engine: "core" });
  const src = new LiveSource(sim);
  sim.reset({ seed: 3, ...spec }, { settled: true });
  sim.warmup(20);
  if (occlude) sim.apply({ lesions: LAD });
  sim.run(occlude ? 60 : 40); // the first 2 clinical hours of an occlusion: ectopy has started
  return { sim, src };
}

describe.each([
  ["normal rhythm", {}, false],
  ["ectopyTendency 3 with a LAD occlusion", { ectopyTendency: 3 }, true],
] as const)("%s", (_name, spec, occlude) => {
  const { sim, src } = frames(spec as PatientSpec, occlude);
  let maxEctopy = 0;
  it("shows identical vitals in the Monitor, Hemodynamics and left-heart-cath panels at every frame", () => {
    let checked = 0, withBeat = 0;
    maxEctopy = 0;
    for (let f = 0; f < 12; f++) {
      sim.run(1.7);
      const n = src.numbers(), v = src.vitals(), rows = numberRows(n, src.saturations()), mt = monitorText(v, CIRC.shockMap, CIRC.hypotensionMap);
      maxEctopy = Math.max(maxEctopy, n.ectopy?.fraction ?? 0);
      expect(mt.hr).toBe(`${row(rows, "HR")} bpm`);
      expect(mt.bp).toBe(row(rows, "BP s/d (mean)"));
      expect(mt.co.startsWith(`${row(rows, "CO / CI").split(" / ")[0]} L/min`)).toBe(true);
      expect(mt.ef).toBe(row(rows, "LVEF"));
      const hb = recentHemodynamicBeats(src.beats(4 + SETTLE_BEATS)).beats, c = leftHeartCath(n, hb[hb.length - 1], "adult");
      if (c) {
        const lh = cathRows(c, v);
        expect(row(lh, "Aorta s/d (mean)")).toBe(row(rows, "BP s/d (mean)").replace(/^(\d+)\/(\d+) \((\d+)\)$/, "$1/$2 ($3)"));
        expect(row(lh, "LV systolic / LVEDP").split(" / ")[1]).toBe(row(rows, "LVEDP"));
        withBeat++;
      }
      checked++;
    }
    expect(checked).toBe(12);
    expect(withBeat).toBeGreaterThan(8);
  });
  it("the Monitor's circulation status follows the same MAP", () => {
    const v = src.vitals(), mt = monitorText(v, CIRC.shockMap, CIRC.hypotensionMap);
    expect(mt.status).toBe(v.map < CIRC.shockMap ? "Shock" : v.map < CIRC.hypotensionMap ? "Hypotension" : "Stable");
  });
  if (occlude) it("has ectopy, so the check is not vacuous", () => {
    expect(maxEctopy).toBeGreaterThan(0);
  });
});
