import { CrossLink, crossLinks, PageId } from "../sim/crossLinks";
import type { PatientSpec } from "../sim/patient";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface CrossLinkRow { refresh(): void; repoint(): void }

/**
 * A small "Open in…" row of links on a page that has a patient (task P14). The hrefs are rebuilt from `patient()` when a link is
 * about to be used (pointer, focus, touch, context menu), so they always carry what is on screen without re-encoding every frame;
 * `refresh()` rebuilds the row itself (after the patient's heart changes which links apply). With `hidden` true (the game: a link
 * would show the culprit) the row is empty and hidden. `skip` leaves out pages the host already links elsewhere.
 */
export function mountCrossLinks(el: HTMLElement, from: PageId, root: string, patient: () => PatientSpec | null, opts: { skip?: PageId[]; hidden?: () => boolean } = {}): CrossLinkRow {
  const build = (): CrossLink[] => {
    const p = patient();
    return !p || opts.hidden?.() ? [] : crossLinks(from, p, root).filter((l) => !opts.skip?.includes(l.page));
  };
  function refresh() {
    const links = build();
    el.classList.add("xlinks"); el.hidden = links.length === 0;
    el.innerHTML = links.length ? `<span class="xlinks-lead">Open this patient in</span>` + links.map((l) =>
      `<a class="xlink" data-page="${l.page}" data-carries="${l.carries}" href="${esc(l.href)}" title="${esc(l.note)}">${esc(l.label.replace(/^Open in /, ""))}<span aria-hidden="true">→</span></a>`).join("") : "";
  }
  /** Point each link at the patient now on screen, in place. */
  function repoint() {
    const links = build();
    for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a.xlink"))) { const l = links.find((x) => x.page === a.dataset.page); if (l) a.href = l.href; }
  }
  for (const ev of ["pointerdown", "focusin", "mouseover", "contextmenu", "touchstart", "keydown"]) el.addEventListener(ev, repoint);
  refresh();
  return { refresh, repoint };
}
