# Scope Direct Effect-Id Dispatch Candidate

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Branch: `codex/effect-runtime-optimization-notes`
- Base: `f55a022`
- Candidate: cache scope-related effect ids in `ScopeBoundary.[Symbol.iterator]` and compare `_fxEffectId` directly after `isEffect` validation.
- Files changed during candidate: `src/Scope.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm benchmark:runtime-loops` twice
- Decision: keep, modest improvement.

## Summary

This candidate targets scope pass-through specifically. Once `isEffect` has validated a yielded value, `ScopeBoundary` no longer calls each static `.is` helper on the miss path. It caches the relevant effect ids locally:

- `Finally._fxEffectId`
- `ReturnFrom._fxEffectId`
- `Abort._fxEffectId`
- `Fail._fxEffectId`
- `HandlerCapture._fxEffectId`

It does not change scope cleanup behavior, captured-handler allocation, constructor shape, module graph, public APIs, or finalizer ordering.

## Primary Scope Pass-Through Comparison

Baseline was measured after experiment 1 was committed.

| Case | Baseline ns/op | Candidate run 1 ns/op | Candidate run 2 ns/op |
| --- | ---: | ---: | ---: |
| scope pass-through depth 0 | 13,125 | 12,968 | 13,293 |
| scope pass-through depth 1 | 49,922 | 49,914 | 50,893 |
| scope pass-through depth 4 | 102,927 | 100,334 | 102,132 |
| scope pass-through depth 8 | 208,371 | 203,962 | 205,065 |
| scope pass-through depth 16 | 338,782 | 329,296 | 330,229 |

The depth-16 case improved in both runs, by roughly 2.5-2.8%. Shallow depths are mixed/noisy, with no clear fixed-cost cliff.

## Guardrails

| Case | Baseline ns/op | Candidate run 1 ns/op | Candidate run 2 ns/op |
| --- | ---: | ---: | ---: |
| scope no-finalizer success depth 16 | 69,502 | 70,416 | 70,258 |
| scope finalizer registration depth 16 | 47,969 | 48,016 | 46,717 |
| scope capture depth 16 | 80,812 | 80,812 | 79,150 |
| dispose blocked scoped task | 40,530 | 36,856 | 41,834 |

The no-finalizer case is slightly slower in both candidate runs, but by about 1.1-1.3%, which is within expected benchmark noise for this suite. Finalizer registration and scope capture did not show a repeatable regression.

## Interpretation

This is a small local reduction rather than a structural optimization. It does not solve the larger nested `ScopeBoundary` generator-frame pass-through cost, but it removes repeated helper calls from the scope loop and gives a repeatable improvement at the deepest measured pass-through case.

Keep the change as an incremental improvement. Future scope work should treat this as the new baseline and continue to guard:

- `scope pass-through depth 0/16`
- `scope no-finalizer success depth 16`
- `scope finalizer registration depth 16`
- `scope capture depth 16`

## Validation Output

- `pnpm typecheck`: passed
- `pnpm lint`: passed, 0 warnings and 0 errors
- `pnpm test`: passed, 323 tests
- `pnpm benchmark:runtime-loops`: passed twice
