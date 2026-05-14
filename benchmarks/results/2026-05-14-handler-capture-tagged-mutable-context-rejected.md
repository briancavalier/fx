# Handler Capture Tagged Mutable Context Candidate

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Branch: `codex/effect-runtime-optimization-notes`
- Base: `147dd7f`
- Candidate: tag the fresh empty context array created by `HandlerCaptureBoundary`, then mutate that tagged array with `unshift` while captured handlers bubble inward.
- Files changed during candidate: `src/HandlerCapture.ts`, `src/internal/Handler.ts`, `src/Scope.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm benchmark:runtime-loops`
- Decision: reject and revert.

## Summary

The candidate attempted to reduce capture-context allocation by replacing repeated `[captured, ...context]` copies with mutation of a private tagged array. To avoid changing custom handler semantics, only arrays created by `HandlerCaptureBoundary` were tagged as mutable. Untagged arrays still used the old copy-spread fallback.

Correctness passed, but the benchmark signal was negative for the target path.

## Target Comparison

Baseline was measured from clean commit `147dd7f`.

| Case | Baseline ns/op | Candidate ns/op | Change |
| --- | ---: | ---: | ---: |
| capture depth 0 | 3,198 | 4,099 | +28.2% |
| capture depth 1 | 5,043 | 5,026 | -0.3% |
| capture depth 4 | 9,120 | 9,679 | +6.1% |
| capture depth 8 | 15,380 | 15,602 | +1.4% |
| capture depth 16 | 25,584 | 26,114 | +2.1% |
| scope capture depth 16 | 79,093 | 81,057 | +2.5% |

The tagged mutable array adds fixed overhead at depth 0 and does not recover enough copy cost at deeper capture depths.

## Other Observations

The candidate also perturbed unrelated handler measurements in the benchmark process. For example, `matched handler throughput` was much slower in the candidate run than the baseline run. That may be normal benchmark noise, but it is consistent with the V8/module-shape sensitivity already seen in PR #170's structural handler prototypes.

## Interpretation

This version should not be kept. The likely costs are:

- `Object.defineProperty` tagging on every default capture boundary result.
- `Array.unshift`, which still shifts existing entries.
- Additional exported helper machinery in a module that participates in handler hot paths.

Future capture-context experiments should avoid per-capture `defineProperty` and avoid `unshift`. A builder would need to append cheaply and materialize exactly once before user code observes the result, but the current generator bubbling shape does not provide an obvious single materialization point without changing public capture semantics.

## Validation Output

- `pnpm typecheck`: passed
- `pnpm lint`: passed, 0 warnings and 0 errors
- `pnpm test`: passed, 323 tests
- `pnpm benchmark:runtime-loops`: passed
