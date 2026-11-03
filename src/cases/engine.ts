import type { PatientSpec } from "../sim/patient";
import { GENERIC_HARMS } from "./harms";

/**
 * The case engine: a case is a patient to start from, a card to read, and a set of checkpoints that fire as the case goes on.
 * Nothing here touches the simulation or the page. The page builds a Probe of what is true now, ticks the runner with the
 * simulated time that passed, and carries out what comes back (patches to apply, lines to show, a prompt to put up). While a prompt
 * is open the runner is `paused`, and the page holds the clock.
 *
 * A checkpoint becomes eligible when its time has come (`atS`), its condition has held long enough (`when` for `forS`), every flag it
 * `requires` is set and none it `forbids` is. An eligible checkpoint with a prompt puts the question up; one without just plays its
 * outcome (a complication, a piece of news). An answer's outcome can reveal information, patch the patient, set flags that later
 * checkpoints gate on, order a procedure, or end the case.
 */

/** What is true of the patient right now, as far as a case can ask. */
export interface Probe {
  map: number; hr: number; // mmHg, bpm
  arrest: "none" | "arrest" | "rosc" | "dead";
  rhythmClass: string; // vf, pulselessVt, asystole, pea, perfusing
  shocks: number; epiDoses: number; amioMg: number; lidoDoses: number;
  cpr: boolean;
  ecmo: boolean; impella: boolean; iabp: boolean;
  pci: boolean; pciPending: boolean; // a stent is in / a PCI is on its way
  /** Infusion levels now, 0..1 of a full dose, by drug name (betaBlocker, nitroglycerin, ...). */
  drugs: Record<string, number>;
  /** Left-ventricular ejection fraction (0..1), ischemic fraction of each ventricle (0..1), pulmonary congestion (0..1), litres of fluid given. */
  ef: number; lvIschemia: number; rvIschemia: number; congestion: number; fluidsL: number;
  dead: boolean;
}
export type Cond = (p: Probe) => boolean;

export interface Option {
  label: string;
  /** Points for choosing this (negative for a costly choice). */
  points?: number;
  /** Right or wrong, for the debrief. Left out where the choice is not graded. */
  correct?: boolean;
  /** The teaching point shown in the debrief when this was the choice. */
  why?: string;
  outcome?: Outcome;
}
export interface Outcome {
  /** Lines added to what is known about the patient. */
  reveal?: string[];
  /** Applied to the simulation (`sim.apply`). */
  patch?: PatientSpec;
  /** Set for later checkpoints to gate on. */
  flags?: string[];
  /** A procedure the page orders on the team's behalf. */
  order?: "pci";
  /** A shock the page delivers (`sim.shock`); what follows depends on whether it worked. */
  shock?: ShockOrder;
  /** Ends the case. */
  end?: "success" | "fail";
}
export interface ShockOrder { joules: number; sync?: boolean; onSuccess?: Outcome; onFail?: Outcome }
export interface Prompt { text: string; options: Option[] }
export interface Checkpoint {
  id: string;
  atS?: number; // case seconds
  when?: Cond; forS?: number; // the condition, and for how long it must hold (default 0)
  requires?: string[]; forbids?: string[];
  prompt?: Prompt; outcome?: Outcome;
  /** A prompt that only comes up if an earlier choice went the wrong way: it does not count towards the best possible score. */
  branch?: boolean;
  /** May fire again, this many case seconds after it last did (default: it fires once). */
  repeatAfterS?: number;
}

export interface CaseCard { presents: string; pmh: string; info?: string[] }
export interface Harm { tag: string; label: string; when: Cond }
export interface CaseDef {
  id: string; title: string; tier: "easy" | "medium" | "hard"; blurb: string;
  card: CaseCard;
  start: PatientSpec;
  /** What the team has already done when the case opens. */
  opening?: { rhythm?: string; cpr?: boolean; drugs?: { drug: "epinephrine" | "amiodarone" | "lidocaine"; mg: number }[] };
  checkpoints: Checkpoint[];
  /** Counted as "kept alive and stable" time (default: pressure at 60 or more and not in arrest). */
  stable?: Cond;
  /** Harms particular to this case, on top of the generic ones (`GENERIC_HARMS`). */
  harms?: Harm[];
  /** Tags of generic harms that do not apply here. */
  skipHarms?: string[];
  /** Flags the learner should have earned, named for the debrief. */
  musts?: { flag: string; label: string }[];
  points: { survive: number; stable: number; harm: number };
  limitS: number; // case seconds before the case times out
}

export type Result = "success" | "fail" | "died" | "timeout";
export interface Logged { t: number; text: string }
export interface Choice { id: string; prompt: string; label: string; points: number; correct?: boolean; why?: string }
export interface Tick {
  patches: PatientSpec[]; reveals: string[]; orders: "pci"[]; shocks: ShockOrder[];
  opened: { id: string; prompt: Prompt } | null;
  over: Result | null;
}
export interface Debrief { result: Result; score: number; max: number; lines: string[] }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const STABLE: Cond = (p) => p.map >= 60 && p.arrest !== "arrest" && !p.dead;

export class CaseRunner {
  t = 0; // case seconds, not counting time a prompt was open
  flags = new Set<string>();
  log: Logged[] = [];
  choices: Choice[] = [];
  result: Result | null = null;
  open: { id: string; prompt: Prompt } | null = null;
  private fired = new Map<string, number>(); // checkpoint id -> case time it last fired
  private held = new Map<string, number>(); // checkpoint id -> seconds its condition has held
  private queue: Checkpoint[] = [];
  private stableS = 0; private harmS = 0; private harmBy = new Map<string, number>();
  private points = 0;

  /** The harms this case is scored against: the generic list less what it skips, plus its own. */
  readonly harms: Harm[];
  constructor(readonly def: CaseDef) { this.harms = [...GENERIC_HARMS.filter((h) => !def.skipHarms?.includes(h.tag)), ...(def.harms ?? [])]; }

  get paused() { return this.open !== null; }
  get over() { return this.result !== null; }

  private eligible(c: Checkpoint, p: Probe, dt: number): boolean {
    const last = this.fired.get(c.id);
    if (last !== undefined && (c.repeatAfterS === undefined || this.t - last < c.repeatAfterS)) return false;
    if (c.requires?.some((f) => !this.flags.has(f))) return false;
    if (c.forbids?.some((f) => this.flags.has(f))) return false;
    if (c.atS !== undefined && this.t < c.atS) return false;
    if (c.when) {
      const h = c.when(p) ? (this.held.get(c.id) ?? 0) + dt : -1;
      this.held.set(c.id, Math.max(0, h));
      if (h < 0 || h < (c.forS ?? 0)) return false;
    }
    return true;
  }

  private play(o: Outcome, into: Tick) {
    for (const r of o.reveal ?? []) { this.log.push({ t: this.t, text: r }); into.reveals.push(r); }
    if (o.patch) into.patches.push(o.patch);
    for (const f of o.flags ?? []) this.flags.add(f);
    if (o.order) into.orders.push(o.order);
    if (o.shock) into.shocks.push(o.shock);
    if (o.end) this.finish(o.end, into);
  }
  private finish(r: Result, into: Tick) { if (!this.result) { this.result = r; this.open = null; this.queue = []; into.over = r; } }

  /** Advance by `dt` case seconds with the patient as `p`. Does nothing while a prompt is open or once the case is over. */
  tick(p: Probe, dt: number): Tick {
    const out: Tick = { patches: [], reveals: [], orders: [], shocks: [], opened: null, over: null };
    if (this.result || this.open) return out;
    this.t += dt;
    if (p.dead) { this.finish("died", out); return out; }
    if ((this.def.stable ?? STABLE)(p)) this.stableS += dt;
    let harmed = false;
    for (const h of this.harms) if (h.when(p)) { harmed = true; this.harmBy.set(h.tag, (this.harmBy.get(h.tag) ?? 0) + dt); }
    if (harmed) this.harmS += dt;
    for (const c of this.def.checkpoints) {
      if (this.queue.includes(c)) continue;
      if (!this.eligible(c, p, dt)) continue;
      this.fired.set(c.id, this.t); this.held.set(c.id, 0);
      if (c.prompt) this.queue.push(c); else if (c.outcome) { this.play(c.outcome, out); if (this.result) return out; }
    }
    const next = this.queue.shift();
    if (next?.prompt) { this.open = { id: next.id, prompt: next.prompt }; out.opened = this.open; }
    else if (this.t >= this.def.limitS) this.finish("timeout", out);
    return out;
  }

  /** Answer the open prompt. The outcome comes back as a Tick for the page to carry out. */
  answer(i: number): Tick {
    const out: Tick = { patches: [], reveals: [], orders: [], shocks: [], opened: null, over: null };
    const o = this.open;
    if (!o) return out;
    const opt = o.prompt.options[i];
    if (!opt) return out;
    this.open = null;
    this.points += opt.points ?? 0;
    this.choices.push({ id: o.id, prompt: o.prompt.text, label: opt.label, points: opt.points ?? 0, correct: opt.correct, why: opt.why });
    if (opt.outcome) this.play(opt.outcome, out);
    return out;
  }

  /** Play an outcome that depends on something the page found out (a shock that did or did not convert the rhythm). */
  resolve(o: Outcome): Tick {
    const out: Tick = { patches: [], reveals: [], orders: [], shocks: [], opened: null, over: null };
    if (!this.result) this.play(o, out);
    return out;
  }

  /** The most the case can award: survival, stability, and the best option of every prompt on the way through (once each). */
  maxScore(): number {
    const best = this.def.checkpoints.reduce((s, c) => s + (c.prompt && !c.branch ? Math.max(0, ...c.prompt.options.map((o) => o.points ?? 0)) : 0), 0);
    return this.def.points.survive + this.def.points.stable + best;
  }

  debrief(): Debrief {
    const r = this.result ?? "timeout", P = this.def.points, span = Math.max(1, this.t);
    const stableFrac = clamp(this.stableS / span, 0, 1), harmFrac = clamp(this.harmS / span, 0, 1);
    const survived = r === "success";
    const score = Math.max(0, Math.round((survived ? P.survive : 0) + P.stable * stableFrac - P.harm * harmFrac + this.points));
    const lines: string[] = [];
    lines.push(r === "success" ? "The case was resolved." : r === "died" ? "The patient died." : r === "timeout" ? "Time ran out before the problem was resolved." : "The case ended badly.");
    for (const c of this.choices) {
      if (c.why) lines.push(`${c.correct === undefined ? "•" : c.correct ? "✓" : "✗"} ${c.label}: ${c.why}`);
    }
    const missed = (this.def.musts ?? []).filter((m) => !this.flags.has(m.flag));
    if (missed.length) lines.push(`Not done: ${missed.map((m) => m.label).join("; ")}.`);
    lines.push(`Held stable ${Math.round(stableFrac * 100)}% of the time.`);
    const harms = [...this.harmBy].filter(([, s]) => s / span >= 0.05).map(([tag, s]) => `${this.harms.find((h) => h.tag === tag)!.label} (${Math.round((100 * s) / span)}%)`);
    if (harms.length) lines.push(`Harmful: ${harms.join(", ")}.`);
    return { result: r, score, max: this.maxScore(), lines };
  }
}
