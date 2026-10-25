/** The "Monitor" panel: the Simulator page's bedside readout table (rhythm, rate, pressure, output, ST). app.ts writes it. */
import type { Panel, PanelDef } from "./panel";
import { createAdopter } from "./adopt";

/** The monitor's section, found through one of its cells so the page's markup stays the single source. */
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
      draw() { /* app.ts's frame loop updates the readouts */ },
      dispose() { a.release(); },
    };
  },
};
