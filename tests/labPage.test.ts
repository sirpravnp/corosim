import { describe, it, expect } from "vitest";
import { StubLabEngine } from "../src/lab/stub";
import { STUB_CATALOG } from "../src/lab/stubCatalog";
import { deviceShelf, monitorModel, eventFeed, procedureSummary, acrossLesion, nextStep } from "../src/cath/lab/panels";
import type { LabEvent } from "../src/lab/types";

const slot = (shelf: ReturnType<typeof deviceShelf>, s: string) => shelf.find((x) => x.slot === s)!;

describe("deviceShelf", () => {
  it("offers only the guide before access is gained, and nothing else", () => {
    const e = new StubLabEngine();
    const sh = deviceShelf(e.state(), STUB_CATALOG, e.plaques());
    expect(slot(sh, "guide").enabled).toBe(false); expect(slot(sh, "wire").enabled).toBe(false);
    expect(slot(sh, "guide").reason).toMatch(/access/i);
  });
  it("offers wires once a guide is engaged", () => {
    const e = new StubLabEngine();
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    const sh = deviceShelf(e.state(), STUB_CATALOG, e.plaques());
    expect(slot(sh, "guide").enabled).toBe(true); expect(slot(sh, "wire").enabled).toBe(true);
    expect(slot(sh, "wire").options.every((o) => o.id.startsWith("wire-"))).toBe(true);
    expect(slot(sh, "stent").enabled).toBe(false);
  });
  it("keeps the stent disabled until the wire is across the lesion", () => {
    const e = new StubLabEngine();
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "select", slot: "guide", id: "guide-jl4" }); e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    expect(acrossLesion(e.state(), e.plaques())).toBe(false);
    expect(slot(deviceShelf(e.state(), STUB_CATALOG, e.plaques()), "stent").enabled).toBe(false);
    for (let i = 0; i < 40 && !acrossLesion(e.state(), e.plaques()); i++) e.apply({ t: "advance", mm: 20 });
    expect(acrossLesion(e.state(), e.plaques())).toBe(true);
    expect(slot(deviceShelf(e.state(), STUB_CATALOG, e.plaques()), "stent").enabled).toBe(true);
    expect(slot(deviceShelf(e.state(), STUB_CATALOG, e.plaques()), "balloon").enabled).toBe(true);
  });
});

describe("monitorModel", () => {
  it("marks a low pressure as abnormal and a normal one as quiet", () => {
    const low = monitorModel({ hr: 110, map: 52, sbp: 80, dbp: 40, ffr: 0.62 }, new StubLabEngine().state());
    const ok = monitorModel({ hr: 72, map: 90, sbp: 120, dbp: 75, ffr: 0.95 }, new StubLabEngine().state());
    expect(low.find((t) => t.id === "map")!.tone).toBe("bad"); expect(ok.find((t) => t.id === "map")!.tone).toBe("");
    expect(low.find((t) => t.id === "ffr")!.tone).toBe("bad"); expect(ok.find((t) => t.id === "ffr")!.tone).toBe("");
  });
  it("shows ACT as caution below 250 s before the wire goes in", () => {
    const e = new StubLabEngine(); e.apply({ t: "access", site: "femoral-R" });
    const t = monitorModel({ hr: 72, map: 90, sbp: 120, dbp: 75, ffr: null }, e.state()).find((x) => x.id === "act")!;
    expect(t.tone).toBe("warn");
  });
});

describe("eventFeed and summary", () => {
  it("keeps time order and caps at 200", () => {
    const evs: LabEvent[] = Array.from({ length: 250 }, (_, i) => ({ at: i, kind: "x", text: `e${i}`, severity: "info" }));
    const f = eventFeed(evs);
    expect(f.length).toBe(200); expect(f[0].text).toBe("e50"); expect(f[199].text).toBe("e249");
  });
  it("sums contrast, fluoro time and dose", () => {
    const e = new StubLabEngine(); e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "inject", where: "LCA", ml: 8 });
    const s = procedureSummary(e.state());
    expect(s.contrastMl).toBe(8);
    expect(s.fluoroLabel).toMatch(/^\d+:\d\d$/);
  });
});

describe("nextStep", () => {
  it("walks the usual order and never names a device the learner cannot use yet", () => {
    const e = new StubLabEngine();
    expect(nextStep(e.state(), e.plaques())).toMatch(/access/i);
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "sheath", french: 6 });
    expect(nextStep(e.state(), e.plaques())).toMatch(/heparin/i);
    e.apply({ t: "drug", id: "heparin", dose: 6000 });
    expect(nextStep(e.state(), e.plaques())).toMatch(/guide/i);
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    expect(nextStep(e.state(), e.plaques())).toMatch(/guidewire/i);
  });
});
