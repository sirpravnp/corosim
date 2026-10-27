/** The hemodynamic-beats policy (src/sim/hemoBeats.ts): which beats a readout may average. */
import { describe, it, expect } from "vitest";
import { hemodynamicBeats, recentHemodynamicBeats, windowedHemodynamicBeats } from "../src/sim/hemoBeats";

/** A rhythm strip as a string, "n" normal and "P" premature; the ids are the positions. */
const strip = (s: string) => [...s].map((c, id) => ({ id, pvc: c === "P" }));
const ids = (s: string, ctx = 0) => hemodynamicBeats(strip(s), ctx).beats.map((b) => b.id);

describe("hemodynamicBeats", () => {
  it("keeps every beat in a normal rhythm (nothing can cut the newest short)", () => {
    const r = hemodynamicBeats(strip("nnnnn"));
    expect(r.beats.map((b) => b.id)).toEqual([0, 1, 2, 3, 4]);
    expect(r.used).toBe("steady"); expect(r.fraction).toBe(0);
  });
  it("drops the premature beat, the beat before it (cut short) and the three after it", () => {
    expect(ids("nnnnnPnnnnnnn")).toEqual([0, 1, 2, 3, 9, 10, 11]); // 4 cut short, 5 premature, 6-8 settling, 12 newest
  });
  it("uses prematureNext when the flag is present", () => {
    const beats = strip("nnnnnn").map((b, i) => ({ ...b, prematureNext: i === 2 }));
    expect(hemodynamicBeats(beats).beats.map((b) => b.id)).toEqual([0, 1, 3, 4, 5]);
  });
  it("leaves the newest beat out while ectopy is present (its successor is unknown)", () => {
    expect(ids("nnPnnnnn")).toEqual([0, 6]);
  });
  it("context beats count for 'follows a premature beat' but are not returned", () => {
    expect(ids("PnnnnnnPn", 1)).toEqual([4, 5]);
  });
  it("falls back to the non-premature beats when none is steady, and says so", () => {
    const r = hemodynamicBeats(strip("nPnPnPn"));
    expect(r.used).toBe("non-premature");
    expect(r.beats.map((b) => b.id)).toEqual([0, 2, 4, 6]);
    expect(r.fraction).toBeCloseTo(3 / 7, 10);
  });
  it("falls back to all beats when every beat is premature (VT, AF, paced), and says so", () => {
    const r = hemodynamicBeats(strip("PPPP"));
    expect(r.used).toBe("all"); expect(r.beats).toHaveLength(4); expect(r.fraction).toBe(1);
  });
  it("is empty for no beats and returns a copy", () => {
    expect(hemodynamicBeats([]).beats).toEqual([]);
    const a = strip("PP"), r = hemodynamicBeats(a);
    expect(r.beats).not.toBe(a);
  });
  it("windowedHemodynamicBeats borrows older steady beats when the window holds fewer than the minimum", () => {
    const b = strip("nnnnnPnnnnPnnnPn"); // window = last 6 beats (10..15): 13 is cut short by 14, 14 premature, 15 newest
    const r = windowedHemodynamicBeats(b, 10, 3);
    expect(r.used).toBe("steady"); expect(r.beats.map((x) => x.id)).toEqual([1, 2, 3]); // none steady in the window: the latest three before it
    expect(r.fraction).toBeCloseTo(2 / 6, 10); // the fraction is the window's own
    expect(windowedHemodynamicBeats(strip("nnnnnnnn"), 5, 2).beats).toHaveLength(3); // a normal rhythm: exactly the window
  });
  it("windowedHemodynamicBeats keeps the fall-backs on the window", () => {
    const r = windowedHemodynamicBeats(strip("nnnnnnPPPP"), 6, 3);
    expect(r.used).toBe("all"); expect(r.beats).toHaveLength(4); // VT after sinus rhythm: the window is all premature, so the old sinus beats are not its readout
    expect(windowedHemodynamicBeats(strip("nnnnnnnPnPnP"), 7, 3).used).toBe("steady"); // some non-premature beats in the window: borrow
    expect(windowedHemodynamicBeats(strip("PnPnPnPn"), 2, 3).used).toBe("non-premature"); // nothing steady anywhere
  });
  it("recentHemodynamicBeats treats the three leading beats as context", () => {
    expect(recentHemodynamicBeats(strip("nPnnnnnnn")).beats.map((b) => b.id)).toEqual([5, 6, 7]);
    expect(recentHemodynamicBeats(strip("Pn")).used).toBe("non-premature"); // too short for context
  });
});
