import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "./db";
import { CaseSpec, validateCase, validateDraft } from "../cases/spec";

/**
 * The case library over HTTP. Published cases are public: the Cases page reads them to list and run them. Everything that writes, and the drafts,
 * need the case passcode (`COROSIM_CASE_PASSCODE`, a server secret; without it editing is off). The passcode is checked here on every request; the
 * page hiding the editor is a convenience, not the gate.
 */
export interface CaseGate { passcode?: string; take(key: string): boolean }

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export async function handleCases(
  req: IncomingMessage, res: ServerResponse, url: URL, store: Store, gate: CaseGate, who: string,
  json: (res: ServerResponse, code: number, body: unknown) => void, body: () => Promise<unknown>,
): Promise<boolean> {
  const m = url.pathname.match(/^\/cases(?:\/([^/]+))?\/?$/);
  if (!m) return false;
  const id = m[1] && decodeURIComponent(m[1]);

  // public: the published cases
  if (req.method === "GET" && !id) { json(res, 200, { cases: store.listCases(false) }); return true; }

  // everything else needs the passcode
  if (!gate.passcode) { json(res, 503, { error: "Case editing is not set up on this server." }); return true; }
  if (!gate.take(who)) { json(res, 429, { error: "Too many attempts; wait a minute." }); return true; }
  const given = String(req.headers["x-case-passcode"] ?? "");
  if (!given || !same(given, gate.passcode)) { json(res, 401, { error: "Wrong passcode." }); return true; }

  if (req.method === "GET" && id === "all") { json(res, 200, { cases: store.listCases(true) }); return true; }
  if (req.method === "POST" && id === "check") { json(res, 200, { ok: true }); return true; }
  if (req.method === "PUT" && id) {
    const spec = (await body()) as CaseSpec | undefined;
    if (!spec || typeof spec !== "object") { json(res, 400, { error: "Send the case as JSON." }); return true; }
    if (spec.id !== id) { json(res, 400, { error: "The id in the case must match the address." }); return true; }
    // A draft may be unfinished; a published case has to be complete, because everyone can play it.
    const errors = spec.published ? validateCase(spec) : validateDraft(spec);
    if (errors.length) { json(res, 422, { errors }); return true; }
    store.saveCase(id, spec, !!spec.published);
    json(res, 200, { ok: true, id, published: !!spec.published });
    return true;
  }
  if (req.method === "DELETE" && id) { const gone = store.deleteCase(id); json(res, gone ? 200 : 404, gone ? { ok: true } : { error: "No such case." }); return true; }
  json(res, 405, { error: "Not allowed." });
  return true;
}
