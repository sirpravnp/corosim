import { describe, it, expect } from "vitest";
import { migrateLegacyKeys } from "../src/sim/aliases";
import { normalizePatient } from "../src/sim/patient";
import { parseCaseMarkdown } from "../src/cases/markdown";

describe("legacy Impella keys", () => {
  it("accepts devices.impella and maps it to devices.coroPump with a warning", () => {
    const { spec, warnings } = migrateLegacyKeys({ devices: { impella: { level: 6, model: "CP" } } });
    expect((spec as { devices?: { coroPump?: { level: number } } }).devices?.coroPump?.level).toBe(6);
    expect(warnings).toContain("renamed");
    const n = normalizePatient({ devices: { impella: { level: 6, model: "CP" } } } as never);
    expect(n.spec.devices?.coroPump?.level).toBe(6);
    expect(n.warnings).toContain("renamed");
  });
  it("accepts support.impella and maps it to support.coroPump with a warning", () => {
    const { spec, warnings } = migrateLegacyKeys({ support: { impella: true } });
    expect((spec as { support?: { coroPump?: boolean } }).support?.coroPump).toBe(true);
    expect(warnings).toContain("renamed");
  });
  it("accepts devices.impellaRp and maps it to devices.coroPumpRp with a warning", () => {
    const { spec, warnings } = migrateLegacyKeys({ devices: { impellaRp: { level: 4 } } });
    expect((spec as { devices?: { coroPumpRp?: { level: number } } }).devices?.coroPumpRp?.level).toBe(4);
    expect(warnings).toContain("renamed");
  });
  it('accepts the case device word "Impella" and maps it to CoroPump', () => {
    const md = `# Test
- id: t
- summary: x
- devices: Impella

## Card

Presents: p
History: h

## Time points

### a
`;
    const { spec, warnings } = parseCaseMarkdown(md);
    expect(spec?.devices).toContain("CoroPump");
    expect(warnings).toContain("renamed");
  });
});
