/**
 * Workspace layout state, DOM-free so tests can reach it: which panels are on, in what order, and how that is
 * remembered. Storage is injected and every access is wrapped in try/catch; the page works without it.
 */
import type { PanelDef } from "./panel";

export interface LayoutState { on: string[]; active: string | null } // `active`: the visible tab on phones

export const LAYOUT_KEY = "corosim.panels.v1";
export const PHONE_MAX_WIDTH = 900; // below this, tabs

export function defaultLayout(defs: readonly PanelDef[]): LayoutState {
  const on = defs.filter(d => d.defaultOn).map(d => d.id);
  return { on, active: on[0] ?? null };
}

/** Make any value (a saved blob, or garbage) into a layout that only names known panels, once each. */
export function sanitizeLayout(raw: unknown, defs: readonly PanelDef[]): LayoutState {
  const known = new Set(defs.map(d => d.id));
  const r = raw as { on?: unknown; active?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.on)) return defaultLayout(defs);
  const on: string[] = [];
  for (const id of r.on) if (typeof id === "string" && known.has(id) && !on.includes(id)) on.push(id);
  const active = typeof r.active === "string" && on.includes(r.active) ? r.active : on[0] ?? null;
  return { on, active };
}

/** Turn a panel on (appended to the end) or off. Unknown ids are ignored. */
export function setPanelOn(s: LayoutState, id: string, on: boolean, defs: readonly PanelDef[]): LayoutState {
  if (!defs.some(d => d.id === id)) return s;
  const has = s.on.includes(id);
  if (on === has) return s;
  const next = on ? [...s.on, id] : s.on.filter(x => x !== id);
  let active = s.active;
  if (on && active === null) active = id;
  if (!on && active === id) active = next[0] ?? null;
  return { on: next, active };
}

export function setActive(s: LayoutState, id: string): LayoutState {
  return s.on.includes(id) ? { on: s.on, active: id } : s;
}

/** Picker rows: every panel with its checkbox state. */
export function pickerItems(s: LayoutState, defs: readonly PanelDef[]): { id: string; title: string; checked: boolean }[] {
  return defs.map(d => ({ id: d.id, title: d.title, checked: s.on.includes(d.id) }));
}

/** The panels to draw this frame: on, and (on phones) only the active tab. */
export function visibleIds(s: LayoutState, phone: boolean): string[] {
  return phone ? (s.active ? [s.active] : []) : s.on;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): KV | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadLayout(defs: readonly PanelDef[], store: KV | null = defaultStorage()): LayoutState {
  try {
    const s = store?.getItem(LAYOUT_KEY);
    if (s) return sanitizeLayout(JSON.parse(s), defs);
  } catch { /* unavailable or corrupt: fall through */ }
  return defaultLayout(defs);
}

export function saveLayout(s: LayoutState, store: KV | null = defaultStorage()): void {
  try { store?.setItem(LAYOUT_KEY, JSON.stringify(s)); } catch { /* private window, quota */ }
}
