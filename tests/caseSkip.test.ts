import { describe, it, expect } from "vitest";
import { canSkip, skipStop, SKIP_CAP_S, SKIP_SPEED } from "../src/cases/skip";
import type { Probe, Cond } from "../src/cases/engine";

const probe = (o: Partial<Probe> = {}): Probe => ({
  map: 90, hr: 75, arrest: "none", rhythmClass: "perfusing",
  shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false,
  ecmo: false, impella: false, iabp: false, pci: false, pciPending: false,
  drugs: {}, ef: 0.55, lvIschemia: 0, rvIschemia: 0, congestion: 0, fluidsL: 0,
  dead: false, ...o,
});

const stable: Cond = (p) => p.map >= 60 && p.arrest !== "arrest" && !p.dead;

describe("time skip rules", () => {
  it("exports the cap and speed the page uses", () => {
    expect(SKIP_CAP_S).toBe(60);
    expect(SKIP_SPEED).toBe(30);
  });

  it("canSkip refuses when the stable condition is false and says why", () => {
    const r = canSkip(probe({ map: 50 }), stable);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.why).toMatch(/^[A-Z]/);
      expect(r.why).toMatch(/unstable/i);
    }
  });

  it("canSkip allows a stable patient", () => {
    expect(canSkip(probe(), stable)).toEqual({ ok: true });
  });

  it("skipStop returns null when nothing changed", () => {
    const p = probe();
    expect(skipStop(p, probe(), { promptOpen: false, harmActive: false, spo2: 0.98 })).toBeNull();
  });

  it("skipStop names the reason for each of: prompt open, arrest, rhythm class change, map falling below 65 (\"Stopped: pressure fell to 58\"), spo2 below 0.90, harm active", () => {
    const base = probe();
    const quiet = { promptOpen: false, harmActive: false, spo2: 0.98 };

    const prompt = skipStop(base, base, { ...quiet, promptOpen: true });
    expect(prompt).toMatch(/^Stopped: /);
    expect(prompt).toMatch(/prompt/i);

    const arrest = skipStop(base, probe({ arrest: "arrest", rhythmClass: "vf", map: 0 }), quiet);
    expect(arrest).toMatch(/^Stopped: /);
    expect(arrest).toMatch(/arrest/i);

    const rhythm = skipStop(base, probe({ rhythmClass: "vf" }), quiet);
    expect(rhythm).toMatch(/^Stopped: /);
    expect(rhythm).toMatch(/rhythm/i);
    expect(rhythm).toBe("Stopped: rhythm changed to ventricular fibrillation.");

    const map = skipStop(base, probe({ map: 58 }), quiet);
    expect(map).toBe("Stopped: pressure fell to 58.");

    const spo2 = skipStop(base, base, { ...quiet, spo2: 0.85 });
    expect(spo2).toMatch(/^Stopped: /);
    expect(spo2).toMatch(/saturation/i);

    const harm = skipStop(base, base, { ...quiet, harmActive: true });
    expect(harm).toMatch(/^Stopped: /);
    expect(harm).toMatch(/harm/i);
  });

  it("skipStop does not fire when map was already below 65 in prev", () => {
    const prev = probe({ map: 60 });
    const now = probe({ map: 58 });
    expect(skipStop(prev, now, { promptOpen: false, harmActive: false, spo2: 0.98 })).toBeNull();
  });
});

import { skipSpeed, SKIP_PAUSED_NOTE } from "../src/cases/skip";
describe("skipSpeed", () => {
  const frame = 0.05;
  const landed = (left: number, scale: number) => frame * scale * skipSpeed(left, frame, scale);
  it("lands a frame exactly on the target at scale 1, 0.25 and 3 when the target is near", () => {
    for (const scale of [1, 0.25, 3]) expect(landed(0.3, scale)).toBeCloseTo(0.3, 9);
  });
  it("is capped at SKIP_SPEED when the target is far", () => {
    expect(skipSpeed(600, frame, 1)).toBe(SKIP_SPEED);
    expect(skipSpeed(600, frame, 0.25)).toBe(SKIP_SPEED);
  });
  it("gives a speed below normal when the target is nearer than one frame, so it is not overshot", () => {
    const s = skipSpeed(0.01, frame, 1);
    expect(s).toBeLessThan(1);
    expect(landed(0.01, 1)).toBeCloseTo(0.01, 9);
  });
  it("returns the normal speed at or past the target and for a dead clock", () => {
    expect(skipSpeed(0, frame, 1)).toBe(1);
    expect(skipSpeed(-3, frame, 1)).toBe(1);
    expect(skipSpeed(10, frame, 0)).toBe(1);
  });
  it("has a one-line note for a paused clock", () => {
    expect(SKIP_PAUSED_NOTE).toBe("Skip is unavailable while the clock is paused.");
  });
});
