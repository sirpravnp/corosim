import { BRANCHES as B } from "../config/tree";
import { V3, add, mul, norm, sub, len } from "./curve";
import { projectToEpicardium, septalDistance } from "./heartSurface";
import { Tree, diameterAt } from "./tree";

/**
 * Display-only side branches of the coronary tree: the `taps` (small branches the physics takes off as beds, given as fractions of
 * the parent's length and the mass they feed) laid out as thin vessels that leave the parent and run over the epicardium toward their
 * territory, twigs off the larger ones, and septal perforators that dive from the LAD and PDA. Nothing here feeds back into the physics
 * or the segment list; the three.js assembly lives in page/vessels3d.ts. Deterministic: every random choice is seeded from the segment
 * id and the tap index, so a rebuild (new lesion sampling, variant change) reproduces the same picture.
 *
 * Heart frame, mm; diameters in mm. Murray's law gives a branch's root diameter from the mass it feeds (d ~ mass^(1/3)), capped at
 * `childRatio` of the parent's diameter at the junction so a branch is always narrower than its parent; along its own course it tapers
 * as the mass it still feeds falls (twigs leave in steps), and never below the minimum visible diameter.
 */
export interface Branch {
  id: string;
  segId: string; // the main segment this branch ultimately hangs from (picking and colour follow it)
  gen: 1 | 2 | 3; // 1: off a tap; 2, 3: twigs off a branch
  septal: boolean; // a perforator: sinks below the epicardium toward the septum
  u: number; // fraction along the root segment's length where the chain leaves it (its colour and blocked state are sampled there)
  mass: number; // muscle mass fraction fed (perforators: 0, they are decoration within the septum)
  pts: V3[]; // centre line, ring by ring, heart frame, on the epicardium lifted by `lift` (perforators sink)
  nrm: V3[]; // outward epicardial normal at each point
  d: number[]; // diameter at each point, non-increasing
  parentD: number; // parent's diameter at the junction (mm)
}

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
/** mulberry32 */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) % 100000) / 100000; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const tangentPart = (v: V3, n: V3): V3 => sub(v, mul(n, dot(v, n)));
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const APEX: V3 = [0, -1, 0];
const LIFT = 0.6; // mm above the epicardium, as the main vessels

const murray = (mass: number) => B.refDiameter * Math.pow(Math.max(mass, 1e-6) / B.refMass, 1 / 3);
const lengthFor = (mass: number, gen: number) => Math.min(B.maxLength, B.minLength + B.lengthPerSqrtMass * Math.sqrt(mass)) * (gen === 1 ? 1 : 0.55);

/** March over the epicardium from `start`, heading `dir0`, curving gently toward `bias` with a deterministic meander. */
function march(start: V3, startN: V3, dir0: V3, length: number, bias: V3, rand: () => number): { pts: V3[]; nrm: V3[] } {
  const n = Math.max(3, Math.round(length / B.ringSpacing)), step = length / n, ph = rand() * 6.283, wl = 0.5 + 0.4 * rand();
  const pts: V3[] = [start], nrm: V3[] = [startN];
  let dir = norm(tangentPart(dir0, startN)), p = start, nv = startN;
  for (let k = 1; k <= n; k++) {
    const want = norm(tangentPart(bias, nv)), side = cross(nv, dir);
    dir = norm(add(add(mul(dir, 0.82), mul(want, 0.18)), mul(side, 0.2 * Math.sin((6.283 * k) / (n * wl) + ph))));
    const q = projectToEpicardium(add(p, mul(dir, step)), LIFT);
    p = q.pos; nv = q.n; dir = norm(tangentPart(dir, nv));
    pts.push(p); nrm.push(nv);
  }
  return { pts, nrm };
}

/** Diameters down a branch of root diameter d0: it feeds (1 - 0.7t) of its mass at t along it (floored at tipMass), less each twig's share once that twig has left. */
function taper(d0: number, n: number, twigs: { t: number; share: number }[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let m = 1 - (1 - B.tipMass) * t;
    for (const w of twigs) m -= w.share * smooth((t - w.t + 0.06) / 0.12);
    out.push(Math.max(B.minDiameter, d0 * Math.pow(Math.max(m, B.tipMass * 0.5), 1 / 3)));
    if (i > 0 && out[i] > out[i - 1]) out[i] = out[i - 1];
  }
  out[0] = Math.max(B.minDiameter, d0);
  return out;
}

const apexward = (side: V3) => (dot(side, APEX) < 0 ? mul(side, -1) : side);

/** Build every display branch of a tree (cached per tree by the caller if it likes; this is cheap and pure). */
export function buildBranches(tree: Tree): Branch[] {
  const all: Branch[] = [];
  for (const seg of tree.segments) {
    const root = (id: string, gen: 1 | 2 | 3, u: number, mass: number, septal: boolean, pts: V3[], nrm: V3[], d: number[], parentD: number) =>
      all.push({ id, segId: seg.id, gen, septal, u, mass, pts, nrm, d, parentD });
    const atrioventricular = seg.id === "LCX" || seg.id === "RCA"; // LCx and RCA run in the AV groove: their branches head down toward the apex
    seg.taps.forEach((tap, k) => {
      const id = `${seg.id}#${k}`, rand = rng(hash(id));
      const at = projectToEpicardium(seg.curve.at(tap.pos), LIFT);
      const tg = norm(sub(seg.curve.at(Math.min(1, tap.pos + 0.01)), seg.curve.at(Math.max(0, tap.pos - 0.01))));
      let side = norm(cross(at.n, tg));
      // LAD and the PDAs shed branches alternately to the left-ventricular side and the right-ventricular side of the septal plane;
      // AV-groove vessels shed toward the apex; the branches (diagonals, marginals) alternate.
      if (atrioventricular) side = apexward(side);
      else if (seg.id === "LAD" || seg.id.startsWith("PDA")) side = (dot(side, [0.979, 0, -0.204]) > 0) === (k % 2 === 0) ? side : mul(side, -1);
      else side = (hash(seg.id) + k) % 2 === 0 ? side : mul(side, -1);
      const parentD = diameterAt(tree, seg, tap.pos * seg.length) * 1000;
      const d0 = Math.max(B.minDiameter, Math.min(murray(tap.mass), B.childRatio * parentD));
      const nT = tap.mass >= B.tertiaryMinMass ? 2 : tap.mass >= B.secondaryMinMass ? 1 : 0;
      const twigT = nT === 0 ? [] : nT === 1 ? [0.35 + 0.3 * rand()] : [0.28 + 0.1 * rand(), 0.62 + 0.12 * rand()];
      const bias = add(mul(side, 0.6), mul(APEX, 0.7));
      const { pts, nrm } = march(at.pos, at.n, side, lengthFor(tap.mass, 1), bias, rand);
      const d = taper(d0, pts.length, twigT.map((t) => ({ t, share: B.twigShare })));
      root(id, 1, tap.pos, tap.mass, false, pts, nrm, d, parentD);
      // generation 2 twigs, and from each of the big branches' twigs, generation 3
      twigT.forEach((t, j) => {
        const i2 = Math.max(1, Math.min(pts.length - 2, Math.round(t * (pts.length - 1))));
        const id2 = `${id}.${j}`, r2 = rng(hash(id2));
        const tg2 = norm(sub(pts[i2 + 1], pts[i2 - 1]));
        const s2 = mul(norm(cross(nrm[i2], tg2)), (k + j) % 2 === 0 ? 1 : -1);
        const m2 = tap.mass * B.twigShare;
        const pd2 = d[i2], d2 = Math.max(B.minDiameter, Math.min(murray(m2), B.childRatio * pd2));
        const t3 = nT === 2 ? [0.5 + 0.1 * r2()] : [];
        const p2 = march(pts[i2], nrm[i2], add(mul(tg2, 0.55), mul(s2, 0.85)), lengthFor(m2, 2), add(mul(s2, 0.4), mul(APEX, 0.8)), r2);
        const dd2 = taper(d2, p2.pts.length, t3.map((tt) => ({ t: tt, share: B.twigShare })));
        root(id2, 2, tap.pos, m2, false, p2.pts, p2.nrm, dd2, pd2);
        t3.forEach((tt) => {
          const i3 = Math.max(1, Math.min(p2.pts.length - 2, Math.round(tt * (p2.pts.length - 1))));
          const id3 = `${id2}.0`, r3 = rng(hash(id3));
          const tg3 = norm(sub(p2.pts[i3 + 1], p2.pts[i3 - 1]));
          const s3 = mul(norm(cross(p2.nrm[i3], tg3)), j % 2 === 0 ? -1 : 1);
          const m3 = m2 * B.twigShare, pd3 = dd2[i3], d3 = Math.max(B.minDiameter, Math.min(murray(m3), B.childRatio * pd3));
          const p3 = march(p2.pts[i3], p2.nrm[i3], add(mul(tg3, 0.5), mul(s3, 0.85)), lengthFor(m3, 3), add(mul(s3, 0.3), mul(APEX, 0.8)), r3);
          root(id3, 3, tap.pos, m3, false, p3.pts, p3.nrm, taper(d3, p3.pts.length, []), pd3);
        });
      });
    });
    // septal perforators: short stubs from the LAD and the PDA that dive into the septum
    if (seg.id === "LAD" || seg.id.startsWith("PDA")) {
      const per = B.perforators, count = Math.max(per.min, Math.min(per.max, Math.round(seg.length * per.perMm))), depth = seg.id === "LAD" ? per.depthLad : per.depthPda;
      for (let k = 0; k < count; k++) {
        const id = `${seg.id}~${k}`, rand = rng(hash(id)), u = 0.2 + (0.62 * (k + 0.5)) / count + (rand() - 0.5) * 0.03;
        const at = projectToEpicardium(seg.curve.at(u), LIFT);
        const toward = septalDistance(at.pos) > 0 ? -1 : 1; // toward the septal plane from either side
        const down = norm(add(mul(at.n, -0.88), mul([0.979, 0, -0.204], 0.12 * toward)));
        const lenP = depth * (0.8 + 0.4 * rand()), pts: V3[] = [], nrm: V3[] = [], n = 5;
        for (let i = 0; i < n; i++) { pts.push(add(at.pos, mul(down, (lenP * i) / (n - 1)))); nrm.push(at.n); }
        const parentD = diameterAt(tree, seg, u * seg.length) * 1000, d0 = Math.max(B.minDiameter, Math.min(per.diameter, B.childRatio * parentD));
        root(id, 1, u, 0, true, pts, nrm, taper(d0, n, []), parentD);
      }
    }
  }
  return all;
}

/** LOD tier a branch belongs to: 0 taps and septal stubs, 1 generation-2 twigs, 2 generation-3 twigs. */
export const tierOf = (b: Branch) => (b.septal ? 0 : b.gen - 1);
/**
 * Level-of-detail rule: how many tiers to draw, from the radius scale and the camera's distance to the heart's centre (mm).
 * Taps and perforators always (they carry the anatomy); generation-2 twigs once the radius scale is at least 1.2 and the camera is
 * within 520 mm; generation-3 twigs ("tertiary": thinner than a pixel or two when small or far) at scale 2 and within 400 mm.
 * The default views sit at about 330 mm with scale 2.5, so they show everything; zooming out or shrinking the vessels drops the finest first.
 */
export const branchTierCount = (exag: number, dist: number) => 1 + (exag >= 1.2 && dist <= 520 ? 1 : 0) + (exag >= 2 && dist <= 400 ? 1 : 0);
export const branchLength = (b: Branch) => b.pts.reduce((a, p, i) => (i ? a + len(sub(p, b.pts[i - 1])) : 0), 0);
