import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const repo = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("CoroPump physics constants live in config", () => {
  it("coroPump.ts uses COROPUMP_PUMP, not inline 0.3 or 0.4 burden factors", () => {
    const t = repo("src/physics/core/devices/coroPump.ts");
    expect(t).toContain("COROPUMP_PUMP");
    expect(t).not.toMatch(/1 - 0\.3 \* this\.thrombusBurden/);
    expect(t).not.toMatch(/1 \+ 0\.4 \* this\.thrombusBurden/);
  });
  it("purge.ts uses COROPUMP_PURGE.thrombusResistanceQuadratic, not literal 3", () => {
    const t = repo("src/physics/core/devices/purge.ts");
    expect(t).toMatch(/COROPUMP_PURGE/);
    expect(t).not.toMatch(/1 \+ 3 \* thrombus/);
  });
  it("hemolysis.ts uses COROPUMP_HEMOLYSIS for min flow, pfHb cap, and deep level divisor", () => {
    const t = repo("src/physics/core/devices/hemolysis.ts");
    expect(t).toMatch(/COROPUMP_HEMOLYSIS/);
    expect(t).not.toMatch(/Math\.max\(inp\.flowLpm, 0\.05\)/);
    expect(t).not.toMatch(/inp\.level \/ 9/);
    expect(t).not.toMatch(/clamp\(pf, 0, 500\)/);
  });
});
