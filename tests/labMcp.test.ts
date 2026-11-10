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
    for (const n of ["corosim_lab_start", "corosim_lab_act", "corosim_lab_state", "corosim_lab_score", "corosim_lab_hint", "corosim_lab_undo", "corosim_lab_resus"]) {
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

  it("mcp hint and undo tools return the hint and the state", async () => {
    const { call } = await connect();
    await call("corosim_lab_start", { caseId: "stable-lad", seed: 5 });
    await call("corosim_lab_act", { actions: [{ t: "access", site: "femoral-R" }, { t: "sheath", french: 6 }] });
    const hint = await call("corosim_lab_hint", { level: 2 });
    expect(hint.isError).toBe(false);
    expect(hint.data.next?.kind).toBeTruthy();
    expect(typeof hint.data.next?.why).toBe("string");
    const undo = await call("corosim_lab_undo");
    expect(undo.isError).toBe(false);
    expect(undo.data.undoCount).toBe(1);
    expect(undo.data.canUndo).toBe(true);
    expect(undo.data.state.access).toBe("femoral-R");
  });

  it("mcp resuscitation tools drive CPR, shock and pericardiocentesis through the engine", async () => {
    const { call } = await connect();
    await call("corosim_lab_start", { caseId: "stable-lad", seed: 8 });
    await call("corosim_lab_act", { actions: [{ t: "access", site: "femoral-R" }] });
    const fluid = await call("corosim_lab_resus", { action: { t: "fluid", ml: 250 } });
    expect(fluid.isError).toBe(false);
    expect(fluid.data.events.some((e: { kind: string }) => e.kind === "fluid")).toBe(true);
    const peri = await call("corosim_lab_resus", { action: { t: "pericardiocentesis", ml: 20 } });
    expect(peri.isError).toBe(false);
    expect(peri.data.events.some((e: { kind: string }) => e.kind === "pericardiocentesis")).toBe(true);
    const cpr = await call("corosim_lab_resus", { action: { t: "cpr", on: true } });
    expect(cpr.isError).toBe(false);
    const shock = await call("corosim_lab_resus", { action: { t: "shock", joules: 200 } });
    expect(shock.isError).toBe(false);
    expect(shock.data.events.some((e: { kind: string }) => e.kind === "shock" || e.kind === "cpr")).toBe(true);
  });

  it("lab_score is callable after start", async () => {
    const { call } = await connect();
    await call("corosim_lab_start", { caseId: "stable-lad" });
    const score = await call("corosim_lab_score");
    expect(score.isError).toBe(false);
    expect(score.data.total).toBeGreaterThan(0);
  });
});
