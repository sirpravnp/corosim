// "Find the culprit": the simulator run backwards. A lesion is drawn at random and hidden; the player reads the
// 12-lead and the monitor and names the vessel. Pure functions here; app.ts owns the display and the clock.
import { buildTree, Tree, Variant, TYPICAL } from "./anatomy/tree";
import { Lesion } from "./physics/network";

export type Level = "resident" | "attending";
export type Verdict = "vessel" | "territory" | "miss";
export interface Case { variant: Variant; lesion: Lesion; exert: boolean }
/** A spot on the tree: a vessel and a fraction of the way along it. The player's call and the lesion are both one. */
export interface Point { segId: string; pos: number }
export type Rng = () => number;

export const ROUNDS = 5;
export const POINTS = {
  location: 100, // a call on the lesion itself, at time zero
  freeMm: 7, // half the 14 mm lesion window: anywhere on the lesion is on the lesion
  sigmaMm: 20, // beyond that, Gaussian fall-off with distance along the tree: half credit at ~17 mm off, a tenth at ~30
  timeTau: 150, // s of the patient's time: the location score decays by e every tau
  speed: 3, // time scale a case runs at, so seconds since the occlusion compare between players
};
export const LEVELS: Record<Level, { name: string; blurb: string }> = {
  resident: {
    name: "Resident",
    blurb: "Typical anatomy. A complete occlusion somewhere along one of the main arteries. The ischemic muscle darkens on the heart.",
  },
  attending: {
    name: "Attending",
    blurb: "Any anatomic variant and any vessel, the nodal arteries included; an occlusion, or a tight stenosis under exertion. The heart keeps its ischemia to itself: ECG and monitor only.",
  },
};

/** The big named arteries a first-pass player is asked about, whichever of them the variant has. */
const RESIDENT_IDS = ["LM", "LAD", "LCX", "RCA", "D1", "OM1", "PDA_R", "PDA_L"];

export function eligible(tree: Tree, level: Level): string[] {
  const ids = tree.segments.map((s) => s.id);
  return level === "resident" ? ids.filter((id) => RESIDENT_IDS.includes(id)) : ids;
}

const pick = <T>(rng: Rng, xs: T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
const weighted = <T extends string>(rng: Rng, table: Record<T, number>): T => {
  const keys = Object.keys(table) as T[];
  let u = rng() * keys.reduce((a, k) => a + table[k], 0);
  for (const k of keys) { u -= table[k]; if (u < 0) return k; }
  return keys[keys.length - 1];
};

/** A variant drawn for teaching, not epidemiology: the rarer patterns come up far more often than in life. */
export function randomVariant(rng: Rng): Variant {
  return {
    dominance: weighted(rng, { right: 0.6, co: 0.2, left: 0.2 }),
    lm: weighted(rng, { bifurcation: 0.6, trifurcation: 0.25, absent: 0.15 }),
    ladCourse: weighted(rng, { normal: 0.6, short: 0.2, wrap: 0.2 }),
    saNodeFrom: weighted(rng, { RCA: 0.6, LCx: 0.4 }),
    conusOstium: weighted(rng, { shared: 0.65, separate: 0.35 }),
  };
}

/** Draw the next case. `avoid` keeps the same vessel from coming up twice running. */
export function drawCase(rng: Rng, level: Level, avoid = ""): Case {
  const variant = level === "resident" ? { ...TYPICAL } : randomVariant(rng);
  const tree = buildTree(variant);
  const ids = eligible(tree, level);
  const pool = ids.filter((id) => id !== avoid);
  const segId = pick(rng, pool.length ? pool : ids);
  if (level === "resident") return { variant, lesion: { segId, pos: 0.1 + 0.3 * rng(), ds: 1, occluded: true }, exert: false };
  const occluded = rng() < 0.65;
  const pos = 0.05 + 0.85 * rng();
  return occluded
    ? { variant, lesion: { segId, pos, ds: 1, occluded: true }, exert: false }
    : { variant, lesion: { segId, pos, ds: 0.88 + 0.07 * rng(), occluded: false }, exert: true };
}

export function judge(tree: Tree, guess: string, truth: string): Verdict {
  if (guess === truth) return "vessel";
  const g = tree.byId[guess], t = tree.byId[truth];
  return g && t && g.group === t.group ? "territory" : "miss";
}

/** The path from a point back to the aortic root: on each vessel, how far along it the path runs before leaving. */
function chain(tree: Tree, p: Point): { segId: string; s: number }[] {
  const out: { segId: string; s: number }[] = [];
  let seg = tree.byId[p.segId], s = Math.min(1, Math.max(0, p.pos)) * seg.length;
  for (;;) {
    out.push({ segId: seg.id, s });
    if (!seg.parent) return out;
    const up = tree.byId[seg.parent];
    s = seg.attach * up.length; seg = up;
  }
}

/** Distance (mm) between two points measured along the vessels, through the aortic root when they share no vessel. */
export function treeDistance(tree: Tree, a: Point, b: Point): number {
  const ca = chain(tree, a), cb = chain(tree, b);
  const onA = new Map(ca.map((e, i) => [e.segId, i]));
  const j = cb.findIndex((e) => onA.has(e.segId));
  if (j < 0) return ca.reduce((t, e) => t + e.s, 0) + cb.reduce((t, e) => t + e.s, 0);
  const i = onA.get(cb[j].segId)!;
  const below = (c: typeof ca, k: number) => c.slice(0, k).reduce((t, e) => t + e.s, 0);
  return below(ca, i) + below(cb, j) + Math.abs(ca[i].s - cb[j].s);
}

/** Location score (points) for a call `d` mm along the tree from the lesion. */
export function locationScore(d: number): number {
  const off = Math.max(0, d - POINTS.freeMm) / POINTS.sigmaMm;
  return POINTS.location * Math.exp(-off * off);
}

/** Time factor (0..1) for a call made `elapsed` s of the patient's time after the occlusion. */
export const timeFactor = (elapsed: number) => Math.exp(-Math.max(0, elapsed) / POINTS.timeTau);

export interface Score { distance: number; location: number; time: number; total: number }
export function score(tree: Tree, call: Point | null, lesion: Point, elapsed: number): Score {
  if (!call) return { distance: Infinity, location: 0, time: timeFactor(elapsed), total: 0 };
  const distance = treeDistance(tree, call, lesion), location = locationScore(distance), time = timeFactor(elapsed);
  return { distance, location, time, total: Math.round(location * time) };
}

export const maxScore = (rounds = ROUNDS) => rounds * POINTS.location;

const TERRITORY_NOTE: Record<string, string> = {
  LAD: "The LAD system supplies the anterior wall and septum, so its injury current points at V1–V4; the diagonals add I and aVL.",
  LCx: "The circumflex system supplies the lateral wall, and the inferior wall too when it is dominant, so it shows in I, aVL and V5–V6, often faintly: the lateral wall faces away from most of the twelve leads.",
  RCA: "The RCA system supplies the inferior wall and the right ventricle, and usually both nodal arteries, so look to II, III and aVF, and to the rate and PR interval.",
};
const VESSEL_NOTE: Record<string, string> = {
  SAN: "The SA-node artery feeds almost no muscle. Its loss shows as sinus slowing, not as ST shift.",
  AVN: "The AV-node artery feeds almost no muscle. Its loss shows as a lengthening PR interval and Wenckebach, then complete block, rather than as ST shift.",
  LM: "The left main feeds both the LAD and the circumflex: a very large territory, so pressure falls and the ST shift is widespread, with aVR often elevated.",
  CONUS: "The conus branch supplies the right ventricular outflow tract alone, so it causes little on the 12-lead.",
};

export interface Findings { stUp: string[]; stDown: string[]; rhythm: string }

/** The one-paragraph debrief shown after a case: what the lesion was, what it did to the tracing, and why. */
export function explain(tree: Tree, c: Case, f: Findings): string {
  const seg = tree.byId[c.lesion.segId];
  const what = c.lesion.occluded ? "Complete occlusion of the" : `${Math.round(c.lesion.ds * 100)}% stenosis of the`;
  const where = `${what} ${seg.name}, ${Math.round(c.lesion.pos * 100)}% of the way along it${c.exert ? ", under exertion" : ""}; ` +
    `${Math.round(seg.subMass * 100)}% of the myocardium lies beyond it.`;
  const st = f.stUp.length || f.stDown.length
    ? ` ST elevation in ${f.stUp.length ? f.stUp.join(", ") : "no lead"}${f.stDown.length ? `, depression in ${f.stDown.join(", ")}` : ""}.`
    : " No lead reached 1 mm of ST shift.";
  const rhythm = f.rhythm ? ` Rhythm: ${f.rhythm}.` : "";
  return `${where}${st}${rhythm} ${VESSEL_NOTE[seg.id] ?? TERRITORY_NOTE[seg.group]}`;
}
