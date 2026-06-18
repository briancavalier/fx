# Weekly Benchmark Report

- Date: 2026-06-01
- Repository: `@briancavalier/fx`
- Compared against:
  - Trace: `benchmarks/results/2026-05-25-weekly-benchmarks.md` (latest comparable weekly raw output), with `benchmarks/results/2026-05-07-trace-policy-and-fast-paths.md` as older history
  - Runtime context: `benchmarks/results/2026-05-25-weekly-benchmarks.md` (latest comparable weekly raw output), with `benchmarks/results/2026-05-08-runtime-context-fast-paths.md` as older history
  - Runtime loops: `benchmarks/results/2026-05-14-runtime-loops-baseline.md` and `benchmarks/results/2026-05-14-expanded-runtime-loop-coverage-baseline.md`
- Default significance threshold: 10% delta in `ns/op`
- Interpretation: lower `ns/op` is faster, higher `ns/op` is slower
- Node activation: `.nvmrc` version via `fnm exec --using "$(cat .nvmrc)" ...`

## Invalidated Run

- The earlier 2026-06-01 Node `v25.9.0` report generated at approximately `13:37-13:39Z` is invalid and has been superseded.
- That run produced catastrophic slowdowns that did not reproduce in fresh Node `v25.9.0` processes on the same SHA.
- The fresh reruns below were captured at:
  - Trace: `2026-06-01T13:49:09.591Z`
  - Runtime context: `2026-06-01T13:49:30.204Z`
  - Runtime loops: `2026-06-01T13:51:47.738Z`

## Command Status

| Command | Status | Notes |
| --- | --- | --- |
| `pnpm benchmark:trace` | pass | Fresh rerun via `fnm exec` + `corepack pnpm` on clean worktree `a30a315` |
| `pnpm benchmark:runtime-context` | pass | Fresh rerun via `fnm exec` + `corepack pnpm` on clean worktree `a30a315` |
| `pnpm benchmark:runtime-loops` | pass | Fresh rerun via `fnm exec` + `corepack pnpm` on clean worktree `a30a315` |

## Significant Improvements

### Runtime Loops

- `capture depth 16`: `37,526 -> 26,726 ns/op` (`-28.8%`)
- `capture depth 0`: `4,148 -> 3,307 ns/op` (`-20.3%`)
- `capture depth 4`: `10,853 -> 8,881 ns/op` (`-18.2%`)
- `capture depth 1`: `6,019 -> 4,944 ns/op` (`-17.9%`)
- `capture depth 8`: `18,707 -> 15,483 ns/op` (`-17.2%`)
- `matched handler outermost`: `17,638 -> 15,497 ns/op` (`-12.1%`)
- `mapCapturedHandlers fanout 4`: `4,896 -> 4,306 ns/op` (`-12.1%`)
- `replay depth 0`: `14,564 -> 12,809 ns/op` (`-12.1%`)

## Significant Regressions

### Trace

- `successful assertPromise off`: `2,114 -> 5,668 ns/op` (`+168.1%`)
- `all structured failure`: `86,738 -> 220,405 ns/op` (`+154.1%`)
- `successful assertPromise labels`: `2,630 -> 6,112 ns/op` (`+132.4%`)
- `rejected assertPromise`: `21,913 -> 50,776 ns/op` (`+131.7%`)
- `append trace 1 + 1`: `80 -> 183 ns/op` (`+128.8%`)
- `race structured failure`: `76,268 -> 171,404 ns/op` (`+124.7%`)
- `handled fail off`: `1,893 -> 3,988 ns/op` (`+110.7%`)
- `pure runtime baseline`: `1,151 -> 2,360 ns/op` (`+105.0%`)
- `unhandled fail`: `20,879 -> 40,930 ns/op` (`+96.0%`)
- `nested fork failure`: `173,459 -> 334,721 ns/op` (`+93.0%`)
- `handled fail labels`: `2,120 -> 4,083 ns/op` (`+92.6%`)
- `forkEach structured failure`: `80,571 -> 154,584 ns/op` (`+91.9%`)

### Runtime Context

- `withActiveRuntimeContext active`: `6 -> 11 ns/op` (`+83.3%`)
- `handled effects regional full`: `19,222 -> 34,389 ns/op` (`+78.9%`)
- `handled effects regional labels`: `19,313 -> 33,758 ns/op` (`+74.8%`)
- `handled effects regional off`: `19,636 -> 32,980 ns/op` (`+68.0%`)
- `handled effects ambient active off`: `6,619 -> 10,911 ns/op` (`+64.8%`)
- `handled effects baseline`: `6,852 -> 10,175 ns/op` (`+48.5%`)
- `handled effects global off`: `6,614 -> 9,672 ns/op` (`+46.2%`)

### Runtime Loops

- `scope pass-through depth 16`: `359,625 -> 1,641,472 ns/op` (`+356.4%`)
- `all fanout 16`: `234,169 -> 602,267 ns/op` (`+157.2%`)
- `scope capture depth 16`: `97,416 -> 243,315 ns/op` (`+149.8%`)
- `scope finalizer registration depth 0`: `7,630 -> 12,488 ns/op` (`+63.7%`)
- `race fanout 16`: `229,296 -> 292,434 ns/op` (`+27.5%`)
- `dispose blocked fork`: `61,499 -> 76,631 ns/op` (`+24.6%`)
- `dispose blocked scoped task`: `41,006 -> 49,880 ns/op` (`+21.6%`)
- `handler capture boundary close depth 0`: `3,085 -> 3,455 ns/op` (`+12.0%`)

## Stable Or Noisy Cases Worth Noting

- The previously saved June 1 Node 25 result was contaminated. Fresh reruns on the same SHA moved trace from catastrophic slowdowns back to a consistent `~1.6x-2.7x` penalty on many trace-heavy rows, and moved runtime-context from `~2.7x-6.6x` slowdowns back to `~1.5x-1.8x` on most rows.
- Fresh reruns are internally consistent. Two independent Node `v25.9.0` reruns of `benchmark:trace` and `benchmark:runtime-context` landed very close to each other, which is a much stronger signal than the invalidated June 1 run.
- Trace remains genuinely slower on Node 25 even after removing the contaminated run. The slowdown is broad across async, fork, formatting, and breadcrumb rows, which points to runtime-level cost shifts rather than a single `fx` logic bug.
- Runtime-context also remains slower on Node 25, but the corrected numbers are much closer to the older 2026-05-08 baseline than the invalidated June 1 run suggested.
- Runtime-loops is mixed under fresh Node 25 reruns. Ordinary handler throughput, replay, and many pass-through rows are close to the May 14 baselines, while deep scope and aggregate concurrency rows remain clearly worse.
- `prebuilt handled fail` is still substantially better than the older 2026-05-07 trace-policy baseline (`16,422 -> 6,127 ns/op`, `-62.7%` total), and `handled fail` is also still better (`24,294 -> 12,145`, `-50.0%`). The strongest persistent trace regressions are concentrated in labels/off policy and async/fork-heavy rows rather than every trace path uniformly.

## Suggested Attention Areas

- Treat the invalidated June 1 Node 25 numbers as measurement failure, not product behavior. Do not use them for trend analysis or optimization targeting.
- Investigate the persistent Node 25 trace penalty in async and structured concurrency paths first, especially `successful assertPromise off`, `successful assertPromise labels`, `rejected assertPromise`, `all structured failure`, `race structured failure`, and `nested fork failure`.
- Revisit runtime-context only after accounting for the corrected reruns. The real regression is moderate, not catastrophic, and is most visible in `withActiveRuntimeContext active` plus the handled regional modes.
- Focus runtime-loop optimization on deep scope and aggregate fanout paths, especially `scope pass-through depth 16`, `scope capture depth 16`, and `all fanout 16`. Those remain the clearest repeatable regressions after removing contaminated data.
- When comparing future weekly runs, prefer fresh serial reruns before drawing conclusions from a single surprising Node-version jump. The invalidated June 1 run shows that this suite is sensitive enough to environment state that one bad process can dominate the conclusions.

## Raw Output: Trace

```text
$ tsx benchmarks/trace.ts
# Fx Trace Benchmark Results

- Date: 2026-06-01T13:49:09.591Z
- Git SHA: a30a315
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:trace`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 118.01 | 423675 | 2360 | 1.00x |
| handled fail | 2,000 | 24.29 | 82341 | 12145 | 5.15x |
| prebuilt handled fail | 2,000 | 12.25 | 163216 | 6127 | 2.60x |
| handled fail labels | 2,000 | 8.17 | 244929 | 4083 | 1.73x |
| handled fail off | 2,000 | 7.98 | 250772 | 3988 | 1.69x |
| unhandled fail | 2,000 | 81.86 | 24432 | 40930 | 17.34x |
| successful assertPromise | 5,000 | 121.68 | 41093 | 24335 | 10.31x |
| prebuilt successful assertPromise | 5,000 | 74.26 | 67327 | 14853 | 6.29x |
| successful assertPromise labels | 5,000 | 30.56 | 163615 | 6112 | 2.59x |
| successful assertPromise off | 5,000 | 28.34 | 176425 | 5668 | 2.40x |
| rejected assertPromise | 2,000 | 101.55 | 19694 | 50776 | 21.51x |
| nested fork failure | 2,000 | 669.44 | 2988 | 334721 | 141.81x |
| nested fork success | 2,000 | 414.54 | 4825 | 207269 | 87.81x |
| nested fork failure labels | 2,000 | 226.50 | 8830 | 113250 | 47.98x |
| nested fork failure off | 2,000 | 214.26 | 9335 | 107129 | 45.39x |
| all structured failure | 2,000 | 440.81 | 4537 | 220405 | 93.38x |
| forkEach structured failure | 2,000 | 309.17 | 6469 | 154584 | 65.49x |
| race structured failure | 2,000 | 342.81 | 5834 | 171404 | 72.62x |
| plain breadcrumb object | 25,000 | 2.33 | 10749798 | 93 | 1.00x |
| capture breadcrumb stack | 25,000 | 195.34 | 127982 | 7814 | 83.99x |
| capture breadcrumb labels | 25,000 | 2.56 | 9781864 | 102 | 1.10x |
| capture breadcrumb off | 25,000 | 2.49 | 10027576 | 100 | 1.07x |
| append trace 1 + 1 | 25,000 | 4.57 | 5472207 | 183 | 1.00x |
| append trace 16 + 16 | 25,000 | 16.40 | 1524491 | 656 | 3.59x |
| format trace 1 frame | 25,000 | 26.51 | 943120 | 1060 | 1.00x |
| format trace 8 frames | 25,000 | 179.27 | 139455 | 7171 | 6.76x |
| format trace 16 frames | 25,000 | 352.57 | 70908 | 14103 | 13.30x |
| format trace 32 frames | 25,000 | 701.36 | 35645 | 28055 | 26.46x |
```

## Raw Output: Runtime Context

```text
$ tsx benchmarks/runtime-context.ts
# Fx Runtime Context Benchmark Results

- Date: 2026-06-01T13:49:30.204Z
- Git SHA: a30a315
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-context`
- Handled effect programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct call | 5,000,000 | 4.17 | 1197939640 | 1 | 1.00x |
| withActiveRuntimeContext active | 5,000,000 | 55.31 | 90402698 | 11 | 13.25x |
| handled effects baseline | 25,000 | 254.36 | 98284 | 10175 | 1.00x |
| handled effects global off | 25,000 | 241.80 | 103393 | 9672 | 0.95x |
| handled effects ambient active off | 25,000 | 272.79 | 91647 | 10911 | 1.07x |
| handled effects regional off | 25,000 | 824.51 | 30321 | 32980 | 3.24x |
| handled effects regional labels | 25,000 | 843.95 | 29623 | 33758 | 3.32x |
| handled effects regional full | 25,000 | 859.73 | 29079 | 34389 | 3.38x |
```

## Raw Output: Runtime Loops

```text
$ tsx benchmarks/runtime-loops.ts
# Fx Runtime Loop Benchmark Results

- Date: 2026-06-01T13:51:47.738Z
- Git SHA: a30a315
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 202.34 | 98841 | 10117 | 1.00x |
| prebuilt matched handler throughput | 20,000 | 197.07 | 101487 | 9853 | 0.97x |
| direct internal matched handler throughput | 20,000 | 199.85 | 100077 | 9992 | 0.99x |
| pass-through depth 0 | 20,000 | 252.06 | 79345 | 12603 | 1.25x |
| pass-through depth 1 | 20,000 | 402.36 | 49707 | 20118 | 1.99x |
| pass-through depth 4 | 20,000 | 882.73 | 22657 | 44136 | 4.36x |
| pass-through depth 8 | 20,000 | 1550.82 | 12896 | 77541 | 7.66x |
| pass-through depth 16 | 20,000 | 3648.55 | 5482 | 182428 | 18.03x |
| prebuilt pass-through depth 0 | 20,000 | 274.08 | 72971 | 13704 | 1.35x |
| prebuilt pass-through depth 1 | 20,000 | 390.63 | 51199 | 19532 | 1.93x |
| prebuilt pass-through depth 4 | 20,000 | 869.49 | 23002 | 43474 | 4.30x |
| prebuilt pass-through depth 8 | 20,000 | 1511.17 | 13235 | 75559 | 7.47x |
| prebuilt pass-through depth 16 | 20,000 | 3614.56 | 5533 | 180728 | 17.86x |
| direct internal pass-through depth 0 | 20,000 | 234.85 | 85161 | 11742 | 1.16x |
| direct internal pass-through depth 1 | 20,000 | 396.59 | 50430 | 19830 | 1.96x |
| direct internal pass-through depth 4 | 20,000 | 867.58 | 23053 | 43379 | 4.29x |
| direct internal pass-through depth 8 | 20,000 | 1517.38 | 13181 | 75869 | 7.50x |
| direct internal pass-through depth 16 | 20,000 | 3588.87 | 5573 | 179444 | 17.74x |
| construct handler stack depth 0 | 20,000 | 5.63 | 3552319 | 282 | 0.03x |
| construct handler stack depth 1 | 20,000 | 8.85 | 2258845 | 443 | 0.04x |
| construct handler stack depth 4 | 20,000 | 13.80 | 1449678 | 690 | 0.07x |
| construct handler stack depth 8 | 20,000 | 18.71 | 1069121 | 935 | 0.09x |
| construct handler stack depth 16 | 20,000 | 28.78 | 694912 | 1439 | 0.14x |
| matched handler outermost | 20,000 | 309.93 | 64530 | 15497 | 1.53x |
| matched handler middle | 20,000 | 574.83 | 34793 | 28742 | 2.84x |
| matched handler innermost | 20,000 | 716.95 | 27896 | 35847 | 3.54x |
| control resume | 20,000 | 240.95 | 83004 | 12048 | 1.19x |
| control short-circuit | 20,000 | 76.33 | 262013 | 3817 | 0.38x |
| control pass-through depth 0 | 20,000 | 250.06 | 79981 | 12503 | 1.24x |
| control pass-through depth 1 | 20,000 | 411.40 | 48614 | 20570 | 2.03x |
| control pass-through depth 4 | 20,000 | 918.99 | 21763 | 45950 | 4.54x |
| control pass-through depth 8 | 20,000 | 1586.40 | 12607 | 79320 | 7.84x |
| control pass-through depth 16 | 20,000 | 3718.72 | 5378 | 185936 | 18.38x |
| capture depth 0 | 20,000 | 66.15 | 302366 | 3307 | 1.00x |
| capture depth 1 | 20,000 | 98.88 | 202263 | 4944 | 1.49x |
| capture depth 4 | 20,000 | 177.62 | 112599 | 8881 | 2.69x |
| capture depth 8 | 20,000 | 309.66 | 64586 | 15483 | 4.68x |
| capture depth 16 | 20,000 | 534.51 | 37417 | 26726 | 8.08x |
| replay depth 0 | 20,000 | 256.17 | 78073 | 12809 | 3.87x |
| replay depth 1 | 20,000 | 257.39 | 77702 | 12870 | 3.89x |
| replay depth 4 | 20,000 | 251.09 | 79652 | 12555 | 3.80x |
| replay depth 8 | 20,000 | 253.46 | 78906 | 12673 | 3.83x |
| replay depth 16 | 20,000 | 257.21 | 77758 | 12860 | 3.89x |
| mapCapturedHandlers fanout 1 | 20,000 | 77.41 | 258349 | 3871 | 1.17x |
| mapCapturedHandlers fanout 4 | 20,000 | 86.12 | 232226 | 4306 | 1.30x |
| mapCapturedHandlers fanout 16 | 20,000 | 92.57 | 216063 | 4628 | 1.40x |
| mapCapturedHandlers fanout 64 | 20,000 | 158.68 | 126039 | 7934 | 2.40x |
| scope pass-through depth 0 | 20,000 | 254.80 | 78492 | 12740 | 1.00x |
| scope pass-through depth 1 | 20,000 | 1642.93 | 12173 | 82146 | 6.45x |
| scope pass-through depth 4 | 20,000 | 9102.32 | 2197 | 455116 | 35.72x |
| scope pass-through depth 8 | 20,000 | 16256.53 | 1230 | 812826 | 63.80x |
| scope pass-through depth 16 | 20,000 | 32829.43 | 609 | 1641472 | 128.84x |
| scope finalizer registration depth 0 | 20,000 | 249.75 | 80079 | 12488 | 0.98x |
| scope finalizer registration depth 1 | 20,000 | 312.74 | 63951 | 15637 | 1.23x |
| scope finalizer registration depth 4 | 20,000 | 454.09 | 44044 | 22704 | 1.78x |
| scope finalizer registration depth 8 | 20,000 | 660.66 | 30273 | 33033 | 2.59x |
| scope finalizer registration depth 16 | 20,000 | 1039.88 | 19233 | 51994 | 4.08x |
| scope capture depth 0 | 20,000 | 66.87 | 299080 | 3344 | 0.26x |
| scope capture depth 1 | 20,000 | 287.43 | 69581 | 14372 | 1.13x |
| scope capture depth 4 | 20,000 | 1091.87 | 18317 | 54593 | 4.29x |
| scope capture depth 8 | 20,000 | 2182.17 | 9165 | 109109 | 8.56x |
| scope capture depth 16 | 20,000 | 4866.30 | 4110 | 243315 | 19.10x |
| handler capture boundary pass-through depth 0 | 20,000 | 289.88 | 68994 | 14494 | 1.00x |
| handler capture boundary pass-through depth 1 | 20,000 | 453.12 | 44138 | 22656 | 1.56x |
| handler capture boundary pass-through depth 4 | 20,000 | 908.95 | 22003 | 45448 | 3.14x |
| handler capture boundary pass-through depth 8 | 20,000 | 1526.49 | 13102 | 76325 | 5.27x |
| handler capture boundary pass-through depth 16 | 20,000 | 3609.50 | 5541 | 180475 | 12.45x |
| handler capture boundary close depth 0 | 20,000 | 69.10 | 289416 | 3455 | 0.24x |
| handler capture boundary close depth 1 | 20,000 | 98.43 | 203182 | 4922 | 0.34x |
| handler capture boundary close depth 4 | 20,000 | 191.51 | 104431 | 9576 | 0.66x |
| handler capture boundary close depth 8 | 20,000 | 317.38 | 63015 | 15869 | 1.09x |
| handler capture boundary close depth 16 | 20,000 | 569.87 | 35096 | 28494 | 1.97x |
| run interrupt mask x100 | 20,000 | 3204.77 | 6241 | 160238 | 1.00x |
| pure runPromise | 2,000 | 25.03 | 79912 | 12514 | 1.00x |
| sequential async x10 | 2,000 | 364.13 | 5493 | 182063 | 14.55x |
| fork fanout 16 withUnboundedConcurrency | 2,000 | 1360.22 | 1470 | 680110 | 54.35x |
| fork fanout 16 withBoundedConcurrency 1 | 2,000 | 1377.22 | 1452 | 688608 | 55.03x |
| fork fanout 16 withBoundedConcurrency 4 | 2,000 | 1362.73 | 1468 | 681364 | 54.45x |
| fork fanout 16 withBoundedConcurrency 16 | 2,000 | 1439.40 | 1389 | 719698 | 57.51x |
| all fanout 16 | 2,000 | 1204.53 | 1660 | 602267 | 48.13x |
| race fanout 16 | 2,000 | 584.87 | 3420 | 292434 | 23.37x |
| dispose blocked task | 1,000 | 23.91 | 41816 | 23914 | 1.00x |
| dispose blocked scoped task | 1,000 | 49.88 | 20048 | 49880 | 2.09x |
| dispose blocked fork | 1,000 | 76.63 | 13050 | 76631 | 3.20x |
```
