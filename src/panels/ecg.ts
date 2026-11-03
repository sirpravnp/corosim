/** The "ECG" panel: the Simulator page's twelve-lead strip with its ST map. app.ts steps and draws it each frame. */
import type { Panel, PanelDef } from "./panel";
import { createAdopter } from "./adopt";

/** The ECG figure: the strip's canvas and the ST map under it. */
export const findEcg = (): HTMLElement | null => document.getElementById("ecg")?.closest("figure") ?? null;

export const ecgPanel: PanelDef = {
  id: "ecg",
  title: "ECG",
  defaultOn: true,
  wide: true,
  create(): Panel {
    const a = createAdopter(findEcg);
    return {
      id: "ecg",
      title: "ECG",
      mount(el) { a.attach(el); },
      draw() { /* the strip draws itself in the page's frame loop */ },
      dispose() { a.release(); },
    };
  },
};
