# Cooperative All Evaluation

- Date: 2026-05-27T15:30:21.116Z
- Git SHA: 8894dc8
- Worktree: M examples/advanced/bookmarks/browser/assets/src/internal/withCoopConcurrency.js
 M src/internal/withCoopConcurrency.ts
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
| withUnboundedConcurrency ok fanout 16 | 1,000 | 1605.63 | 623 | 1605628 | 1.00x |
| withCoopConcurrency ok fanout 16 | 1,000 | 395.85 | 2526 | 395851 | 0.25x |
| withUnboundedConcurrency async fanout 16 | 1,000 | 1866.01 | 536 | 1866007 | 1.00x |
| withCoopConcurrency async fanout 16 | 1,000 | 1380.77 | 724 | 1380765 | 0.74x |
| withUnboundedConcurrency explicit fork fanout 16 | 1,000 | 3298.14 | 303 | 3298137 | 1.00x |
| withCoopConcurrency explicit fork fanout 16 | 1,000 | 2657.80 | 376 | 2657801 | 0.81x |
| withUnboundedConcurrency yielding 16x16 | 250 | 196.02 | 1275 | 784069 | 1.00x |
| withCoopConcurrency yielding 16x16 budget 1 | 250 | 400.53 | 624 | 1602120 | 2.04x |
| withCoopConcurrency yielding 16x16 budget 8 | 250 | 234.34 | 1067 | 937357 | 1.20x |
| withCoopConcurrency yielding 16x16 budget 64 | 250 | 192.71 | 1297 | 770850 | 0.98x |
| withUnboundedConcurrency mixed parked async | 250 | 138.19 | 1809 | 552772 | 1.00x |
| withCoopConcurrency mixed parked async budget 1 | 250 | 211.81 | 1180 | 847224 | 1.53x |
| firstSettled + withUnboundedConcurrency nested race | 250 | 172.91 | 1446 | 691639 | 1.00x |
| withCoopConcurrency nested race | 250 | 85.14 | 2936 | 340577 | 0.49x |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 250 | 199.99 | 1250 | 799960 | 1.00x |
| withCoopConcurrency nested firstSuccess | 250 | 117.89 | 2121 | 471577 | 0.59x |
| withUnboundedConcurrency cancel cleanup | 250 | 172.75 | 1447 | 691011 | 1.00x |
| withCoopConcurrency cancel cleanup | 250 | 169.59 | 1474 | 678360 | 0.98x |
