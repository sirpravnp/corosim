// "Find the culprit": the simulator run backwards. A lesion is drawn at random and hidden; the player reads the
// 12-lead and the monitor and names the vessel. Pure functions here; app.ts owns the display and the clock.
import { buildTree, Tree, Variant, TYPICAL } from "./anatomy/tree";
import { Lesion } from "./physics/network";

export type Level = "resident" | "attending";
export type Verdict = "vessel" | "territory" | "miss";
export interface Case { variant: Variant; lesion: Lesion; exert: boolean }
export type Rng = () => number;

export const ROUNDS = 5;
export const POINTS = {
  vessel: 100, // the culprit itself
  territory: 40, // right system (LAD, circumflex or RCA), wrong branch
  speedBonus: 50, // on a correct vessel, scaled by how soon it was named
  speedFullUntil: 30, // s of simulated time: ischemia is fully developed by ~20 s
  speedZeroAt: 120,
};
export const LEVELS: Record<Level, { name: string; blurb: string }> = {
  resident: {
    name: "Resident",
    blurb: "Typical anatomy. A complete occlusion of one of the main arteries. The ischemic muscle darkens on the heart.",
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

/** Speed bonus (points) for a correct vessel named after `elapsed` s of simulated time. */
export function speedBonus(elapsed: number): number {
  const { speedBonus: max, speedFullUntil: a, speedZeroAt: b } = POINTS;
  return Math.round(max * Math.min(1, Math.max(0, 1 - (elapsed - a) / (b - a))));
}

export function points(verdict: Verdict, elapsed: number): { base: number; bonus: number; total: number } {
  const base = verdict === "vessel" ? POINTS.vessel : verdict === "territory" ? POINTS.territory : 0;
  const bonus = verdict === "vessel" ? speedBonus(elapsed) : 0;
  return { base, bonus, total: base + bonus };
}

export const maxScore = (rounds = ROUNDS) => rounds * (POINTS.vessel + POINTS.speedBonus);

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
