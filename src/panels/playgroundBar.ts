/**
 * The workspace bar's playground controls (task P13): time controls, snapshots, CSV export. DOM only; the logic is in
 * ./timeControl, ./snapshots and ./csvExport.
 */
import type { HemoSource } from "../sim/hemoSource";
import { CSV_BEATS, CSV_SECONDS, beatsCsv, downloadCsv, traceCsv } from "./csvExport";
import { SLOW_SCALES, type PlayClock } from "./timeControl";
import { MAX_SNAPSHOTS, type SnapshotStore } from "./snapshots";

export interface PlaygroundBar {
  el: HTMLElement;
  setSource(s: HemoSource): void;
  dispose(): void;
}

function btn(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = text; b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function group(label: string): HTMLElement {
  const g = document.createElement("div");
  g.className = "ws-tools-group";
  g.setAttribute("role", "group");
  g.setAttribute("aria-label", label);
  return g;
}

export function createPlaygroundBar(source: HemoSource, clock: PlayClock | undefined, store: SnapshotStore): PlaygroundBar {
  let src = source;
  const el = document.createElement("div");
  el.className = "ws-tools";
  const subs: (() => void)[] = [];

  if (clock) {
    const g = group("Time controls");
    const pause = btn("Pause", "Pause the simulation: ECG, monitor, traces and 3D view stop together", () => clock.toggle());
    const step = btn("Step beat", "Advance exactly to the next ventricular beat, then pause", () => clock.stepBeat());
    g.append(pause, step);
    const scales = SLOW_SCALES.map(s => {
      const b = btn(s === 1 ? "1× beat" : `${s}×`, s === 1 ? "Heartbeats in real time" : `Slow motion: heartbeats at ${s}× real time (the clinical-minutes clock keeps its meaning)`, () => clock.setScale(s));
      return [s, b] as const;
    });
    g.append(...scales.map(([, b]) => b));
    const sync = () => {
      pause.textContent = clock.paused ? "Resume" : "Pause";
      pause.setAttribute("aria-pressed", String(clock.paused));
      for (const [s, b] of scales) b.setAttribute("aria-pressed", String(clock.scale === s));
    };
    sync();
    subs.push(clock.subscribe(sync));
    el.append(g);
  }

  {
    const g = group("Snapshots");
    const save = btn("Save snapshot", `Keep the current numbers, last beat and last 6 s of traces (up to ${MAX_SNAPSHOTS}); drawn dashed behind live data`, () => store.save(src));
    const pick = document.createElement("select");
    pick.setAttribute("aria-label", "Snapshot overlay");
    pick.style.cssText = "width:auto;min-width:0";
    pick.addEventListener("change", () => store.select(pick.value === "" ? null : Number(pick.value)));
    const clear = btn("Clear", "Remove the selected snapshot", () => { const id = store.selectedId(); if (id !== null) store.clear(id); });
    const clearAll = btn("Clear all", "Remove every snapshot", () => store.clear());
    g.append(save, pick, clear, clearAll);
    const sync = () => {
      const items = store.list(), sel = store.selectedId();
      pick.replaceChildren(...[["", items.length ? "No overlay" : "No snapshots"] as const, ...items.map(s => [String(s.id), `${s.label} · ${s.t.toFixed(1)} s`] as const)].map(([v, t]) => {
        const o = document.createElement("option"); o.value = v; o.textContent = t; return o;
      }));
      pick.value = sel === null ? "" : String(sel);
      pick.disabled = items.length === 0;
      clear.disabled = sel === null;
      clearAll.disabled = items.length === 0;
    };
    sync();
    subs.push(store.subscribe(sync));
    el.append(g);
  }

  {
    const g = group("Export");
    const stamp = () => src.now().toFixed(1);
    g.append(
      btn("Traces CSV", `Download the last ${CSV_SECONDS} s: time, every node's pressure and the chamber volumes`, () => downloadCsv(`corosim-traces-t${stamp()}.csv`, traceCsv(src))),
      btn("Beats CSV", `Download the last ${CSV_BEATS} beats with their numbers`, () => downloadCsv(`corosim-beats-t${stamp()}.csv`, beatsCsv(src))),
    );
    el.append(g);
  }

  return {
    el,
    setSource(s) { src = s; },
    dispose() { for (const u of subs) u(); subs.length = 0; el.remove(); },
  };
}
