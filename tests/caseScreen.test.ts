import { describe, expect, it } from "vitest";
import { caseChrome } from "../src/page/caseChrome";

describe("caseChrome: which regions the page has", () => {
  it("a running case drops every disease-building and developer region and keeps Treatments", () => {
    const c = caseChrome(true, "run");
    expect(c.diseaseTabs).toBe(false);
    expect(c.mode).toBe(false);
    expect(c.toolbar).toBe(false);
    expect(c.stage).toBe(false);
    expect(c.tableOne).toBe(false);
    expect(c.stMap).toBe(false);
    expect(c.panelsPicker).toBe(false);
    expect(c.treatments).toBe(true);
  });
  it("the debrief shows on the same stripped screen", () => {
    expect(caseChrome(true, "over")).toEqual(caseChrome(true, "run"));
  });
  it("the case front door (idle) changes nothing", () => {
    const c = caseChrome(true, "idle");
    expect(Object.values(c).every(Boolean)).toBe(true);
  });
  it("outside the cases page nothing changes, whatever the phase", () => {
    for (const p of ["idle", "run", "over"] as const) expect(Object.values(caseChrome(false, p)).every(Boolean)).toBe(true);
  });
});
