import { describe, expect, it } from "vitest";
import { FIRST_DAY, SPECIMENS, daysSince, specimenFor, specimenForDay, today } from "../src/specimens";
import { ANIMALS, usesLogo } from "../src/specimenArt";
import { buildTree } from "../src/anatomy/tree";
import { meshHeart } from "../src/anatomy/heartSurface";
import { HEART_OUTLINE } from "../src/heartOutline";
import { silhouette } from "../scripts/bake-home-outline";
import { dotsFor, fieldFromMasks } from "../src/stipple";

const key = (n: number) => { const t = new Date(Date.UTC(2026, 9, 7) + n * 86400000); return t.toISOString().slice(0, 10); };

describe("the catalogue", () => {
  it("has unique ids, names and facts of a size the card can hold", () => {
    expect(new Set(SPECIMENS.map((s) => s.id)).size).toBe(SPECIMENS.length);
    for (const s of SPECIMENS) {
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.fact.length, s.id).toBeGreaterThan(40);
      expect(s.fact.length, s.id).toBeLessThan(260);
      expect(s.fact, s.id).not.toMatch(/\s{2}|\s$/);
    }
  });
  it("draws every animal from a recipe, and every human heart from the simulator's own tree", () => {
    for (const s of SPECIMENS.filter((x) => x.kind === "animal")) { expect(ANIMALS[s.id], s.id).toBeTruthy(); expect(s.variant, s.id).toBeUndefined(); expect(usesLogo(s)).toBe(false); }
    const textbook = SPECIMENS.filter((s) => s.kind === "human" && !s.variant);
    expect(textbook.map((s) => s.id)).toEqual(["textbook"]); // the logo's artwork
    expect(usesLogo(textbook[0])).toBe(true);
    const seen = new Set<string>();
    for (const s of SPECIMENS.filter((x) => x.variant)) {
      const tree = buildTree(s.variant!), sig = JSON.stringify(s.variant);
      expect(seen.has(sig), `${s.id} repeats another variant`).toBe(false); seen.add(sig);
      expect(s.feature?.length, s.id).toBeGreaterThan(0);
      for (const f of s.feature!) expect(tree.byId[f], `${s.id}: no artery ${f} in this anatomy`).toBeTruthy(); // a feature the variant really has
    }
  });
  it("mixes animals and human anatomy", () => {
    expect(SPECIMENS.filter((s) => s.kind === "animal").length).toBeGreaterThanOrEqual(10);
    expect(SPECIMENS.filter((s) => s.kind === "human").length).toBeGreaterThanOrEqual(8);
  });
});

describe("the day's heart", () => {
  it("shows every heart once in a cycle, and the same heart all day", () => {
    const n = SPECIMENS.length;
    expect(new Set(Array.from({ length: n }, (_, i) => specimenForDay(key(i)).id)).size).toBe(n);
    expect(specimenForDay(FIRST_DAY)).toBe(SPECIMENS[0]);
    expect(specimenForDay(key(n))).toBe(SPECIMENS[0]); // and round again
    expect(specimenForDay(key(3))).toBe(specimenForDay("2026-10-10"));
  });
  it("counts back past the first day without breaking", () => {
    expect(daysSince("2026-10-06")).toBe(-1);
    expect(specimenForDay("2026-10-06")).toBe(SPECIMENS[SPECIMENS.length - 1]);
    expect(specimenForDay("2020-01-01")).toBeTruthy();
  });
  it("never shows more than two animals, or two human hearts, in a row", () => {
    let run = 1;
    for (let i = 1; i < SPECIMENS.length * 2; i++) {
      run = specimenForDay(key(i)).kind === specimenForDay(key(i - 1)).kind ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });
  it("reads the page address: ?heart=, ?day=, else today", () => {
    const now = new Date(2026, 9, 21, 12);
    expect(today(now)).toBe("2026-10-21");
    expect(specimenFor("", now)).toBe(specimenForDay("2026-10-21"));
    expect(specimenFor("?heart=octopus", now).id).toBe("octopus");
    expect(specimenFor("?day=2026-10-08", now)).toBe(SPECIMENS[1]);
    expect(specimenFor("?heart=nope&day=junk", now)).toBe(specimenForDay("2026-10-21"));
    expect(daysSince("not a day")).toBeNaN();
  });
});

describe("the heart's baked outline", () => {
  const area = (p: [number, number][]) => Math.abs(p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0) / 2);
  it("still matches the procedural heart (run scripts/bake-home-outline.ts if the heart changed)", () => {
    const m = meshHeart(1.0), now = silhouette(m.positions, m.indices);
    expect(HEART_OUTLINE.length).toBeGreaterThan(50);
    expect(Math.abs(area(now) - area(HEART_OUTLINE)) / area(now)).toBeLessThan(0.01);
    const box = (p: [number, number][]) => [Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[1]))];
    box(now).forEach((v, i) => expect(Math.abs(v - box(HEART_OUTLINE)[i])).toBeLessThan(0.8));
  }, 60000);
});

describe("the stippler's field", () => {
  const n = 40, at = (x: number, y: number) => y * n + x;
  const body = new Uint8Array(n * n), vessel = new Uint8Array(n * n), dim = new Uint8Array(n * n);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) body[at(x, y)] = 1;
  for (let y = 5; y < 35; y++) vessel[at(10, y)] = 1;
  for (let x = 5; x < 35; x++) dim[at(x, 30)] = 1;
  const f = fieldFromMasks(n, body, [[vessel, 1], [dim, 0.5]]);
  it("is dense and hot on a vessel, cooler and sparser away from it, and empty outside the heart", () => {
    expect(f.heat[at(10, 15)]).toBeCloseTo(1, 5);
    expect(f.heat[at(30, 15)]).toBeLessThan(0.05);
    expect(f.rho[at(10, 15)]).toBeGreaterThan(f.rho[at(30, 15)]);
    expect(f.rho[at(0, 0)]).toBe(0);
    expect(f.heat[at(0, 0)]).toBe(0);
  });
  it("scales a background layer's heat by its level", () => {
    expect(f.heat[at(25, 30)]).toBeCloseTo(0.5, 5);
  });
  it("reports the heart's box and its weight, and the dots that weight earns", () => {
    expect(f.box).toEqual({ x0: 5, y0: 5, x1: 35, y1: 35 });
    expect(f.mass).toBeCloseTo(f.rho.reduce((a, v) => a + v, 0), 3);
    expect(dotsFor(f, 4)).toBeGreaterThan(dotsFor(f, 2) * 3.9); // dots follow the area on screen
  });
});
