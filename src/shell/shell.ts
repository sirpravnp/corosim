import { AiHandle, AiHooks, mountAi } from "./ai";

export interface ShellPage { id: string; label: string; path: string; blurb: string }
/** Every page of the site, in menu order. A new page (echo, structural) is one line here. */
export const PAGES: ShellPage[] = [
  { id: "sim", label: "Simulator", path: "sim/", blurb: "The 3D heart, ECG and monitor" },
  { id: "game", label: "Find the culprit", path: "game/", blurb: "A daily case on the simulator" },
  { id: "ekg", label: "EKG", path: "ekg/", blurb: "Twelve-lead rhythms and mimics" },
  { id: "cath", label: "Cath lab", path: "cath/", blurb: "Angiogram and pressure wire" },
  { id: "structural", label: "Structural", path: "structural/", blurb: "Valve and congenital lesions" },
];

/** The one disclaimer, shown in the footer of every page and nowhere else. */
export const DISCLAIMER = "CoroSim is an educational simulation, not a medical device. Anatomy and waveforms are schematic, model constants are assumptions, and nothing here has been clinically validated or is for clinical decisions.";

const CHEVRON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
const CHECK = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

export interface Shell { ai: AiHandle; menuLink(id: string): HTMLAnchorElement | null; setPage(id: string): void }

/**
 * The header and footer every page except the homepage shares. The page supplies `#shell-head` and `#shell-foot`
 * (empty elements) and the page it is; `root` is the path from that page to the site root ("../" from /ekg/).
 */
export function mountShell(opts: { page: string; root: string; ai?: AiHooks }): Shell {
  const { root } = opts;
  const head = document.getElementById("shell-head")!, foot = document.getElementById("shell-foot")!;
  head.className = "shell-head";
  head.innerHTML = `
    <a class="shell-brand" href="${root}" aria-label="CoroSim home"><img src="${root}logo-transparent.png" alt="" width="32" height="32"><span>CoroSim</span></a>
    <span class="shell-sep" aria-hidden="true">/</span>
    <div class="shell-pages">
      <button type="button" class="shell-cur" aria-haspopup="menu" aria-expanded="false"><span class="shell-cur-label"></span>${CHEVRON}</button>
      <ul class="shell-menu" role="menu" hidden>
        ${PAGES.map((p) => `<li role="none"><a role="menuitem" data-page="${p.id}" href="${root}${p.path}"><span class="shell-mi"><b>${p.label}</b><small>${p.blurb}</small></span>${CHECK}</a></li>`).join("")}
      </ul>
    </div>
    <div class="shell-ai"></div>`;
  foot.className = "shell-foot";
  foot.innerHTML = `<p>${DISCLAIMER}</p><a href="${root}privacy.html">Privacy</a>`;

  const cur = head.querySelector<HTMLButtonElement>(".shell-cur")!, menu = head.querySelector<HTMLElement>(".shell-menu")!;
  const items = () => Array.from(menu.querySelectorAll<HTMLAnchorElement>("a"));
  const toggle = (on: boolean) => { menu.hidden = !on; cur.setAttribute("aria-expanded", String(on)); };
  cur.addEventListener("click", () => { toggle(menu.hidden); if (!menu.hidden) items().find((a) => a.getAttribute("aria-current"))?.focus(); });
  menu.addEventListener("keydown", (e) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
  });
  cur.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); toggle(true); items()[0].focus(); } });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { toggle(false); cur.focus(); } });
  addEventListener("pointerdown", (e) => { if (!menu.hidden && !head.querySelector(".shell-pages")!.contains(e.target as Node)) toggle(false); });

  function setPage(id: string) {
    const page = PAGES.find((p) => p.id === id);
    head.querySelector(".shell-cur-label")!.textContent = page?.label ?? "Pages";
    for (const a of items()) { const on = a.dataset.page === id; if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  }
  setPage(opts.page);

  const ai = mountAi(head.querySelector<HTMLElement>(".shell-ai")!, root, opts.ai);
  return { ai, setPage, menuLink: (id) => menu.querySelector<HTMLAnchorElement>(`a[data-page="${id}"]`) };
}
