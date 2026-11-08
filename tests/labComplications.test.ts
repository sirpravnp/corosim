import { describe, it, expect } from "vitest";
import { byId } from "../src/config/labDevices";
import { draw, risk, scriptedComplication, type Complication } from "../src/lab/complications";
import type { Guidewire } from "../src/lab/types";

describe("lab complications", () => {
  const wire = byId["wire-stiff-cto"] as Guidewire;
  const floppy = byId["wire-floppy"] as Guidewire;

  it("risk is monotonic in main drivers", () => {
    const low = risk("perforation", { tipLoad: 1, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 });
    const high = risk("perforation", { tipLoad: 12, calcium: 0.9, oversize: 0.3, thrombus: 0, pressureAtm: 8, ratedAtm: 16 });
    expect(high).toBeGreaterThan(low);
    const nrLow = risk("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0.1, pressureAtm: 0, ratedAtm: 16 });
    const nrHigh = risk("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0.9, pressureAtm: 0, ratedAtm: 16 });
    expect(nrHigh).toBeGreaterThan(nrLow);
    expect(risk("dissection", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm: 10, ratedAtm: 16 }))
      .toBeLessThan(risk("dissection", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm: 18, ratedAtm: 16 }));
  });

  it("scripted complication fires once at the trigger", () => {
    const f = scriptedComplication("no-reflow", "post-stent");
    expect(f.complication).toBe("no-reflow");
    expect(f.trigger).toBe("post-stent");
    expect(f.once).toBe(true);
  });

  it("draw returns hemodynamic effects for forced complications", () => {
    const eff = draw("no-reflow", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 1, pressureAtm: 0, ratedAtm: 16 }, () => 0);
    expect(eff?.bedResistance?.["LAD#dist"]).toBeGreaterThan(1);
    const forced = draw("perforation", { tipLoad: 12, calcium: 0.9, oversize: 0.2, thrombus: 0, pressureAtm: 14, ratedAtm: 16 }, () => 0.01);
    expect(forced?.tamponade).toBeGreaterThan(0);
  });

  it("hydrophilic wires raise perforation risk", () => {
    const base = risk("perforation", { tipLoad: wire.tipLoadGf, calcium: 0.5, oversize: 0, thrombus: 0, pressureAtm: 10, ratedAtm: 16, hydrophilic: false });
    const hydro = risk("perforation", { tipLoad: wire.tipLoadGf, calcium: 0.5, oversize: 0, thrombus: 0, pressureAtm: 10, ratedAtm: 16, hydrophilic: true });
    expect(hydro).toBeGreaterThanOrEqual(base);
    expect(risk("perforation", { tipLoad: floppy.tipLoadGf, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 }))
      .toBeLessThan(risk("perforation", { tipLoad: wire.tipLoadGf, calcium: 0.1, oversize: 0, thrombus: 0, pressureAtm: 8, ratedAtm: 16 }));
  });
});
