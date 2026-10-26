import { solveBridge } from "./bridgeSolver";
import type { SolveRequest, SolveResult } from "./bridgeSolver";

/** Runs the bridge's solves (analyze + MAP calibration) off the main thread: each analyze call takes about 100 ms. */
export interface WorkerRequest { id: number; req: SolveRequest }
export type WorkerReply = { id: number; result: SolveResult } | { id: number; error: string };
// No "webworker" lib reference (see meshWorker.ts): the worker scope is typed locally.
const scope = self as unknown as { onmessage: (e: MessageEvent<WorkerRequest>) => void; postMessage(m: WorkerReply): void };
scope.onmessage = (e) => {
  const { id, req } = e.data;
  try { scope.postMessage({ id, result: solveBridge(req) }); }
  catch (err) { scope.postMessage({ id, error: String(err) }); }
};
