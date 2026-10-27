// C7: the loops panel's history selection and fade, and the traces panel's paused-review windowing (pure helpers).
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_WINDOW, LOOP_WINDOWS, MAX_LOOPS, loopAlpha, loopHistory } from "../src/panels/loopHistory";
import { REVIEW_SECONDS, WINDOWS, maxScrub, windowSeries } from "../src/panels/traceMath";

type B = { t: number; rr: number; pvc: boolean; prematureNext?: boolean };
/** Beats at a steady rr ending at `end`, with premature beats at the given indices (from the oldest). */
function run(n: number, rr: number, end: number, pvcAt: number[] = []): B[] {
  return Array.from({ length: n }, (_, i) => ({ t: end - (n - i) * rr, rr, pvc: pvcAt.includes(i), prematureNext: pvcAt.includes(i + 1) }));
}

describe("loop history", () => {
  it("offers 5, 10 and 30 s, 30 by default", () => {
    expect([...LOOP_WINDOWS]).toEqual([5, 10, 30]);
    expect(DEFAULT_LOOP_WINDOW).toBe(30);
  });
  it("keeps the beats of the window, oldest first", () => {
    const all = run(100, 0.8, 100);
    const h = loopHistory(all, 100, 30);
    expect(h.used).toBe("steady");
    expect(h.beats.length).toBeGreaterThanOrEqual(36); expect(h.beats.length).toBeLessThanOrEqual(38);
    expect(h.beats[0].t + 0.8).toBeGreaterThanOrEqual(70);
    for (let i = 1; i < h.beats.length; i++) expect(h.beats[i].t).toBeGreaterThan(h.beats[i - 1].t);
    expect(loopHistory(all, 100, 5).beats.length).toBeLessThan(loopHistory(all, 100, 10).beats.length);
  });
  it("never draws a premature beat, the beat it cut short or the three after it", () => {
    const all = run(60, 0.8, 60, [30, 45]);
    const h = loopHistory(all, 60, 30);
    expect(h.beats.some((b) => b.pvc || b.prematureNext)).toBe(false);
    const idx = h.beats.map((b) => all.indexOf(b));
    for (const p of [30, 45]) for (const k of [p - 1, p, p + 1, p + 2, p + 3]) expect(idx).not.toContain(k);
  });
  it("reports when the newest beat is left out", () => {
    const all = run(40, 0.8, 40, [39]);
    expect(loopHistory(all, 40, 30).omittedNewest).toBe(true);
    expect(loopHistory(run(40, 0.8, 40), 40, 30).omittedNewest).toBe(false);
  });
  it("falls back to every beat when none is steady, and says so", () => {
    const af = run(40, 0.5, 20, Array.from({ length: 40 }, (_, i) => i));
    expect(loopHistory(af, 20, 30).used).toBe("all");
  });
  it("keeps the newest steady beat when none is in the window, and caps the count", () => {
    expect(loopHistory(run(10, 0.8, 10), 500, 30).beats.length).toBe(1);
    const fast = run(400, 0.3, 120);
    const h = loopHistory(fast, 120, 120);
    expect(h.beats.length).toBe(MAX_LOOPS);
    expect(h.beats[h.beats.length - 1]).toBe(fast[fast.length - 1]);
  });
  it("fades with age and is zero outside the window", () => {
    expect(loopAlpha(0, 30)).toBeGreaterThan(loopAlpha(10, 30));
    expect(loopAlpha(10, 30)).toBeGreaterThan(loopAlpha(29, 30));
    expect(loopAlpha(29, 30)).toBeGreaterThan(0);
    expect(loopAlpha(31, 30)).toBe(0);
    expect(loopAlpha(NaN, 30)).toBe(0);
    expect(loopAlpha(0, 30)).toBeLessThan(1);
  });
});

describe("paused review windowing", () => {
  const n = 6001, s = { t: Float32Array.from({ length: n }, (_, i) => 100 + i * 0.01), v: Float32Array.from({ length: n }, (_, i) => i) };
  it("has a 30 s window and a minute of review", () => {
    expect(WINDOWS).toContain(30);
    expect(REVIEW_SECONDS).toBe(60);
    expect(maxScrub(60, 30)).toBe(30);
    expect(maxScrub(60, 3)).toBe(57);
    expect(maxScrub(10, 30)).toBe(0);
  });
  it("cuts the window out of the kept copy", () => {
    const w = windowSeries(s, 120, 130);
    expect(w.t[0]).toBeGreaterThanOrEqual(120 - 1e-3);
    expect(w.t[w.t.length - 1]).toBeLessThanOrEqual(130 + 1e-3);
    expect(w.t.length).toBeGreaterThan(990); expect(w.t.length).toBeLessThan(1010);
  });
  it("thins to maxPoints keeping both ends, and handles an empty window", () => {
    const w = windowSeries(s, 100, 160, 200);
    expect(w.t.length).toBe(200);
    expect(w.v[0]).toBe(0); expect(w.v[199]).toBe(6000);
    expect(windowSeries(s, 500, 600).t.length).toBe(0);
  });
});
