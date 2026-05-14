# Scope No-Finalizer Release Fast Path

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Branch: `codex/effect-runtime-optimization-notes`
- Base: `406f203`
- Candidate: return `[]` directly from `ScopeBoundary.release` when no finalizers were registered.
- Files changed during candidate: `src/Scope.ts`, `benchmarks/runtime-loops.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm benchmark:runtime-loops`
- Decision: keep.

## Summary

The candidate is a narrow local fast path. A successful scope with no registered finalizers no longer constructs and interprets `releaseSafely(finalizers, exit)` just to return an empty cleanup failure list.

This preserves the existing released-state behavior: `released` is still set before returning, so interruption or later close paths cannot run release twice.

## Benchmark Addition

Added focused runtime-loop coverage:

- `scope no-finalizer success depth 0`
- `scope no-finalizer success depth 1`
- `scope no-finalizer success depth 4`
- `scope no-finalizer success depth 8`
- `scope no-finalizer success depth 16`

These cases run successful scoped computations that register no finalizers, isolating the release path targeted by the candidate.

## Primary Comparison

Baseline after adding the benchmark case, before the runtime change:

| Case | Baseline ns/op | Candidate ns/op | Change |
| --- | ---: | ---: | ---: |
| scope no-finalizer success depth 0 | 1,929 | 1,894 | -1.8% |
| scope no-finalizer success depth 1 | 7,301 | 6,413 | -12.2% |
| scope no-finalizer success depth 4 | 23,571 | 19,178 | -18.6% |
| scope no-finalizer success depth 8 | 43,962 | 36,108 | -17.9% |
| scope no-finalizer success depth 16 | 85,805 | 73,430 | -14.4% |

The focused signal is positive at every measured depth and becomes material once at least one scope boundary is present.

## Scope Guardrails

| Case | Baseline ns/op | Candidate ns/op | Notes |
| --- | ---: | ---: | --- |
| scope pass-through depth 0 | 12,871 | 12,548 | slight improvement |
| scope pass-through depth 16 | 356,846 | 338,208 | improvement, but pass-through remains expensive |
| scope finalizer registration depth 16 | 47,865 | 47,528 | effectively unchanged |
| scope capture depth 16 | 97,954 | 78,228 | improved in this run, but this path was noisy in prior work |
| dispose blocked scoped task | 43,381 | 40,240 | slight improvement |

The finalizer registration guardrail did not regress. Scope capture improved in this run, but prior PR #170 scope-capture results were noisy, so this should not be over-interpreted as a capture optimization.

## Interpretation

This candidate is worth keeping because it targets one clear unnecessary operation and has a focused benchmark improvement without changing public APIs, module shape, constructor shape, handler capture behavior, or cleanup semantics.

The broader scope pass-through path remains a separate performance problem. This fast path only avoids empty release interpretation; it does not address repeated generator-frame pass-through through nested `ScopeBoundary` instances.

## Validation Output

- `pnpm typecheck`: passed
- `pnpm lint`: passed, 0 warnings and 0 errors
- `pnpm test`: passed, 323 tests
- `pnpm benchmark:runtime-loops`: passed
