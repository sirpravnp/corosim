# Cath lab simulator — design and open decisions

Copied from the implementation plan for review.

## Design decisions

1. **1D, not finite-element.** Devices ride on centerlines; force transmission decays with curvature.
2. **One vascular graph.** Access and coronaries share patient-frame mm coordinates.
3. **Plaque replaces single-ds lesions.** `plaqueToLesions()` feeds the existing solver.
4. **Steady-state solver with real-time stepping** for inflation ischemia.
5. **Deterministic** seeded `LabEngine` and replay.
6. **Complications** as risk functions with optional forced triggers on cases.
7. **Constants** in `src/config/*.ts` tagged `[lit]` or `[assumed]`.

## Open decisions (defaults chosen)

1. Femoral first, radial second; case 6 stresses access choice.
2. No IVUS/OCT or rotational atherectomy in this plan.
3. No right-heart or structural access.
4. Wire shape is a single bend angle.
5. Keyboard and button control, no haptics.
6. Roughly 200–300 lines per task; ~5k lines total plus tests.
