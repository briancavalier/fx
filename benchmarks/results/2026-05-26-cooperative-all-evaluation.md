# Cooperative All Evaluation

- Date: 2026-05-27T15:45:42.285Z
- Git SHA: 491b0ca
- Worktree: M benchmarks/cooperative-all.ts
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

Relative values use median ns/op; noisy rows have max/min > 1.25.

| Case | Samples | Iterations/sample | Ops/sec | Median ns/op | Min ns/op | P75 ns/op | Max ns/op | Relative to group baseline | Noise |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| withUnboundedConcurrency ok fanout 16 | 7 | 512 | 1617 | 618583 | 589344 | 944461 | 952843 | 1.00x | noisy |
| withCoopConcurrency ok fanout 16 | 7 | 512 | 4491 | 222651 | 198463 | 255605 | 276647 | 0.36x | noisy |
| withUnboundedConcurrency async fanout 16 | 7 | 128 | 939 | 1065070 | 755930 | 1250553 | 1382945 | 1.00x | noisy |
| withCoopConcurrency async fanout 16 | 7 | 256 | 1268 | 788459 | 594976 | 1138728 | 1378940 | 0.74x | noisy |
| withUnboundedConcurrency explicit fork fanout 16 | 7 | 64 | 583 | 1715222 | 1519904 | 2138153 | 3019964 | 1.00x | noisy |
| withCoopConcurrency explicit fork fanout 16 | 7 | 64 | 467 | 2143388 | 1869129 | 2601603 | 3947670 | 1.25x | noisy |
| withUnboundedConcurrency yielding 16x16 | 7 | 128 | 1332 | 750997 | 676244 | 777983 | 779274 | 1.00x | ok |
| withCoopConcurrency yielding 16x16 budget 1 | 7 | 128 | 794 | 1258682 | 1124880 | 1413323 | 2625518 | 1.68x | noisy |
| withCoopConcurrency yielding 16x16 budget 8 | 7 | 256 | 1405 | 711498 | 639358 | 1050178 | 1164359 | 0.95x | noisy |
| withCoopConcurrency yielding 16x16 budget 64 | 7 | 256 | 1196 | 835895 | 589977 | 875376 | 922024 | 1.11x | noisy |
| withUnboundedConcurrency mixed parked async | 7 | 256 | 2019 | 495187 | 392712 | 519083 | 913018 | 1.00x | noisy |
| withCoopConcurrency mixed parked async budget 1 | 7 | 256 | 1337 | 748013 | 677658 | 995126 | 2966284 | 1.51x | noisy |
| firstSettled + withUnboundedConcurrency nested race | 7 | 256 | 1348 | 741595 | 674321 | 800532 | 802748 | 1.00x | ok |
| withCoopConcurrency nested race | 7 | 512 | 3174 | 315097 | 262359 | 416512 | 618288 | 0.42x | noisy |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 7 | 256 | 1219 | 820651 | 737237 | 897775 | 1337599 | 1.00x | noisy |
| withCoopConcurrency nested firstSuccess | 7 | 256 | 1927 | 518932 | 398069 | 590304 | 641366 | 0.63x | noisy |
| withUnboundedConcurrency cancel cleanup | 7 | 128 | 1528 | 654531 | 557817 | 791813 | 965751 | 1.00x | noisy |
| withCoopConcurrency cancel cleanup | 7 | 256 | 1543 | 647905 | 482473 | 885705 | 970192 | 0.99x | noisy |
