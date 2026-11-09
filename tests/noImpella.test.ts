import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/** Paths that may still mention the old name (see CoroPump plan C1). */
const ALIAS_ALLOWLIST = [
  "src/sim/aliases.ts",
  "tests/aliases.test.ts",
  "scripts/rename-coropump.sh",
  "scripts/coropump-replace.py",
];

describe("CoroPump rename", () => {
  it("no tracked file mentions the old device name outside the allowlist", () => {
    const needle = "imp" + "ella";
    const raw = execSync(`git grep -il ${needle}`, { encoding: "utf8" }).trim();
    const files = raw ? raw.split("\n").filter(Boolean) : [];
    const ok = (f: string) =>
      ALIAS_ALLOWLIST.includes(f) || f.startsWith("docs/superpowers/");
    const extras = files.filter((f) => !ok(f));
    expect(extras, extras.join(", ")).toEqual([]);
  });
});
