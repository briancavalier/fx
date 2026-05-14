# Expanded Runtime Loop Coverage Baseline

- Date: 2026-05-14T20:42:11.504Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Runtime state: miss-path minimal `Handler` accepted point, before Scope/HandlerCaptureBoundary reductions.

## Added Coverage

This run adds benchmark coverage for:

- non-matching `Control` pass-through depth
- `ScopeBoundary` pass-through depth
- scope finalizer registration
- scope capture depth
- `HandlerCaptureBoundary` pass-through depth
- matching close depth through non-matching handler capture boundaries

## New Baseline Cases

| Case | ns/op |
| --- | ---: |
| control pass-through depth 0 | 12,230 |
| control pass-through depth 16 | 185,250 |
| scope pass-through depth 0 | 13,468 |
| scope pass-through depth 16 | 359,625 |
| scope finalizer registration depth 0 | 7,630 |
| scope finalizer registration depth 16 | 47,485 |
| scope capture depth 0 | 3,647 |
| scope capture depth 16 | 97,416 |
| handler capture boundary pass-through depth 0 | 14,306 |
| handler capture boundary pass-through depth 16 | 191,650 |
| handler capture boundary close depth 0 | 3,085 |
| handler capture boundary close depth 16 | 28,146 |

Use this file as the comparison point for subsequent Scope and HandlerCaptureBoundary candidates.
