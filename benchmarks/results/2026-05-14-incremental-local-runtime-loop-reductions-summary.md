# Incremental Local Runtime Loop Reductions

- Date: 2026-05-14T21:00:23.738Z
- Git SHA: d72d784
- Worktree: `/private/tmp/fx-runtime-loop-benchmarks`
- Branch: `bench/runtime-loop-benchmarks`
- Worktree state: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Final runtime-loop command: `pnpm benchmark:runtime-loops`
- Final correctness checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`

## Final Kept Diff Summary

```text
package.json                   | 1 +
src/HandlerCapture.ts          | 2 +-
src/internal/Handler.ts        | 9 +++++----
src/internal/runtimeContext.ts | 2 +-
4 files changed, 8 insertions(+), 6 deletions(-)
```

Kept runtime changes:

- `Handler`: lazy allocation of the captured handler wrapper and direct `HandlerCapture._fxEffectId` check on the ordinary miss path.
- `HandlerCaptureBoundary`: direct `_fxEffectId` check after `isEffect` has already validated the yielded value.
- `runtimeContext`: inline runtime-context presence check in `attachRuntimeContext` to avoid the helper call on an already guarded object.

Kept benchmark changes:

- Added `pnpm benchmark:runtime-loops`.
- Added expanded runtime-loop coverage for handler execution/construction, direct internal handler execution, control pass-through, scope pass-through/finalizer/capture paths, handler capture boundary pass-through/close paths, and interrupt-mask loops.

## Candidate Decisions

| Candidate | Decision | Reason |
| --- | --- | --- |
| Miss-path minimal `Handler` | Keep | Correctness passed; repeated benchmarks showed useful handler miss-path and capture-depth improvements without the fixed-cost cliff seen in flattened/coalesced prototypes. |
| Scope lazy capture/direct check | Revert | Correctness passed, but scope capture/finalizer signals were noisy and included regressions; not enough evidence to keep. |
| `HandlerCaptureBoundary` direct check | Keep | Correctness passed; boundary pass-through improved modestly with no broad handler guardrail regression. |
| `Control` lazy resume closure | Revert | Pass-through improved, but `control resume` regressed beyond the guardrail. |
| Runtime-context attach inline check | Keep | Correctness passed; `benchmark:runtime-context` showed small regional context improvements without changing module shape. |
| `run` interrupt-mask direct check | Revert | Correctness passed, but `run interrupt mask x100` regressed slightly, suggesting the existing checks are already well optimized. |

## Final Runtime-Loop Benchmark Highlights

The final cumulative benchmark includes only kept runtime changes.

| Case | ns/op |
| --- | ---: |
| matched handler throughput | 10,250 |
| prebuilt matched handler throughput | 10,080 |
| direct internal matched handler throughput | 10,278 |
| pass-through depth 0 | 11,887 |
| prebuilt pass-through depth 0 | 11,645 |
| direct internal pass-through depth 0 | 11,673 |
| pass-through depth 16 | 181,419 |
| prebuilt pass-through depth 16 | 190,968 |
| direct internal pass-through depth 16 | 200,690 |
| capture depth 0 | 3,452 |
| capture depth 16 | 26,791 |
| replay depth 0 | 13,718 |
| control resume | 12,133 |
| control short-circuit | 3,958 |
| control pass-through depth 16 | 185,987 |
| scope pass-through depth 16 | 369,737 |
| scope finalizer registration depth 16 | 48,097 |
| scope capture depth 16 | 99,273 |
| handler capture boundary pass-through depth 16 | 185,875 |
| handler capture boundary close depth 16 | 27,867 |
| run interrupt mask x100 | 119,258 |

## Interpretation

The useful pattern is narrow and local: moving rare capture/context work behind a cheap check can help without changing the object/module shape that V8 currently optimizes. The accepted handler change suggests that avoiding wrapper allocation on ordinary misses is worthwhile, especially for deep pass-through and capture-heavy measurements.

The rejected candidates are equally informative. Similar-looking reductions are not portable across loops: `Control` favored the existing eager resume closure on the resume path, `ScopeBoundary` showed unstable or negative results despite matching the same shape, and `run` did not benefit from direct interrupt-mask id checks. Each loop needs its own benchmark coverage and independent acceptance decision.

## Next Prototype Direction

The highest-value next work is not another structural handler representation. Instead, continue with isolated, per-loop micro-reductions only where benchmark coverage already identifies a cost center:

- Scope pass-through remains very expensive at depth, but previous local capture changes were inconclusive. Any next scope prototype should target pass-through specifically, not capture/finalizer paths.
- Handler capture boundary pass-through still scales with depth and may have more local miss-path opportunities.
- Runtime-context attachment should be explored with `benchmark:runtime-context`, not handler-loop benchmarks.
- `run` interrupt-mask changes should be left alone unless a different benchmark isolates a clearer repeated operation.
