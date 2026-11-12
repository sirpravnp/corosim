import { describe, expect, it } from "vitest";
import { DRUG_INFO, effect, effectText } from "../src/lipids/drugInfo";
import { DRUGS } from "../src/lipids/model";

describe("drug info for the stage callouts and the drug cards", () => {
  it("covers every stage drug", () => {
    for (const d of DRUGS) expect(DRUG_INFO[d.id], d.id).toBeDefined();
  });
  it("reports the model's effect alone at steady state", () => {
    expect(effect("wt", ["statin"]).ldl).toBeLessThan(-30);
    expect(effect("wt", ["olpa"]).lpa).toBeLessThan(-80);
    expect(effect("fcs", ["olez"]).tg).toBeLessThan(-30);
  });
  it("names the largest changes first, with a minus sign", () => {
    expect(effectText({ ldl: -47, tg: -14, hdl: 5, lpa: 1 })).toBe("LDL-C −47%, TG −14%, HDL-C +5%");
    expect(effectText({ ldl: 1, tg: 0, hdl: 2, lpa: -1 })).toBe("little change in this patient");
  });
});
