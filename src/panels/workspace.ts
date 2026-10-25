/**
 * The panel workspace (docs/HEMODYNAMICS_CORE.md §4G): a grid of panel cards on wide screens, a tab strip on phones,
 * a "Panels" picker, one animation-frame loop that draws only visible panels. Layout logic is in ./layout (DOM-free).
 */
import "./workspace.css";
import type { HemoSource } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { createPlaygroundBar, type PlaygroundBar } from "./playgroundBar";
import { snapshots, type SnapshotStore } from "./snapshots";
import type { PlayClock } from "./timeControl";
import {
  PHONE_MAX_WIDTH, loadLayout, pickerItems, saveLayout, setActive, setPanelOn, visibleIds, type LayoutState,
} from "./layout";

/** Optional page hooks: the simulation clock's play controls (absent in tests), and the snapshot store panels share. */
export interface WorkspaceOptions { clock?: PlayClock; snapshots?: SnapshotStore }

interface Live { panel: Panel; card: HTMLElement; tab: HTMLButtonElement }

export class Workspace {
  private layout: LayoutState;
  private live = new Map<string, Live>();
  private phone = false;
  private raf = 0;
  private ro?: ResizeObserver;
  private bar = document.createElement("div");
  private tabs = document.createElement("div");
  private grid = document.createElement("div");
  private menu = document.createElement("div");
  private pickBtn = document.createElement("button");
  private tools: PlaygroundBar;

  constructor(private root: HTMLElement, private defs: readonly PanelDef[], private source: HemoSource, opts: WorkspaceOptions = {}) {
    this.layout = loadLayout(defs);
    root.classList.add("ws");
    this.bar.className = "ws-bar";
    this.tabs.className = "ws-tabs";
    this.tabs.setAttribute("role", "tablist");
    this.grid.className = "ws-grid";
    this.menu.className = "ws-menu";
    this.menu.hidden = true;
    this.pickBtn.textContent = "Panels";
    this.pickBtn.setAttribute("aria-haspopup", "true");
    this.pickBtn.setAttribute("aria-expanded", "false");
    this.pickBtn.addEventListener("click", () => this.toggleMenu());
    const pick = document.createElement("div");
    pick.className = "ws-pick";
    pick.append(this.pickBtn, this.menu);
    this.tools = createPlaygroundBar(source, opts.clock, opts.snapshots ?? snapshots);
    this.bar.append(this.tabs, this.tools.el, pick);
    root.append(this.bar, this.grid);
    document.addEventListener("click", e => { if (!pick.contains(e.target as Node)) this.toggleMenu(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") this.toggleMenu(false); });
    this.phone = this.isPhone();
    this.sync();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(root);
    } else addEventListener("resize", () => this.onResize());
    this.raf = requestAnimationFrame(this.frame);
  }

  setSource(source: HemoSource): void {
    this.source = source;
    this.tools.setSource(source);
    for (const l of this.live.values()) l.panel.setSource?.(source);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.tools.dispose();
    for (const l of this.live.values()) l.panel.dispose();
    this.live.clear();
  }

  private isPhone(): boolean { return (this.root.clientWidth || innerWidth) < PHONE_MAX_WIDTH; }

  private update(next: LayoutState): void {
    this.layout = next;
    saveLayout(next);
    this.sync();
  }

  /** Bring the DOM in line with the layout: create/dispose panels, order cards, tabs, picker, visibility. */
  private sync(): void {
    const byId = new Map(this.defs.map(d => [d.id, d]));
    for (const [id, l] of [...this.live]) {
      if (!this.layout.on.includes(id)) { l.panel.dispose(); l.card.remove(); l.tab.remove(); this.live.delete(id); }
    }
    for (const id of this.layout.on) {
      if (this.live.has(id)) continue;
      const def = byId.get(id)!;
      const panel = def.create();
      const card = document.createElement("section");
      card.className = "ws-card";
      const head = document.createElement("header");
      const h = document.createElement("h2");
      h.textContent = def.title;
      const x = document.createElement("button");
      x.className = "ws-x";
      x.textContent = "×";
      x.setAttribute("aria-label", `Close ${def.title}`);
      x.addEventListener("click", () => this.update(setPanelOn(this.layout, id, false, this.defs)));
      head.append(h, x);
      const body = document.createElement("div");
      body.className = "ws-body";
      card.append(head, body);
      const tab = document.createElement("button");
      tab.className = "ws-tab";
      tab.setAttribute("role", "tab");
      tab.textContent = def.title;
      tab.addEventListener("click", () => this.update(setActive(this.layout, id)));
      this.live.set(id, { panel, card, tab });
      panel.mount(body, this.source);
    }
    // order follows the layout
    for (const id of this.layout.on) { const l = this.live.get(id)!; this.grid.append(l.card); this.tabs.append(l.tab); }
    const vis = new Set(visibleIds(this.layout, this.phone));
    for (const [id, l] of this.live) {
      l.card.hidden = !vis.has(id);
      l.tab.classList.toggle("on", id === this.layout.active);
      l.tab.setAttribute("aria-selected", String(id === this.layout.active));
    }
    this.root.classList.toggle("ws-phone", this.phone);
    this.root.classList.toggle("ws-empty", this.layout.on.length === 0);
    this.renderMenu();
    requestAnimationFrame(() => { for (const id of vis) this.live.get(id)?.panel.resize?.(); });
  }

  private renderMenu(): void {
    this.menu.replaceChildren(...pickerItems(this.layout, this.defs).map(it => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = it.checked;
      cb.addEventListener("change", () => this.update(setPanelOn(this.layout, it.id, cb.checked, this.defs)));
      label.append(cb, document.createTextNode(it.title));
      return label;
    }));
  }

  private toggleMenu(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.pickBtn.setAttribute("aria-expanded", String(open));
  }

  private onResize(): void {
    const phone = this.isPhone();
    if (phone !== this.phone) { this.phone = phone; this.sync(); return; }
    for (const id of visibleIds(this.layout, this.phone)) this.live.get(id)?.panel.resize?.();
  }

  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.root.getClientRects().length) return; // the section is hidden (the game page, or a closed tab)
    const now = this.source.now();
    for (const id of visibleIds(this.layout, this.phone)) this.live.get(id)?.panel.draw(now);
  };
}

export function mountWorkspace(root: HTMLElement, defs: readonly PanelDef[], source: HemoSource, opts?: WorkspaceOptions): Workspace {
  return new Workspace(root, defs, source, opts);
}
