# HandlerCaptureBoundary Direct Check Candidate

- Candidate: replace `HandlerCapture.is(ir.value)` with direct `_fxEffectId` comparison inside `HandlerCaptureBoundary`.
- Files changed during candidate: `src/HandlerCapture.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed.
- Decision: keep.

## Summary

This candidate is a small local reduction in an existing loop. It avoids a static `is` helper call after `isEffect` has already validated the yielded value as an effect.

It did not change public APIs, class shape, constructor shape, imports, or module graph.

## Primary Comparison

Expanded coverage baseline:

| Case | Baseline ns/op | Candidate ns/op |
| --- | ---: | ---: |
| handler capture boundary pass-through depth 0 | 14,306 | 14,054 |
| handler capture boundary pass-through depth 16 | 191,650 | 186,965 |
| handler capture boundary close depth 0 | 3,085 | 3,083 |
| handler capture boundary close depth 4 | 9,613 | 8,957 |
| handler capture boundary close depth 16 | 28,146 | 27,378 |

## Guardrails

Handler guardrails stayed in the expected range:

| Case | Candidate ns/op |
| --- | ---: |
| matched handler throughput | 10,100 |
| direct internal matched handler throughput | 10,070 |
| pass-through depth 0 | 12,342 |
| prebuilt pass-through depth 16 | 179,995 |
| direct internal pass-through depth 16 | 181,742 |

## Interpretation

This is a small positive candidate. Like the Handler miss-path change, it suggests direct effect-id checks are preferable inside hot loops once `isEffect` has already established the effect shape.
