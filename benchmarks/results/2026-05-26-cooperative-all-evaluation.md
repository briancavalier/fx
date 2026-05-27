# Cooperative All Evaluation

- Date: 2026-05-27T15:05:52.557Z
- Git SHA: 549f212
- Worktree: M benchmarks/cooperative-all.ts
 M examples/advanced/bookmarks/browser/assets/src/Concurrent.js
 M examples/advanced/bookmarks/browser/assets/src/internal/withCoopConcurrency.js
 M examples/advanced/incident-collector/cli.ts
 M src/Concurrent.test.ts
 M src/Concurrent.ts
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
| withUnboundedConcurrency ok fanout 16 | 1,000 | 254.00 | 3937 | 254003 | 1.00x |
| withCoopConcurrency ok fanout 16 | 1,000 | 93.39 | 10708 | 93385 | 0.37x |
| withUnboundedConcurrency async fanout 16 | 1,000 | 415.13 | 2409 | 415129 | 1.00x |
| withCoopConcurrency async fanout 16 | 1,000 | 334.67 | 2988 | 334671 | 0.81x |
| withUnboundedConcurrency explicit fork fanout 16 | 1,000 | 711.33 | 1406 | 711333 | 1.00x |
| withCoopConcurrency explicit fork fanout 16 | 1,000 | 898.21 | 1113 | 898210 | 1.26x |
| withUnboundedConcurrency yielding 16x16 | 250 | 76.74 | 3258 | 306944 | 1.00x |
| withCoopConcurrency yielding 16x16 budget 1 | 250 | 133.06 | 1879 | 532248 | 1.73x |
| withCoopConcurrency yielding 16x16 budget 8 | 250 | 81.62 | 3063 | 326487 | 1.06x |
| withCoopConcurrency yielding 16x16 budget 64 | 250 | 75.40 | 3316 | 301600 | 0.98x |
| withUnboundedConcurrency mixed parked async | 250 | 51.89 | 4818 | 207556 | 1.00x |
| withCoopConcurrency mixed parked async budget 1 | 250 | 88.34 | 2830 | 353376 | 1.70x |
| firstSettled + withUnboundedConcurrency nested race | 250 | 63.89 | 3913 | 255554 | 1.00x |
| withCoopConcurrency nested race | 250 | 26.71 | 9361 | 106823 | 0.42x |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 250 | 73.29 | 3411 | 293153 | 1.00x |
| withCoopConcurrency nested firstSuccess | 250 | 51.20 | 4883 | 204806 | 0.70x |
| withUnboundedConcurrency cancel cleanup | 250 | 79.38 | 3149 | 317516 | 1.00x |
| withCoopConcurrency cancel cleanup | 250 | 76.94 | 3249 | 307762 | 0.97x |
