import { mountShare } from "./share";
import { AiHandle, AiHooks, mountAi } from "./ai";
import { SHARE_PAGES, mountTheme } from "./theme";

export interface ShellPage { id: string; label: string; path: string; blurb: string }
/** Every page of the site, in menu order. A new page (echo, structural) is one line here. */
export const PAGES: ShellPage[] = [
  { id: "sim", label: "simulator", path: "sim/", blurb: "The 3D heart, ECG and monitor" },
  { id: "cases", label: "cases", path: "cases/", blurb: "Patients to keep alive, with decisions along the way" },
  { id: "simbook", label: "simbook", path: "simbook/", blurb: "Preclinical cardiac physiology, one idea at a time" },
  { id: "ekg", label: "EKG", path: "ekg/", blurb: "Twelve-lead rhythms and mimics" },
  { id: "cath", label: "cath lab", path: "cath/", blurb: "Angiogram and pressure wire" },
  { id: "structural", label: "structural", path: "structural/", blurb: "Valve and congenital lesions" },
  { id: "echo", label: "echo", path: "echo/", blurb: "Standard views: the probe on the 3D heart, beside a real loop" },
  { id: "lipids", label: "lipids", path: "lipids/", blurb: "Lipoproteins, receptors and lipid drugs, from gut and liver to the capillary beds" },
];

/** The one disclaimer, shown in the footer of every page and nowhere else. */
export const DISCLAIMER = "CoroSim is an educational simulation, not a medical device. Anatomy and waveforms are schematic, model constants are assumptions, and nothing here has been clinically validated or is for clinical decisions.";

/** One line pictogram per page, in the style of the product marks on a hardware maker's menu. */
const ICONS: Record<string, string> = {
  sim: `<circle cx="13" cy="13" r="10"/><path d="M13 3v10l7 7M13 13l-7 7"/>`,
  cases: `<rect x="4" y="5" width="18" height="18"/><path d="M9 5V2h8v3M13 10v8M9 14h8"/>`,
  simbook: `<path d="M5 3h12v20H5z"/><path d="M5 3c-1.5 0-2.5 1-2.5 2.5v15c0 1.5 1 2.5 2.5 2.5"/><path d="M9 8h5M9 12h5M9 16h3"/>`,
  ekg: `<path d="M1 14h6l3-9 4 17 3-8h8"/>`,
  cath: `<path d="M4 22A18 18 0 0 1 22 4"/><path d="M4 22A11 11 0 0 1 15 11"/><circle cx="4" cy="22" r="2"/>`,
  structural: `<rect x="3" y="3" width="20" height="20"/><path d="M3 3l20 20M13 3v20"/>`,
  echo: `<path d="M13 3L3 23h20z"/><path d="M13 3v20M8 13h10"/>`,
  lipids: `<circle cx="13" cy="13" r="8"/><circle cx="13" cy="13" r="3"/><path d="M13 2v3M13 21v3M2 13h3M21 13h3"/>`,
};
export const icon = (id: string) => `<svg viewBox="0 0 26 26" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${ICONS[id] ?? ""}</svg>`;

export interface Shell {
  ai: AiHandle;
  menuLink(id: string): HTMLAnchorElement | null;
  setPage(id: string): void;
  /** Show or hide Share; cases hide it because the URL does not carry a shareable patient. */
  setShare(on: boolean): void;
}

/**
 * The header and footer every page except the homepage shares. The page supplies `#shell-head` and `#shell-foot`
 * (empty elements) and the page it is; `root` is the path from that page to the site root ("../" from /ekg/).
 * Share mounts only when the page has a shareable view (or when `share` is passed explicitly).
 */
export function mountShell(opts: { page: string; root: string; ai?: AiHooks; share?: boolean }): Shell {
  const { root } = opts;
  const head = document.getElementById("shell-head")!, foot = document.getElementById("shell-foot")!;
  head.className = "shell-head";
  const shareOn = opts.share ?? SHARE_PAGES.has(opts.page);
  head.innerHTML = `
    <a class="shell-brand" href="${root}" aria-label="CoroSim home"><img src="${root}logo-transparent.png" alt="" width="32" height="32"><span>CoroSim</span></a>
    <nav class="shell-nav" aria-label="Pages">
      ${PAGES.map((p) => `<a data-page="${p.id}" href="${root}${p.path}" title="${p.blurb}">${icon(p.id)}<span>${p.label}</span></a>`).join("")}
    </nav>
    <div class="shell-share" ${shareOn ? "" : "hidden"}></div>
    <div class="shell-theme"></div>
    <div class="shell-ai"></div>`;
  foot.className = "shell-foot";
  foot.innerHTML = `<p>${DISCLAIMER}</p><a href="${root}privacy.html">Privacy</a>`;

  const items = () => Array.from(head.querySelectorAll<HTMLAnchorElement>(".shell-nav a"));
  const shareHost = head.querySelector<HTMLElement>(".shell-share")!;

  function setPage(id: string) {
    for (const a of items()) { const on = a.dataset.page === id; if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  }
  function setShare(on: boolean) {
    shareHost.hidden = !on;
    head.classList.toggle("no-share", !on);
    if (on && !shareHost.querySelector(".share-btn")) mountShare(shareHost);
  }
  setPage(opts.page);
  setShare(shareOn);
  mountTheme(head.querySelector<HTMLElement>(".shell-theme")!);
  const ai = mountAi(head.querySelector<HTMLElement>(".shell-ai")!, root, opts.ai);
  return { ai, setPage, setShare, menuLink: (id) => head.querySelector<HTMLAnchorElement>(`.shell-nav a[data-page="${id}"]`) };
}
