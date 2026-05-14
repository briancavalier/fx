# Runtime Context Attach Inline Check Candidate

- Candidate: inline the existing runtime-context presence check inside `attachRuntimeContext`.
- Files changed during candidate: `src/internal/runtimeContext.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm benchmark:runtime-context` passed.
- Decision: keep.

## Summary

This candidate removes an internal `getRuntimeContext(...)` call from `attachRuntimeContext` after `attachRuntimeContext` has already checked that the target is an object. It preserves public API and module shape.

## Benchmark Comparison

Runtime-context baseline before candidate:

| Case | Baseline ns/op | Candidate ns/op |
| --- | ---: | ---: |
| handled effects baseline | 10,197 | 9,785 |
| handled effects global off | 9,525 | 9,193 |
| handled effects ambient active off | 9,531 | 9,272 |
| handled effects regional off | 33,836 | 32,813 |
| handled effects regional labels | 33,448 | 32,786 |
| handled effects regional full | 33,047 | 32,572 |

## Interpretation

This is a small local win in the runtime-context path. It avoids duplicate object/null checks and an extra function call in a path that runs for every yielded effect inside a regional runtime context.
