# Cursor prompts for the unified cath page

Plan: `docs/superpowers/plans/2026-11-09-unified-cath-page.md`. Spec: `docs/superpowers/specs/2026-11-09-unified-cath-page-design.md`.

**Split.** Cursor builds Tasks 0, 1, 2, 3, 4, 5, 6, 8 and 11 (engine, data, simulation, MCP, docs). Claude builds all UI: Tasks 7, 9 and 10, on branch `cath-unified-ui`. Claude reviews each Cursor commit. A fresh Sonnet 5.5 reviewer runs Task 12 (the whole-UI review) at the end. Cursor never edits UI files.

## Before you push (once, from the repo that has the realism work)

```bash
cd /Users/praveenparthasarathy/Desktop/corosim/.claude/worktrees/focused-hypatia-8c3bfd
git add -f docs/superpowers/specs/2026-11-09-unified-cath-page-design.md docs/superpowers/plans/2026-11-09-unified-cath-page.md docs/superpowers/plans/unified-cath-cursor-prompts.md
git commit -m "docs: split unified cath plan: Claude owns UI, Cursor the rest"
git push -u origin claude/focused-hypatia-8c3bfd
```

## Kickoff prompt (paste into Cursor once)

> You are building the engine, data and tools for the unified cath page of CoroSim, an educational cardiovascular simulator. Work only from `docs/superpowers/plans/2026-11-09-unified-cath-page.md` and the spec it links. Read these first, in order: `CLAUDE.md`, the spec, the plan's "Ownership and review", "Global Constraints" and "Review Focus" sections, and `src/lab/types.ts`.
>
> **You do not touch the UI.** No CSS, no HTML, no canvas or DOM code, nothing under `src/cath/` except `src/cath/data/`, and not `vite.config.ts`. Claude owns all of that (Tasks 7, 9 and 10). If a task seems to need a UI change, stop and say so.
>
> You own Tasks 0, 1, 2, 3, 4, 5, 6, 8 and 11, in that order. Start with Task 0: fetch `origin`, check out `claude/focused-hypatia-8c3bfd`, create the worktree `../corosim-cath-unified` on a new branch `cath-unified`, merge `origin/main`, and make `npx vitest run && npm run typecheck && npm run build` green. Then add `.cursor/rules/cath-unified.mdc` (narrowed to the engine files, as the task says) and commit. Push `cath-unified` so Claude can fork the UI branch from it.
>
> Rules for every task: write the task's failing tests first and show them failing; implement only what the task's Interfaces and Steps say; edit only the files the task lists; seeded randomness (`mulberry32`); American English; commit with explicit paths, never `git add -A`; run `npx vitest run && npm run typecheck` and paste the real output, including failures; then STOP, push, and report the commit hash and what you did. Do not start the next task. Claude reviews your commit against the task text before you continue.
>
> If a task needs a decision the plan does not make, stop and ask rather than guess. If a source license cannot be verified (Task 5), do not use that source; hand-define that anatomy and mark it `assumed`.

## Prompt for every later task

> Implement Task N of `docs/superpowers/plans/2026-11-09-unified-cath-page.md` on branch `cath-unified`. Reread the task's section and the Global Constraints first. No UI files. Failing tests first, minimal implementation, run `npx vitest run && npm run typecheck`, commit with explicit paths, push, report real output, stop. Review findings from the previous task must be closed before you start.

## Task-specific notes (Cursor)

- Task 1: `src/lab/lesions.ts` is the contract Claude's Set up step builds on. Keep the exported names and signatures exactly as the task lists them.
- Task 2: the hard-coded `routeTo(..., "LAD")` is in `src/lab/engine.ts`; all existing `tests/lab*.test.ts` must stay green.
- Task 3: undo is replay-based; if 200 actions replay in more than 2 s, add engine and simulation snapshots and say so in the report.
- Task 4: `nextHint` is pure and must not mutate the engine; Claude's hint UI calls it as is.
- Task 5: the plan lists the Wikimedia Commons reference images (femoral route, radial route, PCI device look) with the licenses the Commons API reported on 2026-11-09. Re-check each on its file page, record the result in `docs/CATH_PERIPHERAL_SOURCES.md`, and download them into untracked `scripts/cath/work/refs/`. Reference images inform the drawing and are never embedded or committed; centerlines derived from CC BY-SA 3.0 meshes are labeled share-alike. If no clean normal run-off or radial-to-arch image exists, draw the normal anatomy from the Gray's plates and mark it `assumed`. The baked `src/cath/data/peripheral.json` is the one file you may add under `src/cath/`.
- Task 6: the access routes (femoral and radial) must match the "What the access route must look like" list in Task 5; Claude's renderer draws exactly what your graph provides.
- Task 8: reuse the main simulator's arrest, CPR, shock and drug methods; do not add a second hemodynamic or arrest model.
- Task 11: MCP tools and docs only; route redirects are Claude's (Task 9).

## What Claude does (not for Cursor)

- Task 7 (peripheral rendering, camera presets, run-off views), Task 9 (page shell, Set up step, route redirects, `vite.config.ts`), Task 10 (Diagnose, Treat, hint and undo controls, resuscitation strip, 12-lead band, retiring the old renderer) on `cath-unified-ui`, merging `cath-unified` in as each engine task lands.
- Task 12: a fresh Sonnet 5.5 reviewer runs the whole-UI review; UI findings go to Claude, engine findings to Cursor.

## Review prompt for Claude (after each Cursor commit)

> Review commit `<hash>` on branch `cath-unified` against Task N of `docs/superpowers/plans/2026-11-09-unified-cath-page.md`. Check: tests exist for every bullet in the task and fail without the change; only the task's files changed and no UI file was touched; signatures match the task's Interfaces exactly; the Global Constraints hold; the Review Focus lines that belong to this task are tested. Run `npx vitest run && npm run typecheck`. Report findings by severity with file:line, or "approved".
