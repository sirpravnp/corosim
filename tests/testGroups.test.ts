import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error plain .mjs module shared with the test runner script
import { groupOf, perfDir, slow } from "../scripts/test-groups.mjs";

// CI runs the suite in groups (scripts/test-group.mjs): fast gates the deploy, slow and perf run in a separate
// workflow. These checks make sure a new test file cannot fall out of every group, or be run twice.
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const all = walk("tests");
const testFiles = all.filter((f) => f.endsWith(".test.ts")).sort();

describe("test groups", () => {
  it("finds the test files", () => {
    expect(testFiles.length).toBeGreaterThan(50);
    expect(testFiles).toContain("tests/testGroups.test.ts");
  });

  it("only .test.ts files hold tests (vitest would run other spellings, the group scripts would not select them)", () => {
    const odd = all.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !f.endsWith(".test.ts"));
    expect(odd).toEqual([]);
  });

  it("every slow entry is a real test file, listed once, outside tests/perf", () => {
    expect(slow.filter((f: string, i: number) => slow.indexOf(f) !== i), "duplicates").toEqual([]);
    expect(slow.filter((f: string) => !testFiles.includes(f)), "missing files").toEqual([]);
    expect(slow.filter((f: string) => f.startsWith(`${perfDir}/`)), "perf files listed as slow").toEqual([]);
    expect([...slow].sort(), "keep the list sorted").toEqual(slow);
  });

  it("every test file is in exactly one of fast, slow and perf", () => {
    const groups = { fast: [] as string[], slow: [] as string[], perf: [] as string[] };
    for (const f of testFiles) groups[groupOf(f) as keyof typeof groups].push(f);
    expect(groups.fast.length + groups.slow.length + groups.perf.length).toBe(testFiles.length);
    expect(groups.slow).toEqual(slow);
    expect(groups.perf.length).toBeGreaterThan(0);
    expect(groups.fast.length).toBeGreaterThan(0);
  });

  it("package.json wires the groups, and npm test runs all three", () => {
    const s = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    for (const g of ["fast", "slow", "perf"]) expect(s[`test:${g}`], `test:${g}`).toBe(`node scripts/test-group.mjs ${g}`);
    expect(s.test).toBe("npm run test:fast && npm run test:slow && npm run test:perf");
  });
});
