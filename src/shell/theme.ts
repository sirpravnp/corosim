/** Light / dark theme for every page. Preference is stored; with none set the OS scheme applies until the user toggles. */

export type Theme = "light" | "dark";

const KEY = "corosim-theme";

/** Pages where Share copies a useful view or patient link. Home and cases are not shareable this way. */
export const SHARE_PAGES = new Set(["sim", "ekg", "cath", "structural", "echo"]);

export function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch { return null; }
}

/** The theme the page is showing: a saved choice, else the OS preference (dark when unknown). */
export function resolvedTheme(): Theme {
  const saved = savedTheme();
  if (saved) return saved;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Apply a theme and remember it. */
export function applyTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

/** On load: restore a saved theme. Leave the attribute alone when none is saved so CSS can follow the OS. */
export function initTheme() {
  const saved = savedTheme();
  if (saved && typeof document !== "undefined") document.documentElement.dataset.theme = saved;
}

export function toggleTheme(): Theme {
  const next: Theme = resolvedTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

const SUN = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.8 9.6A5.5 5.5 0 0 1 6.4 3.2 5.6 5.6 0 1 0 12.8 9.6z"/></svg>`;

/** Mount the theme toggle into `host`. Syncs its label when the theme changes. */
export function mountTheme(host: HTMLElement): { sync: () => void } {
  initTheme();
  host.classList.add("theme");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-btn";
  host.replaceChildren(btn);

  const sync = () => {
    const now = resolvedTheme();
    const next: Theme = now === "light" ? "dark" : "light";
    btn.innerHTML = `${next === "light" ? SUN : MOON}<span class="theme-label">${next === "light" ? "Light" : "Dark"}</span>`;
    btn.setAttribute("aria-label", `Switch to ${next} theme`);
    btn.title = `Switch to ${next} theme`;
  };
  sync();
  btn.addEventListener("click", () => { toggleTheme(); sync(); });
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!savedTheme()) sync(); });
  }
  return { sync };
}
