import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/mcp/server";
import { TOOLS } from "../src/mcp/tools";
import { scoreProcedure } from "../src/lab/score";
import { LAB_CASES } from "../src/cath/lab/cases";

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: !!r.isError, data: r.isError ? text : JSON.parse(text) };
  };
  return { call };
}

describe("lab MCP tools", () => {
  it("lists lab tools", () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ["corosim_lab_start", "corosim_lab_act", "corosim_lab_state", "corosim_lab_score", "corosim_lab_hint"]) {
      expect(names).toContain(n);
    }
  });

  it("lab_start and lab_act", async () => {
    const { call } = await connect();
    const start = await call("corosim_lab_start", { caseId: "stable-lad", seed: 9 });
    expect(start.isError).toBe(false);
    expect(start.data.caseId).toBe("stable-lad");
    const act = await call("corosim_lab_act", { actions: [{ t: "access", site: "femoral-R" }] });
    expect(act.isError).toBe(false);
    expect(act.data.events.length).toBeGreaterThan(0);
    const hint1 = await call("corosim_lab_hint", { level: 1 });
    expect(hint1.data.hint).not.toMatch(/guide-jl4|wire-workhorse/);
    const hint3 = await call("corosim_lab_hint", { level: 3 });
    expect(hint3.data.hint).toMatch(/guide-jl4/);
  });

  it("lab_score is callable after start", async () => {
    const { call } = await connect();
    await call("corosim_lab_start", { caseId: "stable-lad" });
    const score = await call("corosim_lab_score");
    expect(score.isError).toBe(false);
    expect(score.data.total).toBeGreaterThan(0);
  });
});
