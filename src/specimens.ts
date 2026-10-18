// The homepage's heart of the day: an animal's heart, or a variation of the human coronary tree, each with one fact.
// Pure data and the day's pick, with no DOM, so tests can check them; the drawings are in specimenArt.ts.
import { Variant, TYPICAL } from "./anatomy/tree";

export interface Specimen {
  id: string;
  kind: "animal" | "human";
  name: string; // what the label says
  fact: string; // one sentence or two, shown under "Did you know"
  /** Human hearts: the anatomy to draw, as the simulator's own Variant. Animals and the textbook heart have none. */
  variant?: Variant;
  /** Human hearts: the arteries (by segment id) that make this variant what it is, drawn hottest and thickest. */
  feature?: string[];
}

const human = (id: string, name: string, fact: string, v?: Partial<Variant>, feature?: string[]): Specimen => ({ id, kind: "human", name, fact, ...(v ? { variant: { ...TYPICAL, ...v }, feature } : {}) });
const animal = (id: string, name: string, fact: string): Specimen => ({ id, kind: "animal", name, fact });

/** In the order they come round: animal and human hearts alternate, and never more than two of a kind in a row (round
 *  the end of the cycle too). Add new ones at the end, so that the days already shown keep their hearts. */
export const SPECIMENS: Specimen[] = [
  animal("giraffe", "Giraffe", "A giraffe's heart weighs around 10 kg. Its blood pressure at the heart is about twice a person's, enough to lift blood two metres up to the brain."),
  human("typical", "Right-dominant coronary arteries", "In most people the right coronary artery gives off the posterior descending artery, and that is what “right-dominant” means. Dominance is about that one branch, not about which side feeds more muscle.", {}, ["RCA", "PDA_R"]),
  animal("octopus", "Octopus", "An octopus has three hearts: two push blood through the gills and one sends it to the body. The body heart pauses while the octopus swims, one reason it prefers to crawl."),
  human("left-dominant", "Left-dominant coronary arteries", "In a left-dominant heart the circumflex, not the right coronary, supplies the underside of the heart. A circumflex blockage there can look like an inferior heart attack.", { dominance: "left" }, ["PDA_L", "PLV_L", "AVN"]),
  animal("hummingbird", "Hummingbird", "A hummingbird's heart can beat more than 1,200 times a minute in flight, and it is among the largest hearts for body size of any bird."),
  human("ramus", "Ramus intermedius", "Roughly one heart in five has a third branch off the left main, the ramus intermedius, running between the LAD and the circumflex. Published figures run from about 15 to 30 percent.", { lm: "trifurcation" }, ["RAMUS"]),
  animal("frog", "Frog", "In 1921 Otto Loewi dripped fluid from a nerve-stimulated frog heart onto a second one and slowed it. It showed that nerves talk to the heart with chemicals, and won a Nobel Prize in 1936."),
  animal("insect", "Insect", "An insect's heart is a tube along its back that pumps in waves, and in many species it periodically reverses direction. Its blood does not carry oxygen: tiny air tubes do."),
  human("absent-lm", "Absent left main", "In under one percent of people there is no left main trunk: the LAD and the circumflex open separately from the aorta. A catheter placed for the left system may enter only one of them.", { lm: "absent" }, ["LAD", "LCX"]),
  animal("blue-whale", "Blue whale", "A blue whale's heart has been recorded beating as slowly as about twice a minute on a deep dive, and rising above 25 beats a minute when it surfaces to breathe."),
  human("wrap-lad", "Wrap-around LAD", "A wrap-around LAD turns the apex and runs back up the underside of the heart, so one blockage can lift the ST segment on the front leads and the inferior ones together.", { ladCourse: "wrap" }, ["LAD"]),
  animal("crocodile", "Crocodile", "A crocodile has a four-chambered heart like ours, plus a small opening, the foramen of Panizza, between its two aortas. It lets the animal shunt blood away from the lungs when it dives."),
  human("textbook", "The textbook heart", "Over an average lifetime a human heart beats about 2.5 billion times, and each day it moves roughly 7,000 litres of blood."),
  animal("fish", "Fish", "A fish heart has two chambers and pumps blood once around: out through the gills, then on to the body, with no second boost between."),
  human("short-lad", "Short LAD", "The LAD usually runs down to the apex. In some hearts it stops short, and the posterior descending artery from the right coronary reaches round to supply the apex instead.", { ladCourse: "short" }, ["LAD", "PDA_R"]),
  animal("elephant", "Elephant", "An elephant's heart has a double-pointed tip, a cleft apex it shares with manatees and dugongs, and it beats only about 30 times a minute at rest."),
  animal("sea-squirt", "Sea squirt", "A sea squirt's tube-shaped heart reverses direction every few minutes, pushing blood one way and then the other."),
  human("sa-circumflex", "Sinus node artery from the circumflex", "The artery to the heart's natural pacemaker, the sinoatrial node, comes from the right coronary in roughly six people in ten and from the circumflex in roughly four in ten.", { saNodeFrom: "LCx" }, ["SAN"]),
  animal("earthworm", "Earthworm", "An earthworm has no single heart: five pairs of muscular vessels loop round its gut and pump blood between a vessel along its back and one along its belly."),
  human("co-dominant", "Co-dominant coronary arteries", "In a co-dominant heart the right coronary gives the posterior descending artery while the circumflex also sends branches to the inferior wall, so the supply of the underside is shared.", { dominance: "co" }, ["PLV_L", "PDA_R"]),
  animal("python", "Burmese python", "After a large meal a Burmese python's heart can grow by around 40 percent within a day or two, a healthy enlargement that researchers study for clues to heart disease."),
  human("separate-conus", "Separate conus ostium", "In many hearts the conus artery, a small branch to the right ventricle's outflow, has its own opening in the aorta. It can link the right and left systems: the ring of Vieussens.", { conusOstium: "separate" }, ["CONUS"]),
  animal("pig", "Pig", "In 2022 surgeons in Baltimore transplanted a genetically modified pig heart into a living patient, who survived about two months. Pig valves have repaired human hearts for decades."),
];

// ---- the day ----
/** The first day of the cycle: the first heart. */
export const FIRST_DAY = "2026-10-07";
/** The day in the visitor's own calendar, as YYYY-MM-DD. */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Whole days since the first day (0 on it), or NaN for anything that is not a YYYY-MM-DD date. */
export function daysSince(key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
  const utc = (k: string) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(key) - utc(FIRST_DAY)) / 86400000);
}
/** The heart for a day: the cycle repeats every SPECIMENS.length days, including before the first day. */
export function specimenForDay(key: string): Specimen {
  const n = SPECIMENS.length, k = daysSince(key);
  return SPECIMENS[((Number.isFinite(k) ? k : 0) % n + n) % n];
}
/** Which heart a page address asks for: ?heart=<id> names one, ?day=YYYY-MM-DD a day's, and with neither it is today's. */
export function specimenFor(search: string, now = new Date()): Specimen {
  const q = new URLSearchParams(search);
  return SPECIMENS.find((s) => s.id === q.get("heart")) ?? specimenForDay(Number.isFinite(daysSince(q.get("day") ?? "")) ? q.get("day")! : today(now));
}
