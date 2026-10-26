// The three groups of the test suite, in one place. The slow files are listed in tests/slow.json (nothing else
// names them); tests/perf holds the wall-clock benchmark, which must run alone; every other test file is fast.
import { readFileSync } from "node:fs";

export const slow = JSON.parse(readFileSync(new URL("../tests/slow.json", import.meta.url), "utf8"));
export const perfDir = "tests/perf";

/** "perf", "slow" or "fast" for a test file path relative to the repository root. */
export const groupOf = (file) => (file.startsWith(`${perfDir}/`) ? "perf" : slow.includes(file) ? "slow" : "fast");

/** The vitest arguments that select a group (the fast group is everything except the other two). */
export const selectors = {
  fast: ["--exclude", `${perfDir}/**`, ...slow.flatMap((f) => ["--exclude", f])],
  slow,
  perf: [perfDir],
};
