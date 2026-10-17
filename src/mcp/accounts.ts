import { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { Store, User } from "./db";

/**
 * Accounts for the hosted server: sign-in with Google or GitHub, and the OAuth 2.1 authorization server that AI
 * connectors (Claude, ChatGPT, any MCP client) use to act for a signed-in person. The MCP spec's flow:
 *
 *   AI → /mcp (no token) → 401 + WWW-Authenticate: resource_metadata → /.well-known/oauth-protected-resource
 *      → /.well-known/oauth-authorization-server → POST /oauth/register (dynamic client registration)
 *      → browser: /oauth/authorize (sign in, consent) → redirect with code → POST /oauth/token (PKCE) → Bearer token
 *
 * The site (corosim.com) signs people in through the same providers: /auth/login → provider → /auth/callback →
 * back to the site with a one-time code → POST /auth/exchange → a page token for the live connection.
 */

export interface ProviderKeys { clientId: string; clientSecret: string }
export interface AccountsConfig {
  publicUrl: string; // this server's public base, e.g. https://mcp.corosim.com (OAuth issuer)
  siteOrigins: (string | RegExp)[]; // where a sign-in may return to
  github?: ProviderKeys;
  google?: ProviderKeys;
  devLogin?: boolean; // a no-provider sign-in for development; refused unless publicUrl is on localhost
  fetch?: typeof fetch; // injectable for tests
}

const SESSION_COOKIE = "corosim_session";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const b64url = (b: Buffer) => b.toString("base64url");

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 100_000) throw Object.assign(new Error("Request body too large"), { code: 413 }); chunks.push(c as Buffer); }
  const s = Buffer.concat(chunks).toString("utf8");
  if (!s) return {};
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    try { const j = JSON.parse(s); return j && typeof j === "object" ? j : {}; } catch { throw Object.assign(new Error("Invalid JSON"), { code: 400 }); }
  }
  return Object.fromEntries(new URLSearchParams(s));
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

export class Accounts {
  readonly issuer: string;
  readonly resource: string;
  private secure: boolean;
  private devAllowed: boolean;
  private fetch: typeof fetch;

  constructor(readonly store: Store, private cfg: AccountsConfig) {
    this.issuer = cfg.publicUrl.replace(/\/$/, "");
    this.resource = `${this.issuer}/mcp`;
    this.secure = this.issuer.startsWith("https://");
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(this.issuer);
    this.devAllowed = !!cfg.devLogin && local;
    this.fetch = cfg.fetch ?? fetch;
  }

  get providers(): string[] { return [...(this.cfg.google ? ["google"] : []), ...(this.cfg.github ? ["github"] : []), ...(this.devAllowed ? ["dev"] : [])]; }

  private siteAllowed(u: string): boolean {
    try { const o = new URL(u).origin; return this.cfg.siteOrigins.some((x) => (typeof x === "string" ? x === o : x.test(o))); } catch { return false; }
  }

  /** The signed-in user for an API call: an AI's OAuth access token, or the site's page token. */
  bearer(req: IncomingMessage): { user: User; via: "ai" | "page"; clientId?: string } | undefined {
    const m = String(req.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i);
    if (!m) return undefined;
    const t = this.store.tokenUser(m[1], "access");
    if (t && (!t.resource || t.resource === this.resource)) return { user: t.user, via: "ai", clientId: t.clientId };
    const u = this.store.sessionUser(m[1], "page");
    return u ? { user: u, via: "page" } : undefined;
  }

  /** The 401 an MCP client needs to find the authorization server. */
  challenge(res: ServerResponse, cors: Record<string, string>) {
    res.writeHead(401, { ...cors, "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${this.issuer}/.well-known/oauth-protected-resource"` });
    res.end(JSON.stringify({ error: "unauthorized", message: "Sign in to CoroSim to use it from an AI. Your AI client should open the sign-in page for you." }));
  }

  private webUser(req: IncomingMessage): User | undefined { return this.store.sessionUser(cookies(req)[SESSION_COOKIE], "web"); }

  private setSession(res: ServerResponse, token: string | null): string {
    const attrs = `Path=/; HttpOnly; SameSite=Lax${this.secure ? "; Secure" : ""}`;
    return token ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${30 * 86400}` : `${SESSION_COOKIE}=; ${attrs}; Max-Age=0`;
  }

  private html(res: ServerResponse, code: number, title: string, body: string, headers: Record<string, string> = {}) {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; base-uri 'none'", ...headers });
    res.end(page(title, body));
  }
  private json(res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  }
  private redirect(res: ServerResponse, to: string, headers: Record<string, string> = {}) { res.writeHead(302, { location: to, "cache-control": "no-store", ...headers }); res.end(); }

  /** CORS for the site's own calls (/auth/exchange, /auth/me…): only the allowed site origins, never "*". */
  siteCors(req: IncomingMessage): Record<string, string> {
    const o = String(req.headers.origin ?? "");
    return o && this.siteAllowed(o) ? { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", vary: "origin" } : {};
  }

  /** Handles every /auth, /oauth and /.well-known route. Returns false for anything else. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname, method = req.method ?? "GET";
    const cors = this.siteCors(req);

    // ---------------- discovery (RFC 9728, RFC 8414)
    if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") {
      this.json(res, 200, { resource: this.resource, authorization_servers: [this.issuer], bearer_methods_supported: ["header"], resource_name: "CoroSim", resource_documentation: "https://corosim.com" }, { "access-control-allow-origin": "*" });
      return true;
    }
    if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/openid-configuration") {
      this.json(res, 200, {
        issuer: this.issuer, authorization_endpoint: `${this.issuer}/oauth/authorize`, token_endpoint: `${this.issuer}/oauth/token`,
        registration_endpoint: `${this.issuer}/oauth/register`, revocation_endpoint: `${this.issuer}/oauth/revoke`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["corosim"],
      }, { "access-control-allow-origin": "*" });
      return true;
    }

    // ---------------- dynamic client registration (RFC 7591)
    if (p === "/oauth/register" && method === "POST") {
      const b = (await readBody(req)) as unknown as { client_name?: string; redirect_uris?: unknown };
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
      const ok = uris.length > 0 && uris.length <= 10 && uris.every((u) => /^https:\/\/[^\s]+$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
      if (!ok) { this.json(res, 400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or http on localhost)." }, { "access-control-allow-origin": "*" }); return true; }
      const name = String(b.client_name ?? "An AI assistant").slice(0, 80);
      const c = this.store.registerClient(name, uris);
      this.json(res, 201, { client_id: c.clientId, client_name: c.name, redirect_uris: c.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, { "access-control-allow-origin": "*" });
      return true;
    }

    // ---------------- authorization: sign in, then consent
    if (p === "/oauth/authorize" && method === "GET") {
      const q = Object.fromEntries(url.searchParams);
      const client = q.client_id ? this.store.client(q.client_id) : undefined;
      // Never redirect to an unregistered address: show the error here instead.
      if (!client || !q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) { this.html(res, 400, "Cannot connect", `<p>This connection request is not valid (unknown app or return address). Start again from your AI app.</p>`); return true; }
      const back = (err: string, desc: string) => { const r = new URL(q.redirect_uri); r.searchParams.set("error", err); r.searchParams.set("error_description", desc); if (q.state) r.searchParams.set("state", q.state); this.redirect(res, r.toString()); };
      if (q.response_type !== "code") { back("unsupported_response_type", "Only response_type=code is supported."); return true; }
      if (!q.code_challenge || q.code_challenge_method !== "S256") { back("invalid_request", "PKCE with S256 is required."); return true; }
      if (q.resource && q.resource.replace(/\/$/, "") !== this.resource) { back("invalid_target", `resource must be ${this.resource}`); return true; }
      const pending = this.store.park({ kind: "authorize", client_id: client.clientId, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state ?? "", resource: q.resource ?? "" });
      if (!this.webUser(req)) { this.redirect(res, `${this.issuer}/auth/signin?pending=${encodeURIComponent(pending)}`); return true; }
      this.redirect(res, `${this.issuer}/oauth/consent?pending=${encodeURIComponent(pending)}`);
      return true;
    }
    if (p === "/oauth/consent" && method === "GET") {
      const id = url.searchParams.get("pending") ?? "", params = this.store.parked(id), user = this.webUser(req);
      if (!params) { this.html(res, 400, "Cannot connect", `<p>This request has expired. Start again from your AI app.</p>`); return true; }
      if (!user) { this.redirect(res, `${this.issuer}/auth/signin?pending=${encodeURIComponent(id)}`); return true; }
      const client = this.store.client(params.client_id)!, host = new URL(params.redirect_uri).host;
      this.html(res, 200, "Allow access", `
        <p>Signed in as <b>${esc(user.name ?? user.email ?? "you")}</b>${user.email ? ` (${esc(user.email)})` : ""}.</p>
        <p><b>${esc(client.name)}</b> wants to use your CoroSim patient: read it, change it and run it, on your screen when CoroSim is open.</p>
        <p class="muted">It will return to ${esc(host)}. You can disconnect it at any time from CoroSim.</p>
        <form method="post" action="/oauth/consent">
          <input type="hidden" name="pending" value="${esc(id)}">
          <button name="decision" value="allow" class="primary">Allow</button>
          <button name="decision" value="deny">Cancel</button>
        </form>`);
      return true;
    }
    if (p === "/oauth/consent" && method === "POST") {
      // The session cookie is SameSite=Lax, so a cross-site form cannot post here as the user.
      const b = await readBody(req), params = this.store.parked(b.pending ?? ""), user = this.webUser(req);
      if (!params || !user) { this.html(res, 400, "Cannot connect", `<p>This request has expired, or you are signed out. Start again from your AI app.</p>`); return true; }
      this.store.unpark(b.pending);
      const r = new URL(params.redirect_uri);
      if (b.decision === "allow") {
        r.searchParams.set("code", this.store.createAuthCode({ clientId: params.client_id, userId: user.id, redirectUri: params.redirect_uri, challenge: params.code_challenge, resource: params.resource || null }));
      } else { r.searchParams.set("error", "access_denied"); r.searchParams.set("error_description", "The user declined."); }
      if (params.state) r.searchParams.set("state", params.state);
      r.searchParams.set("iss", this.issuer);
      this.redirect(res, r.toString());
      return true;
    }

    // ---------------- tokens
    if (p === "/oauth/token" && method === "POST") {
      const b = await readBody(req), cors = { "access-control-allow-origin": "*" };
      const fail = (error: string, d: string) => this.json(res, 400, { error, error_description: d }, cors);
      if (b.grant_type === "authorization_code") {
        const c = b.code ? this.store.redeemAuthCode(b.code) : undefined;
        if (!c) { fail("invalid_grant", "The code is invalid, expired or already used."); return true; }
        if (c.clientId !== b.client_id || c.redirectUri !== b.redirect_uri) { fail("invalid_grant", "client_id or redirect_uri does not match."); return true; }
        if (!b.code_verifier || b64url(createHash("sha256").update(b.code_verifier).digest()) !== c.challenge) { fail("invalid_grant", "PKCE verification failed."); return true; }
        const t = this.store.issueTokens(c.clientId, c.userId, c.resource ?? this.resource);
        this.json(res, 200, { access_token: t.access, token_type: "Bearer", expires_in: t.expiresIn, refresh_token: t.refresh, scope: "corosim" }, cors);
        return true;
      }
      if (b.grant_type === "refresh_token") {
        const t = b.refresh_token ? this.store.tokenUser(b.refresh_token, "refresh") : undefined;
        if (!t || (b.client_id && b.client_id !== t.clientId)) { fail("invalid_grant", "The refresh token is invalid or expired."); return true; }
        this.store.revokeToken(b.refresh_token); // rotate: each refresh token works once
        const n = this.store.issueTokens(t.clientId, t.user.id, t.resource);
        this.json(res, 200, { access_token: n.access, token_type: "Bearer", expires_in: n.expiresIn, refresh_token: n.refresh, scope: "corosim" }, cors);
        return true;
      }
      fail("unsupported_grant_type", "Use authorization_code or refresh_token.");
      return true;
    }
    if (p === "/oauth/revoke" && method === "POST") {
      const b = await readBody(req);
      if (b.token) this.store.revokeToken(b.token);
      res.writeHead(200, { "access-control-allow-origin": "*" }); res.end();
      return true;
    }

    // ---------------- sign-in pages and providers
    if (p === "/auth/signin" && method === "GET") {
      const pending = url.searchParams.get("pending") ?? "";
      const params = pending ? this.store.parked(pending) : undefined;
      const client = params ? this.store.client(params.client_id) : undefined;
      const ret = `/oauth/consent?pending=${encodeURIComponent(pending)}`;
      const buttons = this.providers.map((pr) => `<a class="btn" href="/auth/login?provider=${pr}&return=${encodeURIComponent(ret)}">Continue with ${pr === "github" ? "GitHub" : pr === "google" ? "Google" : "a development account"}</a>`).join("");
      this.html(res, 200, "Sign in to CoroSim", `<p>${client ? `<b>${esc(client.name)}</b> wants to connect to CoroSim.` : "Sign in to CoroSim."} An account keeps your patient and lets your AI work with it.</p>${buttons || "<p>No sign-in method is configured on this server.</p>"}<p class="muted">We keep your name, email and your simulated patient, nothing else. <a href="https://corosim.com/privacy.html">Privacy</a></p>`);
      return true;
    }
    if (p === "/auth/login" && method === "GET") {
      const provider = url.searchParams.get("provider") ?? "", ret = url.searchParams.get("return") ?? "";
      if (!this.providers.includes(provider)) { this.html(res, 400, "Sign-in", `<p>That sign-in method is not available.</p>`); return true; }
      if (!(ret.startsWith("/oauth/consent?") || this.siteAllowed(ret))) { this.html(res, 400, "Sign-in", `<p>Unknown return address.</p>`); return true; }
      const state = this.store.park({ kind: "login", provider, return: ret });
      const cb = `${this.issuer}/auth/callback/${provider}`;
      if (provider === "dev") { this.redirect(res, `${cb}?code=dev:${encodeURIComponent(url.searchParams.get("as") ?? "tester")}&state=${encodeURIComponent(state)}`); return true; }
      const q = new URLSearchParams({ client_id: provider === "github" ? this.cfg.github!.clientId : this.cfg.google!.clientId, redirect_uri: cb, state });
      if (provider === "github") { q.set("scope", "read:user user:email"); q.set("allow_signup", "true"); this.redirect(res, `https://github.com/login/oauth/authorize?${q}`); }
      else { q.set("response_type", "code"); q.set("scope", "openid email profile"); q.set("prompt", "select_account"); this.redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`); }
      return true;
    }
    const cb = p.match(/^\/auth\/callback\/(github|google|dev)$/);
    if (cb && method === "GET") {
      const provider = cb[1], state = url.searchParams.get("state") ?? "", params = this.store.parked(state);
      if (!params || params.kind !== "login" || params.provider !== provider) { this.html(res, 400, "Sign-in", `<p>This sign-in has expired. Please try again.</p>`); return true; }
      this.store.unpark(state);
      if (url.searchParams.get("error")) { this.html(res, 400, "Sign-in", `<p>Sign-in was cancelled.</p>`); return true; }
      let who: { id: string; email: string | null; name: string | null };
      try { who = await this.identify(provider, url.searchParams.get("code") ?? ""); }
      catch (e) { this.html(res, 502, "Sign-in", `<p>Could not complete sign-in: ${esc((e as Error).message)}</p>`); return true; }
      const user = this.store.upsertUser(provider, who.id, who.email, who.name);
      const cookie = this.setSession(res, this.store.createSession(user.id, "web"));
      if (params.return.startsWith("/oauth/consent?")) { this.redirect(res, `${this.issuer}${params.return}`, { "set-cookie": cookie }); return true; }
      const back = new URL(params.return); back.hash = `corosim_login=${this.store.createLoginCode(user.id)}`;
      this.redirect(res, back.toString(), { "set-cookie": cookie });
      return true;
    }

    // ---------------- the site's account API
    if (p.startsWith("/auth/") && method === "OPTIONS") { res.writeHead(204, cors); res.end(); return true; }
    if (p === "/auth/exchange" && method === "POST") {
      const b = await readBody(req), user = b.code ? this.store.redeemLoginCode(b.code) : undefined;
      if (!user) { this.json(res, 400, { error: "That sign-in link has expired. Sign in again." }, cors); return true; }
      this.json(res, 200, { token: this.store.createSession(user.id, "page"), user: { name: user.name, email: user.email, provider: user.provider } }, cors);
      return true;
    }
    const pageUser = () => { const a = this.bearer(req); return a?.via === "page" ? a.user : undefined; };
    if (p === "/auth/me" && method === "GET") {
      const u = pageUser();
      if (!u) { this.json(res, 401, { error: "signed out" }, cors); return true; }
      this.json(res, 200, { user: { name: u.name, email: u.email, provider: u.provider }, connected: this.store.connectedClients(u.id), providers: this.providers }, cors);
      return true;
    }
    if (p === "/auth/logout" && method === "POST") {
      const m = String(req.headers.authorization ?? "").match(/^Bearer\s+(\S+)$/i);
      if (m) this.store.endSession(m[1]);
      this.json(res, 200, { ok: true }, cors);
      return true;
    }
    if (p === "/auth/disconnect" && method === "POST") {
      const u = pageUser();
      if (!u) { this.json(res, 401, { error: "signed out" }, cors); return true; }
      this.store.revokeAll(u.id);
      this.json(res, 200, { ok: true }, cors);
      return true;
    }
    if (p === "/auth/account" && method === "DELETE") {
      const u = pageUser();
      if (!u) { this.json(res, 401, { error: "signed out" }, cors); return true; }
      this.store.deleteUser(u.id);
      this.json(res, 200, { ok: true, deleted: true }, cors);
      return true;
    }
    if (p === "/auth/providers" && method === "GET") { this.json(res, 200, { providers: this.providers }, cors); return true; }
    return false;
  }

  /** Exchange a provider's code for who the person is. */
  private async identify(provider: string, code: string): Promise<{ id: string; email: string | null; name: string | null }> {
    if (provider === "dev") {
      if (!this.devAllowed) throw new Error("development sign-in is disabled");
      const as = code.replace(/^dev:/, "").slice(0, 40) || "tester";
      return { id: `dev-${as}`, email: `${as}@example.test`, name: as };
    }
    const cb = `${this.issuer}/auth/callback/${provider}`;
    if (provider === "github") {
      const k = this.cfg.github!;
      const t = await (await this.fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: k.clientId, client_secret: k.clientSecret, code, redirect_uri: cb }) })).json() as { access_token?: string; error_description?: string };
      if (!t.access_token) throw new Error(t.error_description ?? "GitHub refused the code");
      const h = { authorization: `Bearer ${t.access_token}`, accept: "application/vnd.github+json", "user-agent": "corosim" };
      const u = await (await this.fetch("https://api.github.com/user", { headers: h })).json() as { id: number; login: string; name: string | null; email: string | null };
      let email = u.email;
      if (!email) {
        const list = await (await this.fetch("https://api.github.com/user/emails", { headers: h })).json() as { email: string; primary: boolean; verified: boolean }[];
        email = Array.isArray(list) ? list.find((e) => e.primary && e.verified)?.email ?? null : null;
      }
      return { id: String(u.id), email, name: u.name ?? u.login };
    }
    const k = this.cfg.google!;
    const t = await (await this.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: k.clientId, client_secret: k.clientSecret, redirect_uri: cb, grant_type: "authorization_code" }) })).json() as { access_token?: string; error_description?: string };
    if (!t.access_token) throw new Error(t.error_description ?? "Google refused the code");
    const u = await (await this.fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })).json() as { sub: string; email?: string; email_verified?: boolean; name?: string };
    if (!u.sub) throw new Error("Google did not return an account");
    return { id: u.sub, email: u.email_verified ? u.email ?? null : null, name: u.name ?? null };
  }
}

/** The server's own pages (sign-in, consent), in CoroSim's console look. No scripts. */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · CoroSim</title>
<style>
:root { --bg: #05060a; --panel: #0b0d14; --ink: #e9e7e1; --muted: #8d90a3; --rule: #2b2f45; --accent: #b8372e; }
@media (prefers-color-scheme: light) { :root { --bg: #eeece6; --panel: #f7f5f0; --ink: #05060a; --muted: #5a5d6e; --rule: #05060a; } }
* { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; }
main { width: min(440px, 100%); padding: 22px; background: var(--panel); border: 1px solid var(--rule); }
h1 { margin: 0 0 14px; font: 700 12px/1 -apple-system, Arial, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; }
.brand { font: 700 22px/1 -apple-system, Arial, sans-serif; letter-spacing: -0.02em; margin-bottom: 16px; }
.muted { color: var(--muted); font-size: 13px; } a { color: inherit; }
.btn, button { display: block; width: 100%; margin: 8px 0; padding: 11px 12px; font: 700 12px/1 -apple-system, Arial, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; text-align: center; text-decoration: none; color: var(--ink); background: var(--panel); border: 1px solid var(--rule); cursor: pointer; }
.btn:hover, button:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style></head><body><main><div class="brand">CoroSim</div><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
