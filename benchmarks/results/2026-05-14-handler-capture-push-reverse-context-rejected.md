# Handler Capture Push Reverse Context Candidate

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Branch: `codex/effect-runtime-optimization-notes`
- Base: `147dd7f`
- Candidate: create a private captured-context array, append handlers with `push`, and replay tagged contexts in reverse order with a plain `for` loop.
- Files changed during candidate: `src/HandlerCapture.ts`, `src/internal/Handler.ts`, `src/Scope.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm benchmark:runtime-loops`
- Decision: reject and revert.

## Summary

This candidate tested the suggested improvement over the previous mutable-context prototype: avoid `unshift` and append with `push`, then process the tagged context in reverse order in `withHandlerContext`.

To avoid per-array `Object.defineProperty`, the prototype used a private `WeakSet` to recognize contexts created by `HandlerCaptureBoundary`.

Correctness passed, but performance was still negative.

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

The numbers were effectively no better than the earlier tagged mutable `unshift` attempt for the main capture-depth cases.

## Hot-Path Guardrails

| Case | Baseline ns/op | Candidate ns/op |
| --- | ---: | ---: |
| matched handler throughput | 10,675 | 21,380 |
| prebuilt matched handler throughput | 10,162 | 17,999 |
| pass-through depth 0 | 12,515 | 17,537 |

This is a fixed-cost cliff. Even if a deeper capture case had improved, this would be enough to reject the candidate.

## Semantic Concern

The candidate preserves replay behavior by reversing tagged contexts in `withHandlerContext`, but the captured value is still a public `readonly CapturedHandler[]`. Pushing while bubbling stores handlers in outer-to-inner order, which is the reverse of the existing observable array order. Fixing that would require a materialization/reversal step before user code observes the captured context, and the current generator-bubbling shape does not provide a clean single point for that without extra machinery.

## Interpretation

This confirms that the `unshift` operation was not the main problem with the previous prototype. The fixed overhead of tagging/checking private context arrays and changing `HandlerCapture`/`Handler` module shape dominates any allocation savings.

Do not keep this approach. A future context-builder design would need to:

- avoid per-capture tagging overhead in the hot path,
- preserve public captured-array order before user observation,
- avoid changing matched/depth-0 handler performance,
- show a clear win on `capture depth 16` and `mapCapturedHandlers fanout`.

## Validation Output

- `pnpm typecheck`: passed
- `pnpm lint`: passed, 0 warnings and 0 errors
- `pnpm test`: passed, 323 tests
- `pnpm benchmark:runtime-loops`: passed
