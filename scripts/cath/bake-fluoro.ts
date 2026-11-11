/**
 * Bake src/cath/media/fluoro.webm from the open teaching cine. Run from the repo root:
 *   npx tsx scripts/cath/bake-fluoro.ts
 * Needs ffmpeg, curl, about 10 MB of disk. The raw download lives in scripts/cath/work/ and stays out of git.
 *
 * Source (CC BY-SA 4.0): Alextogus, File:Coronarographie.gif, Wikimedia Commons.
 * Each frame of the cine is read; iodine is stripped by taking the temporal max (contrast is dark);
 * the empty field is then shifted a few pixels through two breathing cycles and cropped to a circular collimator.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FLUORO_BAKE, FLUORO_SOURCE, bakeLoop } from "../../src/cath/backdrop";

const WORK = "scripts/cath/work";
const GIF = `${WORK}/${FLUORO_SOURCE.commonsFile}`;
const RAW = `${WORK}/fluoro-src.gray`;
const OUT_RAW = `${WORK}/fluoro-320.gray`;
const WEBM = "src/cath/media/fluoro.webm";

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

function probe(path: string): { w: number; h: number; n: number } {
  const r = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=width,height,nb_read_frames", "-of", "csv=p=0", path,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const [w, h, n] = r.stdout.trim().split(",").map(Number);
  if (!(w > 0 && h > 0 && n > 0)) throw new Error(`ffprobe parse: ${r.stdout}`);
  return { w, h, n };
}

mkdirSync(WORK, { recursive: true });
mkdirSync("src/cath/media", { recursive: true });
if (!existsSync(GIF)) {
  console.log(`downloading ${FLUORO_SOURCE.page}`);
  run("curl", ["-fL", "-A", "CoroSim/1.0 (educational; fluoro bake)", "-o", GIF, FLUORO_SOURCE.url]);
}
const { w, h, n } = probe(GIF);
console.log(`source ${w}×${h}, ${n} frames`);
run("ffmpeg", ["-y", "-i", GIF, "-vf", "format=gray", "-f", "rawvideo", "-pix_fmt", "gray", RAW]);
const raw = new Uint8Array(readFileSync(RAW));
const frames = bakeLoop(raw, w, h, n);
const packed = new Uint8Array(frames.length * FLUORO_BAKE.w * FLUORO_BAKE.h);
frames.forEach((f, i) => packed.set(f, i * f.length));
writeFileSync(OUT_RAW, packed);
run("ffmpeg", [
  "-y", "-f", "rawvideo", "-pix_fmt", "gray",
  "-s", `${FLUORO_BAKE.w}x${FLUORO_BAKE.h}`, "-r", String(FLUORO_BAKE.fps),
  "-i", OUT_RAW, "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
  "-b:v", "0", "-crf", String(FLUORO_BAKE.crf), "-g", String(n), WEBM,
]);
console.log(`wrote ${WEBM} (${frames.length} frames at ${FLUORO_BAKE.w}×${FLUORO_BAKE.h}, ${FLUORO_BAKE.fps} fps)`);
console.log(`credit: ${FLUORO_SOURCE.author}, ${FLUORO_SOURCE.license}, ${FLUORO_SOURCE.page}`);
