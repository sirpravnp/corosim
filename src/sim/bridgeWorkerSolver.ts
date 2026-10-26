import { solveBridge } from "./bridgeSolver";
import type { BridgeSolver, SolveRequest, SolveResult } from "./bridgeSolver";
import type { WorkerReply, WorkerRequest } from "./bridgeWorker";

/**
 * Solver that runs in a module Web Worker (same pattern as the mesh worker in src/structural/heartView.ts). If the worker
 * cannot be created, or later fails, it warns once and solves on the calling thread from then on. Page code only: it
 * needs `Worker` and Vite's `new URL(..., import.meta.url)`.
 */
export function createWorkerSolver(): BridgeSolver & { dispose(): void } {
  let worker: Worker | null = null;
  let nextId = 1;
  const waiting = new Map<number, { ok: (r: SolveResult) => void; fail: (e: Error) => void }>();
  const giveUp = (why: string) => {
    console.warn("CoroSim: the bridge worker is unavailable (" + why + "); solving on the main thread.");
    worker?.terminate(); worker = null;
    for (const w of waiting.values()) w.fail(new Error(why));
    waiting.clear();
  };
  try {
    worker = new Worker(new URL("./bridgeWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if ("result" in e.data) w.ok(e.data.result); else w.fail(new Error(e.data.error));
    };
    worker.onerror = (e) => giveUp(e.message || "worker error");
  } catch (e) { giveUp(String(e)); }
  return {
    solve(req: SolveRequest) {
      if (!worker) return solveBridge(req);
      const id = nextId++, w = worker;
      return new Promise<SolveResult>((ok, fail) => {
        waiting.set(id, { ok, fail });
        try { w.postMessage({ id, req } satisfies WorkerRequest); } catch (e) { waiting.delete(id); fail(e as Error); }
      });
    },
    dispose() { worker?.terminate(); worker = null; for (const w of waiting.values()) w.fail(new Error("disposed")); waiting.clear(); },
  };
}
