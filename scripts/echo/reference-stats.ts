/**
 * Measure the open reference loops the echo page ships (src/echo/media/*.webm) and write src/echo/reference.json: gray percentiles,
 * anechoic fraction, speckle grain along and across the beam, and tissue brightness by depth. tests/echoRealism.test.ts holds the
 * simulated echo to these numbers. Run from the repo root (needs ffmpeg):
 *   npx tsx scripts/echo/reference-stats.ts
 *
 * The loops are 624x480 teaching clips (CardioNetworks ECHOpedia, CC BY-SA 3.0, I.A.C. van der Bilt, AMC). The millimeter scale of each
 * is read from its own depth labels (5, 10, 15 cm along the sector's left edge); the sector wedge is the one the page crops with
 * (`clean` in src/echo/views.ts), shrunk a little so the edge, the depth ticks and the index marker stay out.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { IMAGES } from "../../src/echo/views";
import { imageStats, wedgeMask } from "../../src/echo/imageStats";

const W = 624, H = 480;
/** Pixels per millimeter, from the depth labels: PLAX 5 to 10 cm is 136 px; PSAX 130 px; subcostal 5, 10, 15 cm are 101 px apart. */
const PX_PER_MM: Record<string, number> = { plax: 2.72, "psax-pm": 2.6, subcostal: 2.02 };

function frames(file: string): Uint8Array[] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr}`);
  const buf = r.stdout as Buffer, n = Math.floor(buf.length / (W * H)), out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) out.push(new Uint8Array(buf.buffer, buf.byteOffset + i * W * H, W * H));
  return out;
}

const result: Record<string, unknown> = {};
for (const im of IMAGES) {
  if (!im.clean) continue;
  const f = frames(`src/echo/media/${im.file}`), c = im.clean;
  const mask = wedgeMask(W, H, c.apex, [c.half[0] - 3, c.half[1] - 3], c.radius - 12);
  const stats = imageStats(f, { w: W, h: H, apex: c.apex, pxPerMm: PX_PER_MM[im.view], mask });
  result[im.view] = { frames: f.length, pxPerMm: PX_PER_MM[im.view], ...stats };
  console.log(im.view, JSON.stringify(result[im.view]));
}
writeFileSync("src/echo/reference.json", JSON.stringify({
  source: "CardioNetworks ECHOpedia normal loops (CC BY-SA 3.0), measured by scripts/echo/reference-stats.ts",
  loops: result,
}, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 2) + "\n");
