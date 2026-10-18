import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DB } from "node:sqlite";
import { Scenario } from "../sim/scenario";

// node:sqlite is built into Node ≥ 22.5; loaded this way so bundlers and the test runner leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DB };

/** A random secret (256 bits, URL-safe) and the hash it is stored under. Only hashes are kept. */
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
const now = () => Date.now();

export interface User { id: string; provider: string; providerId: string; email: string | null; name: string | null; createdAt: number }
export interface OAuthClient { clientId: string; name: string; redirectUris: string[] }
export interface SavedPatient { scenario: Scenario; at: number }

const DAY = 86_400_000;
export const TTL = {
  webSession: 30 * DAY, // signed-in browser on the server's own pages, and the site's page token
  loginCode: 2 * 60_000, // one-time code that carries a sign-in back to the site
  authCode: 5 * 60_000, // OAuth authorization code
  access: 60 * 60_000, // OAuth access token for an AI connector
  refresh: 90 * DAY, // OAuth refresh token (rotated on use)
  pending: 15 * 60_000, // an OAuth request waiting for the user to sign in
};

/**
 * Everything the hosted server keeps: accounts, sign-in sessions, OAuth clients and tokens for AI connectors, one
 * patient per account, and daily usage. One SQLite file. Secrets are stored as SHA-256 hashes, never in the clear.
 */
export class Store {
  readonly db: DB;
  readonly persistent: boolean;

  constructor(file?: string) {
    if (file && file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file ?? ":memory:");
    this.persistent = !!file && file !== ":memory:";
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_id TEXT NOT NULL, email TEXT, name TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, UNIQUE (provider, provider_id));
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_codes (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_pending (id TEXT PRIMARY KEY, params TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, resource TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, resource TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS patients (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, scenario TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY (user_id, day));
    `);
  }

  close() { this.db.close(); }

  // ---------------------------------------------------------------- users
  /** Find or create the account for an identity from a sign-in provider. */
  upsertUser(provider: string, providerId: string, email: string | null, name: string | null): User {
    const row = this.db.prepare("SELECT id FROM users WHERE provider = ? AND provider_id = ?").get(provider, providerId) as { id: string } | undefined;
    if (row) {
      this.db.prepare("UPDATE users SET email = ?, name = ?, last_seen = ? WHERE id = ?").run(email, name, now(), row.id);
      return this.user(row.id)!;
    }
    const id = randomBytes(12).toString("base64url");
    this.db.prepare("INSERT INTO users (id, provider, provider_id, email, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, provider, providerId, email, name, now(), now());
    return this.user(id)!;
  }
  user(id: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? { id: r.id as string, provider: r.provider as string, providerId: r.provider_id as string, email: r.email as string | null, name: r.name as string | null, createdAt: r.created_at as number } : undefined;
  }
  /** Delete an account and everything tied to it: sessions, tokens, patient, usage. */
  deleteUser(id: string) { this.db.prepare("DELETE FROM users WHERE id = ?").run(id); }

  // ---------------------------------------------------------------- sessions (browser on this server, and the site's page token)
  createSession(userId: string, kind: "web" | "page"): string {
    const s = secret();
    this.db.prepare("INSERT INTO sessions (hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)").run(hash(s), userId, kind, now() + TTL.webSession);
    return s;
  }
  sessionUser(token: string | undefined, kind: "web" | "page"): User | undefined {
    if (!token) return undefined;
    const r = this.db.prepare("SELECT user_id FROM sessions WHERE hash = ? AND kind = ? AND expires_at > ?").get(hash(token), kind, now()) as { user_id: string } | undefined;
    return r ? this.user(r.user_id) : undefined;
  }
  endSession(token: string) { this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(hash(token)); }

  /** A short-lived, single-use code that carries a sign-in from this server back to the site. */
  createLoginCode(userId: string): string {
    const c = secret();
    this.db.prepare("INSERT INTO login_codes (hash, user_id, expires_at) VALUES (?, ?, ?)").run(hash(c), userId, now() + TTL.loginCode);
    return c;
  }
  redeemLoginCode(code: string): User | undefined {
    const h = hash(code);
    const r = this.db.prepare("SELECT user_id FROM login_codes WHERE hash = ? AND expires_at > ?").get(h, now()) as { user_id: string } | undefined;
    this.db.prepare("DELETE FROM login_codes WHERE hash = ?").run(h);
    return r ? this.user(r.user_id) : undefined;
  }

  // ---------------------------------------------------------------- OAuth for AI connectors
  registerClient(name: string, redirectUris: string[]): OAuthClient {
    const clientId = randomBytes(16).toString("base64url");
    this.db.prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").run(clientId, name, JSON.stringify(redirectUris), now());
    return { clientId, name, redirectUris };
  }
  /** A client known by its metadata document URL (CIMD): its id is the URL, refreshed whenever it is fetched again. */
  saveClient(clientId: string, name: string, redirectUris: string[]): OAuthClient {
    this.db.prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, created_at = excluded.created_at").run(clientId, name, JSON.stringify(redirectUris), now());
    return { clientId, name, redirectUris };
  }
  client(clientId: string): OAuthClient | undefined {
    const r = this.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as Record<string, string> | undefined;
    return r ? { clientId: r.client_id, name: r.name, redirectUris: JSON.parse(r.redirect_uris) } : undefined;
  }
  /** An authorization request parked while the user signs in. */
  park(params: Record<string, string>): string {
    const id = secret();
    this.db.prepare("INSERT INTO oauth_pending (id, params, expires_at) VALUES (?, ?, ?)").run(hash(id), JSON.stringify(params), now() + TTL.pending);
    return id;
  }
  parked(id: string): Record<string, string> | undefined {
    const r = this.db.prepare("SELECT params FROM oauth_pending WHERE id = ? AND expires_at > ?").get(hash(id), now()) as { params: string } | undefined;
    return r ? JSON.parse(r.params) : undefined;
  }
  unpark(id: string) { this.db.prepare("DELETE FROM oauth_pending WHERE id = ?").run(hash(id)); }

  createAuthCode(a: { clientId: string; userId: string; redirectUri: string; challenge: string; resource: string | null }): string {
    const c = secret();
    this.db.prepare("INSERT INTO oauth_codes (hash, client_id, user_id, redirect_uri, challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(hash(c), a.clientId, a.userId, a.redirectUri, a.challenge, a.resource, now() + TTL.authCode);
    return c;
  }
  /** Authorization codes are single-use: redeeming deletes it whatever the outcome. */
  redeemAuthCode(code: string): { clientId: string; userId: string; redirectUri: string; challenge: string; resource: string | null } | undefined {
    const h = hash(code);
    const r = this.db.prepare("SELECT * FROM oauth_codes WHERE hash = ? AND expires_at > ?").get(h, now()) as Record<string, string> | undefined;
    this.db.prepare("DELETE FROM oauth_codes WHERE hash = ?").run(h);
    return r ? { clientId: r.client_id, userId: r.user_id, redirectUri: r.redirect_uri, challenge: r.challenge, resource: r.resource } : undefined;
  }
  issueTokens(clientId: string, userId: string, resource: string | null): { access: string; refresh: string; expiresIn: number } {
    const access = secret(), refresh = secret();
    const ins = this.db.prepare("INSERT INTO oauth_tokens (hash, kind, client_id, user_id, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
    ins.run(hash(access), "access", clientId, userId, resource, now() + TTL.access);
    ins.run(hash(refresh), "refresh", clientId, userId, resource, now() + TTL.refresh);
    return { access, refresh, expiresIn: TTL.access / 1000 };
  }
  tokenUser(token: string, kind: "access" | "refresh"): { user: User; clientId: string; resource: string | null } | undefined {
    const r = this.db.prepare("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = ? AND expires_at > ?").get(hash(token), kind, now()) as Record<string, string> | undefined;
    const user = r && this.user(r.user_id);
    return r && user ? { user, clientId: r.client_id, resource: r.resource } : undefined;
  }
  revokeToken(token: string) { this.db.prepare("DELETE FROM oauth_tokens WHERE hash = ?").run(hash(token)); }
  /** Which AI clients this account has connected, for the page to show. */
  connectedClients(userId: string): string[] {
    const rows = this.db.prepare("SELECT DISTINCT c.name FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id WHERE t.user_id = ? AND t.kind = 'refresh' AND t.expires_at > ?").all(userId, now()) as { name: string }[];
    return rows.map((r) => r.name);
  }
  /** Disconnect every AI from this account. */
  revokeAll(userId: string) { this.db.prepare("DELETE FROM oauth_tokens WHERE user_id = ?").run(userId); }

  // ---------------------------------------------------------------- the account's patient
  patient(userId: string): SavedPatient | undefined {
    const r = this.db.prepare("SELECT scenario, at FROM patients WHERE user_id = ?").get(userId) as { scenario: string; at: number } | undefined;
    return r ? { scenario: JSON.parse(r.scenario), at: r.at } : undefined;
  }
  savePatient(userId: string, scenario: Scenario, at = now()) {
    this.db.prepare("INSERT INTO patients (user_id, scenario, at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET scenario = excluded.scenario, at = excluded.at").run(userId, JSON.stringify(scenario), at);
  }

  // ---------------------------------------------------------------- usage
  /** Count one tool call against today's allowance; false when the account is over it. */
  spend(userId: string, perDay: number): boolean {
    const day = new Date().toISOString().slice(0, 10);
    const r = this.db.prepare("SELECT calls FROM usage WHERE user_id = ? AND day = ?").get(userId, day) as { calls: number } | undefined;
    if ((r?.calls ?? 0) >= perDay) return false;
    this.db.prepare("INSERT INTO usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1").run(userId, day);
    return true;
  }

  /** Remove what has expired. */
  sweep() {
    const t = now();
    for (const tbl of ["sessions", "login_codes", "oauth_pending", "oauth_codes", "oauth_tokens"]) this.db.prepare(`DELETE FROM ${tbl} WHERE expires_at < ?`).run(t);
    this.db.prepare("DELETE FROM usage WHERE day < ?").run(new Date(t - 30 * DAY).toISOString().slice(0, 10));
  }
}
