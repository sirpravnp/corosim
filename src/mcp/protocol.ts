import type { Scenario } from "../sim/scenario";

/**
 * The wire protocol between the hosted CoroSim MCP server and a CoroSim page that has opened a live connection.
 * Shared by both ends so they cannot drift.
 *
 *   page  ──ws /live──▶  server            the signed-in page says hello with its token, then answers calls
 *   AI    ──http /mcp──▶  server ──▶ page    each MCP tool call (OAuth bearer token) is forwarded to that account's page
 *
 * Both ends are tied to an account; the account owns one patient.
 *
 * The server keeps the room's patient (as a scenario). An open page is the live copy: it sends a snapshot whenever
 * the patient changes, and on connecting it is handed the saved one if that is newer (an AI changed it while the
 * page was closed). With no page open, the server runs tool calls on the saved patient itself.
 */
export const PROTOCOL_VERSION = 3;
export interface Snapshot { scenario: Scenario; at: number }

export type PageToServer =
  | { type: "hello"; protocol: number; app: "corosim"; version: string; token: string; since?: number } // token: the page's sign-in; since: the newest snapshot it has
  | { type: "snapshot"; scenario: Scenario; at: number }
  | { type: "result"; id: string; ok: true; result: unknown }
  | { type: "result"; id: string; ok: false; error: string };

export type ServerToPage =
  | { type: "welcome"; protocol: number }
  | { type: "restore"; scenario: Scenario; at: number } // the saved patient is newer than the page's: load it
  | { type: "call"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "status"; clients: number; lastTool: string | null; lastClient: string | null; saved: boolean } // clients: AIs active in the last 10 min; saved: the patient survives a restart
  | { type: "replaced" }; // another tab opened the same room; this one is closed
