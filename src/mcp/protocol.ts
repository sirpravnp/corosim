/**
 * The wire protocol between the hosted CoroSim MCP server and a CoroSim page that has opened a live connection.
 * Shared by both ends so they cannot drift.
 *
 *   page  ──ws /live/<room>──▶  server        page says hello, then answers calls
 *   AI    ──http /mcp/<room>─▶  server ──▶ page   each MCP tool call is forwarded to the page and run on its patient
 *
 * The room id is the capability: anyone holding the connector URL can drive that page while it is connected.
 */
export const PROTOCOL_VERSION = 1;

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
  | { type: "hello"; protocol: number; app: "corosim"; version: string }
  | { type: "result"; id: string; ok: true; result: unknown }
  | { type: "result"; id: string; ok: false; error: string };

export type ServerToPage =
  | { type: "welcome"; protocol: number }
  | { type: "call"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "status"; clients: number; lastTool: string | null; lastClient: string | null }
  | { type: "replaced" }; // another tab opened the same room; this one is closed
