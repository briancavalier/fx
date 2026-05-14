# Runtime Loop Performance Analysis

Based on the initial runtime-loop benchmark baseline, the highest-value performance areas are:

## 1. Handler stack pass-through

The clearest signal is pass-through depth:

| Case | ns/op |
| --- | ---: |
| pass-through depth 0 | 13,156 |
| pass-through depth 4 | 46,733 |
| pass-through depth 8 | 81,043 |
| pass-through depth 16 | 190,649 |

That is almost linear-to-worse growth as non-matching handlers wrap the same yielded effect. This points at `src/internal/Handler.ts`: every non-matching handler adds another generator boundary, `isEffect` check, effect-id comparison, `yield`, and `i.next(...)` bounce.

Highest-value questions:

- Can adjacent handlers be represented in a flatter handler frame at construction time?
- Can handler lookup avoid walking nested generator wrappers for non-matches?
- Can captured/replayed handlers preserve simple dispatch without rebuilding deep wrapper chains?

## 2. Fork fan-out

Forking 16 pure children is expensive:

| Case | ns/op |
| --- | ---: |
| pure runPromise | 12,720 |
| fork fanout 16 unbounded | 677,707 |
| fork fanout 16 bounded 1 | 678,424 |
| fork fanout 16 bounded 4 | 670,646 |
| fork fanout 16 bounded 16 | 668,490 |

Bounded vs unbounded is nearly the same, suggesting semaphore contention is not the dominant cost. The likely cost is task/runtime setup: `runForkInternal`, `Promise.withResolvers`, `InterruptState`, `Task`, trace/fork origin handling, handler capture/replay, disposable bookkeeping, and child promise coordination.

Highest-value places:

- `src/internal/runFork.ts`: `runFork`, `acquireAndRunFork`, `runForkInternal`
- `src/Concurrent.ts`: `fork`, `forkEach`, `bounded`
- Trace capture in fork construction, especially for already-pure children

## 3. Sequential Async stepping

`sequential async x10` is roughly 14x pure `runPromise` in the saved baseline. That path pays per async effect:

- `Async.is`
- `runTask`
- `AbortController`
- `Task`
- disposable add/remove
- `Promise.race([promise, unhandled])`
- runtime-context resume

The biggest likely win is reducing fixed per-`Async` overhead, especially for already-resolved promises.

## 4. Handler capture depth

Capture depth scales sharply:

| Case | ns/op |
| --- | ---: |
| capture depth 0 | 4,148 |
| capture depth 16 | 37,526 |

This matters because `fork`, `all`, `race`, timeout, and server boundaries all rely on capture/replay. Capture replay itself did not grow much by depth in this benchmark, but capture construction did.

Look at:

- `HandlerCapture` interception in `Handler`
- `withHandlerContext` replay shape
- Whether common captures can avoid array spreading or nested wrapper reconstruction

## 5. Structured concurrency overhead

`all fanout 16` and `race fanout 16` are much cheaper than explicit fork/wait fanout, but still around 230k ns/op. This is worth investigating after fork setup is better understood. Improvements here may come from fork setup and handler capture improvements.

## Lower-priority signals

- `control resume` is only modestly slower than `handle`.
- `control short-circuit` is faster in this benchmark because it exits after the first effect, so it is not comparable to full 100-effect throughput.
- Interrupt cleanup has measurable overhead, but the absolute numbers are much smaller than fork fan-out and deep handler pass-through.

## Recommended investigation order

1. Deep non-matching handler pass-through.
2. Fork child setup overhead for pure child programs.
3. Per-`Async` fixed overhead.
4. Handler capture construction at runtime boundaries.
5. Structured `all`/`race` after fork/capture findings.
