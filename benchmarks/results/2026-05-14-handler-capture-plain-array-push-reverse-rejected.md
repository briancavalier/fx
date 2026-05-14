# Handler Capture Plain Array Push Reverse Candidate

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Branch: `codex/effect-runtime-optimization-notes`
- Base: `147dd7f`
- Candidate: mutate captured-handler arrays with `push` while bubbling, then process them in reverse order in `withHandlerContext` with a plain `for` loop.
- Files changed during candidate: `src/HandlerCapture.ts`, `src/internal/Handler.ts`, `src/Scope.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm benchmark:runtime-loops` twice
- Decision: reject and revert.

## Summary

This variant avoided the tagging overhead of the earlier context-builder prototypes. It used only plain arrays:

- `HandlerCaptureBoundary` still returned `[]`.
- `Handler` and `ScopeBoundary` pushed captured wrappers onto that array.
- `withHandlerContext` replayed arrays from end to start with a `for` loop.

Correctness passed, but the target benchmark signal was not good enough to keep.

## Target Comparison

Baseline was measured from clean commit `147dd7f`.

| Case | Baseline ns/op | Candidate run 1 ns/op | Candidate run 2 ns/op |
| --- | ---: | ---: | ---: |
| capture depth 0 | 3,198 | 3,184 | 3,430 |
| capture depth 1 | 5,043 | 5,011 | 5,073 |
| capture depth 4 | 9,120 | 9,320 | 9,537 |
| capture depth 8 | 15,380 | 15,250 | 15,425 |
| capture depth 16 | 25,584 | 26,101 | 26,414 |
| replay depth 16 | 13,154 | 13,440 | 12,880 |
| mapCapturedHandlers fanout 64 | 7,949 | 8,018 | 8,111 |
| scope capture depth 16 | 79,093 | 77,920 | 78,029 |

The ordinary capture-depth target regressed at depth 16 in both runs. Scope capture improved slightly, but the overall capture/replay signal is mixed and not strong enough.

## Semantic Concern

This candidate changes the public array order returned by `captureHandlers`. The runtime can compensate inside `withHandlerContext` by processing in reverse, but user code can still inspect the returned `readonly CapturedHandler[]`.

The current tests only assert captured context length and replay behavior, not direct array order. Still, changing an observable public array order for no clear performance win is not worth keeping.

## Interpretation

The plain-array push/reverse idea is better than the tagged mutable variants because it avoids `Object.defineProperty`, `WeakSet`, and `unshift`. However, it still does not improve the main ordinary capture-depth path. It also changes public order semantics.

Reject this candidate. If capture construction is revisited, it likely needs a representation that:

- preserves public array order,
- does not add per-capture tagging/checking,
- avoids changing matched/depth-0 handler performance,
- has a clear materialization boundary before user code observes the context.

## Validation Output

- `pnpm typecheck`: passed
- `pnpm lint`: passed, 0 warnings and 0 errors
- `pnpm test`: passed, 323 tests
- `pnpm benchmark:runtime-loops`: passed twice
