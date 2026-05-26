# Benchmark Harness Fix And Trace Regression Investigation

- Date: 2026-05-26
- Worktree: `/private/tmp/fx-benchmark-harness-regressions`
- Branch: `codex/benchmark-harness-regressions`
- Base SHA: `192e251`
- Node: `v24.14.0`
- Platform: `darwin 25.3.0 arm64`

## Summary

- Fixed `pnpm benchmark:runtime-loops` after scope and task lifecycle API changes.
- Investigated the trace labels/off regressions from `benchmarks/results/2026-05-25-weekly-benchmarks.md`.
- Found the main regression point at `fefff46` (`Finalize scopes on task interruption`).
- Kept the cleanup semantics and removed an avoidable runtime-boundary cost instead: `run`, `runTask`, and `runFork` now handle the default empty environment directly instead of wrapping every runtime execution in `provideAll({})`.

## Harness Fix

`benchmarks/runtime-loops.ts` had two stale API assumptions:

- `scope(name)` now creates a scope token; the handler is `withScope(scopeToken)`.
- `Task` interruption is now `task.interrupt()`, replacing the old disposal helpers used by the benchmark.

The benchmark now runs successfully and preserves existing benchmark names for historical comparison.

## Regression Root Cause

The trace regression was not primarily trace-policy-specific. `run` and `runTask` always wrapped programs with `provideAll({})`, which adds a general handler around every runtime execution. After `fefff46`, handlers and controls gained generator `try/finally` cleanup paths so interrupted tasks can drain yielded cleanup effects. That semantic fix made the previously cheap default environment wrapper visible in hot paths.

The fix keeps cleanup draining intact and handles `Get` at the runtime boundary:

- `run` resumes `Get` effects with `{}` directly.
- `runFork` resumes `Get` effects with `{}` directly.
- `runTask` no longer wraps the program with `provideAll({})`.

## Commit Sweep

Selected rows from the same-machine commit sweep:

| Commit | pure runtime baseline | handled fail labels | handled fail off | successful assertPromise labels | successful assertPromise off |
| --- | ---: | ---: | ---: | ---: | ---: |
| `35db822` | 135 | 573 | 530 | 937 | 884 |
| `5ae689b` | 133 | 735 | 548 | 970 | 942 |
| `fefff46` | 1186 | 2334 | 5531 | 3410 | 2878 |
| `192e251` before fix | 1178 | 2137 | 2045 | 2722 | 2188 |
| candidate final | 235 | 2500 | 1913 | 1594 | 1126 |

## Trace Results

Compared against the current pre-fix run from this worktree:

| Case | Before ns/op | After ns/op | Change |
| --- | ---: | ---: | ---: |
| pure runtime baseline | 1178 | 235 | -80.1% |
| successful assertPromise labels | 2722 | 1594 | -41.4% |
| successful assertPromise off | 2188 | 1126 | -48.5% |
| nested fork failure labels | 61647 | 59942 | -2.8% |
| nested fork failure off | 57430 | 50637 | -11.8% |
| handled fail | 6655 | 6047 | -9.1% |
| prebuilt handled fail | 3842 | 1701 | -55.7% |
| handled fail labels | 2137 | 2500 | +17.0% |
| handled fail off | 2045 | 1913 | -6.5% |

Compared against the saved `2026-05-07-trace-policy-and-fast-paths.md` artifact, the runtime-boundary rows are back near or better than the old artifact:

| Case | Saved ns/op | After ns/op | Change |
| --- | ---: | ---: | ---: |
| pure runtime baseline | 233 | 235 | +0.9% |
| successful assertPromise labels | 1670 | 1594 | -4.6% |
| successful assertPromise off | 1579 | 1126 | -28.7% |
| nested fork failure labels | 63256 | 59942 | -5.2% |
| nested fork failure off | 59227 | 50637 | -14.5% |

## Remaining Regression

`handled fail labels` and `handled fail off` remain slower than the May 7 artifact. Those rows are synchronous `control(Fail, ...)` paths, not runtime-boundary `runTask` paths. They still pay the handler/control cleanup-drain overhead introduced for interrupted-finalizer correctness. A follow-up should investigate whether `Handler` and `Control` can avoid generator `try/finally` cost on normal completion without giving up cleanup draining on runtime `return()`.

## Validation

- `corepack pnpm benchmark:trace`: pass
- `corepack pnpm benchmark:runtime-context`: pass
- `corepack pnpm benchmark:runtime-loops`: pass
- `corepack pnpm build`: pass
- `corepack pnpm lint`: pass
- `corepack pnpm test`: pass
- `corepack pnpm typecheck`: pass after `build` generated package declarations for example package imports
