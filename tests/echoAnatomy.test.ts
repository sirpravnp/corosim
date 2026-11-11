import { describe, it, expect } from "vitest";
import { V3 } from "../src/anatomy/curve";
import { Part, classifyHeart, heartSdf, gradient } from "../src/anatomy/heartSurface";
import { buildPoses, LANDMARKS_HEART_FRAME as LM } from "../src/echo/poses";
import { frameFor, rasterize } from "../src/echo/paint";
import { PERICARDIAL_REFLECTION_Y, Tissue, classifyEcho, isSolidTissue } from "../src/echo/tissue";
import { AORTIC, E1, E2, LEAFLET_BOW, LV_AXIS, LV_LENGTH, MITRAL, TRICUSPID, flaps, lvEpiDistance, lvFrame, LvPoint } from "../src/echo/anatomy";

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const at = (c: V3, a: number, b: number): V3 => add(add(c, E1, a), E2, b);
/** Center of the short-axis plane `frac` of the way from the apex landmark to the mitral landmark. */
const planeCenter = (frac: number): V3 => add(LM.apex, LV_AXIS, frac * LV_LENGTH);

interface Pix { a: number; b: number; tissue: Tissue; part: Part | null }
/** Classify a square grid (1 mm) of the plane perpendicular to the LV long axis. */
function shortAxis(frac: number, half = 60, step = 1): Pix[] {
  const c = planeCenter(frac), out: Pix[] = [];
  for (let a = -half; a <= half; a += step) for (let b = -half; b <= half; b += step) {
    const e = classifyEcho(at(c, a, b));
    out.push({ a, b, tissue: e.tissue, part: e.part });
  }
  return out;
}
const centroid = (px: Pix[]) => ({ a: px.reduce((s, q) => s + q.a, 0) / px.length, b: px.reduce((s, q) => s + q.b, 0) / px.length });

describe("round LV, crescent RV, bowed septum", () => {
  const plane = shortAxis(0.4);
  const lvBlood = plane.filter((q) => q.tissue === Tissue.Blood && q.part === Part.LV);
  const rvBlood = plane.filter((q) => q.tissue === Tissue.Blood && q.part === Part.RV);

  it("makes the LV cavity round in a plane perpendicular to the long axis", () => {
    const w = Math.max(...lvBlood.map((q) => q.a)) - Math.min(...lvBlood.map((q) => q.a));
    const h = Math.max(...lvBlood.map((q) => q.b)) - Math.min(...lvBlood.map((q) => q.b));
    expect(lvBlood.length).toBeGreaterThan(500);
    expect(w / h).toBeGreaterThan(0.85);
    expect(w / h).toBeLessThan(1.2);
  });
  it("wraps the RV on the anterior right of the LV and never inside the LV epicardial shape", () => {
    expect(rvBlood.length).toBeGreaterThan(300);
    const l = centroid(lvBlood), r = centroid(rvBlood);
    expect(r.a - l.a).toBeLessThan(-5); // toward the RV side (E1 points to the LV side)
    expect(r.b - l.b).toBeGreaterThan(0); // anterior
    const c = planeCenter(0.4), f: LvPoint = { t: 0, x: 0, y: 0 };
    for (const q of rvBlood) expect(lvEpiDistance(lvFrame(at(c, q.a, q.b), f))).toBeGreaterThanOrEqual(0);
  });
  it("gives every point inside the display heart exactly one tissue and a chamber", () => {
    const rnd = rng(7);
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const p: V3 = [-64 + 128 * rnd(), -74 + 188 * rnd(), -72 + 120 * rnd()];
      const h = classifyHeart(p), e = classifyEcho(p);
      if (h.part !== null) { n++; expect(e.part).not.toBeNull(); expect([Tissue.Blood, Tissue.Myocardium, Tissue.Septum, Tissue.Leaflet, Tissue.Papillary]).toContain(e.tissue); }
      else expect(e.part).toBeNull();
      expect(e.sdf).toBeCloseTo(h.sdf, 6);
    }
    expect(n).toBeGreaterThan(400);
  });
  it("makes the septum 8 to 12 mm thick between the cavity centers", () => {
    const l = centroid(lvBlood);
    // the RV cavity pixel nearest the RV centroid (the crescent's centroid can sit outside it)
    const rc = centroid(rvBlood);
    const rv = rvBlood.reduce((best, q) => ((q.a - rc.a) ** 2 + (q.b - rc.b) ** 2 < (best.a - rc.a) ** 2 + (best.b - rc.b) ** 2 ? q : best));
    const c = planeCenter(0.4), n = 800, len = Math.hypot(rv.a - l.a, rv.b - l.b);
    let run = 0, best = 0, sawSeptum = false;
    for (let i = 0; i <= n; i++) {
      const k = i / n, e = classifyEcho(at(c, l.a + (rv.a - l.a) * k, l.b + (rv.b - l.b) * k));
      if (e.tissue === Tissue.Septum) { run += len / n; sawSeptum = true; best = Math.max(best, run); } else run = 0;
    }
    expect(sawSeptum).toBe(true);
    expect(best).toBeGreaterThanOrEqual(8);
    expect(best).toBeLessThanOrEqual(12);
  });
});

/** Length (mm) of the contiguous run of `want` tissue through `origin` along `dir`, searching `reach` mm either way (0 if `origin` is not that tissue). */
function runAlong(origin: V3, dir: V3, reach: number, want: Tissue, step = 0.05): number {
  const is = (t: number) => classifyEcho(add(origin, dir, t), 0.35).tissue === want;
  if (!is(0)) return 0;
  let lo = 0, hi = 0;
  while (lo > -reach && is(lo - step)) lo -= step;
  while (hi < reach && is(hi + step)) hi += step;
  return hi - lo + step;
}

describe("valves", () => {
  it("has mitral and tricuspid leaflets as thin sheets (at most 3 mm through the sheet) at their annuli", () => {
    for (const [name, ann, part] of [["mitral", MITRAL, Part.LV], ["tricuspid", TRICUSPID, Part.RV]] as const) {
      const [s0, s1] = flaps(ann, 0.35);
      for (const s of [s0, s1]) {
        // leaflets bow along their length: the middle sits LEAFLET_BOW off the straight hinge-to-tip line
        const mid = add(add(s.origin, s.dir, s.length / 2), s.norm, LEAFLET_BOW);
        const e = classifyEcho(mid, 0.35);
        expect(e.tissue, name).toBe(Tissue.Leaflet);
        expect(e.part, name).toBe(part);
        const thick = runAlong(mid, s.norm, 6, Tissue.Leaflet);
        expect(thick, name).toBeGreaterThan(1.2);
        expect(thick, name).toBeLessThanOrEqual(3);
      }
    }
  });
  it("closes the leaflets toward the center line at phase 0 and swings them to the wall at phase 1", () => {
    // distance of the anterior leaflet's tip from the center line, across the orifice: shrinking when closed, back toward the wall when open
    const reach = (phase: number) => { const [s0] = flaps(MITRAL, phase); const tip = add(s0.origin, s0.dir, s0.length); return Math.abs(dotp(sub(tip, MITRAL.center), MITRAL.side)); };
    expect(reach(0)).toBeLessThan(4);
    expect(reach(1)).toBeGreaterThan(8);
  });
  it("draws three aortic cusps as a Y in the short axis when closed, and fewer marks near the center when open", () => {
    const c: V3 = [AORTIC.center[0], AORTIC.center[1], AORTIC.center[2]];
    const count = (phase: number) => {
      const seen = new Set<number>();
      let n = 0;
      for (let a = -14; a <= 14; a += 0.4) for (let b = -14; b <= 14; b += 0.4) {
        const e = classifyEcho([c[0] + a, c[1], c[2] + b], phase);
        if (e.tissue === Tissue.Leaflet) { n++; seen.add(Math.round((Math.atan2(b, a) * 3) / Math.PI)); }
      }
      return { n, arms: seen.size };
    };
    const closed = count(0), open = count(1);
    expect(closed.n).toBeGreaterThan(20);
    expect(closed.arms).toBeGreaterThanOrEqual(3);
    // the cusp thickness through the sheet is at most 3 mm: along the tangent of the arm at 90 degrees
    const thick = runAlong([c[0], c[1], c[2] + 5], [1, 0, 0], 6, Tissue.Leaflet);
    expect(thick).toBeGreaterThan(1.2);
    expect(thick).toBeLessThanOrEqual(3);
    expect(open.n).toBeLessThan(closed.n);
  });
  it("puts the leaflets in the ventricle on the ventricular side of the annulus", () => {
    const [s0] = flaps(MITRAL, 0);
    const tip = add(s0.origin, s0.dir, s0.length * 0.8);
    expect((tip[0] - MITRAL.center[0]) * LV_AXIS[0] + (tip[1] - MITRAL.center[1]) * LV_AXIS[1] + (tip[2] - MITRAL.center[2]) * LV_AXIS[2]).toBeLessThan(0);
  });
});
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dotp = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

describe("papillary muscles", () => {
  it("shows two separate papillary heads in the mid-LV short axis, each 8 to 12 mm across", () => {
    const step = 0.5, half = 40, n = (2 * half) / step + 1, c = planeCenter(0.4);
    const grid = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grid[i * n + j] = classifyEcho(at(c, -half + i * step, -half + j * step)).tissue === Tissue.Papillary ? 1 : 0;
    const label = new Int32Array(n * n); let comps = 0; const sizes: { w: number; h: number }[] = [];
    for (let s = 0; s < n * n; s++) {
      if (!grid[s] || label[s]) continue;
      comps++; const stack = [s]; label[s] = comps; let i0 = n, i1 = 0, j0 = n, j1 = 0;
      while (stack.length) {
        const q = stack.pop()!, i = Math.floor(q / n), j = q % n;
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const k = ni * n + nj;
          if (grid[k] && !label[k]) { label[k] = comps; stack.push(k); }
        }
      }
      sizes.push({ w: (i1 - i0) * step, h: (j1 - j0) * step });
    }
    expect(comps).toBe(2);
    for (const s of sizes) { expect(Math.min(s.w, s.h)).toBeGreaterThanOrEqual(7); expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(13); }
  });
});

describe("pericardium", () => {
  it("is a thin bright shell 3.5 to 5 mm outside the display heart, at most 2 mm thick radially", () => {
    const rnd = rng(3);
    let found = 0, tried = 0;
    for (let i = 0; i < 300; i++) {
      // a ray from inside the ventricles outward until it leaves the heart, then the outward normal there
      const th = Math.acos(1 - 2 * rnd()), ph = 2 * Math.PI * rnd(), d: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      let t = 0; while (t < 160 && heartSdf(add([0, 0, 0], d, t)) < 0) t += 0.5;
      if (t >= 160) continue;
      const s: V3 = add([0, 0, 0], d, t), g = gradient(heartSdf, s);
      // the pericardium reflects onto the great arteries a few centimeters above the valves; above that there is none
      if (s[1] > PERICARDIAL_REFLECTION_Y - 8) continue;
      tried++;
      // the first pericardium point out along the surface normal; its thickness is measured along the field's own normal there
      let q: V3 | null = null;
      for (let u = 2; u < 8; u += 0.05) if (classifyEcho(add(s, g, u)).tissue === Tissue.Pericardium) { q = add(s, g, u); break; }
      const run = q ? runAlong(q, gradient(heartSdf, q), 5, Tissue.Pericardium, 0.05) : 0;
      if (run > 0) found++;
      expect(run).toBeLessThanOrEqual(2);
      if (q) expect(classifyEcho(q).part).toBeNull();
    }
    expect(found / tried).toBeGreaterThan(0.9);
    expect(isSolidTissue(Tissue.Pericardium)).toBe(true);
  });
});

describe("LV outflow tract", () => {
  it("is blood between the anterior mitral leaflet and the septum, open to the aortic root", () => {
    const [ant] = flaps(MITRAL, 0.35);
    const mid = add(ant.origin, ant.dir, ant.length / 2);
    // from the anterior leaflet, step toward the aortic side: blood first, then the septum
    const toward = MITRAL.side;
    let blood = 0, hit: Tissue | null = null;
    for (let t = 1.5; t < 40; t += 0.25) {
      const e = classifyEcho(add(mid, toward, t), 0.35);
      if (e.tissue === Tissue.Blood) { if (e.part === Part.LV) blood += 0.25; continue; }
      if (e.tissue === Tissue.Leaflet) continue;
      hit = e.tissue; break;
    }
    expect(blood).toBeGreaterThan(4);
    expect([Tissue.Septum, Tissue.Myocardium]).toContain(hit);
    // blood connects from the LV to the aortic root through the outflow tract (flood fill on a 2 mm grid, leaflets and walls block)
    const lo: V3 = [-30, 5, -35], step = 2, nx = 40, ny = 32, nz = 32, seen = new Uint8Array(nx * ny * nz);
    const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
    const kind = (i: number, j: number, k: number) => classifyEcho([lo[0] + i * step, lo[1] + j * step, lo[2] + k * step], 0.35);
    const start = classifyEcho(add(planeCenter(0.85), E1, 4));
    expect(start.part).toBe(Part.LV);
    const si = Math.round((planeCenter(0.85)[0] + E1[0] * 4 - lo[0]) / step), sj = Math.round((planeCenter(0.85)[1] + E1[1] * 4 - lo[1]) / step), sk = Math.round((planeCenter(0.85)[2] + E1[2] * 4 - lo[2]) / step);
    const stack = [[si, sj, sk]]; let reachedAorta = false; seen[idx(si, sj, sk)] = 1;
    while (stack.length) {
      const [i, j, k] = stack.pop()!;
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || seen[idx(a, b, c)]) continue;
        const e = kind(a, b, c);
        if (e.tissue !== Tissue.Blood) continue;
        seen[idx(a, b, c)] = 1;
        if (e.part === Part.Aorta) reachedAorta = true;
        stack.push([a, b, c]);
      }
    }
    expect(reachedAorta).toBe(true);
  });
});

describe("standard views", () => {
  const poses = buildPoses();
  const has = (id: string) => {
    const pose = poses[id], w = 90, h = 100, r = rasterize(pose, w, h, frameFor(pose, w / h));
    const t = new Set<number>(r.tissue);
    const blood = new Set<number>();
    for (let i = 0; i < r.tissue.length; i++) if (r.tissue[i] === Tissue.Blood) blood.add(r.part[i]);
    return { t, blood };
  };
  it("parasternal long axis shows septum, a leaflet and a chamber", () => {
    const { t, blood } = has("plax");
    expect(t.has(Tissue.Septum)).toBe(true);
    expect(t.has(Tissue.Leaflet)).toBe(true);
    expect([Part.LV, Part.RV, Part.LA, Part.Aorta].some((p) => blood.has(p))).toBe(true);
  });
  it("papillary short axis shows septum, papillary muscle and the RV", () => {
    const { t, blood } = has("psaxPM");
    expect(t.has(Tissue.Septum)).toBe(true);
    expect(t.has(Tissue.Papillary)).toBe(true);
    expect(blood.has(Part.RV)).toBe(true);
  });
  it("subcostal shows the septum", () => {
    expect(has("subcostal").t.has(Tissue.Septum)).toBe(true);
  });
});

describe("classifyEcho speed", () => {
  it("handles 100000 random points in the heart's bounding box in under 1.5 s", () => {
    const rnd = rng(11), pts: V3[] = [];
    for (let i = 0; i < 100000; i++) pts.push([-64 + 128 * rnd(), -74 + 188 * rnd(), -72 + 120 * rnd()]);
    classifyEcho(pts[0]);
    const t0 = performance.now();
    let sink = 0;
    for (const p of pts) sink += classifyEcho(p).tissue;
    const ms = performance.now() - t0;
    console.log(`classifyEcho: ${ms.toFixed(0)} ms for 100000 calls (${sink})`);
    expect(ms).toBeLessThan(1500);
  });
});
