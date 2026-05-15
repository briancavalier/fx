# Runtime Context Attachment Alternatives

## Candidate

This experiment evaluated two alternatives from the runtime-context section of the research notes:

1. Store runtime metadata in an internal `WeakMap<object, RuntimeContext>` instead of attaching a non-enumerable symbol property with `Object.defineProperty`.
2. Keep symbol-property attachment, but skip `withActiveRuntimeContext` merging when the requested context is already the active context by object identity.

The target workload is regional runtime context, especially handled effects inside `withTraceCapture(...)`.

## Baseline

Baseline was measured from clean commit `e3d6b6c`.

| Case | ns/op |
| --- | ---: |
| direct call | 1 |
| withActiveRuntimeContext active | 11 |
| handled effects baseline | 9,585 |
| handled effects global off | 9,097 |
| handled effects ambient active off | 9,168 |
| handled effects regional off | 28,527 |
| handled effects regional labels | 28,216 |
| handled effects regional full | 27,939 |

## WeakMap Metadata Prototype

Prototype:

- `attachRuntimeContext` stored metadata in `WeakMap<object, RuntimeContext>`.
- `getRuntimeContext` read from that `WeakMap`.
- The previous symbol property and `Object.defineProperty` attachment path were removed.

Validation:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Results:

| Case | Baseline ns/op | WeakMap run 1 ns/op | WeakMap run 2 ns/op |
| --- | ---: | ---: | ---: |
| handled effects baseline | 9,585 | 10,296 | 10,383 |
| handled effects global off | 9,097 | 9,905 | 9,928 |
| handled effects ambient active off | 9,168 | 9,800 | 9,798 |
| handled effects regional off | 28,527 | 34,085 | 32,848 |
| handled effects regional labels | 28,216 | 31,070 | 30,803 |
| handled effects regional full | 27,939 | 31,571 | 31,901 |

Decision: reject.

The target regional cases regressed by roughly 9-19%, and even the non-regional handled-effect cases slowed down. The semantic profile is also less conservative: `WeakMap` can associate context with non-extensible objects where `Object.defineProperty` previously failed silently.

## Active Context Identity No-Op Prototype

Prototype:

- Restored symbol-property attachment.
- Added a fast path to `withActiveRuntimeContext`: when `activeRuntimeContext === context`, call `f()` directly rather than merging and installing a fresh object.

Validation:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Results:

| Case | Baseline ns/op | Identity run 1 ns/op | Identity run 2 ns/op |
| --- | ---: | ---: | ---: |
| withActiveRuntimeContext active | 11 | 11 | 12 |
| handled effects baseline | 9,585 | 9,768 | 9,744 |
| handled effects global off | 9,097 | 9,387 | 9,286 |
| handled effects ambient active off | 9,168 | 9,365 | 9,371 |
| handled effects regional off | 28,527 | 28,791 | 28,444 |
| handled effects regional labels | 28,216 | 28,465 | 28,730 |
| handled effects regional full | 27,939 | 28,134 | 28,519 |

Decision: reject.

This was much better than the `WeakMap` prototype but still did not produce a repeatable improvement. Regional cases were neutral to slightly slower, and the direct `withActiveRuntimeContext active` case did not improve.

## Overall Decision

Reject both runtime-context attachment alternatives for now and keep the existing symbol-property metadata path unchanged.

The current `Object.defineProperty` approach remains faster than `WeakMap` for the measured workloads. The identity no-op is semantically safe, but the branch does not pay for itself in the current benchmark suite.
