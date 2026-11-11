import { describe, it, expect } from "vitest";
import { PadReader, padName, PAD } from "../src/cath/unified/gamepad";

const pad = (down: number[] = [], axes: number[] = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => down.includes(i)), axes });

describe("game controller mapping", () => {
  it("fires a button once per press, not every frame it is held", () => {
    const r = new PadReader();
    expect(r.read(pad([0]), 0.016)).toEqual([{ k: "press", id: "inject" }]);
    expect(r.read(pad([0]), 0.016)).toEqual([]);
    r.read(pad(), 0.016);
    expect(r.read(pad([0]), 0.016)).toEqual([{ k: "press", id: "inject" }]);
  });

  it("names the Xbox and 8BitDo layouts' buttons the same way", () => {
    const r = new PadReader();
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => { const c = r.read(pad([b]), 0.016); r.read(pad(), 0.016); return c[0]; });
    expect(ids.map((c) => (c && c.k === "press" ? c.id : null))).toEqual(["deflate", "inflate", "deploy", "undo", "hint", "viewPrev", "viewNext", "camera", "skip"]);
  });

  it("a held D-pad up feeds the wire in small steps at a steady rate, and down withdraws", () => {
    const r = new PadReader();
    let mm = 0;
    for (let i = 0; i < 60; i++) for (const c of r.read(pad([12]), 1 / 60)) if (c.k === "advance") { mm += c.mm; expect(Math.abs(c.mm)).toBe(PAD.stepMm); }
    expect(mm).toBeGreaterThanOrEqual(PAD.advanceMmPerS - PAD.stepMm);
    expect(mm).toBeLessThanOrEqual(PAD.advanceMmPerS);
    let back = 0;
    for (let i = 0; i < 30; i++) for (const c of r.read(pad([13]), 1 / 60)) if (c.k === "advance") back += c.mm;
    expect(back).toBeLessThan(0);
  });

  it("the left stick advances in proportion and ignores drift inside the dead zone", () => {
    const r = new PadReader();
    const drift = Array.from({ length: 120 }, () => r.read(pad([], [0.1, -0.15, 0.1, 0.1]), 1 / 60)).flat();
    expect(drift).toEqual([]);
    const full = Array.from({ length: 60 }, () => r.read(pad([], [0, -1, 0, 0]), 1 / 60)).flat();
    expect(full.filter((c) => c.k === "advance").length).toBeGreaterThan(8);
  });

  it("D-pad left and right rotate the wire by a fixed turn; the right stick moves the C-arm", () => {
    const r = new PadReader();
    expect(r.read(pad([15]), 0.016)).toEqual([{ k: "torque", deg: PAD.torqueStepDeg }]);
    r.read(pad(), 0.016);
    expect(r.read(pad([14]), 0.016)).toEqual([{ k: "torque", deg: -PAD.torqueStepDeg }]);
    const c = r.read(pad([], [0, 0, 1, -1]), 0.1).find((x) => x.k === "carm");
    expect(c).toMatchObject({ k: "carm" });
    if (c?.k === "carm") { expect(c.dRot).toBeGreaterThan(0); expect(c.dTilt).toBeGreaterThan(0); }
  });

  it("reads analog triggers and object-style buttons", () => {
    const r = new PadReader();
    const out = r.read({ buttons: [{ pressed: false, value: 0 }, 0, 0, 0, 0, 0, 0, { pressed: true, value: 1 }], axes: [] }, 0.016);
    expect(out).toEqual([{ k: "press", id: "viewNext" }]);
  });

  it("recognizes the controllers by name", () => {
    expect(padName("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)")).toBe("Xbox controller");
    expect(padName("8BitDo Micro gamepad (Vendor: 2dc8 Product: 9020)")).toBe("8BitDo Micro");
    expect(padName("8BitDo Pro 2")).toBe("8BitDo controller");
  });
});
