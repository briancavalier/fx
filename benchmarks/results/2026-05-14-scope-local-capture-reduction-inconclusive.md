# Scope Local Capture Reduction Candidate

- Candidate: lazy `CapturedHandler` allocation plus direct `HandlerCapture._fxEffectId` check in `ScopeBoundary`.
- Files changed during candidate: `src/Scope.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed.
- Decision: do not keep. Revert this candidate before continuing.

## Summary

The Scope candidate was correct but not stable enough to accept. It showed some pass-through improvement, but scope finalizer and scope capture measurements were noisy and included regressions larger than the 5% guardrail.

## Comparison

Expanded coverage baseline:

| Case | Baseline ns/op |
| --- | ---: |
| scope pass-through depth 0 | 13,468 |
| scope pass-through depth 16 | 359,625 |
| scope finalizer registration depth 16 | 47,485 |
| scope capture depth 0 | 3,647 |
| scope capture depth 8 | 50,384 |
| scope capture depth 16 | 97,416 |

Candidate run 1:

| Case | Candidate ns/op |
| --- | ---: |
| scope pass-through depth 0 | 13,182 |
| scope pass-through depth 16 | 353,317 |
| scope finalizer registration depth 16 | 47,509 |
| scope capture depth 0 | 3,768 |
| scope capture depth 8 | 53,322 |
| scope capture depth 16 | 99,997 |

Candidate run 2:

| Case | Candidate ns/op |
| --- | ---: |
| scope pass-through depth 0 | 12,520 |
| scope pass-through depth 16 | 353,823 |
| scope finalizer registration depth 16 | 54,013 |
| scope capture depth 0 | 5,028 |
| scope capture depth 8 | 49,702 |
| scope capture depth 16 | 95,154 |

## Interpretation

The direct miss-path reduction may help scope pass-through slightly, but the broader scope benchmarks did not remain within the acceptance guardrails. Since Scope has more cleanup/runtime-context work than ordinary Handler, this candidate needs a more focused investigation before being kept.

The safest next step is to revert the Scope change and continue with smaller independent candidates.
