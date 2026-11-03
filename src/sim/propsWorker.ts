import { propsForPatient } from "./simProps";
import type { SimProps } from "./simProps";
import type { PatientSpec } from "./patient";

/** Builds the Simulator's structural props off the main thread (analyze takes about 100 ms, the septa a little more). */
export interface PropsRequest { id: number; patient: PatientSpec | undefined }
export type PropsReply = { id: number; result: SimProps } | { id: number; error: string };
const scope = self as unknown as { onmessage: (e: MessageEvent<PropsRequest>) => void; postMessage(m: PropsReply): void };
scope.onmessage = (e) => {
  try { scope.postMessage({ id: e.data.id, result: propsForPatient(e.data.patient) }); }
  catch (err) { scope.postMessage({ id: e.data.id, error: String(err) }); }
};
