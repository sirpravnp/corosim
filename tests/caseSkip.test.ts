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
