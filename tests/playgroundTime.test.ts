import { describe, expect, it } from "vitest";
import { MAX_SNAPSHOTS, SNAPSHOT_SECONDS, SnapshotStore } from "../src/panels/snapshots";
import { beatColumns, beatsCsv, traceColumns, traceCsv } from "../src/panels/csvExport";
import { PlayClock, advanceClock, initialClock, nextBeatTime, type ClockState } from "../src/panels/timeControl";
import { deltaText } from "../src/panels/numbers";
import { createStubSource } from "../src/sim/stubSource";
import type { HemoSource } from "../src/sim/hemoSource";

function source(): HemoSource {
  let t = 40;
  const s = createStubSource(() => t);
  (s as unknown as { __set: (x: number) => void }).__set = x => { t = x; };
  return s;
}
const setClock = (s: HemoSource, x: number) => (s as unknown as { __set: (x: number) => void }).__set(x);

describe("snapshot store", () => {
  it("saves a copy of numbers, saturations, last beat and 6 s of traces, and selects it", () => {
    const src = source(), store = new SnapshotStore();
    const snap = store.save(src, "before LAD");
    expect(store.list()).toHaveLength(1);
    expect(store.selected()).toBe(snap);
    expect(snap.label).toBe("before LAD");
    expect(snap.t).toBe(src.now());
    expect(snap.numbers).toEqual(src.numbers());
    expect(snap.numbers).not.toBe(src.numbers());
    expect(snap.saturations.spo2).toBe(src.saturations().spo2);
    expect(snap.beat).toBe(src.beats(1)[0]);
    for (const n of src.nodes()) {
      const ref = src.trace(n, SNAPSHOT_SECONDS, { maxPoints: 600 });
      expect(Array.from(snap.traces[n].v)).toEqual(Array.from(ref.v));
      expect(snap.traces[n].t[snap.traces[n].t.length - 1] - snap.traces[n].t[0]).toBeLessThanOrEqual(SNAPSHOT_SECONDS + 1e-3);
    }
  });
  it("gives a default label and keeps at most 3, dropping the oldest", () => {
    const src = source(), store = new SnapshotStore();
    const ids = [1, 2, 3, 4].map(() => store.save(src).id);
    expect(MAX_SNAPSHOTS).toBe(3);
    expect(store.list().map(s => s.id)).toEqual(ids.slice(1));
    expect(store.list()[0].label).toBe(`Snapshot ${ids[1]}`);
    expect(store.selectedId()).toBe(ids[3]);
  });
  it("selects, deselects, ignores unknown ids and clears one or all", () => {
    const src = source(), store = new SnapshotStore();
    const a = store.save(src), b = store.save(src);
    store.select(a.id);
    expect(store.selected()).toBe(a);
    store.select(999);
    expect(store.selected()).toBeNull();
    store.select(b.id);
    store.clear(b.id);
    expect(store.list()).toEqual([a]);
    expect(store.selectedId()).toBeNull();
    store.save(src);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.selected()).toBeNull();
  });
  it("tells subscribers about every change, and stops after unsubscribe", () => {
    const src = source(), store = new SnapshotStore();
    let n = 0;
    const off = store.subscribe(() => n++);
    const a = store.save(src);
    store.select(null);
    store.clear(a.id);
    expect(n).toBe(3);
    off();
    store.save(src);
    expect(n).toBe(3);
  });
  it("is not changed by the source moving on", () => {
    const src = source(), store = new SnapshotStore();
    const snap = store.save(src);
    const before = Array.from(snap.traces.AO.v);
    setClock(src, 47);
    expect(Array.from(snap.traces.AO.v)).toEqual(before);
    expect(snap.t).toBeCloseTo(0, 6);
  });
});

describe("CSV export", () => {
  const parse = (csv: string) => csv.trim().split("\n").map(l => l.split(","));
  it("has the headers and one row per sample, and the values equal source.trace", () => {
    const src = source();
    setClock(src, 70);
    const rows = parse(traceCsv(src, 30, 3000));
    expect(rows[0]).toEqual(traceColumns(src.nodes()));
    expect(rows[0][0]).toBe("time_s");
    expect(rows[0]).toContain("LV_mmHg");
    expect(rows[0]).toContain("LV_vol_ml");
    const ref = src.trace("AO", 30, { maxPoints: 3000 });
    expect(rows.length - 1).toBe(ref.t.length);
    src.nodes().forEach((n, k) => {
      const s = src.trace(n, 30, { maxPoints: 3000 }), col = 1 + k;
      for (let i = 0; i < s.t.length; i++) {
        expect(Math.fround(Number(rows[i + 1][0]))).toBe(s.t[i]);
        expect(Math.fround(Number(rows[i + 1][col]))).toBe(s.v[i]);
      }
    });
    ["RA", "RV", "LA", "LV"].forEach((c, k) => {
      const s = src.trace(c, 30, { quantity: "volume", maxPoints: 3000 }), col = 1 + src.nodes().length + k;
      for (let i = 0; i < s.t.length; i++) expect(Math.fround(Number(rows[i + 1][col]))).toBe(s.v[i]);
    });
  });
  it("has strictly increasing time and a constant column count", () => {
    const src = source();
    setClock(src, 90);
    const rows = parse(traceCsv(src));
    const t = rows.slice(1).map(r => Number(r[0]));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    for (const r of rows) expect(r.length).toBe(rows[0].length);
    expect(t[t.length - 1] - t[0]).toBeLessThanOrEqual(30 + 1e-3);
  });
  it("writes one row per beat with the beat's numbers", () => {
    const src = source();
    const rows = parse(beatsCsv(src, 5));
    const b = src.beats(5);
    expect(rows[0]).toEqual(beatColumns(src.nodes()));
    expect(rows.length - 1).toBe(b.length);
    const col = (name: string) => rows[0].indexOf(name);
    expect(Number(rows[1][col("lv_stroke_volume_ml")])).toBe(b[0].strokeVolume);
    expect(Number(rows[1][col("LV_edv_ml")])).toBe(b[0].edv.LV);
    expect(Number(rows[1][col("AO_max_mmHg")])).toBeCloseTo(Math.max(...b[0].pressure.AO), 4);
    expect(Number(rows[1][col("AO_min_mmHg")])).toBeCloseTo(Math.min(...b[0].pressure.AO), 4);
    expect(Number(rows[1][col("hr_bpm")])).toBeCloseTo(60 / b[0].rr, 6);
    for (const r of rows) expect(r.length).toBe(rows[0].length);
  });
});

describe("step one beat", () => {
  it("finds the first beat strictly after now", () => {
    expect(nextBeatTime([1, 2, 3], 1.5)).toBe(2);
    expect(nextBeatTime([3, 1, 2], 0)).toBe(1);
    expect(nextBeatTime([1, 2, 3], 3)).toBeNull();
    expect(nextBeatTime([], 0)).toBeNull();
  });
  it("treats a beat at now as already delivered, so the next step moves on", () => {
    expect(nextBeatTime([1, 1.8], 1)).toBe(1.8);
    expect(nextBeatTime([1, 1.8], 1 - 1e-9)).toBe(1.8);
  });
  it("ignores non-finite times", () => {
    expect(nextBeatTime([NaN, Infinity, 2], 0)).toBe(2);
  });

  const stepping = (): ClockState => ({ ...initialClock(), stepping: true, stepBudget: 5 });
  const beats = [10.8, 11.6, 12.4];
  it("lands exactly on the beat and pauses", () => {
    let s = stepping(), now = 10.5, frames = 0;
    while (!s.paused && frames++ < 100) {
      const r = advanceClock(s, 0.05, now, () => beats);
      now += r.dt; s = r.state;
    }
    expect(s.paused).toBe(true);
    expect(s.stepping).toBe(false);
    expect(now).toBeCloseTo(10.8, 12);
    // a further frame while paused advances nothing
    expect(advanceClock(s, 0.05, now, () => beats).dt).toBe(0);
  });
  it("one step advances one beat, however many are queued", () => {
    const clock = new PlayClock();
    let now = 10.8; // sitting on a beat after a previous step
    clock.stepBeat();
    for (let i = 0; i < 200 && !clock.paused; i++) now += clock.advance(0.05, now, () => beats);
    expect(now).toBeCloseTo(11.6, 12);
  });
  it("honours slow motion and gives up when no beat is known", () => {
    const slow = { ...stepping(), scale: 0.25 };
    expect(advanceClock(slow, 0.04, 10.5, () => beats).dt).toBeCloseTo(0.01, 12);
    let s = stepping(), now = 0, frames = 0;
    while (!s.paused && frames++ < 1000) { const r = advanceClock(s, 0.05, now, () => []); now += r.dt; s = r.state; }
    expect(s.paused).toBe(true);
    expect(now).toBeLessThanOrEqual(5.05);
  });
});

describe("play clock", () => {
  it("pauses, resumes and scales time", () => {
    const c = new PlayClock(), up = () => [] as number[];
    expect(c.advance(0.05, 0, up)).toBe(0.05);
    c.pause();
    expect(c.paused).toBe(true);
    expect(c.advance(0.05, 0, up)).toBe(0);
    c.resume();
    c.setScale(0.5);
    expect(c.advance(0.05, 0, up)).toBeCloseTo(0.025, 12);
    c.setScale(-1);
    c.setScale(NaN);
    expect(c.scale).toBe(0.5);
  });
  it("notifies when the pause state changes, including a step ending", () => {
    const c = new PlayClock();
    let n = 0;
    c.subscribe(() => n++);
    c.stepBeat();
    const before = n;
    c.advance(1, 0, () => [0.1]);
    expect(c.paused).toBe(true);
    expect(n).toBe(before + 1);
  });
});

describe("snapshot delta text", () => {
  it("signs differences at the row's decimals", () => {
    expect(deltaText(80, 100, 0)).toBe("−20");
    expect(deltaText(5.04, 4.5, 1)).toBe("+0.5");
    expect(deltaText(0.5, 0.5, 1)).toBe("0");
    expect(deltaText(NaN, 1, 0)).toBe("–");
  });
});
