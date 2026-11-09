# Cursor prompts for the CoroPump plan

Plan: `docs/superpowers/plans/2026-11-08-corepump.md`. Spec: `docs/superpowers/specs/2026-11-07-corepump-design.md`. Cursor owns the C tasks (engine and pure case rules). Claude owns the K tasks (UI, review, cases) and reviews every Cursor commit before it merges.

**Before anything else.** The learner gate (`src/cases/gate.ts`) lives on the `case-screen` branch. Check that it is on `origin/main`:

```bash
git fetch origin
git ls-tree -r --name-only origin/main | grep cases/gate.ts
```

If that prints nothing, stop and tell Claude. The rename (Task C1) would conflict with the gate.

**Setup (once).** From the repo root:

```bash
git worktree add -b corepump-engine ../corosim-corepump-engine origin/main
cd ../corosim-corepump-engine && npm ci
```

Open `../corosim-corepump-engine` in Cursor. Do not work in `../corosim` (its `echo-atlas` checkout is stale and has uncommitted changes).

**Order.** C0 → C1 → C2, one task per branch and PR, then stop. Claude reviews each against the gates in Task K5 of the plan. After C2 merges, Claude starts the UI against the stub and you continue with C3 → C4 → C5 → C6 → C6b → C7 → C8 from the same plan.

**Prompt for every task** (replace N and paste that task's section from the plan below it):

> Implement Task N of `docs/superpowers/plans/2026-11-08-corepump.md`. Read `CLAUDE.md`, the plan's Global Constraints, Review Focus and Contract sections, and the files the task lists. Write the failing tests before any code and show them failing. Do not touch `src/page`, `src/panels`, CSS, HTML, `src/library` or the case content files in `src/cases/` (the scripted rename in C1 is the one exception). If an acceptance number cannot be met as written, stop and write down why in the PR body instead of loosening the test. In the PR body list: what changed, every new constant with its `[lit]` or `[assumed]` tag, deviations from the plan, open questions.

**Task-specific notes**

- **C0.** No code. Record the test counts and the `scripts/bench-engine.ts` multiple in the C1 PR body. If `npm test` is not green on a clean `origin/main`, stop and report which tests fail.
- **C1.** Run the rename as one script (`scripts/rename-coropump.sh`) so it is repeatable if `main` moves. In `src/cases/gate.ts`, do not rename `devices.impella` to a blanket `devices.coroPump` entry. List `level`, `model`, `purge.solution` and `purge.heparinUml` separately; a blanket entry would let a learner set `position` and create a malposition. Fix remaining lowercase prose "impella" in comments and strings by hand, then run `tests/noImpella.test.ts`. User-visible strings are reviewed by Claude (Task K1), so list them by area in the PR body.
- **C2.** The contract must match the plan's Contract block exactly: Claude builds against it. Stub values are fixed constants until C3 to C5 replace them. Keep `thrombusBurden` out of anything a console or a pane would show.
- **Later tasks (for reference).** C3 to C5 are pure functions called once per beat, never per integrator step. All time constants are in clinical minutes, so thrombus and free hemoglobin must match at 1x, 3x and 6x speed. C6b changes the order catalog, labs, gate and markdown in `src/cases/` and `src/sim/labs.ts`; run the existing `caseGate`, `caseOrders` and `caseMarkdown` tests unmodified.

- **C9 (K5 fixes).** Rebase on `main`, then do the six steps of Task C9 in the plan. Do not loosen any test; if a number cannot be met as written, stop and say why in the PR body.
