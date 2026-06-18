# Weekly Benchmark Report

- Date: 2026-06-15
- Repository: `@briancavalier/fx`
- Node pin: `.nvmrc` = `v25`
- Preferred activation attempt: `fnm use`
- Activation note: `fnm use` did not switch this non-interactive shell and left `node -v` at `v24.14.0`
- Valid benchmark activation: `fnm exec --using "$(cat .nvmrc)"`
- Activated Node version for the saved results: `v25.9.0`
- Pin status for saved results: applied successfully via exec wrapper
- Current Git SHA: `87f18a8`
- Repo status before report write: dirty due to pre-existing untracked files in the worktree
- Benchmark program worktree metadata: clean
- Platform: `darwin 25.3.0 arm64`
- Default significance threshold: 10% delta in `ns/op`
- Interpretation: lower `ns/op` is faster, higher `ns/op` is slower
- Compared against:
  - Latest weekly comparable raw output: `benchmarks/results/2026-06-08-weekly-benchmarks.md`
  - Prior weekly context: `benchmarks/results/2026-06-01-weekly-benchmarks.md` and `benchmarks/results/2026-05-25-weekly-benchmarks.md`
  - Older trace/runtime-context context: `benchmarks/results/2026-05-07-trace-policy-and-fast-paths.md` and `benchmarks/results/2026-05-08-runtime-context-fast-paths.md`
  - Older runtime-loop baseline: `benchmarks/results/2026-05-14-runtime-loops-baseline.md`
  - Earlier same-day saved report before this refresh: 2026-06-15 09:03 EDT on the same SHA and Node `v25.9.0`
- Verification rerun: one additional full suite rerun under the same `fnm exec --using` activation also passed, remained slow, and exposed large row-level variance in `runtime-loops`

## Command Status

| Command | Status | Notes |
| --- | --- | --- |
| `pnpm benchmark:trace` | pass | Saved raw output from the first valid `fnm exec --using "$(cat .nvmrc)"` run under Node `v25.9.0` |
| `pnpm benchmark:runtime-context` | pass | Saved raw output from the first valid `fnm exec --using "$(cat .nvmrc)"` run under Node `v25.9.0` |
| `pnpm benchmark:runtime-loops` | pass | Saved raw output from the first valid `fnm exec --using "$(cat .nvmrc)"` run under Node `v25.9.0` |
| Verification rerun of all three commands | pass | Used only to assess noise and reproducibility after the first run landed far outside prior history |

## Significant Improvements

- None versus the latest comparable files in `benchmarks/results/`. The current run is broadly slower across all three benchmark commands.

## Significant Regressions

### Trace

- The trace section is broadly slower than `2026-06-08-weekly-benchmarks.md`, with a median regression of about `+79.9%` across rows.
- `successful assertPromise`: `12,858 -> 23,368 ns/op` (`+81.7%`) in the saved run and `24,894 ns/op` in the verification rerun (`+93.6%`).
- `successful assertPromise off`: `2,297 -> 3,691 ns/op` (`+60.7%`) in the saved run and `4,410 ns/op` in the verification rerun (`+92.0%`).
- `rejected assertPromise`: `22,321 -> 43,450 ns/op` (`+94.7%`) in the saved run and `42,265 ns/op` in the verification rerun (`+89.4%`).
- `all structured failure`: `122,390 -> 212,192 ns/op` (`+73.4%`) in the saved run and `225,220 ns/op` in the verification rerun (`+84.0%`).
- `capture breadcrumb labels`: `53 -> 163 ns/op` (`+207.5%`) in the saved run, but only `97 ns/op` (`+83.0%`) in the verification rerun, which points to extra small-benchmark instability on top of the broader slowdown.

### Runtime Context

- Runtime-context is also broadly slower, with a median regression of about `+80.5%` versus `2026-06-08-weekly-benchmarks.md`.
- `handled effects baseline`: `5,369 -> 9,797 ns/op` (`+82.5%`) in the saved run and `10,010 ns/op` in the verification rerun (`+86.4%`).
- `handled effects global off`: `5,154 -> 9,363 ns/op` (`+81.7%`) in the saved run and `9,304 ns/op` in the verification rerun (`+80.5%`).
- `handled effects ambient active off`: `5,218 -> 9,301 ns/op` (`+78.3%`) in the saved run and `9,443 ns/op` in the verification rerun (`+81.0%`).
- `handled effects regional full`: `18,419 -> 32,409 ns/op` (`+75.9%`) in the saved run and `32,484 ns/op` in the verification rerun (`+76.4%`).

### Runtime Loops

- Runtime-loops is the noisiest section. The saved run was already broadly slower, and the verification rerun stayed slow while swinging sharply on several specific rows.
- Representative regressions versus `2026-06-08-weekly-benchmarks.md` from the saved run:
- `matched handler throughput`: `5,444 -> 9,960 ns/op` (`+83.0%`)
- `pass-through depth 16`: `99,097 -> 181,373 ns/op` (`+83.0%`)
- `run interrupt mask x100`: `74,099 -> 119,909 ns/op` (`+61.8%`)
- `all fanout 16`: `333,481 -> 575,004 ns/op` (`+72.4%`)
- `fork fanout 16 withBoundedConcurrency 16`: `381,208 -> 655,570 ns/op` (`+72.0%`)
- `scope finalizer registration depth 16`: `29,980 -> 62,920 ns/op` (`+109.9%`)
- The verification rerun kept the broad slowdown and exposed additional instability:
- `scope capture depth 16`: `122,853 -> 18,010,888 ns/op` (`+14,560.5%`) in the verification rerun after `270,038 ns/op` in the saved run.
- `scope pass-through depth 16`: `950,928 -> 1,613,729 ns/op` (`+69.7%`) in the verification rerun after `4,374,015 ns/op` in the saved run.
- `fork fanout 16 withBoundedConcurrency 1`: `410,703 -> 692,119 ns/op` (`+68.5%`) in the verification rerun after an extreme `67,183,231 ns/op` outlier in the saved run.

## Stable Or Noisy Cases Worth Noting

- The earlier saved 2026-06-15 report that this file replaces was already on the same commit `87f18a8` and the same pinned Node `v25.9.0`, but it was much faster. Relative to that same-SHA report, the current verification rerun shows median slowdowns of about `+77.6%` in trace, `+75.5%` in runtime-context, and `+73.8%` in runtime-loops. That makes a source-level regression on this SHA unlikely.
- The saved run and the verification rerun are close for most trace and runtime-context rows, which suggests a broad host slowdown rather than one isolated bad sample.
- Several runtime-loop rows are too unstable to treat as code signal from this session alone. The biggest same-session swings were:
- `scope capture depth 16`: `270,038 -> 18,010,888 ns/op`
- `fork fanout 16 withBoundedConcurrency 1`: `67,183,231 -> 692,119 ns/op`
- `pass-through depth 4`: `496,265 -> 44,199 ns/op`
- `scope pass-through depth 8`: `4,717,999 -> 797,011 ns/op`
- Because those outliers move dramatically between two back-to-back pinned-Node reruns on the same SHA, they look more like scheduler, thermal, or machine contention noise than a trustworthy benchmark trend.
- Even after discounting the wildest outliers, the whole suite still stayed materially slower than the June 8 and earlier weekly artifacts. The useful signal from this run is therefore "host state was degraded" rather than "one subsystem uniquely regressed."

## Suggested Attention Areas

- Do not attribute this weekly slowdown to a code change on `87f18a8` without rerunning on a quieter machine state. The strongest evidence against a source regression is that the earlier same-day report on the same SHA and Node pin was much faster.
- If you rerun manually, prioritize runtime-loop scope and concurrency rows because they showed the biggest same-session variance: `scope capture depth 16`, `scope pass-through depth 8`, `scope pass-through depth 16`, and `fork fanout 16 withBoundedConcurrency 1`.
- If the next weekly run returns to the earlier 2026-06-15 or 2026-06-08 range, treat this report as an environment-contaminated sample rather than a new baseline.
- If the next weekly run is still broadly `+60-90%` slower on trace and runtime-context, then the problem is likely outside individual microbenchmarks and worth checking at the machine/toolchain level before investigating specific subsystems.

## Raw Output: Trace

```text
$ tsx benchmarks/trace.ts
# Fx Trace Benchmark Results

- Date: 2026-06-15T13:02:02.954Z
- Git SHA: 87f18a8
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:trace`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 111.56 | 448189 | 2231 | 1.00x |
| handled fail | 2,000 | 23.96 | 83488 | 11978 | 5.37x |
| prebuilt handled fail | 2,000 | 11.17 | 179097 | 5584 | 2.50x |
| handled fail labels | 2,000 | 8.26 | 242169 | 4129 | 1.85x |
| handled fail off | 2,000 | 8.02 | 249395 | 4010 | 1.80x |
| unhandled fail | 2,000 | 78.25 | 25559 | 39126 | 17.54x |
| successful assertPromise | 5,000 | 116.84 | 42794 | 23368 | 10.47x |
| prebuilt successful assertPromise | 5,000 | 72.59 | 68877 | 14519 | 6.51x |
| successful assertPromise labels | 5,000 | 29.21 | 171148 | 5843 | 2.62x |
| successful assertPromise off | 5,000 | 18.46 | 270897 | 3691 | 1.65x |
| rejected assertPromise | 2,000 | 86.90 | 23015 | 43450 | 19.47x |
| nested fork failure | 2,000 | 627.14 | 3189 | 313572 | 140.54x |
| nested fork success | 2,000 | 407.73 | 4905 | 203863 | 91.37x |
| nested fork failure labels | 2,000 | 224.55 | 8907 | 112277 | 50.32x |
| nested fork failure off | 2,000 | 212.07 | 9431 | 106034 | 47.52x |
| all structured failure | 2,000 | 424.38 | 4713 | 212192 | 95.10x |
| forkEach structured failure | 2,000 | 298.81 | 6693 | 149406 | 66.96x |
| race structured failure | 2,000 | 331.77 | 6028 | 165887 | 74.35x |
| plain breadcrumb object | 25,000 | 2.35 | 10636981 | 94 | 1.00x |
| capture breadcrumb stack | 25,000 | 193.66 | 129094 | 7746 | 82.40x |
| capture breadcrumb labels | 25,000 | 4.07 | 6135221 | 163 | 1.73x |
| capture breadcrumb off | 25,000 | 2.68 | 9342155 | 107 | 1.14x |
| append trace 1 + 1 | 25,000 | 3.53 | 7082737 | 141 | 1.00x |
| append trace 16 + 16 | 25,000 | 16.39 | 1524991 | 656 | 4.64x |
| format trace 1 frame | 25,000 | 25.99 | 961990 | 1040 | 1.00x |
| format trace 8 frames | 25,000 | 179.39 | 139362 | 7176 | 6.90x |
| format trace 16 frames | 25,000 | 357.79 | 69874 | 14311 | 13.77x |
| format trace 32 frames | 25,000 | 703.36 | 35544 | 28134 | 27.07x |
```

## Raw Output: Runtime Context

```text
$ tsx benchmarks/runtime-context.ts
# Fx Runtime Context Benchmark Results

- Date: 2026-06-15T13:02:07.148Z
- Git SHA: 87f18a8
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-context`
- Handled effect programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct call | 5,000,000 | 4.04 | 1238505124 | 1 | 1.00x |
| withActiveRuntimeContext active | 5,000,000 | 56.57 | 88381904 | 11 | 14.01x |
| handled effects baseline | 25,000 | 244.92 | 102074 | 9797 | 1.00x |
| handled effects global off | 25,000 | 234.08 | 106801 | 9363 | 0.96x |
| handled effects ambient active off | 25,000 | 232.54 | 107511 | 9301 | 0.95x |
| handled effects regional off | 25,000 | 824.24 | 30331 | 32970 | 3.37x |
| handled effects regional labels | 25,000 | 816.46 | 30620 | 32658 | 3.33x |
| handled effects regional full | 25,000 | 810.24 | 30855 | 32409 | 3.31x |
```

## Raw Output: Runtime Loops

```text
$ tsx benchmarks/runtime-loops.ts
# Fx Runtime Loop Benchmark Results

- Date: 2026-06-15T13:09:27.715Z
- Git SHA: 87f18a8
- Worktree: clean
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 199.21 | 100397 | 9960 | 1.00x |
| prebuilt matched handler throughput | 20,000 | 196.55 | 101757 | 9827 | 0.99x |
| direct internal matched handler throughput | 20,000 | 196.30 | 101886 | 9815 | 0.99x |
| pass-through depth 0 | 20,000 | 245.28 | 81540 | 12264 | 1.23x |
| pass-through depth 1 | 20,000 | 404.84 | 49403 | 20242 | 2.03x |
| pass-through depth 4 | 20,000 | 9925.30 | 2015 | 496265 | 49.82x |
| pass-through depth 8 | 20,000 | 1539.88 | 12988 | 76994 | 7.73x |
| pass-through depth 16 | 20,000 | 3627.46 | 5514 | 181373 | 18.21x |
| prebuilt pass-through depth 0 | 20,000 | 235.85 | 84799 | 11793 | 1.18x |
| prebuilt pass-through depth 1 | 20,000 | 395.74 | 50538 | 19787 | 1.99x |
| prebuilt pass-through depth 4 | 20,000 | 859.67 | 23265 | 42984 | 4.32x |
| prebuilt pass-through depth 8 | 20,000 | 1514.15 | 13209 | 75708 | 7.60x |
| prebuilt pass-through depth 16 | 20,000 | 3592.07 | 5568 | 179604 | 18.03x |
| direct internal pass-through depth 0 | 20,000 | 236.88 | 84432 | 11844 | 1.19x |
| direct internal pass-through depth 1 | 20,000 | 396.28 | 50470 | 19814 | 1.99x |
| direct internal pass-through depth 4 | 20,000 | 861.45 | 23217 | 43073 | 4.32x |
| direct internal pass-through depth 8 | 20,000 | 1517.44 | 13180 | 75872 | 7.62x |
| direct internal pass-through depth 16 | 20,000 | 3638.36 | 5497 | 181918 | 18.26x |
| construct handler stack depth 0 | 20,000 | 5.13 | 3902281 | 256 | 0.03x |
| construct handler stack depth 1 | 20,000 | 8.30 | 2410086 | 415 | 0.04x |
| construct handler stack depth 4 | 20,000 | 14.24 | 1404079 | 712 | 0.07x |
| construct handler stack depth 8 | 20,000 | 18.68 | 1070905 | 934 | 0.09x |
| construct handler stack depth 16 | 20,000 | 30.17 | 662939 | 1508 | 0.15x |
| matched handler outermost | 20,000 | 309.68 | 64583 | 15484 | 1.55x |
| matched handler middle | 20,000 | 575.89 | 34729 | 28795 | 2.89x |
| matched handler innermost | 20,000 | 703.24 | 28440 | 35162 | 3.53x |
| control resume | 20,000 | 236.63 | 84520 | 11831 | 1.19x |
| control short-circuit | 20,000 | 79.66 | 251065 | 3983 | 0.40x |
| control pass-through depth 0 | 20,000 | 239.15 | 83628 | 11958 | 1.20x |
| control pass-through depth 1 | 20,000 | 413.44 | 48375 | 20672 | 2.08x |
| control pass-through depth 4 | 20,000 | 900.71 | 22205 | 45036 | 4.52x |
| control pass-through depth 8 | 20,000 | 1567.32 | 12761 | 78366 | 7.87x |
| control pass-through depth 16 | 20,000 | 3665.17 | 5457 | 183258 | 18.40x |
| capture depth 0 | 20,000 | 73.80 | 270986 | 3690 | 1.00x |
| capture depth 1 | 20,000 | 97.88 | 204327 | 4894 | 1.33x |
| capture depth 4 | 20,000 | 177.89 | 112428 | 8895 | 2.41x |
| capture depth 8 | 20,000 | 308.14 | 64905 | 15407 | 4.18x |
| capture depth 16 | 20,000 | 513.36 | 38959 | 25668 | 6.96x |
| replay depth 0 | 20,000 | 265.08 | 75448 | 13254 | 3.59x |
| replay depth 1 | 20,000 | 253.44 | 78914 | 12672 | 3.43x |
| replay depth 4 | 20,000 | 256.35 | 78017 | 12818 | 3.47x |
| replay depth 8 | 20,000 | 253.82 | 78795 | 12691 | 3.44x |
| replay depth 16 | 20,000 | 255.87 | 78163 | 12794 | 3.47x |
| mapCapturedHandlers fanout 1 | 20,000 | 69.00 | 289862 | 3450 | 0.93x |
| mapCapturedHandlers fanout 4 | 20,000 | 80.58 | 248194 | 4029 | 1.09x |
| mapCapturedHandlers fanout 16 | 20,000 | 96.56 | 207120 | 4828 | 1.31x |
| mapCapturedHandlers fanout 64 | 20,000 | 159.71 | 125230 | 7985 | 2.16x |
| scope pass-through depth 0 | 20,000 | 254.51 | 78582 | 12726 | 1.00x |
| scope pass-through depth 1 | 20,000 | 1663.20 | 12025 | 83160 | 6.53x |
| scope pass-through depth 4 | 20,000 | 7564.63 | 2644 | 378232 | 29.72x |
| scope pass-through depth 8 | 20,000 | 94359.98 | 212 | 4717999 | 370.75x |
| scope pass-through depth 16 | 20,000 | 87480.29 | 229 | 4374015 | 343.72x |
| scope finalizer registration depth 0 | 20,000 | 304.29 | 65726 | 15215 | 1.20x |
| scope finalizer registration depth 1 | 20,000 | 381.23 | 52462 | 19062 | 1.50x |
| scope finalizer registration depth 4 | 20,000 | 562.44 | 35559 | 28122 | 2.21x |
| scope finalizer registration depth 8 | 20,000 | 821.85 | 24335 | 41092 | 3.23x |
| scope finalizer registration depth 16 | 20,000 | 1258.39 | 15893 | 62920 | 4.94x |
| scope capture depth 0 | 20,000 | 80.05 | 249852 | 4002 | 0.31x |
| scope capture depth 1 | 20,000 | 352.66 | 56712 | 17633 | 1.39x |
| scope capture depth 4 | 20,000 | 1329.33 | 15045 | 66467 | 5.22x |
| scope capture depth 8 | 20,000 | 2615.00 | 7648 | 130750 | 10.27x |
| scope capture depth 16 | 20,000 | 5400.75 | 3703 | 270038 | 21.22x |
| handler capture boundary pass-through depth 0 | 20,000 | 396.90 | 50390 | 19845 | 1.00x |
| handler capture boundary pass-through depth 1 | 20,000 | 540.93 | 36974 | 27046 | 1.36x |
| handler capture boundary pass-through depth 4 | 20,000 | 921.37 | 21707 | 46069 | 2.32x |
| handler capture boundary pass-through depth 8 | 20,000 | 1539.03 | 12995 | 76951 | 3.88x |
| handler capture boundary pass-through depth 16 | 20,000 | 3568.38 | 5605 | 178419 | 8.99x |
| handler capture boundary close depth 0 | 20,000 | 60.81 | 328883 | 3041 | 0.15x |
| handler capture boundary close depth 1 | 20,000 | 100.15 | 199710 | 5007 | 0.25x |
| handler capture boundary close depth 4 | 20,000 | 186.70 | 107123 | 9335 | 0.47x |
| handler capture boundary close depth 8 | 20,000 | 304.33 | 65718 | 15217 | 0.77x |
| handler capture boundary close depth 16 | 20,000 | 544.50 | 36731 | 27225 | 1.37x |
| run interrupt mask x100 | 20,000 | 2398.18 | 8340 | 119909 | 1.00x |
| pure runPromise | 2,000 | 31.13 | 64244 | 15566 | 1.00x |
| sequential async x10 | 2,000 | 359.62 | 5561 | 179810 | 11.55x |
| fork fanout 16 withUnboundedConcurrency | 2,000 | 1351.38 | 1480 | 675692 | 43.41x |
| fork fanout 16 withBoundedConcurrency 1 | 2,000 | 134366.46 | 15 | 67183231 | 4316.12x |
| fork fanout 16 withBoundedConcurrency 4 | 2,000 | 1335.74 | 1497 | 667870 | 42.91x |
| fork fanout 16 withBoundedConcurrency 16 | 2,000 | 1311.14 | 1525 | 655570 | 42.12x |
| all fanout 16 | 2,000 | 1150.01 | 1739 | 575004 | 36.94x |
| race fanout 16 | 2,000 | 567.71 | 3523 | 283856 | 18.24x |
| dispose blocked task | 1,000 | 23.48 | 42593 | 23478 | 1.00x |
| dispose blocked scoped task | 1,000 | 48.99 | 20413 | 48989 | 2.09x |
| dispose blocked fork | 1,000 | 69.90 | 14306 | 69902 | 2.98x |
```
