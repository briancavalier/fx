# Cooperative All Evaluation

- Date: 2026-05-27T16:04:33.447Z
- Git SHA: 2f24d49
- Worktree: M examples/advanced/bookmarks/browser/assets/src/internal/withCoopConcurrency.js
 M src/internal/withCoopConcurrency.ts
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
| withUnboundedConcurrency ok fanout 16 | 7 | 256 | 1762 | 567545 | 482995 | 772960 | 1149967 | 1.00x | noisy |
| withCoopConcurrency ok fanout 16 | 7 | 1,024 | 5830 | 171537 | 125990 | 220181 | 255567 | 0.30x | noisy |
| withUnboundedConcurrency async fanout 16 | 7 | 128 | 963 | 1038446 | 795456 | 1286805 | 1395427 | 1.00x | noisy |
| withCoopConcurrency async fanout 16 | 7 | 256 | 1298 | 770231 | 629769 | 889606 | 1048148 | 0.74x | noisy |
| withUnboundedConcurrency explicit fork fanout 16 | 7 | 64 | 501 | 1994850 | 1437461 | 2183201 | 2339361 | 1.00x | noisy |
| withCoopConcurrency explicit fork fanout 16 | 7 | 128 | 507 | 1971643 | 1583415 | 2106479 | 3475435 | 0.99x | noisy |
| withUnboundedConcurrency yielding 16x16 | 7 | 256 | 1059 | 943975 | 627867 | 1076568 | 1087195 | 1.00x | noisy |
| withCoopConcurrency yielding 16x16 budget 1 | 7 | 256 | 1163 | 859488 | 743255 | 972677 | 2678375 | 0.91x | noisy |
| withCoopConcurrency yielding 16x16 budget 8 | 7 | 256 | 1454 | 687735 | 615735 | 829282 | 1272101 | 0.73x | noisy |
| withCoopConcurrency yielding 16x16 budget 64 | 7 | 128 | 1275 | 784560 | 520299 | 840314 | 1737747 | 0.83x | noisy |
| withUnboundedConcurrency mixed parked async | 7 | 256 | 1767 | 565785 | 430473 | 738436 | 1010726 | 1.00x | noisy |
| withCoopConcurrency mixed parked async budget 1 | 7 | 256 | 1882 | 531463 | 478978 | 821670 | 1146725 | 0.94x | noisy |
| firstSettled + withUnboundedConcurrency nested race | 7 | 256 | 1784 | 560581 | 445633 | 825560 | 830177 | 1.00x | noisy |
| withCoopConcurrency nested race | 7 | 512 | 3997 | 250178 | 178129 | 314780 | 391877 | 0.45x | noisy |
| firstSuccess + withUnboundedConcurrency nested firstSuccess | 7 | 128 | 1132 | 883439 | 562211 | 1068859 | 1201798 | 1.00x | noisy |
| withCoopConcurrency nested firstSuccess | 7 | 512 | 2309 | 433176 | 384115 | 576156 | 697450 | 0.49x | noisy |
| withUnboundedConcurrency cancel cleanup | 7 | 256 | 1316 | 759804 | 533263 | 799053 | 923808 | 1.00x | noisy |
| withCoopConcurrency cancel cleanup | 7 | 256 | 1868 | 535312 | 410142 | 686722 | 798265 | 0.70x | noisy |
