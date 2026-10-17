import { mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Scenario } from "../sim/scenario";
import { ROOM_RE } from "./protocol";

/** What the server keeps for a connector URL: the patient, so the URL stays good when no page is open. */
export interface SavedRoom { scenario: Scenario; at: number; client?: string; lastUsed: number }

/**
 * Patients by room id, in memory and, when `dir` is set, on disk as one small JSON file each, so a connector
 * survives restarts and deploys. Rooms unused for `ttlDays` are removed. No personal data: the patient is synthetic.
 */
export class RoomStore {
  private mem = new Map<string, SavedRoom>();
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  readonly persistent: boolean;

  constructor(private dir?: string, private ttlDays = 90, private maxInMemory = 5000, private log: (m: string) => void = () => {}) {
    let ok = false;
    if (dir) {
      try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, ".probe"), ""); unlinkSync(join(dir, ".probe")); ok = true; }
      catch (e) { log(`room store: ${dir} is not writable (${(e as Error).message}); connectors will not survive a restart`); }
    }
    this.persistent = ok;
  }

  private file(id: string) { return join(this.dir!, `${id}.json`); }

  get(id: string): SavedRoom | undefined {
    if (!ROOM_RE.test(id)) return undefined;
    let r = this.mem.get(id);
    if (!r && this.persistent) {
      try { r = JSON.parse(readFileSync(this.file(id), "utf8")) as SavedRoom; this.remember(id, r); } catch { /* never saved */ }
    }
    return r;
  }

  put(id: string, scenario: Scenario, extra: { at?: number; client?: string } = {}) {
    if (!ROOM_RE.test(id)) return;
    const prev = this.get(id);
    this.remember(id, { scenario, at: extra.at ?? Date.now(), client: extra.client ?? prev?.client, lastUsed: Date.now() });
    this.schedule(id);
  }

  /** Note activity without changing the patient (keeps the room from expiring). */
  touch(id: string, client?: string) {
    const r = this.get(id);
    if (!r) return;
    r.lastUsed = Date.now(); if (client) r.client = client;
    this.schedule(id);
  }

  private remember(id: string, r: SavedRoom) {
    this.mem.delete(id); this.mem.set(id, r); // most recent last
    while (this.mem.size > this.maxInMemory) { const old = this.mem.keys().next().value!; if (this.dirty.has(old)) break; this.mem.delete(old); }
  }

  private schedule(id: string) {
    if (!this.persistent) return;
    this.dirty.add(id);
    this.timer ??= setTimeout(() => this.flush(), 1000);
  }

  /** Write changed rooms now (atomically: write a temporary file, then rename over the old one). */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const id of this.dirty) {
      const r = this.mem.get(id);
      if (!r) continue;
      try { const f = this.file(id), tmp = f + ".tmp"; writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, f); }
      catch (e) { this.log(`room store: could not save ${id.slice(0, 6)}…: ${(e as Error).message}`); }
    }
    this.dirty.clear();
  }

  /** Remove rooms nobody has used for ttlDays. */
  purge() {
    const cutoff = Date.now() - this.ttlDays * 86_400_000;
    for (const [id, r] of this.mem) if (r.lastUsed < cutoff) this.mem.delete(id);
    if (!this.persistent) return;
    for (const f of readdirSync(this.dir!)) {
      if (!f.endsWith(".json")) continue;
      try { if (statSync(join(this.dir!, f)).mtimeMs < cutoff) unlinkSync(join(this.dir!, f)); } catch { /* raced with a write */ }
    }
  }
}
