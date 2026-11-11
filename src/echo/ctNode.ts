import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ctHeartFromBytes } from "../anatomy/ctHeart";
import { useCtHeart, ctHeart } from "./ctEcho";
import { LANDMARKS_HEART_FRAME as L, toHeart } from "./poses";

/** Node only (tests, scripts): load src/cath/data/heart.* and install it for the echo. Idempotent. */
export function installCtHeartNode(root = "."): void {
  if (ctHeart()) return;
  const h = ctHeartFromBytes(new Uint8Array(gunzipSync(readFileSync(`${root}/src/cath/data/heart.bin.gz`))), JSON.parse(readFileSync(`${root}/src/cath/data/heart.json`, "utf8")));
  useCtHeart(h, { apex: L.apex, mv: L.mitral, av: L.aortic, tv: L.tricuspid }, toHeart);
}
