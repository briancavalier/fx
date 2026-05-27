# Cooperative All Evaluation

- Date: 2026-05-27T14:17:33.513Z
- Git SHA: 2eca93e
- Worktree: dirty
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:cooperative-all`

## Semantic Checks

- Parity success/failure checks: pass

## Fairness

| Case | Total steps | Max consecutive same-child steps | First-step spread |
| --- | ---: | ---: | ---: |
| withUnboundedConcurrency | 256 | 16 | 240 |
| withCoopConcurrency budget 1 | 256 | 1 | 15 |
| withCoopConcurrency budget 8 | 256 | 8 | 120 |
| withCoopConcurrency budget 64 | 256 | 16 | 240 |

## Performance

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative to group baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| withUnboundedConcurrency ok fanout 16 | 1,000 | 251.26 | 3980 | 251265 | 1.00x |
| withCoopConcurrency ok fanout 16 | 1,000 | 71.87 | 13915 | 71865 | 0.29x |
| withUnboundedConcurrency async fanout 16 | 1,000 | 411.36 | 2431 | 411364 | 1.00x |
| withCoopConcurrency async fanout 16 | 1,000 | 297.91 | 3357 | 297905 | 0.72x |
| withUnboundedConcurrency yielding 16x16 | 250 | 76.45 | 3270 | 305797 | 1.00x |
| withCoopConcurrency yielding 16x16 budget 1 | 250 | 57.56 | 4344 | 230226 | 0.75x |
| withCoopConcurrency yielding 16x16 budget 8 | 250 | 54.53 | 4585 | 218106 | 0.71x |
| withCoopConcurrency yielding 16x16 budget 64 | 250 | 54.50 | 4588 | 217983 | 0.71x |
| withUnboundedConcurrency mixed parked async | 250 | 51.43 | 4861 | 205725 | 1.00x |
| withCoopConcurrency mixed parked async budget 1 | 250 | 50.53 | 4947 | 202123 | 0.98x |
| firstSettled + withUnboundedConcurrency nested race | 250 | 62.91 | 3974 | 251650 | 1.00x |
| withCoopConcurrency nested race | 250 | 23.85 | 10480 | 95419 | 0.38x |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 250 | 72.86 | 3431 | 291422 | 1.00x |
| withCoopConcurrency nested firstSuccess | 250 | 47.09 | 5309 | 188367 | 0.65x |
| withUnboundedConcurrency cancel cleanup | 250 | 78.22 | 3196 | 312899 | 1.00x |
| withCoopConcurrency cancel cleanup | 250 | 60.69 | 4120 | 242742 | 0.78x |
