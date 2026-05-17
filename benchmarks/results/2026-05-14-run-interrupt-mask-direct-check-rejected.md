# Run Interrupt Mask Direct Check Candidate

- Candidate: cache `ir.value` and compare `_fxEffectId` directly for `InterruptMaskBegin`/`InterruptMaskEnd` in `run`.
- Files changed during candidate: `src/Fx.ts`
- Verification: `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed.
- Decision: reject and revert.

## Summary

The candidate did not improve the new `run interrupt mask x100` benchmark.

| Case | Baseline ns/op | Candidate ns/op |
| --- | ---: | ---: |
| run interrupt mask x100 | 119,748 | 120,717 |

## Interpretation

The current `InterruptMaskBegin.is` / `InterruptMaskEnd.is` checks in `run` are already competitive for this path. The direct-check rewrite added no measurable value and should not be kept.
