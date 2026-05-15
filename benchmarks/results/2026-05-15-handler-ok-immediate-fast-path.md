# Candidate 5: Handler `Ok` immediate fast path

## Candidate

Many handlers return `ok(value)`. The normal matched-handler path calls the handler, wraps the returned `Fx` with `withRuntimeContext` when needed, then delegates through `yield*`. For internal `Ok`, that delegation immediately returns the stored value and yields no effects.

This experiment keeps the shortcut narrow: after a matching handler returns, if the result is internal `Ok`, resume the underlying iterator directly with `Ok.value`. All other handler results still use `yield* withRuntimeContext(context, handled)`.

## Baseline

Baseline was measured from clean commit `e72d266`.

| Case | ns/op |
| --- | ---: |
| matched handler throughput | 10,064 |
| prebuilt matched handler throughput | 9,934 |
| direct internal matched handler throughput | 10,037 |
| matched handler outermost | 15,811 |
| matched handler middle | 28,997 |
| matched handler innermost | 35,740 |
| handler capture boundary pass-through depth 16 | 179,095 |
| run interrupt mask x100 | 127,936 |

## Candidate Results

Run 1:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| matched handler throughput | 9,782 | -2.8% |
| prebuilt matched handler throughput | 9,626 | -3.1% |
| direct internal matched handler throughput | 9,951 | -0.9% |
| matched handler outermost | 15,907 | +0.6% |
| matched handler middle | 29,295 | +1.0% |
| matched handler innermost | 35,546 | -0.5% |
| handler capture boundary pass-through depth 16 | 175,954 | -1.8% |
| run interrupt mask x100 | 122,769 | -4.0% |

Run 2:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| matched handler throughput | 9,868 | -1.9% |
| prebuilt matched handler throughput | 9,620 | -3.2% |
| direct internal matched handler throughput | 10,038 | +0.0% |
| matched handler outermost | 15,474 | -2.1% |
| matched handler middle | 29,012 | +0.1% |
| matched handler innermost | 35,381 | -1.0% |
| handler capture boundary pass-through depth 16 | 213,379 | +19.1% |
| run interrupt mask x100 | 151,800 | +18.7% |

Run 3:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| matched handler throughput | 9,962 | -1.0% |
| prebuilt matched handler throughput | 9,703 | -2.3% |
| direct internal matched handler throughput | 9,997 | -0.4% |
| matched handler outermost | 15,781 | -0.2% |
| matched handler middle | 29,409 | +1.4% |
| matched handler innermost | 35,276 | -1.3% |
| handler capture boundary pass-through depth 16 | 176,417 | -1.5% |
| run interrupt mask x100 | 125,438 | -2.0% |

The second run had broad unrelated noise: `run interrupt mask x100` and `pure runPromise` also spiked despite this candidate only touching `Handler`. The third run returned those guardrails to the expected range.

## Trace and Runtime Context Guardrails

`pnpm benchmark:trace` completed successfully. Relevant handled-failure cases:

| Case | ns/op |
| --- | ---: |
| handled fail | 11,869 |
| prebuilt handled fail | 5,575 |
| handled fail labels | 5,282 |
| handled fail off | 3,446 |

`pnpm benchmark:runtime-context` completed successfully. Relevant handled-effect cases:

| Case | ns/op |
| --- | ---: |
| handled effects baseline | 9,886 |
| handled effects global off | 9,487 |
| handled effects ambient active off | 9,407 |
| handled effects regional off | 28,929 |
| handled effects regional labels | 28,593 |
| handled effects regional full | 28,435 |

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm benchmark:runtime-loops` baseline once and candidate three times
- `pnpm benchmark:trace`
- `pnpm benchmark:runtime-context`

## Decision

Keep.

The candidate produces repeatable small wins for the main matched-handler cases and keeps the implementation narrowly scoped to internal `Ok`. It does not change behavior for handlers that return effects, fail, throw, or otherwise require runtime-context wrapping. The observed regressions in run 2 were broad benchmark noise rather than a repeated candidate-specific signal.
