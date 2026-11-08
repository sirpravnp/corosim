# Cursor prompts for the cath lab plan

Plan: `docs/superpowers/plans/2026-11-07-cath-lab-simulator.md`. Cursor owns tasks 1 to 10 and 13 to 16 (all but the visual check). Claude owns 0, 11, 12.

**Setup (once).** From the repo root:

```bash
git fetch origin
git worktree add -b cath-lab-engine ../corosim-cathlab-engine origin/main
cd ../corosim-cathlab-engine && npm ci
```

Open `../corosim-cathlab-engine` in Cursor. The rule `.cursor/rules/cath-lab.mdc` attaches to engine files.

**Order.** 1 → 2; 3, 4, 5 in any order; 6 → 7 → 8 → 9 → 10; then 13, 14, 15, 16. Stop after each task and have Claude review the commit.

**Prompt for every task** (replace N and paste that task's section from the plan below it):

> Implement Task N of `docs/superpowers/plans/2026-11-07-cath-lab-simulator.md`. Read `CLAUDE.md`, `src/lab/types.ts` and `.cursor/rules/cath-lab.mdc` first. Write the failing tests before any code and show them failing. Edit only the files in the task's Files list. Run `npx vitest run && npm run typecheck`, then commit with explicit paths and report the real output. Do not start the next task.

**Task-specific notes**
- Task 1: capture the golden FFR numbers on a clean checkout before editing the solver (Step 1). `tests/cath.test.ts` and `tests/simulation.test.ts` must stay green.
- Task 2: if 60 s of balloon occlusion shows no ST change, tune `LAB.ischemiaTauSeconds` (Step 4). If that is not enough, stop and report; do not change clinical-mode behavior.
- Task 5: the access graph must end within 15 mm of the LM and RCA ostia from `buildTree()`.
- Task 6: `LabEngine` must `implements LabEngineLike` from `types.ts`.
- Task 9: reuse the existing arrest path (see `src/sim/arrest.ts`); do not add a second one.
- Task 15: follow `tests/mcp.test.ts`.
- Task 16: skip Step 4 (browser check); Claude does it.
