/** The "Monitor" panel: the Simulator page's bedside readout table (rhythm, rate, pressure, output, ST). app.ts writes it. */
import type { Panel, PanelDef } from "./panel";
import { createAdopter } from "./adopt";

/** The monitor's section, found through one of its cells so the page's markup stays the single source. */
/** Set by the page: redraws the monitor's vital signs. The Monitor panel calls it in the same frame as the other panels, so they read the same snapshot. */
export const monitorHooks: { draw: (() => void) | null } = { draw: null };

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
      draw() { monitorHooks.draw?.(); /* the rest is updated by the page's frame loop */ },
      dispose() { a.release(); },
    };
  },
};
