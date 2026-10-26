// Runs one group of the test suite: fast, slow or perf (see test-groups.mjs).
// Extra arguments go to vitest, e.g. `npm run test:slow -- --shard=1/4`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { selectors } from "./test-groups.mjs";

const group = process.argv[2];
const args = selectors[group];
if (!args) {
  console.error("usage: node scripts/test-group.mjs fast|slow|perf [vitest args]");
  process.exit(2);
}
const bin = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const r = spawnSync(process.execPath, [bin, "run", ...args, ...process.argv.slice(3)], { stdio: "inherit" });
process.exit(r.status ?? 1);
