# Cursor prompts for the unified cath page

Plan: `docs/superpowers/plans/2026-11-09-unified-cath-page.md`. Spec: `docs/superpowers/specs/2026-11-09-unified-cath-page-design.md`.
Cursor builds Tasks 0 to 11. Sonnet 5.5 reviews each commit and runs Task 12 (the UI review) at the end.

## Before you push (once, from the repo that has the realism work)

```bash
cd /Users/praveenparthasarathy/Desktop/corosim/.claude/worktrees/focused-hypatia-8c3bfd
git add -f docs/superpowers/specs/2026-11-09-unified-cath-page-design.md docs/superpowers/plans/2026-11-09-unified-cath-page.md docs/superpowers/plans/unified-cath-cursor-prompts.md
git commit -m "docs: unified cath page design, plan and Cursor prompts"
git push -u origin claude/focused-hypatia-8c3bfd
```

## Kickoff prompt (paste into Cursor once)

> You are building the unified cath page for CoroSim, an educational cardiovascular simulator. Work only from `docs/superpowers/plans/2026-11-09-unified-cath-page.md` and the spec it links. Read these first, in order: `CLAUDE.md`, `DESIGN.md`, the spec, the plan's "Ownership and review", "Global Constraints" and "Review Focus" sections, and `src/lab/types.ts`.
>
> Start with Task 0: fetch `origin`, check out `claude/focused-hypatia-8c3bfd`, create the worktree `../corosim-cath-unified` on a new branch `cath-unified`, merge `origin/main`, and make `npx vitest run && npm run typecheck && npm run build` green. Then add `.cursor/rules/cath-unified.mdc` and commit.
>
> Rules for every task: write the task's failing tests first and show them failing; implement only what the task's Interfaces and Steps say; edit only the files the task lists; use seeded randomness (`mulberry32`); American English; follow the UI rules in `CLAUDE.md` (square hairline frames, no backdrop-filter, no tinted callouts, captions on every figure and table); commit with explicit paths, never `git add -A`; run `npx vitest run && npm run typecheck` and paste the real output, including failures; then STOP and report the commit hash and what you did. Do not start the next task. A reviewer will read your commit against the task text before you continue.
>
> If a task needs a decision the plan does not make, stop and ask rather than guess. If a source license cannot be verified (Task 5), do not use that source; hand-define that anatomy and mark it `assumed`.

## Prompt for every later task

> Implement Task N of `docs/superpowers/plans/2026-11-09-unified-cath-page.md` on branch `cath-unified`. Reread the task's section and the Global Constraints first. Failing tests first, minimal implementation, run `npx vitest run && npm run typecheck` (and `npm run build` for Tasks 7, 9, 10 and 11), commit with explicit paths, report real output, stop. Review findings from the previous task must be closed before you start.

## Task-specific notes

- Task 2: the hard-coded `routeTo(..., "LAD")` is in `src/lab/engine.ts`; all existing `tests/lab*.test.ts` must stay green.
- Task 3: undo is replay-based; if 200 actions replay in more than 2 s, add engine and simulation snapshots and say so in the report.
- Task 5: the plan lists the Wikimedia Commons reference images (femoral route, radial route, PCI device look) with the licenses the Commons API reported on 2026-11-09. Re-check each on its file page, record the result in `docs/CATH_PERIPHERAL_SOURCES.md`, and download them into untracked `scripts/cath/work/refs/`. Reference images inform the drawing and are never embedded or committed; centerlines derived from CC BY-SA 3.0 meshes are labeled share-alike. If no clean normal run-off or radial-to-arch image exists, draw the normal anatomy from the Gray's plates and mark it `assumed`.
- Task 7: the femoral and the radial route must each be drawn end to end (see "What the access route must look like" in Task 5) and every camera preset compared with its reference image.
- Task 8: reuse the main simulator's arrest, CPR, shock and drug methods; do not add a second hemodynamic or arrest model.
- Task 10: delete `src/cath/angio.ts` and `src/cath/page.ts` only after `grep -r` shows no importers.
- Task 12 is the Sonnet 5.5 UI review. Cursor does not run it; it fixes the findings in a follow-up commit.

## Review prompt for Sonnet 5.5 (after each Cursor commit)

> Review commit `<hash>` on branch `cath-unified` against Task N of `docs/superpowers/plans/2026-11-09-unified-cath-page.md`. Check: tests exist for every bullet in the task and fail without the change; only the task's files changed; signatures match the task's Interfaces exactly; the Global Constraints hold; the Review Focus lines that belong to this task are tested. Run `npx vitest run && npm run typecheck`. Report findings by severity with file:line, or "approved".
