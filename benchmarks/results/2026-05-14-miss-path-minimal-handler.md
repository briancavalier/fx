# Miss-Path Minimal Handler Prototype Results

- Date: 2026-05-14T20:23:22.907Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.
- Result: correctness passed, and the prototype produced a small positive signal without the V8/module-shape cliff seen in handler coalescing prototypes.

## Summary

This prototype only changed `src/internal/Handler.ts`:

- lazy allocate the captured-handler wrapper only when a `HandlerCapture` effect is observed
- replace `HandlerCapture.is(effect)` on ordinary misses with a direct `_fxEffectId` comparison
- leave public APIs, `src/Handler.ts`, imports, module graph, classes, and `Control` unchanged

The result stayed within the intended V8-stable shape and improved several handler-path cases versus the original baseline:

| Case | Baseline ns/op | Prototype ns/op | Change |
| --- | ---: | ---: | ---: |
| matched handler throughput | 10,902 | 9,961 | -8.6% |
| pass-through depth 0 | 13,156 | 12,605 | -4.2% |
| pass-through depth 16 | 190,649 | 183,286 | -3.9% |
| prebuilt pass-through depth 16 | n/a | 178,843 | n/a |
| direct internal pass-through depth 16 | n/a | 178,472 | n/a |
| capture depth 16 | 37,526 | 26,062 | -30.5% |
| replay depth 0 | 14,564 | 12,805 | -12.1% |

Unlike the flattened and lazy coalescing prototypes, this did not move single-handler execution into a slow regime. The improvement is modest for ordinary pass-through, but the risk profile is much better.

## Results

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 199.21 | 100395 | 9961 | 1.00x |
| prebuilt matched handler throughput | 20,000 | 196.19 | 101940 | 9810 | 0.98x |
| direct internal matched handler throughput | 20,000 | 198.16 | 100929 | 9908 | 0.99x |
| pass-through depth 0 | 20,000 | 252.10 | 79335 | 12605 | 1.27x |
| pass-through depth 1 | 20,000 | 409.53 | 48837 | 20476 | 2.06x |
| pass-through depth 4 | 20,000 | 889.87 | 22475 | 44493 | 4.47x |
| pass-through depth 8 | 20,000 | 1550.98 | 12895 | 77549 | 7.79x |
| pass-through depth 16 | 20,000 | 3665.72 | 5456 | 183286 | 18.40x |
| prebuilt pass-through depth 0 | 20,000 | 235.34 | 84984 | 11767 | 1.18x |
| prebuilt pass-through depth 1 | 20,000 | 408.75 | 48930 | 20437 | 2.05x |
| prebuilt pass-through depth 4 | 20,000 | 874.60 | 22868 | 43730 | 4.39x |
| prebuilt pass-through depth 8 | 20,000 | 1511.37 | 13233 | 75568 | 7.59x |
| prebuilt pass-through depth 16 | 20,000 | 3576.86 | 5591 | 178843 | 17.95x |
| direct internal pass-through depth 0 | 20,000 | 233.68 | 85586 | 11684 | 1.17x |
| direct internal pass-through depth 1 | 20,000 | 399.07 | 50116 | 19954 | 2.00x |
| direct internal pass-through depth 4 | 20,000 | 863.63 | 23158 | 43181 | 4.34x |
| direct internal pass-through depth 8 | 20,000 | 1512.41 | 13224 | 75621 | 7.59x |
| direct internal pass-through depth 16 | 20,000 | 3569.44 | 5603 | 178472 | 17.92x |
| construct handler stack depth 0 | 20,000 | 5.56 | 3594644 | 278 | 0.03x |
| construct handler stack depth 1 | 20,000 | 10.49 | 1906108 | 525 | 0.05x |
| construct handler stack depth 4 | 20,000 | 12.65 | 1580970 | 633 | 0.06x |
| construct handler stack depth 8 | 20,000 | 18.94 | 1055869 | 947 | 0.10x |
| construct handler stack depth 16 | 20,000 | 28.51 | 701434 | 1426 | 0.14x |
| matched handler outermost | 20,000 | 325.66 | 61414 | 16283 | 1.63x |
| matched handler middle | 20,000 | 590.71 | 33857 | 29536 | 2.97x |
| matched handler innermost | 20,000 | 720.65 | 27753 | 36033 | 3.62x |
| control resume | 20,000 | 238.16 | 83977 | 11908 | 1.20x |
| control short-circuit | 20,000 | 74.65 | 267904 | 3733 | 0.37x |
| capture depth 0 | 20,000 | 83.50 | 239530 | 4175 | 1.00x |
| capture depth 1 | 20,000 | 98.24 | 203574 | 4912 | 1.18x |
| capture depth 4 | 20,000 | 187.19 | 106841 | 9360 | 2.24x |
| capture depth 8 | 20,000 | 306.22 | 65313 | 15311 | 3.67x |
| capture depth 16 | 20,000 | 521.25 | 38370 | 26062 | 6.24x |
| replay depth 0 | 20,000 | 256.11 | 78092 | 12805 | 3.07x |
| replay depth 1 | 20,000 | 255.30 | 78340 | 12765 | 3.06x |
| replay depth 4 | 20,000 | 252.32 | 79264 | 12616 | 3.02x |
| replay depth 8 | 20,000 | 250.61 | 79806 | 12530 | 3.00x |
| replay depth 16 | 20,000 | 253.76 | 78816 | 12688 | 3.04x |
| mapCapturedHandlers fanout 1 | 20,000 | 73.39 | 272507 | 3670 | 0.88x |
| mapCapturedHandlers fanout 4 | 20,000 | 86.60 | 230938 | 4330 | 1.04x |
| mapCapturedHandlers fanout 16 | 20,000 | 99.49 | 201033 | 4974 | 1.19x |
| mapCapturedHandlers fanout 64 | 20,000 | 157.20 | 127228 | 7860 | 1.88x |
| pure runPromise | 2,000 | 24.48 | 81684 | 12242 | 1.00x |
| sequential async x10 | 2,000 | 359.10 | 5569 | 179551 | 14.67x |
| fork fanout 16 unbounded | 2,000 | 1322.16 | 1513 | 661079 | 54.00x |
| fork fanout 16 bounded 1 | 2,000 | 1333.31 | 1500 | 666654 | 54.45x |
| fork fanout 16 bounded 4 | 2,000 | 1306.17 | 1531 | 653087 | 53.35x |
| fork fanout 16 bounded 16 | 2,000 | 1308.89 | 1528 | 654443 | 53.46x |
| all fanout 16 | 2,000 | 435.42 | 4593 | 217709 | 17.78x |
| race fanout 16 | 2,000 | 433.79 | 4611 | 216893 | 17.72x |
| dispose blocked task | 1,000 | 21.70 | 46090 | 21697 | 1.00x |
| dispose blocked scoped task | 1,000 | 36.39 | 27478 | 36393 | 1.68x |
| dispose blocked fork | 1,000 | 66.30 | 15083 | 66300 | 3.06x |

## Interpretation

This is a small but useful win. It does not change the O(depth) pass-through shape, but it trims the ordinary miss path without triggering the severe V8 sensitivity seen when changing handler module/class shape.

The larger capture-depth improvement is consistent with avoiding eager captured-wrapper allocation in each ordinary handler frame. Capture itself still scales with handler depth, but the per-frame cost is lower.

This prototype is a better candidate to keep than either flattened/coalesced handler-stack approach because it preserves the existing optimized structure and improves the common-path guardrails.
