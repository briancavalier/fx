# Fx Runtime Loop Benchmark Results

- Date: 2026-05-14T17:46:20.932Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 218.04 | 91727 | 10902 | 1.00x |
| pass-through depth 0 | 20,000 | 263.12 | 76010 | 13156 | 1.21x |
| pass-through depth 1 | 20,000 | 430.74 | 46432 | 21537 | 1.98x |
| pass-through depth 4 | 20,000 | 934.66 | 21398 | 46733 | 4.29x |
| pass-through depth 8 | 20,000 | 1620.86 | 12339 | 81043 | 7.43x |
| pass-through depth 16 | 20,000 | 3812.98 | 5245 | 190649 | 17.49x |
| matched handler outermost | 20,000 | 352.75 | 56697 | 17638 | 1.62x |
| matched handler middle | 20,000 | 620.86 | 32213 | 31043 | 2.85x |
| matched handler innermost | 20,000 | 755.28 | 26480 | 37764 | 3.46x |
| control resume | 20,000 | 255.38 | 78314 | 12769 | 1.17x |
| control short-circuit | 20,000 | 81.03 | 246833 | 4051 | 0.37x |
| capture depth 0 | 20,000 | 82.97 | 241056 | 4148 | 1.00x |
| capture depth 1 | 20,000 | 120.37 | 166152 | 6019 | 1.45x |
| capture depth 4 | 20,000 | 217.06 | 92142 | 10853 | 2.62x |
| capture depth 8 | 20,000 | 374.15 | 53455 | 18707 | 4.51x |
| capture depth 16 | 20,000 | 750.52 | 26648 | 37526 | 9.05x |
| replay depth 0 | 20,000 | 291.29 | 68661 | 14564 | 3.51x |
| replay depth 1 | 20,000 | 260.49 | 76777 | 13025 | 3.14x |
| replay depth 4 | 20,000 | 270.01 | 74072 | 13500 | 3.25x |
| replay depth 8 | 20,000 | 260.78 | 76693 | 13039 | 3.14x |
| replay depth 16 | 20,000 | 278.94 | 71699 | 13947 | 3.36x |
| mapCapturedHandlers fanout 1 | 20,000 | 82.58 | 242179 | 4129 | 1.00x |
| mapCapturedHandlers fanout 4 | 20,000 | 97.93 | 204229 | 4896 | 1.18x |
| mapCapturedHandlers fanout 16 | 20,000 | 98.68 | 202675 | 4934 | 1.19x |
| mapCapturedHandlers fanout 64 | 20,000 | 176.12 | 113556 | 8806 | 2.12x |
| pure runPromise | 2,000 | 25.44 | 78616 | 12720 | 1.00x |
| sequential async x10 | 2,000 | 362.49 | 5517 | 181244 | 14.25x |
| fork fanout 16 unbounded | 2,000 | 1355.41 | 1476 | 677707 | 53.28x |
| fork fanout 16 bounded 1 | 2,000 | 1356.85 | 1474 | 678424 | 53.33x |
| fork fanout 16 bounded 4 | 2,000 | 1341.29 | 1491 | 670646 | 52.72x |
| fork fanout 16 bounded 16 | 2,000 | 1336.98 | 1496 | 668490 | 52.55x |
| all fanout 16 | 2,000 | 468.34 | 4270 | 234169 | 18.41x |
| race fanout 16 | 2,000 | 458.59 | 4361 | 229296 | 18.03x |
| dispose blocked task | 1,000 | 22.48 | 44475 | 22484 | 1.00x |
| dispose blocked scoped task | 1,000 | 41.01 | 24387 | 41006 | 1.82x |
| dispose blocked fork | 1,000 | 61.50 | 16260 | 61499 | 2.74x |
