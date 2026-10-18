import { HeartMorph, meshHeart } from "../anatomy/heartSurface";

/** Builds heart meshes off the main thread: the 2.8 mm mesh takes about 200 ms and the 1.6 mm one about 650 ms, which would freeze the page and its sliders. */
export interface MeshRequest { id: number; step: number; morph: HeartMorph }
// No "webworker" lib reference: it would replace the DOM types for the whole project, so the worker scope is typed locally.
const scope = self as unknown as { onmessage: (e: MessageEvent<MeshRequest>) => void; postMessage(m: unknown, t: Transferable[]): void };
scope.onmessage = (e) => {
  const { id, step, morph } = e.data, m = meshHeart(step, undefined, morph);
  scope.postMessage({ id, mesh: m }, [m.positions.buffer, m.normals.buffer, m.indices.buffer, m.parts.buffer]);
};
