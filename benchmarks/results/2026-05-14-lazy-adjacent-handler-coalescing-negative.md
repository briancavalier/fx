# Lazy Adjacent Handler Coalescing Prototype Results

- Date: 2026-05-14T19:56:21.204Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.
- Result: correctness passed, but performance did not meet acceptance gates.

## Summary

The lazy adjacent-handler coalescing prototype was correct but performance-negative. Moving the coalescing machinery into a separate internal module still left the handler hot path in the same slow regime as the previous flattened prototype:

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| matched handler throughput | 10,902 | 183,515 |
| pass-through depth 0 | 13,156 | 184,396 |
| pass-through depth 16 | 190,649 | 197,629 |
| replay depth 0 | 14,564 | 185,123 |

This suggests the cost is not only the coalesced dispatch loop. The public handler import/module shape and added adjacent-frame machinery are enough to move ordinary `Handler` execution into the slow regime in this benchmark process, even when `src/internal/Handler.ts` is restored and direct internal `Handler` execution is measured separately.

## Results

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 3670.30 | 5449 | 183515 | 1.00x |
| prebuilt matched handler throughput | 20,000 | 3617.97 | 5528 | 180899 | 0.99x |
| direct internal matched handler throughput | 20,000 | 3625.99 | 5516 | 181299 | 0.99x |
| pass-through depth 0 | 20,000 | 3687.93 | 5423 | 184396 | 1.00x |
| pass-through depth 1 | 20,000 | 3727.42 | 5366 | 186371 | 1.02x |
| pass-through depth 4 | 20,000 | 3730.72 | 5361 | 186536 | 1.02x |
| pass-through depth 8 | 20,000 | 3792.35 | 5274 | 189617 | 1.03x |
| pass-through depth 16 | 20,000 | 3952.57 | 5060 | 197629 | 1.08x |
| prebuilt pass-through depth 0 | 20,000 | 3693.97 | 5414 | 184699 | 1.01x |
| prebuilt pass-through depth 1 | 20,000 | 3683.60 | 5429 | 184180 | 1.00x |
| prebuilt pass-through depth 4 | 20,000 | 3723.28 | 5372 | 186164 | 1.01x |
| prebuilt pass-through depth 8 | 20,000 | 3770.80 | 5304 | 188540 | 1.03x |
| prebuilt pass-through depth 16 | 20,000 | 3901.84 | 5126 | 195092 | 1.06x |
| direct internal pass-through depth 0 | 20,000 | 3681.52 | 5433 | 184076 | 1.00x |
| direct internal pass-through depth 1 | 20,000 | 3679.51 | 5436 | 183975 | 1.00x |
| direct internal pass-through depth 4 | 20,000 | 3708.90 | 5392 | 185445 | 1.01x |
| direct internal pass-through depth 8 | 20,000 | 3765.36 | 5312 | 188268 | 1.03x |
| direct internal pass-through depth 16 | 20,000 | 3886.28 | 5146 | 194314 | 1.06x |
| construct handler stack depth 0 | 20,000 | 5.53 | 3613751 | 277 | 0.00x |
| construct handler stack depth 1 | 20,000 | 8.66 | 2308802 | 433 | 0.00x |
| construct handler stack depth 4 | 20,000 | 13.22 | 1513303 | 661 | 0.00x |
| construct handler stack depth 8 | 20,000 | 23.75 | 842031 | 1188 | 0.01x |
| construct handler stack depth 16 | 20,000 | 30.05 | 665461 | 1503 | 0.01x |
| matched handler outermost | 20,000 | 6571.22 | 3044 | 328561 | 1.79x |
| matched handler middle | 20,000 | 4932.03 | 4055 | 246602 | 1.34x |
| matched handler innermost | 20,000 | 3700.06 | 5405 | 185003 | 1.01x |
| control resume | 20,000 | 249.41 | 80189 | 12471 | 0.07x |
| control short-circuit | 20,000 | 79.77 | 250707 | 3989 | 0.02x |
| capture depth 0 | 20,000 | 74.72 | 267661 | 3736 | 1.00x |
| capture depth 1 | 20,000 | 94.77 | 211042 | 4738 | 1.27x |
| capture depth 4 | 20,000 | 121.98 | 163961 | 6099 | 1.63x |
| capture depth 8 | 20,000 | 160.74 | 124423 | 8037 | 2.15x |
| capture depth 16 | 20,000 | 236.66 | 84509 | 11833 | 3.17x |
| replay depth 0 | 20,000 | 3702.46 | 5402 | 185123 | 49.55x |
| replay depth 1 | 20,000 | 3736.16 | 5353 | 186808 | 50.00x |
| replay depth 4 | 20,000 | 3692.73 | 5416 | 184636 | 49.42x |
| replay depth 8 | 20,000 | 3695.01 | 5413 | 184750 | 49.45x |
| replay depth 16 | 20,000 | 3698.74 | 5407 | 184937 | 49.50x |
| mapCapturedHandlers fanout 1 | 20,000 | 87.29 | 229110 | 4365 | 1.17x |
| mapCapturedHandlers fanout 4 | 20,000 | 88.09 | 227053 | 4404 | 1.18x |
| mapCapturedHandlers fanout 16 | 20,000 | 127.30 | 157111 | 6365 | 1.70x |
| mapCapturedHandlers fanout 64 | 20,000 | 173.61 | 115198 | 8681 | 2.32x |
| pure runPromise | 2,000 | 24.97 | 80104 | 12484 | 1.00x |
| sequential async x10 | 2,000 | 352.77 | 5669 | 176387 | 14.13x |
| fork fanout 16 unbounded | 2,000 | 1362.47 | 1468 | 681234 | 54.57x |
| fork fanout 16 bounded 1 | 2,000 | 1373.23 | 1456 | 686616 | 55.00x |
| fork fanout 16 bounded 4 | 2,000 | 1361.25 | 1469 | 680623 | 54.52x |
| fork fanout 16 bounded 16 | 2,000 | 1353.58 | 1478 | 676791 | 54.21x |
| all fanout 16 | 2,000 | 473.68 | 4222 | 236840 | 18.97x |
| race fanout 16 | 2,000 | 464.82 | 4303 | 232412 | 18.62x |
| dispose blocked task | 1,000 | 26.09 | 38332 | 26088 | 1.00x |
| dispose blocked scoped task | 1,000 | 36.89 | 27109 | 36888 | 1.41x |
| dispose blocked fork | 1,000 | 66.55 | 15027 | 66547 | 2.55x |
