/** The "Monitor" panel: the Simulator page's bedside readout table (rhythm, rate, pressure, output, ST). app.ts writes it. */
import type { Panel, PanelDef } from "./panel";
import { createAdopter } from "./adopt";

/** The monitor's section, found through one of its cells so the page's markup stays the single source. */
/** Set by the page: redraws the monitor's vital signs. The Monitor panel calls it in the same frame as the other panels, so they read the same snapshot. */
export const monitorHooks: { draw: (() => void) | null; rows: Set<string> | null } = { draw: null, rows: null };

export const MONITOR_ROWS = ["hr", "bp", "spo2", "rr", "temp"] as const;
/** Which vital-sign rows show. `rows` null shows all; otherwise only the ids in it. */
export function monitorRowVisibility(rows: Set<string> | null): Record<(typeof MONITOR_ROWS)[number], boolean> {
  return Object.fromEntries(MONITOR_ROWS.map((id) => [id, !rows || rows.has(id)])) as Record<(typeof MONITOR_ROWS)[number], boolean>;
}
/** Hide or show the page's rows (`tr[data-row]`) to match `monitorHooks.rows`. */
export function applyMonitorRows(): void {
  const vis = monitorRowVisibility(monitorHooks.rows);
  for (const id of MONITOR_ROWS) { const tr = document.querySelector<HTMLElement>(`tr[data-row="${id}"]`); if (tr) tr.hidden = !vis[id]; }
}

export const findMonitor = (): HTMLElement | null => document.getElementById("bp")?.closest("section") ?? null;

export const monitorPanel: PanelDef = {
  id: "monitor",
  title: "Monitor",
  defaultOn: true,
  create(): Panel {
    const a = createAdopter(findMonitor);
    return {
      id: "monitor",
      title: "Monitor",
      mount(el) { a.attach(el); },
      draw() { applyMonitorRows(); monitorHooks.draw?.(); /* the rest is updated by the page's frame loop */ },
      dispose() { a.release(); },
    };
  },
};
