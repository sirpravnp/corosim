/** The "Monitor" panel: the Simulator page's bedside readout table (rhythm, rate, pressure, output, ST). app.ts writes it. */
import type { Panel, PanelDef } from "./panel";
import { createAdopter } from "./adopt";

/** The monitor's section, found through one of its cells so the page's markup stays the single source. */
/** Set by the page: redraws the monitor's vital signs. The Monitor panel calls it in the same frame as the other panels, so they read the same snapshot. */
export const monitorHooks: { draw: (() => void) | null; rows: Set<string> | null } = { draw: null, rows: null };

/** Rows that stay in a case session whatever the monitor lists: the circulation state and the rhythm are what the bedside always shows. */
export const ALWAYS_ROWS: readonly string[] = ["circulation", "rhythm"];
/**
 * Whether a row of the Monitor table is hidden. `rows` null (the ordinary Simulator page) hides nothing. In a case session only the rows the
 * monitor lists and the always-shown ones remain: every other row (output, ischemia, FFR, ST, infarct, atrial rate, PR) gives information for free.
 */
export function monitorRowHidden(rowId: string | null, rows: Set<string> | null): boolean {
  if (!rows) return false;
  if (!rowId) return true;
  return !(rows.has(rowId) || ALWAYS_ROWS.includes(rowId));
}
/** Hide or show the page's rows (`tr`) to match `monitorHooks.rows`. */
export function applyMonitorRows(): void {
  const rows = monitorHooks.rows;
  for (const tr of document.getElementById("bp")?.closest("table")?.querySelectorAll<HTMLElement>("tr") ?? []) tr.hidden = monitorRowHidden(tr.dataset.row ?? null, rows);
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
