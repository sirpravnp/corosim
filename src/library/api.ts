import { ALL_CASES } from "../cases";
import type { CaseDef } from "../cases/engine";
import { CaseSpec, compileCase } from "../cases/spec";
import { mcpServerUrl } from "../live";

/** One case as the landing page lists it: what to show and filter on, and what to run. */
export interface Entry {
  id: string; title: string; tier: CaseDef["tier"]; blurb: string; complaint: string; devices: string[];
  source: "builtin" | "authored"; published: boolean;
  def: CaseDef; spec?: CaseSpec;
}
const PASS_KEY = "corosim.casePasscode", PREVIEW_KEY = "corosim.casePreview";
const keep = {
  get: (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } },
  set: (s: Storage, k: string, v: string | null) => { try { v === null ? s.removeItem(k) : s.setItem(k, v); } catch { /* storage blocked: held for this visit only */ } },
};

export const NO_COMPLAINT = "Not stated";
const fromDef = (d: CaseDef): Entry => ({ id: d.id, title: d.title, tier: d.tier, blurb: d.blurb, complaint: d.complaint ?? NO_COMPLAINT, devices: d.devices ?? [], source: "builtin", published: true, def: d });
/** A draft that is not finished may not compile; it is still listed for its editor, with what it has. */
export const fromSpec = (s: CaseSpec): Entry => {
  let def: CaseDef;
  try { def = compileCase(s); } catch { def = { id: s.id, title: s.title, tier: s.tier ?? "easy", blurb: s.blurb ?? "", card: { presents: "", pmh: "" }, start: {}, checkpoints: [], points: { survive: 0, stable: 0, harm: 0 }, limitS: 0 }; }
  return { ...fromDef(def), source: "authored", published: !!s.published, spec: s };
};

export const builtinEntries = (): Entry[] => ALL_CASES.map(fromDef);

/** The passcode this tab holds (kept for the tab only, never in the address). */
export const passcode = () => keep.get(sessionStorage, PASS_KEY) ?? "";
export const forgetPasscode = () => keep.set(sessionStorage, PASS_KEY, null);

async function call<T>(path: string, init: RequestInit = {}, pass = false): Promise<{ ok: boolean; status: number; data: T }> {
  const headers: Record<string, string> = { ...(init.body ? { "content-type": "application/json" } : {}), ...(pass ? { "x-case-passcode": passcode() } : {}) };
  const r = await fetch(mcpServerUrl() + path, { ...init, headers });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as T };
}

/** Everything anyone can play: the built-in cases and those authors have published. The server being away leaves the built-in ones. */
export async function playable(): Promise<Entry[]> {
  const out = builtinEntries();
  try {
    const r = await call<{ cases: CaseSpec[] }>("/cases");
    if (r.ok) for (const s of r.data.cases ?? []) { try { out.push(fromSpec(s)); } catch { /* a stored case this build cannot read is skipped */ } }
  } catch { /* offline: built-in cases only */ }
  return out;
}

/** Authored cases including drafts, for an editor. */
export async function authored(): Promise<CaseSpec[]> {
  const r = await call<{ cases: CaseSpec[]; error?: string }>("/cases/all", {}, true);
  if (!r.ok) throw new Error(r.data.error ?? `The server answered ${r.status}.`);
  return r.data.cases;
}
/** Check a passcode with the server; on success this tab keeps it. */
export async function signIn(code: string): Promise<string | null> {
  keep.set(sessionStorage, PASS_KEY, code);
  try {
    const r = await call<{ error?: string }>("/cases/check", { method: "POST", body: "{}" }, true);
    if (r.ok) return null;
    forgetPasscode();
    return r.data.error ?? `The server answered ${r.status}.`;
  } catch { forgetPasscode(); return "Could not reach the server."; }
}
export async function saveSpec(spec: CaseSpec): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const r = await call<{ errors?: string[]; error?: string }>(`/cases/${encodeURIComponent(spec.id)}`, { method: "PUT", body: JSON.stringify(spec) }, true);
  return r.ok ? { ok: true } : { ok: false, errors: r.data.errors ?? [r.data.error ?? `The server answered ${r.status}.`] };
}
export async function deleteSpec(id: string): Promise<boolean> { return (await call(`/cases/${encodeURIComponent(id)}`, { method: "DELETE" }, true)).ok; }

/** A draft handed from the builder to the player: the player reads it once the tab opens. */
export const setPreview = (spec: CaseSpec) => keep.set(localStorage, PREVIEW_KEY, JSON.stringify(spec));
export const getPreview = (): CaseSpec | undefined => { try { const s = keep.get(localStorage, PREVIEW_KEY); return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

/** Where a case plays. */
export const playUrl = (id: string, preview = false) => `../case/?id=${encodeURIComponent(id)}${preview ? "&preview=1" : ""}`;
