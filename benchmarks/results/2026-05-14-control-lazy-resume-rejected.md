# Control Lazy Resume Candidate

- Candidate: lazily allocate the `resume` closure in `Control.[Symbol.iterator]` only when a matching controlled effect is observed.
- Files changed during candidate: `src/internal/Handler.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed.
- Decision: reject and revert.

## Summary

The candidate improved non-matching control pass-through but regressed the matching `control resume` path enough to fail the guardrail.

## Comparison

Expanded coverage baseline:

| Case | Baseline ns/op | Candidate ns/op |
| --- | ---: | ---: |
| control resume | 11,872 | 12,477 |
| control short-circuit | 3,864 | 3,950 |
| control pass-through depth 0 | 12,230 | 12,136 |
| control pass-through depth 16 | 185,250 | 178,612 |

## Interpretation

This shows the same tradeoff at a smaller scale: avoiding setup work helps the non-matching path, but adding lazy initialization to the matched path makes `control resume` slower. Since matching `control` is a first-class hot path in the suite, this candidate should not be kept.
