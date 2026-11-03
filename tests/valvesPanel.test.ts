import { describe, it, expect } from "vitest";
import { severityOf } from "../src/panels/valvesPanel";
import { nativeLesion } from "../src/sim/valves";
import { VALVE_KEYS } from "../src/config/valves";

describe("Valves tab sliders", () => {
  it("read back the severities nativeLesion was built from", () => {
    for (const k of VALVE_KEYS) {
      const s = severityOf(k, nativeLesion(k, { stenosis: 0.6, regurgitation: 0.35 }));
      expect(s.stenosis).toBeCloseTo(0.6, 6);
      expect(s.regurgitation).toBeCloseTo(0.35, 6);
    }
    expect(severityOf("av", undefined)).toEqual({ stenosis: 0, regurgitation: 0 });
  });
});
