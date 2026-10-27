import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FIELDS, ACTIONS } from "../src/sim/registry";
import { normalizePatient } from "../src/sim/patient";
import { addBolus, bolusTotalMl, buildPlaygroundSpec, stateOfSpec, withBloodVolume, withDevice } from "../src/sim/playground";

/** The Support tab: one tab, six fixed sections in a fixed order, one control per thing (the redesign's decisions). */
const html = readFileSync(new URL("../sim/index.html", import.meta.url), "utf8");
const support = html.slice(html.indexOf('<div id="manage"'), html.indexOf('</aside>'));
const has = (id: string) => new RegExp(`\\bid="${id}"`).test(html);

describe("Support tab layout", () => {
  it("is six collapsible sections in order, only Treat open, each with a live summary and an (i)", () => {
    const secs = [...support.matchAll(/<details class="fold sup-sec[^"]*" id="sec-(\w+)"( open)?>/g)].map((m) => [m[1], !!m[2]]);
    expect(secs).toEqual([["treat", true], ["volume", false], ["drugs", false], ["devices", false], ["vent", false], ["assess", false]]);
    for (const [s] of secs) {
      expect(has(`sum-${s}`), s).toBe(true);
      expect(support, s).toContain(`data-info="${s}"`);
      expect(has(`info-${s}`), s).toBe(true);
    }
  });
  it("has no nested Drugs/Reperfuse/Assessment tabs", () => {
    expect(support).not.toMatch(/class="tab\b/);
    expect(support).not.toContain('role="tablist"');
  });
  it("dropped the duplicated controls and keeps exactly one reset", () => {
    for (const id of ["m_fluid", "x_bleed", "x_reset", "volume", "dpane-support"]) expect(has(id), id).toBe(false);
    expect(html.match(/\bid="m_reset"/g)).toHaveLength(1);
    expect(html.match(/>Reset[^<]*<\/button>/g)).toHaveLength(1);
    expect(has("fluidnote")).toBe(true); // the congestion note stays, but not the +500 ml button it belonged to
  });
  it("keeps every id the game and the other pages read", () => {
    for (const id of ["m_pci", "m_lysis", "m_cabg", "m_cancel", "m_hint", "m_reset", "mstatus", "issues", "warns", "steps", "nor", "dob", "m_nitro", "m_atropine", "m_pace", "pacerate", "bl", "blv", "bb", "bbv", "norv", "dobv", "pacev", "openCath", "xlinks", "arrest"]) expect(has(id), id).toBe(true);
  });
  it("has one switch per device (m_iabp, m_impella, m_ecmo), each owned by a field", () => {
    for (const id of ["m_iabp", "m_impella", "m_ecmo"]) {
      expect(html.match(new RegExp(`\\bid="${id}"`, "g")), id).toHaveLength(1);
      expect(FIELDS.some((f) => f.controls.includes(id)), id).toBe(true);
    }
    expect(ACTIONS).not.toHaveProperty("x_reset");
  });
  it("has the arrest panel above the sections", () => {
    expect(html.indexOf('id="arrest"')).toBeLessThan(html.indexOf('id="manage"'));
  });
});

describe("Support tab fields", () => {
  const f = (p: string) => FIELDS.find((x) => x.path === p)!;
  it("volume is blood loss, hemorrhage and the IV bolus; the baseline blood volume is in the Patient tab", () => {
    expect(f("bloodLoss").controls).toEqual(["bl"]);
    expect(f("fluids.hemorrhageMlMin").controls).toEqual(["pg:fluids.hemorrhageMlMin"]);
    expect(f("fluids.given").controls).toEqual(["pg:fluids.given"]);
    expect(f("support.fluids").controls).toEqual([]);
    expect(f("heart.volumeMl").tab).toBe("patient");
    expect(f("heart.volumeMl").controls).toEqual(["pg:heart.volumeMl"]);
  });
});

describe("the IV bolus, the baseline volume and the device switches", () => {
  it("boluses add up, as separate doses", () => {
    let s = addBolus({}, "crystalloid", 500);
    s = addBolus(s, "crystalloid", 500);
    s = addBolus(s, "blood", 250);
    expect(s.fluids?.given).toEqual([{ kind: "crystalloid", ml: 500 }, { kind: "crystalloid", ml: 500 }, { kind: "blood", ml: 250 }]);
    expect(bolusTotalMl(s)).toBe(1250);
    expect(bolusTotalMl({})).toBe(0);
    expect(addBolus({}, "colloid", 0)).toEqual({});
    let many = {} as ReturnType<typeof addBolus>;
    for (let i = 0; i < 25; i++) many = addBolus(many, "crystalloid", 100);
    expect(many.fluids?.given).toHaveLength(20);
    expect(normalizePatient({ fluids: { given: s.fluids!.given } }).warnings).toEqual([]);
  });
  it("the baseline blood volume goes to heart.volumeMl, keeps the rest of the heart and a zero removes it", () => {
    const withValve = { heart: { valves: { av: { open: 0.5 } } } };
    const a = withBloodVolume(withValve, 500);
    expect(a.heart).toEqual({ valves: { av: { open: 0.5 } }, volumeMl: 500 });
    expect(withBloodVolume(a, 0).heart).toEqual({ valves: { av: { open: 0.5 } } });
    expect(withBloodVolume({}, 0).heart).toBeUndefined();
    const lesion = withBloodVolume({ structural: { id: "as", values: { severity: 0.5 } } }, -300);
    expect(lesion.structural).toBeUndefined();
    expect(lesion.heart?.volumeMl).toBe(-300);
    expect(lesion.heart?.valves?.av).toBeDefined();
    expect(buildPlaygroundSpec({}, a).spec.heart?.volumeMl).toBe(500);
  });
  it("the legacy support.iabp / support.impella and devices.* stay in step, and both field names are accepted", () => {
    // the one switch edits devices.*; the legacy booleans follow
    let st = withDevice({}, "iabp", true);
    st = withDevice(st, "impella", true);
    const built = buildPlaygroundSpec({}, st).spec;
    expect(built.support).toMatchObject({ iabp: true, impella: true });
    expect(built.devices?.iabp).toBeDefined();
    expect(buildPlaygroundSpec({}, withDevice(st, "iabp", false)).spec.support?.iabp).toBe(false);
    // a spec that only carries the legacy booleans (chat, an old link) turns the one switch on with the defaults
    const back = stateOfSpec({ support: { iabp: true, impella: true } } as never);
    expect(back.devices?.iabp).toMatchObject({ ratio: 1 });
    expect(back.devices?.impella).toMatchObject({ model: "CP", level: 6 });
    // and devices.* alone is accepted without a warning
    expect(normalizePatient({ devices: { iabp: { ratio: 2 }, impella: { level: 4 }, ecmo: { flowLpm: 3 } } }).warnings).toEqual([]);
  });
});
