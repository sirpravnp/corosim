// ---------------------------------------------------------------- the settings dock: one tabbed place for every control
import { $ } from "./state";
import type { MountId } from "../panels/playgroundControls";

const tabs = () => [...document.querySelectorAll<HTMLButtonElement>("#dock .dtab")];
const visible = (b: HTMLElement) => b.getClientRects().length > 0;

/** Show one tab of the dock (Patient · Rhythm · Coronary · Valves · Support · Display). */
export function setDockTab(t: string) {
  $("dock").dataset.tab = t;
  for (const b of tabs()) { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
}
/** Keep a tab that is hidden (the game shows only some) from staying selected. Cheap; the frame loop calls it. */
export function dockUi() {
  const cur = $("dock").dataset.tab, on = tabs().find((b) => b.dataset.tab === cur);
  if (on && visible(on)) return;
  const first = tabs().find(visible);
  if (first) setDockTab(first.dataset.tab!);
}
/** Put the patient editor's groups in their tabs and wire the tab buttons (arrow keys move between tabs). */
export function mountDock(mounts: Record<MountId, HTMLElement>) {
  $("dpane-patient").append(mounts.patient); $("dpane-valves").append(mounts.valves); $("dpane-support").append(mounts.support);
  const all = tabs();
  for (const b of all) {
    b.addEventListener("click", () => setDockTab(b.dataset.tab!));
    b.addEventListener("keydown", (e) => {
      const vis = all.filter(visible), k = vis.indexOf(b), d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d || k < 0) return;
      const n = vis[(k + d + vis.length) % vis.length]; setDockTab(n.dataset.tab!); n.focus(); e.preventDefault();
    });
  }
  setDockTab("patient");
}
