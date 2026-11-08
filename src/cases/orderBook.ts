// The order book: what the learner has ordered, what is still pending, and what came back. Pure and DOM-free.
// A lab's value is read when it returns (inside `tick`), from the patient as they are then, not when it was ordered.
import { backBeforeEnd, effectiveDelayS, itemById, PatientNow, Reading } from "./orders";

export interface Returned { id: string; t: number; reading: Reading }

export interface LogEntry {
  id: string; orderedAt: number;
  returnedAt?: number; reading?: Reading;
  cancelled?: true;
}

const NOT_MEASURED: Reading = { text: "not measurable" };

export class OrderBook {
  private queue: { id: string; readyAt: number }[] = [];
  private entries: LogEntry[] = [];

  /**
   * Orders an item at case time `t`. Ordering an item already pending adds nothing and says so. With the case's time limit the turnaround is
   * compressed to fit the case (effectiveDelayS), and an order whose result could not return before the limit is refused ("late").
   */
  order(id: string, t: number, limitS?: number): "ok" | "duplicate" | "unknown" | "late" {
    const item = itemById(id);
    if (!item) return "unknown";
    if (this.queue.some((q) => q.id === id)) return "duplicate";
    if (limitS !== undefined && !backBeforeEnd(item, t, limitS)) return "late";
    this.queue.push({ id, readyAt: t + (limitS === undefined ? item.delayS : effectiveDelayS(item, limitS)) });
    this.entries.push({ id, orderedAt: t });
    return "ok";
  }

  /** Returns every order whose time has come at case time `t`, reading each from `now`. */
  tick(t: number, now: PatientNow): Returned[] {
    const due = this.queue.filter((q) => q.readyAt <= t);
    if (due.length === 0) return [];
    this.queue = this.queue.filter((q) => q.readyAt > t);
    due.sort((a, b) => a.readyAt - b.readyAt);
    return due.map(({ id }) => {
      const item = itemById(id);
      const reading = item?.read ? item.read(now) : item?.panel ? { text: "result ready" } : NOT_MEASURED;
      const entry = this.entries.find((e) => e.id === id && e.returnedAt === undefined && !e.cancelled);
      if (entry) { entry.returnedAt = t; entry.reading = reading; }
      return { id, t, reading };
    });
  }

  /** Withdraws a pending order. It stays in the log, marked cancelled. */
  cancel(id: string): void {
    if (!this.queue.some((q) => q.id === id)) return;
    this.queue = this.queue.filter((q) => q.id !== id);
    const entry = this.entries.find((e) => e.id === id && e.returnedAt === undefined && !e.cancelled);
    if (entry) entry.cancelled = true;
  }

  get pending(): { id: string; readyAt: number }[] { return this.queue.map((q) => ({ ...q })); }
  get log(): LogEntry[] { return this.entries.map((e) => ({ ...e })); }

  /** Every item ordered in this case and not cancelled, pending or returned. */
  ordered(): Set<string> {
    return new Set(this.entries.filter((e) => !e.cancelled).map((e) => e.id));
  }
}

/** Case seconds as m:ss, for the debrief. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** One debrief line per order, in the order placed: when it was ordered, and either when it came back with its result, or its state. */
export function orderLines(book: OrderBook): string[] {
  return book.log.map((e) => {
    const name = itemById(e.id)?.label ?? e.id;
    const state = e.cancelled ? "cancelled"
      : e.returnedAt !== undefined ? `back ${clock(e.returnedAt)}, ${e.reading?.text ?? ""}${e.reading?.estimate ? " (estimate)" : ""}`
      : "not back yet";
    return `${name}: ordered ${clock(e.orderedAt)}, ${state}`;
  });
}

/** The line a returned order adds to what is known about the patient. */
export function returnedLine(r: Returned): string {
  return `${itemById(r.id)?.label ?? r.id}:${r.reading.text.includes("\n") ? "\n" : " "}${r.reading.text}${r.reading.estimate ? " (estimate)" : ""}`;
}

/** Puts each returned result in the case log (through `note`), so it survives a redraw of the page. */
export function noteReturned(runner: { note(text: string): void }, back: Returned[]): void {
  for (const r of back) runner.note(returnedLine(r));
}

/** The debrief with one line per order (placed, back, cancelled, or still pending) added at the end. */
export function withOrderLines<D extends { lines: string[] }>(d: D, book: OrderBook): D {
  return { ...d, lines: [...d.lines, ...orderLines(book)] };
}
