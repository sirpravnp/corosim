import type { Panel, PanelDef } from "../panels/panel";
import { $ } from "./state";

/**
 * The perfusion / ischemia table as a workspace panel (it was Table 1 under the 3D view). The page's frame loop (`liveUi`) still
 * fills `#beds`; this panel only gives that element a home in a card the user can open, close and tab to. One table, not two:
 * the element moves into the card and back to its figure (which the game page still shows) when the panel closes.
 */
function create(): Panel {
  let home: HTMLElement | null = null, kids: Element[] = [];
  return {
    id: "ischemia", title: "Ischemia by bed",
    mount(el) {
      home = $("bedsfig"); kids = [...home.children];
      el.append(...kids);
    },
    draw() { /* liveUi fills the table */ },
    dispose() { if (home) home.append(...kids); },
  };
}
export const ischemiaPanel: PanelDef = { id: "ischemia", title: "Ischemia by bed", defaultOn: true, create };
