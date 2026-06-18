# Weekly Benchmark Report

- Date: 2026-06-08
- Repository: `@briancavalier/fx`
- Node pin: `.nvmrc` = `v25`
- Node activation: `fnm exec --using "$(cat .nvmrc)"`
- Activated Node version: `v25.9.0`
- Pin status: applied successfully
- Current Git SHA: `ba81c52`
- Worktree: clean
- Platform: `darwin 25.3.0 arm64`
- Default significance threshold: 10% delta in `ns/op`
- Interpretation: lower `ns/op` is faster, higher `ns/op` is slower
- Compared against:
  - Latest weekly comparable raw output: `benchmarks/results/2026-06-01-weekly-benchmarks.md`
  - Older weekly context for trace and runtime-context: `benchmarks/results/2026-05-25-weekly-benchmarks.md`
  - Older runtime-loop context: `benchmarks/results/2026-05-14-runtime-loops-baseline.md`
  - Additional runtime-loop history for noisy fanout cases: `benchmarks/results/2026-05-14-miss-path-minimal-handler.md`

## Command Status

| Command | Status | Notes |
| --- | --- | --- |
| `pnpm benchmark:trace` | pass | Ran in a fresh `fnm exec` Node `v25.9.0` process |
| `pnpm benchmark:runtime-context` | pass | Ran in a fresh `fnm exec` Node `v25.9.0` process |
| `pnpm benchmark:runtime-loops` | pass | Ran in a fresh `fnm exec` Node `v25.9.0` process |

## Significant Improvements

### Trace

- `successful assertPromise off`: `5,668 -> 2,297 ns/op` (`-59.5%`) versus `2026-06-01-weekly-benchmarks.md`
- `append trace 1 + 1`: `183 -> 77 ns/op` (`-57.9%`) versus `2026-06-01-weekly-benchmarks.md`
- `rejected assertPromise`: `50,776 -> 22,321 ns/op` (`-56.0%`) versus `2026-06-01-weekly-benchmarks.md`
- `prebuilt handled fail`: `6,127 -> 3,070 ns/op` (`-49.9%`) versus `2026-06-01-weekly-benchmarks.md`
- `successful assertPromise`: `24,335 -> 12,858 ns/op` (`-47.2%`) versus `2026-06-01-weekly-benchmarks.md`
- `nested fork failure`: `334,721 -> 176,849 ns/op` (`-47.2%`) versus `2026-06-01-weekly-benchmarks.md`

### Runtime Context

- `handled effects ambient active off`: `10,911 -> 5,218 ns/op` (`-52.2%`) versus `2026-06-01-weekly-benchmarks.md`
- `handled effects baseline`: `10,175 -> 5,369 ns/op` (`-47.2%`) versus `2026-06-01-weekly-benchmarks.md`
- `handled effects global off`: `9,672 -> 5,154 ns/op` (`-46.7%`) versus `2026-06-01-weekly-benchmarks.md`
- `handled effects regional full`: `34,389 -> 18,419 ns/op` (`-46.4%`) versus `2026-06-01-weekly-benchmarks.md`
- `withActiveRuntimeContext active`: `11 -> 6 ns/op` (`-45.5%`) versus `2026-06-01-weekly-benchmarks.md`

### Runtime Loops

- `run interrupt mask x100`: `160,238 -> 74,099 ns/op` (`-53.8%`) versus `2026-06-01-weekly-benchmarks.md`
- `dispose blocked scoped task`: `49,880 -> 24,194 ns/op` (`-51.5%`) versus `2026-06-01-weekly-benchmarks.md`
- `scope pass-through depth 4`: `455,116 -> 221,260 ns/op` (`-51.4%`) versus `2026-06-01-weekly-benchmarks.md`
- `scope capture depth 16`: `243,315 -> 122,853 ns/op` (`-49.5%`) versus `2026-06-01-weekly-benchmarks.md`
- `fork fanout 16 withBoundedConcurrency 16`: `719,698 -> 381,208 ns/op` (`-47.0%`) versus `2026-06-01-weekly-benchmarks.md`
- `matched handler throughput`: `10,117 -> 5,444 ns/op` (`-46.2%`) versus `2026-06-01-weekly-benchmarks.md`
- `all fanout 16`: `602,267 -> 333,481 ns/op` (`-44.6%`) versus `2026-06-01-weekly-benchmarks.md`
- `scope pass-through depth 16`: `1,641,472 -> 950,928 ns/op` (`-42.1%`) versus `2026-06-01-weekly-benchmarks.md`

## Significant Regressions

- None at or above the 10% threshold versus the latest comparable files in `benchmarks/results/`.

## Stable Or Noisy Cases Worth Noting

- The run is broadly faster than `2026-06-01-weekly-benchmarks.md` across all three commands. That prior weekly artifact is still the most recent comparison point, but it now looks like a weak anchor for trend direction rather than a new baseline.
- Trace is back near the 2026-05-25 weekly levels on several rows. `successful assertPromise off` is only `+8.7%` slower than the 2026-05-25 best, `rejected assertPromise` is `+1.9%`, and `nested fork failure` is `+2.0%`.
- Runtime-context looks better than both prior weekly reports on most rows. `handled effects baseline`, `global off`, and `ambient active off` are each about `21-22%` faster than the 2026-05-25 weekly values.
- `all fanout 16` remains noisy. It improved sharply versus 2026-06-01, but `333,481 ns/op` is still `+53.2%` slower than the older `217,709 ns/op` result in `2026-05-14-miss-path-minimal-handler.md`.
- `all structured failure` also looks noisy across weekly history. It improved `44.5%` versus 2026-06-01, but it is still `41.1%` slower than the 2026-05-25 weekly result.
- The first benchmark invocation refreshed `tsx` from `4.22.3` to `4.22.4` through `pnpm`, so the toolchain was not identical to the June 1 run even though the Node pin and benchmark commands were controlled.

## Suggested Attention Areas

- Keep watching the structured-concurrency aggregation rows, especially `all fanout 16` and `all structured failure`. Those are the clearest cases that improved versus last week but still have worse-than-best history.
- Track deep scope paths again next week, especially `scope pass-through depth 16` and `scope capture depth 16`. They improved materially, but they are still among the most expensive runtime-loop rows in absolute terms.
- If a future weekly run swings back toward the slower June 1 profile, rerun in fresh serial processes before drawing conclusions. This week’s across-the-board reversals are too large to treat as ordinary benchmark noise.

## Raw Output: Trace

```text
$ tsx benchmarks/trace.ts
# Fx Trace Benchmark Results

- Date: 2026-06-08T13:02:37.776Z
- Git SHA: ba81c52
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:trace`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 60.79 | 822556 | 1216 | 1.00x |
| handled fail | 2,000 | 12.78 | 156490 | 6390 | 5.26x |
| prebuilt handled fail | 2,000 | 6.14 | 325766 | 3070 | 2.52x |
| handled fail labels | 2,000 | 4.25 | 470381 | 2126 | 1.75x |
| handled fail off | 2,000 | 4.27 | 468156 | 2136 | 1.76x |
| unhandled fail | 2,000 | 42.45 | 47112 | 21226 | 17.46x |
| successful assertPromise | 5,000 | 64.29 | 77772 | 12858 | 10.58x |
| prebuilt successful assertPromise | 5,000 | 41.48 | 120546 | 8296 | 6.82x |
| successful assertPromise labels | 5,000 | 17.67 | 282984 | 3534 | 2.91x |
| successful assertPromise off | 5,000 | 11.48 | 435387 | 2297 | 1.89x |
| rejected assertPromise | 2,000 | 44.64 | 44800 | 22321 | 18.36x |
| nested fork failure | 2,000 | 353.70 | 5655 | 176849 | 145.47x |
| nested fork success | 2,000 | 256.42 | 7800 | 128210 | 105.46x |
| nested fork failure labels | 2,000 | 144.54 | 13837 | 72269 | 59.45x |
| nested fork failure off | 2,000 | 121.57 | 16452 | 60783 | 50.00x |
| all structured failure | 2,000 | 244.78 | 8171 | 122390 | 100.67x |
| forkEach structured failure | 2,000 | 172.98 | 11562 | 86489 | 71.14x |
| race structured failure | 2,000 | 188.60 | 10604 | 94302 | 77.57x |
| plain breadcrumb object | 25,000 | 1.29 | 19384849 | 52 | 1.00x |
| capture breadcrumb stack | 25,000 | 109.89 | 227494 | 4396 | 85.21x |
| capture breadcrumb labels | 25,000 | 2.40 | 10406546 | 96 | 1.86x |
| capture breadcrumb off | 25,000 | 1.33 | 18801714 | 53 | 1.03x |
| append trace 1 + 1 | 25,000 | 1.93 | 12946378 | 77 | 1.00x |
| append trace 16 + 16 | 25,000 | 9.13 | 2737264 | 365 | 4.73x |
| format trace 1 frame | 25,000 | 14.90 | 1678242 | 596 | 1.00x |
| format trace 8 frames | 25,000 | 99.65 | 250877 | 3986 | 6.69x |
| format trace 16 frames | 25,000 | 201.56 | 124035 | 8062 | 13.53x |
| format trace 32 frames | 25,000 | 406.12 | 61558 | 16245 | 27.26x |

EXIT_STATUS=0
```

## Raw Output: Runtime Context

```text
$ tsx benchmarks/runtime-context.ts
# Fx Runtime Context Benchmark Results

- Date: 2026-06-08T13:02:46.338Z
- Git SHA: ba81c52
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-context`
- Handled effect programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct call | 5,000,000 | 2.25 | 2226633926 | 0 | 1.00x |
| withActiveRuntimeContext active | 5,000,000 | 30.99 | 161344972 | 6 | 13.80x |
| handled effects baseline | 25,000 | 134.22 | 186256 | 5369 | 1.00x |
| handled effects global off | 25,000 | 128.84 | 194042 | 5154 | 0.96x |
| handled effects ambient active off | 25,000 | 130.44 | 191660 | 5218 | 0.97x |
| handled effects regional off | 25,000 | 496.49 | 50353 | 19860 | 3.70x |
| handled effects regional labels | 25,000 | 496.91 | 50310 | 19877 | 3.70x |
| handled effects regional full | 25,000 | 460.47 | 54292 | 18419 | 3.43x |

EXIT_STATUS=0
```

## Raw Output: Runtime Loops

```text
$ tsx benchmarks/runtime-loops.ts
# Fx Runtime Loop Benchmark Results

- Date: 2026-06-08T13:04:04.578Z
- Git SHA: ba81c52
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 108.88 | 183681 | 5444 | 1.00x |
| prebuilt matched handler throughput | 20,000 | 108.44 | 184435 | 5422 | 1.00x |
| direct internal matched handler throughput | 20,000 | 110.75 | 180580 | 5538 | 1.02x |
| pass-through depth 0 | 20,000 | 141.34 | 141503 | 7067 | 1.30x |
| pass-through depth 1 | 20,000 | 233.39 | 85693 | 11670 | 2.14x |
| pass-through depth 4 | 20,000 | 560.77 | 35665 | 28038 | 5.15x |
| pass-through depth 8 | 20,000 | 864.87 | 23125 | 43243 | 7.94x |
| pass-through depth 16 | 20,000 | 1981.95 | 10091 | 99097 | 18.20x |
| prebuilt pass-through depth 0 | 20,000 | 138.23 | 144686 | 6912 | 1.27x |
| prebuilt pass-through depth 1 | 20,000 | 233.97 | 85483 | 11698 | 2.15x |
| prebuilt pass-through depth 4 | 20,000 | 497.99 | 40162 | 24899 | 4.57x |
| prebuilt pass-through depth 8 | 20,000 | 860.39 | 23245 | 43019 | 7.90x |
| prebuilt pass-through depth 16 | 20,000 | 1988.42 | 10058 | 99421 | 18.26x |
| direct internal pass-through depth 0 | 20,000 | 135.45 | 147652 | 6773 | 1.24x |
| direct internal pass-through depth 1 | 20,000 | 235.39 | 84964 | 11770 | 2.16x |
| direct internal pass-through depth 4 | 20,000 | 499.64 | 40029 | 24982 | 4.59x |
| direct internal pass-through depth 8 | 20,000 | 862.05 | 23201 | 43102 | 7.92x |
| direct internal pass-through depth 16 | 20,000 | 1998.98 | 10005 | 99949 | 18.36x |
| construct handler stack depth 0 | 20,000 | 2.90 | 6893184 | 145 | 0.03x |
| construct handler stack depth 1 | 20,000 | 4.71 | 4246998 | 235 | 0.04x |
| construct handler stack depth 4 | 20,000 | 9.64 | 2073954 | 482 | 0.09x |
| construct handler stack depth 8 | 20,000 | 10.33 | 1935460 | 517 | 0.09x |
| construct handler stack depth 16 | 20,000 | 16.26 | 1230365 | 813 | 0.15x |
| matched handler outermost | 20,000 | 184.70 | 108283 | 9235 | 1.70x |
| matched handler middle | 20,000 | 334.47 | 59796 | 16724 | 3.07x |
| matched handler innermost | 20,000 | 406.71 | 49175 | 20336 | 3.74x |
| control resume | 20,000 | 134.86 | 148304 | 6743 | 1.24x |
| control short-circuit | 20,000 | 41.22 | 485258 | 2061 | 0.38x |
| control pass-through depth 0 | 20,000 | 137.26 | 145712 | 6863 | 1.26x |
| control pass-through depth 1 | 20,000 | 236.13 | 84699 | 11807 | 2.17x |
| control pass-through depth 4 | 20,000 | 521.50 | 38351 | 26075 | 4.79x |
| control pass-through depth 8 | 20,000 | 908.80 | 22007 | 45440 | 8.35x |
| control pass-through depth 16 | 20,000 | 2044.30 | 9783 | 102215 | 18.77x |
| capture depth 0 | 20,000 | 36.82 | 543203 | 1841 | 1.00x |
| capture depth 1 | 20,000 | 58.41 | 342427 | 2920 | 1.59x |
| capture depth 4 | 20,000 | 104.82 | 190801 | 5241 | 2.85x |
| capture depth 8 | 20,000 | 186.04 | 107501 | 9302 | 5.05x |
| capture depth 16 | 20,000 | 302.45 | 66127 | 15122 | 8.21x |
| replay depth 0 | 20,000 | 147.46 | 135628 | 7373 | 4.01x |
| replay depth 1 | 20,000 | 142.90 | 139961 | 7145 | 3.88x |
| replay depth 4 | 20,000 | 145.94 | 137042 | 7297 | 3.96x |
| replay depth 8 | 20,000 | 143.50 | 139372 | 7175 | 3.90x |
| replay depth 16 | 20,000 | 143.92 | 138965 | 7196 | 3.91x |
| mapCapturedHandlers fanout 1 | 20,000 | 44.65 | 447976 | 2232 | 1.21x |
| mapCapturedHandlers fanout 4 | 20,000 | 47.04 | 425164 | 2352 | 1.28x |
| mapCapturedHandlers fanout 16 | 20,000 | 56.18 | 355984 | 2809 | 1.53x |
| mapCapturedHandlers fanout 64 | 20,000 | 92.78 | 215553 | 4639 | 2.52x |
| scope pass-through depth 0 | 20,000 | 156.05 | 128165 | 7802 | 1.00x |
| scope pass-through depth 1 | 20,000 | 955.83 | 20924 | 47791 | 6.13x |
| scope pass-through depth 4 | 20,000 | 4425.21 | 4520 | 221260 | 28.36x |
| scope pass-through depth 8 | 20,000 | 9302.32 | 2150 | 465116 | 59.61x |
| scope pass-through depth 16 | 20,000 | 19018.56 | 1052 | 950928 | 121.88x |
| scope finalizer registration depth 0 | 20,000 | 141.71 | 141129 | 7086 | 0.91x |
| scope finalizer registration depth 1 | 20,000 | 178.25 | 112202 | 8912 | 1.14x |
| scope finalizer registration depth 4 | 20,000 | 268.32 | 74536 | 13416 | 1.72x |
| scope finalizer registration depth 8 | 20,000 | 377.96 | 52915 | 18898 | 2.42x |
| scope finalizer registration depth 16 | 20,000 | 599.61 | 33355 | 29980 | 3.84x |
| scope capture depth 0 | 20,000 | 37.61 | 531799 | 1880 | 0.24x |
| scope capture depth 1 | 20,000 | 173.08 | 115555 | 8654 | 1.11x |
| scope capture depth 4 | 20,000 | 633.37 | 31577 | 31669 | 4.06x |
| scope capture depth 8 | 20,000 | 1244.32 | 16073 | 62216 | 7.97x |
| scope capture depth 16 | 20,000 | 2457.06 | 8140 | 122853 | 15.75x |
| handler capture boundary pass-through depth 0 | 20,000 | 166.14 | 120380 | 8307 | 1.00x |
| handler capture boundary pass-through depth 1 | 20,000 | 260.10 | 76893 | 13005 | 1.57x |
| handler capture boundary pass-through depth 4 | 20,000 | 532.73 | 37542 | 26637 | 3.21x |
| handler capture boundary pass-through depth 8 | 20,000 | 875.47 | 22845 | 43773 | 5.27x |
| handler capture boundary pass-through depth 16 | 20,000 | 2030.11 | 9852 | 101506 | 12.22x |
| handler capture boundary close depth 0 | 20,000 | 36.50 | 548002 | 1825 | 0.22x |
| handler capture boundary close depth 1 | 20,000 | 58.21 | 343569 | 2911 | 0.35x |
| handler capture boundary close depth 4 | 20,000 | 110.69 | 180683 | 5535 | 0.67x |
| handler capture boundary close depth 8 | 20,000 | 178.29 | 112177 | 8914 | 1.07x |
| handler capture boundary close depth 16 | 20,000 | 321.61 | 62187 | 16081 | 1.94x |
| run interrupt mask x100 | 20,000 | 1481.99 | 13495 | 74099 | 1.00x |
| pure runPromise | 2,000 | 14.22 | 140616 | 7112 | 1.00x |
| sequential async x10 | 2,000 | 205.23 | 9745 | 102616 | 14.43x |
| fork fanout 16 withUnboundedConcurrency | 2,000 | 771.22 | 2593 | 385609 | 54.22x |
| fork fanout 16 withBoundedConcurrency 1 | 2,000 | 821.41 | 2435 | 410703 | 57.75x |
| fork fanout 16 withBoundedConcurrency 4 | 2,000 | 814.77 | 2455 | 407384 | 57.28x |
| fork fanout 16 withBoundedConcurrency 16 | 2,000 | 762.42 | 2623 | 381208 | 53.60x |
| all fanout 16 | 2,000 | 666.96 | 2999 | 333481 | 46.89x |
| race fanout 16 | 2,000 | 328.57 | 6087 | 164286 | 23.10x |
| dispose blocked task | 1,000 | 16.34 | 61205 | 16338 | 1.00x |
| dispose blocked scoped task | 1,000 | 24.19 | 41333 | 24194 | 1.48x |
| dispose blocked fork | 1,000 | 40.27 | 24834 | 40267 | 2.46x |

EXIT_STATUS=0
```
