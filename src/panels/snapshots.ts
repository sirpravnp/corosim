/**
 * Snapshots (task P13): a saved moment of the hemodynamics, kept to compare against the live data. DOM-free store shared
 * by the workspace bar and the panels. A snapshot holds copies, so later changes to the source never alter it.
 */
import type { BeatSummary, HemoNumbers, HemoSource, Saturations, Series } from "../sim/hemoSource";

export const MAX_SNAPSHOTS = 3;
/** Seconds of pressure trace kept in a snapshot. */
export const SNAPSHOT_SECONDS = 6;
const MAX_POINTS = 600;

export interface Snapshot {
  id: number;
  label: string;
  /** Source clock when saved, s. */
  t: number;
  numbers: HemoNumbers;
  saturations: Saturations;
  /** The last completed beat, null before the first. */
  beat: BeatSummary | null;
  /** Pressure of every node over the last SNAPSHOT_SECONDS, mmHg, on the source clock. */
  traces: Record<string, Series>;
}

const copySeries = (s: Series): Series => ({ t: Float32Array.from(s.t), v: Float32Array.from(s.v) });

export function captureSnapshot(source: HemoSource, id: number, label: string): Snapshot {
  const traces: Record<string, Series> = {};
  for (const n of source.nodes()) traces[n] = copySeries(source.trace(n, SNAPSHOT_SECONDS, { maxPoints: MAX_POINTS }));
  return {
    id, label, t: source.now(),
    numbers: structuredClone(source.numbers()), saturations: structuredClone(source.saturations()),
    beat: source.beats(1)[0] ?? null, traces,
  };
}

export class SnapshotStore {
  private items: Snapshot[] = [];
  private sel: number | null = null;
  private nextId = 1;
  private subs = new Set<() => void>();

  list(): readonly Snapshot[] { return this.items; }
  selectedId(): number | null { return this.sel; }
  selected(): Snapshot | null { return this.items.find(s => s.id === this.sel) ?? null; }

  /** Save the source's current state and select it. At the cap, the oldest is dropped. Returns the snapshot. */
  save(source: HemoSource, label?: string): Snapshot {
    const id = this.nextId++;
    const snap = captureSnapshot(source, id, label?.trim() || `Snapshot ${id}`);
    this.items.push(snap);
    while (this.items.length > MAX_SNAPSHOTS) this.items.shift();
    this.sel = id;
    this.emit();
    return snap;
  }

  /** Pick the snapshot to overlay; null (or an unknown id) shows none. */
  select(id: number | null): void {
    const next = id !== null && this.items.some(s => s.id === id) ? id : null;
    if (next === this.sel) return;
    this.sel = next;
    this.emit();
  }

  /** Remove one snapshot, or all when no id is given. */
  clear(id?: number): void {
    if (id === undefined) this.items = [];
    else this.items = this.items.filter(s => s.id !== id);
    if (this.sel !== null && !this.items.some(s => s.id === this.sel)) this.sel = null;
    this.emit();
  }

  subscribe(cb: () => void): () => void { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private emit(): void { for (const cb of [...this.subs]) cb(); }
}

/** The store the Simulator page and its panels share. */
export const snapshots = new SnapshotStore();
