import type { Scenario } from "../sim/scenario";

/**
 * The wire protocol between the hosted CoroSim MCP server and a CoroSim page that has opened a live connection.
 * Shared by both ends so they cannot drift.
 *
 *   page  ──ws /live/<room>──▶  server        page says hello, then answers calls
 *   AI    ──http /mcp/<room>─▶  server ──▶ page   each MCP tool call is forwarded to the page and run on its patient
 *
 * The room id is the capability: anyone holding the connector URL can drive that room's patient.
 *
 * The server keeps the room's patient (as a scenario). An open page is the live copy: it sends a snapshot whenever
 * the patient changes, and on connecting it is handed the saved one if that is newer (an AI changed it while the
 * page was closed). With no page open, the server runs tool calls on the saved patient itself.
 */
export const PROTOCOL_VERSION = 2;
export interface Snapshot { scenario: Scenario; at: number }

/** 22–64 URL-safe characters; a generated id has 128 bits of entropy. */
export const ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function newRoomId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PageToServer =
  | { type: "hello"; protocol: number; app: "corosim"; version: string; since?: number } // since: the newest snapshot this page has
  | { type: "snapshot"; scenario: Scenario; at: number }
  | { type: "result"; id: string; ok: true; result: unknown }
  | { type: "result"; id: string; ok: false; error: string };

export type ServerToPage =
  | { type: "welcome"; protocol: number }
  | { type: "restore"; scenario: Scenario; at: number } // the saved patient is newer than the page's: load it
  | { type: "call"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "status"; clients: number; lastTool: string | null; lastClient: string | null; saved: boolean } // clients: AIs active in the last 10 min; saved: the patient survives a restart
  | { type: "replaced" }; // another tab opened the same room; this one is closed
