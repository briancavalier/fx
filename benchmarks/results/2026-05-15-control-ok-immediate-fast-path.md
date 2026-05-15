# Candidate 6: Control `Ok` immediate fast path

## Candidate

After candidate 5 added the internal `Ok` shortcut to ordinary `Handler`, this experiment applies the same narrow fast path to `Control`.

When a matching control handler returns internal `Ok`, `Control` now uses `Ok.value` directly instead of delegating through `yield* withRuntimeContext(context, handled)`. The existing continuation bookkeeping is unchanged:

- if the handler does not call `resume`, the handled value still short-circuits the controlled computation;
- if the handler calls `resume`, `done` is reset and the underlying iterator is resumed;
- all non-`Ok` handler results still go through `withRuntimeContext`.

## Baseline

Baseline is the candidate 5 working tree before applying the `Control` fast path. These are from the third candidate 5 runtime-loop run, which was the final stable sample before this experiment.

| Case | ns/op |
| --- | ---: |
| control resume | 11,707 |
| control short-circuit | 3,781 |
| control pass-through depth 0 | 12,241 |
| control pass-through depth 1 | 20,795 |
| control pass-through depth 4 | 45,634 |
| control pass-through depth 8 | 77,906 |
| control pass-through depth 16 | 184,584 |
| handled fail | 11,869 |
| prebuilt handled fail | 5,575 |
| handled fail labels | 5,282 |
| handled fail off | 3,446 |

## Candidate Results

Runtime-loop run 1:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| control resume | 11,573 | -1.1% |
| control short-circuit | 4,001 | +5.8% |
| control pass-through depth 0 | 11,901 | -2.8% |
| control pass-through depth 1 | 21,230 | +2.1% |
| control pass-through depth 4 | 46,063 | +0.9% |
| control pass-through depth 8 | 79,264 | +1.7% |
| control pass-through depth 16 | 187,658 | +1.7% |

Runtime-loop run 2:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| control resume | 11,622 | -0.7% |
| control short-circuit | 3,778 | -0.1% |
| control pass-through depth 0 | 12,146 | -0.8% |
| control pass-through depth 1 | 20,814 | +0.1% |
| control pass-through depth 4 | 45,731 | +0.2% |
| control pass-through depth 8 | 79,821 | +2.5% |
| control pass-through depth 16 | 186,347 | +1.0% |

Trace benchmark after candidate:

| Case | ns/op |
| --- | ---: |
| handled fail | 11,844 |
| prebuilt handled fail | 6,048 |
| handled fail labels | 3,906 |
| handled fail off | 3,417 |

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm benchmark:runtime-loops` twice
- `pnpm benchmark:trace`

## Decision

Keep, but treat as marginal.

The matched `control resume` path improved in both samples, and the `control short-circuit` path was neutral after one noisy sample. Deep control pass-through was 1-2.5% slower, even though this branch is not taken by pass-through. That likely reflects benchmark or module-shape noise, but it should remain a watch item in any combined run.

The semantic argument is the same as candidate 5: internal `Ok` yields no effects and throws no errors, so skipping `withRuntimeContext` does not skip observable runtime-context attachment work. Non-`Ok` control handlers still use the existing path.
