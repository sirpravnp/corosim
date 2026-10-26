/** The Share control in the shared header: copy the page's current URL (the Simulator keeps it up to date with the patient). */

export type ShareOutcome = "shared" | "copied" | "manual" | "cancelled";

/** What the browser offers, injected so the logic runs without one. */
export interface ShareEnv {
  url: () => string;
  clipboard?: { writeText(text: string): Promise<void> };
  /** `navigator.share`; used as the click action only when `native` is true (phones). */
  share?: (data: { url: string; title?: string }) => Promise<void>;
  native?: boolean;
  title?: string;
}

/** Do the share: the phone sheet if wanted, else the clipboard, else ask for a manual copy ("manual"). */
export async function shareUrl(env: ShareEnv): Promise<ShareOutcome> {
  const url = env.url();
  if (env.native && env.share) {
    try { await env.share({ url, title: env.title }); return "shared"; }
    catch (e) { if ((e as { name?: string })?.name === "AbortError") return "cancelled"; /* else fall through to the clipboard */ }
  }
  try {
    if (!env.clipboard) return "manual";
    await env.clipboard.writeText(url);
    return "copied";
  } catch { return "manual"; }
}

const ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10V2.5M5.2 5.2L8 2.5l2.8 2.7M3.5 8.5v4h9v-4"/></svg>`;

const MARKUP = `
<button type="button" class="share-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Share this page's link">${ICON}<span class="share-label">Share</span></button>
<span class="share-live" role="status" aria-live="polite"></span>
<section class="share-pop" hidden role="dialog" aria-label="Copy link">
  <p class="share-hint">Copy this link to share this exact view.</p>
  <input class="share-url" type="text" readonly aria-label="Link">
</section>`;

/** Mount the control into `host`. `run` is the click action (exposed for tests). */
export function mountShare(host: HTMLElement, env?: Partial<ShareEnv>): { run: () => Promise<ShareOutcome> } {
  host.classList.add("share");
  host.innerHTML = MARKUP;
  const btn = host.querySelector<HTMLButtonElement>(".share-btn")!, live = host.querySelector<HTMLElement>(".share-live")!;
  const pop = host.querySelector<HTMLElement>(".share-pop")!, field = host.querySelector<HTMLInputElement>(".share-url")!;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const full: ShareEnv = {
    url: () => location.href,
    clipboard: nav?.clipboard,
    share: nav && typeof nav.share === "function" ? (d) => nav.share(d) : undefined,
    native: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    title: document.title,
    ...env,
  };
  let timer = 0;
  const say = (text: string) => { live.textContent = text; clearTimeout(timer); timer = window.setTimeout(() => { live.textContent = ""; }, 2200); };
  const close = (refocus: boolean) => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); };

  async function run(): Promise<ShareOutcome> {
    if (!pop.hidden) { close(true); return "cancelled"; }
    const out = await shareUrl(full);
    if (out === "copied") say("Link copied");
    else if (out === "shared") say("Shared");
    else if (out === "manual") {
      field.value = full.url();
      pop.hidden = false; btn.setAttribute("aria-expanded", "true");
      field.focus(); field.select();
    }
    return out;
  }
  btn.addEventListener("click", () => { void run(); });
  field.addEventListener("focus", () => field.select());
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(true); });
  addEventListener("pointerdown", (e) => { if (!pop.hidden && !host.contains(e.target as Node)) close(false); });
  return { run };
}
