import "./shell.css";
import { Account, LiveLink, LiveStatus } from "../live";
import type { Scenario } from "../sim/scenario";

/** What the simulator page hands in so its tools can run on the patient on screen. Pages without a patient pass nothing. */
export interface AiHooks {
  run: (tool: string, args: Record<string, unknown>) => unknown;
  restore: (scenario: Scenario) => void;
  version: string;
}
export interface AiHandle {
  account: Account;
  live: LiveLink | null;
  /** Show or hide the whole control (the game hides it: an AI on the line could read the lesion). */
  setHidden(hidden: boolean): void;
  /** Say something in the panel's status line for a while (the simulator uses it when it picks up a saved patient). */
  note(text: string): void;
  /** Load the account and, on the simulator, open the live line. */
  start(opts?: { paused?: boolean }): Promise<void>;
}

const LIVE_LABEL: Record<LiveStatus["state"], string> = { off: "AI paused", connecting: "Connecting…", open: "AI ready", retrying: "Reconnecting…", replaced: "In another tab", signedout: "Connect AI" };
const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub", dev: "Development account" };

const MARKUP = `
<button type="button" class="ai-btn" aria-expanded="false" aria-haspopup="dialog"><i class="ai-dot"></i><span class="ai-sum">Connect AI</span></button>
<section class="ai-panel" hidden role="dialog" aria-label="Connect your AI">
  <div class="ai-top"><h2>Connect your AI</h2><button type="button" class="ai-x" aria-label="Close">
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></div>
  <p class="ai-lede">Your AI reads the monitor, changes the patient and draws the heart and ECG right in the chat.</p>
  <a class="ai-primary" target="_blank" rel="noopener">Add to Claude<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l6-6M6 5h5v5"/></svg></a>
  <p class="ai-status" role="status"></p>
  <div class="ai-sec">
    <h3>Other apps</h3>
    <div class="ai-tabs" role="tablist">
      <button type="button" role="tab" data-app="chatgpt" aria-selected="true">ChatGPT</button><button type="button" role="tab" data-app="code" aria-selected="false">Claude Code</button><button type="button" role="tab" data-app="any" aria-selected="false">Any MCP app</button>
    </div>
    <p class="ai-how"></p>
    <div class="ai-url"><code></code><button type="button" class="ai-copy">Copy</button></div>
  </div>
  <div class="ai-sec ai-out">
    <h3>Sign in first</h3>
    <div class="ai-providers"></div>
    <p class="ai-fine">One sign-in covers every CoroSim page and your AI. We keep your name, email and patient, nothing else. <a class="ai-privacy" href="privacy.html">Privacy</a></p>
  </div>
  <div class="ai-sec ai-in" hidden>
    <div class="ai-who"><h3>Signed in</h3><b class="ai-name"></b></div>
    <p class="ai-fine ai-connected"></p>
    <div class="ai-acts"><button type="button" class="ai-disconnect">Disconnect AIs</button><button type="button" class="ai-signout">Sign out</button><a href="#" class="ai-del">Delete account</a></div>
  </div>
</section>`;

/** The one Connect-your-AI control, identical on every page: a pill in the header and the panel under it. */
export function mountAi(host: HTMLElement, root: string, hooks?: AiHooks): AiHandle {
  host.classList.add("ai");
  host.innerHTML = MARKUP;
  const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
  const btn = q<HTMLButtonElement>(".ai-btn"), panel = q(".ai-panel");
  q<HTMLAnchorElement>(".ai-privacy").href = root + "privacy.html";

  const account = new Account();
  let restored: { at: number; text: string } | null = null;
  let app: "chatgpt" | "code" | "any" = "chatgpt";

  const open = (on: boolean) => { panel.hidden = !on; btn.setAttribute("aria-expanded", String(on)); };
  btn.addEventListener("click", () => open(panel.hidden));
  q(".ai-x").addEventListener("click", () => { open(false); btn.focus(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { open(false); btn.focus(); } });
  addEventListener("pointerdown", (e) => { const t = e.target as Node; if (!panel.hidden && !host.contains(t)) open(false); });

  function otherApp() {
    const url = account.connectorUrl;
    const [how, copy] = app === "chatgpt" ? ["Settings → Apps & Connectors → Advanced → Developer mode. Create a connector, paste this URL and sign in.", url]
      : app === "code" ? ["Run this, then type /mcp in Claude Code to sign in.", `claude mcp add --transport http corosim ${url}`]
      : ["Add this as a remote (HTTP) MCP server. It asks you to sign in.", url];
    q(".ai-how").textContent = how; q(".ai-url code").textContent = copy;
    for (const b of host.querySelectorAll<HTMLButtonElement>(".ai-tabs button")) b.setAttribute("aria-selected", String(b.dataset.app === app));
  }
  q(".ai-tabs").addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("button")?.dataset.app as typeof app | undefined;
    if (a) { app = a; otherApp(); }
  });

  function render(st: LiveStatus | null) {
    const signedIn = !!account.user;
    q(".ai-out").hidden = signedIn; q(".ai-in").hidden = !signedIn;
    q<HTMLAnchorElement>(".ai-primary").href = account.claudeInstallUrl;
    otherApp();
    const providers = q(".ai-providers");
    if (!signedIn) {
      const html = account.providers.map((p) => `<button type="button" data-provider="${p}">${PROVIDER_LABEL[p] ?? p}</button>`).join("")
        || `<p class="ai-fine" style="margin:0">Cannot reach the CoroSim server to sign in right now.</p>`;
      if (providers.innerHTML !== html) providers.innerHTML = html;
    } else {
      q(".ai-name").textContent = account.user!.name ?? account.user!.email ?? "you";
      q(".ai-connected").textContent = account.connected.length ? `Connected: ${account.connected.join(", ")}` : "No AI connected yet";
    }
    const fresh = restored && Date.now() - restored.at < 30_000; // say so for a while: the status line updates often
    let text = "", tone = "", label: string, cls = "";
    if (st) {
      const who = st.lastClient ? st.lastClient.replace(/-/g, " ") : "Your AI";
      [text, tone] = st.state === "open"
        ? st.clients ? [`${who} is working with this patient${st.lastTool ? ` · last: ${st.lastTool.replace("corosim_", "")}` : ""}.`, "ok"] : ["Ready. Ask your AI about this patient; it works here while this page is open, and on your saved patient when it is not.", ""]
        : st.state === "replaced" ? ["Your AI is working with CoroSim in another tab.", "bad"]
        : st.state === "off" || st.state === "signedout" ? ["", ""] : [st.detail ?? "Connecting to the CoroSim server…", "warn"];
      const working = st.state === "open" && st.clients > 0;
      label = !signedIn ? "Connect AI" : working ? `${who} connected` : LIVE_LABEL[st.state];
      cls = !signedIn ? "" : st.state === "open" ? "live" : st.state === "replaced" ? "bad" : st.state === "connecting" || st.state === "retrying" ? "wait" : "";
    } else {
      // A page with no patient of its own: the AI works on the saved one, so there is no line to open here.
      if (signedIn) text = "Your AI works on your saved patient. Open the simulator to watch it change live.";
      label = !signedIn ? "Connect AI" : account.connected.length ? "AI connected" : "Add your AI";
      cls = signedIn && account.connected.length ? "live" : "";
    }
    q(".ai-status").textContent = fresh ? restored!.text : text;
    q(".ai-status").className = "ai-status " + (fresh ? "ok" : tone);
    q(".ai-sum").textContent = label;
    btn.className = "ai-btn " + cls;
  }

  const live = hooks ? new LiveLink(account, hooks.run, (s) => render(s), (sc) => hooks.restore(sc), hooks.version) : null;

  q(".ai-providers").addEventListener("click", (e) => { const p = (e.target as HTMLElement).closest("button")?.dataset.provider; if (p) account.signIn(p); });
  q(".ai-signout").addEventListener("click", async () => { live?.close(); await account.signOut(); render(live?.status ?? null); });
  q(".ai-disconnect").addEventListener("click", async () => {
    if (!confirm("Disconnect every AI from your CoroSim account? They will ask you to sign in again.")) return;
    try { await account.disconnectAIs(); } catch (e) { alert((e as Error).message); }
    render(live?.status ?? null);
  });
  q(".ai-del").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Delete your CoroSim account? This removes your saved patient and every AI connection, and cannot be undone. The patient on this page stays until you leave it.")) return;
    live?.close();
    try { await account.deleteAccount(); } catch (err) { alert((err as Error).message); }
    render(live?.status ?? null);
  });
  q(".ai-copy").addEventListener("click", async () => {
    const f = q(".ai-url code"), b = q(".ai-copy");
    try { await navigator.clipboard.writeText(f.textContent ?? ""); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 2000); }
    catch { getSelection()?.selectAllChildren(f); }
  });

  let hidden = false, paused = false;
  async function start(opts: { paused?: boolean } = {}) {
    paused = !!opts.paused;
    await account.load();
    if (live && account.user && !hidden && !paused) live.open(); else render(live?.status ?? null);
    setInterval(async () => { if (account.user) { await account.refresh(); render(live?.status ?? null); } }, 60_000);
    // Back from connecting Claude in another tab: that sign-in counts here too, with no second sign-in.
    addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || account.user || hidden || !(await account.pickUp())) return;
      await account.refresh();
      if (live && account.user) live.open(); else render(live?.status ?? null);
    });
  }
  render(live?.status ?? null);
  return {
    account, live,
    setHidden(h) { hidden = h; host.hidden = h; if (h) open(false); },
    note(text) { restored = { at: Date.now(), text }; render(live?.status ?? null); },
    start,
  };
}
