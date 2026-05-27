# Cooperative All Evaluation

- Date: 2026-05-27T15:53:19.155Z
- Git SHA: 178b079
- Worktree: M .gitignore
 M benchmarks/cooperative-all.ts
 M benchmarks/results/2026-05-26-cooperative-all-evaluation.md
 M package.json
?? tsconfig.benchmarks.json
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:cooperative-all:js`

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

Relative values use median ns/op; noisy rows have max/min > 1.25.

| Case | Samples | Iterations/sample | Ops/sec | Median ns/op | Min ns/op | P75 ns/op | Max ns/op | Relative to group baseline | Noise |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| withUnboundedConcurrency ok fanout 16 | 7 | 256 | 1429 | 699794 | 389345 | 827833 | 1027380 | 1.00x | noisy |
| withCoopConcurrency ok fanout 16 | 7 | 1,024 | 5213 | 191839 | 163922 | 235337 | 277906 | 0.27x | noisy |
| withUnboundedConcurrency async fanout 16 | 7 | 128 | 999 | 1000840 | 767979 | 1246573 | 1384482 | 1.00x | noisy |
| withCoopConcurrency async fanout 16 | 7 | 128 | 1586 | 630542 | 508196 | 1168176 | 1533040 | 0.63x | noisy |
| withUnboundedConcurrency explicit fork fanout 16 | 7 | 128 | 642 | 1558152 | 1382815 | 1794227 | 1809416 | 1.00x | noisy |
| withCoopConcurrency explicit fork fanout 16 | 7 | 128 | 456 | 2194337 | 1606428 | 2461571 | 3813409 | 1.41x | noisy |
| withUnboundedConcurrency yielding 16x16 | 7 | 256 | 1233 | 810775 | 531315 | 1026831 | 1078655 | 1.00x | noisy |
| withCoopConcurrency yielding 16x16 budget 1 | 7 | 256 | 1051 | 951915 | 730461 | 1189937 | 1289765 | 1.17x | noisy |
| withCoopConcurrency yielding 16x16 budget 8 | 7 | 256 | 1478 | 676763 | 577612 | 751533 | 797900 | 0.83x | noisy |
| withCoopConcurrency yielding 16x16 budget 64 | 7 | 256 | 1385 | 722214 | 519691 | 867792 | 1127790 | 0.89x | noisy |
| withUnboundedConcurrency mixed parked async | 7 | 512 | 2422 | 412805 | 353401 | 529743 | 969536 | 1.00x | noisy |
| withCoopConcurrency mixed parked async budget 1 | 7 | 512 | 1997 | 500689 | 430688 | 532626 | 739699 | 1.21x | noisy |
| firstSettled + withUnboundedConcurrency nested race | 7 | 256 | 1602 | 624407 | 539767 | 648144 | 1019465 | 1.00x | noisy |
| withCoopConcurrency nested race | 7 | 512 | 3969 | 251983 | 199441 | 339557 | 435078 | 0.40x | noisy |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 7 | 256 | 1569 | 637505 | 607538 | 710729 | 1401519 | 1.00x | noisy |
| withCoopConcurrency nested firstSuccess | 7 | 512 | 2250 | 444404 | 336311 | 471651 | 504660 | 0.70x | noisy |
| withUnboundedConcurrency cancel cleanup | 7 | 128 | 1576 | 634333 | 476223 | 870445 | 1220737 | 1.00x | noisy |
| withCoopConcurrency cancel cleanup | 7 | 256 | 1894 | 528081 | 394323 | 673861 | 903845 | 0.83x | noisy |
