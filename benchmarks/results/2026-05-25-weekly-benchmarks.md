# Weekly Benchmark Report

- Date: 2026-05-25
- Repository: `@briancavalier/fx`
- Compared against:
  - Trace: `benchmarks/results/2026-05-07-trace-policy-and-fast-paths.md`
  - Runtime context: `benchmarks/results/2026-05-08-runtime-context-fast-paths.md`
  - Runtime loops: `benchmarks/results/2026-05-14-runtime-loops-baseline.md` and `benchmarks/results/2026-05-14-expanded-runtime-loop-coverage-baseline.md`
- Default significance threshold: 10% delta in `ns/op`
- Interpretation: lower `ns/op` is faster, higher `ns/op` is slower

## Command Status

| Command | Status | Notes |
| --- | --- | --- |
| `pnpm benchmark:trace` | pass | Clean worktree on `192e251` |
| `pnpm benchmark:runtime-context` | pass | Clean worktree on `192e251` |
| `pnpm benchmark:runtime-loops` | fail | Crashed before producing a benchmark table |

## Significant Improvements

### Trace

- `prebuilt handled fail`: `16,422 -> 3,831 ns/op` (`-76.7%`)
- `handled fail`: `24,294 -> 6,415 ns/op` (`-73.6%`)
- `capture breadcrumb stack`: `7,599 -> 4,334 ns/op` (`-43.0%`)
- `rejected assertPromise`: `35,112 -> 21,913 ns/op` (`-37.6%`)
- `nested fork failure`: `271,326 -> 173,459 ns/op` (`-36.1%`)
- `nested fork success`: `171,875 -> 113,763 ns/op` (`-33.8%`)
- `unhandled fail`: `30,125 -> 20,879 ns/op` (`-30.7%`)
- `successful assertPromise`: `19,643 -> 13,674 ns/op` (`-30.4%`)
- `prebuilt successful assertPromise`: `10,458 -> 8,261 ns/op` (`-21.0%`)
- `forkEach structured failure`: `92,336 -> 80,571 ns/op` (`-12.7%`)

### Runtime Context

- `withActiveRuntimeContext active`: `11 -> 6 ns/op` (`-45.5%`)
- `handled effects regional full`: `31,631 -> 19,222 ns/op` (`-39.2%`)
- `handled effects regional labels`: `31,631 -> 19,313 ns/op` (`-38.9%`)
- `handled effects regional off`: `31,791 -> 19,636 ns/op` (`-38.2%`)
- `handled effects global off`: `8,498 -> 6,614 ns/op` (`-22.2%`)
- `handled effects ambient active off`: `8,463 -> 6,619 ns/op` (`-21.8%`)
- `handled effects baseline`: `8,463 -> 6,852 ns/op` (`-19.0%`)

## Significant Regressions

### Trace

- `pure runtime baseline`: `233 -> 1,151 ns/op` (`+394.0%`)
- `handled fail labels`: `1,008 -> 2,120 ns/op` (`+110.3%`)
- `handled fail off`: `905 -> 1,893 ns/op` (`+109.2%`)
- `successful assertPromise labels`: `1,670 -> 2,630 ns/op` (`+57.5%`)
- `successful assertPromise off`: `1,579 -> 2,114 ns/op` (`+33.9%`)

### Runtime Loops

- No row-level regression analysis was possible because the benchmark process failed before emitting results.

## Stable Or Noisy Cases Worth Noting

- `format trace 8 frames`, `format trace 16 frames`, and `format trace 32 frames` stayed effectively flat (`-1.0%`, `+1.0%`, and `+0.0%`), which suggests trace formatting cost is stable.
- `append trace 16 + 16` (`-4.3%`) and `nested fork failure labels/off` (`-4.8%` and `-5.7%`) are within normal microbenchmark drift and do not look like meaningful movement.
- `direct call` in runtime-context moved from `1 ns/op` to `0 ns/op`, which is timer-floor noise rather than a real throughput change.
- Several sub-microsecond trace rows changed direction at once: `plain breadcrumb object`, `capture breadcrumb labels`, `capture breadcrumb off`, and `pure runtime baseline`. Those cases are small enough that scheduler noise, CPU frequency shifts, or timer granularity are plausible explanations, especially since larger trace paths improved in the same run.

## Suggested Attention Areas

- Fix the `runtime-loops` harness before drawing runtime-subsystem conclusions. The crash occurs while constructing `blockedWithFinalizer` in [`benchmarks/runtime-loops.ts`](/Users/brian/dev/@briancavalier/fx/benchmarks/runtime-loops.ts:69), where `.pipe(scope('benchmark/runtime-loops/Interrupt'))` now reaches `pipe()` with a non-function argument and throws from [`src/internal/pipe.ts`](/Users/brian/dev/@briancavalier/fx/src/internal/pipe.ts:282).
- Recheck the trace labels/off fast paths. The full trace paths improved sharply, but `handled fail labels`, `handled fail off`, `successful assertPromise labels`, and `successful assertPromise off` all regressed by 34% to 110%, which points at the trace-policy short-circuit paths rather than the full-stack capture path.
- Runtime-context propagation looks broadly healthier than the 2026-05-08 baseline, especially the regional modes. Unless another report contradicts this trend, this subsystem does not look like the current perf priority.
- Treat tiny trace microbenchmarks as guardrails, not optimization targets, until they regress consistently across multiple weekly runs.

## Raw Output: Trace

```text
$ tsx benchmarks/trace.ts
# Fx Trace Benchmark Results

- Date: 2026-05-25T13:30:32.005Z
- Git SHA: 192e251
- Worktree: clean
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:trace`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 57.55 | 868794 | 1151 | 1.00x |
| handled fail | 2,000 | 12.83 | 155884 | 6415 | 5.57x |
| prebuilt handled fail | 2,000 | 7.66 | 261053 | 3831 | 3.33x |
| handled fail labels | 2,000 | 4.24 | 471698 | 2120 | 1.84x |
| handled fail off | 2,000 | 3.79 | 528268 | 1893 | 1.64x |
| unhandled fail | 2,000 | 41.76 | 47894 | 20879 | 18.14x |
| successful assertPromise | 5,000 | 68.37 | 73129 | 13674 | 11.88x |
| prebuilt successful assertPromise | 5,000 | 41.31 | 121049 | 8261 | 7.18x |
| successful assertPromise labels | 5,000 | 13.15 | 380157 | 2630 | 2.29x |
| successful assertPromise off | 5,000 | 10.57 | 473048 | 2114 | 1.84x |
| rejected assertPromise | 2,000 | 43.83 | 45634 | 21913 | 19.04x |
| nested fork failure | 2,000 | 346.92 | 5765 | 173459 | 150.70x |
| nested fork success | 2,000 | 227.53 | 8790 | 113763 | 98.84x |
| nested fork failure labels | 2,000 | 120.48 | 16600 | 60240 | 52.34x |
| nested fork failure off | 2,000 | 111.73 | 17900 | 55865 | 48.54x |
| all structured failure | 2,000 | 173.48 | 11529 | 86738 | 75.36x |
| forkEach structured failure | 2,000 | 161.14 | 12411 | 80571 | 70.00x |
| race structured failure | 2,000 | 152.54 | 13112 | 76268 | 66.26x |
| plain breadcrumb object | 25,000 | 1.31 | 19094289 | 52 | 1.00x |
| capture breadcrumb stack | 25,000 | 108.35 | 230734 | 4334 | 82.75x |
| capture breadcrumb labels | 25,000 | 1.44 | 17343551 | 58 | 1.10x |
| capture breadcrumb off | 25,000 | 1.40 | 17870967 | 56 | 1.07x |
| append trace 1 + 1 | 25,000 | 2.01 | 12455627 | 80 | 1.00x |
| append trace 16 + 16 | 25,000 | 9.50 | 2630195 | 380 | 4.74x |
| format trace 1 frame | 25,000 | 14.35 | 1742378 | 574 | 1.00x |
| format trace 8 frames | 25,000 | 100.96 | 247611 | 4039 | 7.04x |
| format trace 16 frames | 25,000 | 201.94 | 123798 | 8078 | 14.07x |
| format trace 32 frames | 25,000 | 402.42 | 62125 | 16097 | 28.05x |
```

## Raw Output: Runtime Context

```text
$ tsx benchmarks/runtime-context.ts
# Fx Runtime Context Benchmark Results

- Date: 2026-05-25T13:30:39.107Z
- Git SHA: 192e251
- Worktree: clean
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-context`
- Handled effect programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct call | 5,000,000 | 2.43 | 2056908064 | 0 | 1.00x |
| withActiveRuntimeContext active | 5,000,000 | 30.53 | 163765737 | 6 | 12.56x |
| handled effects baseline | 25,000 | 171.29 | 145950 | 6852 | 1.00x |
| handled effects global off | 25,000 | 165.34 | 151206 | 6614 | 0.97x |
| handled effects ambient active off | 25,000 | 165.48 | 151075 | 6619 | 0.97x |
| handled effects regional off | 25,000 | 490.91 | 50926 | 19636 | 2.87x |
| handled effects regional labels | 25,000 | 482.81 | 51780 | 19313 | 2.82x |
| handled effects regional full | 25,000 | 480.54 | 52024 | 19222 | 2.81x |
```

## Raw Output: Runtime Loops

```text
$ tsx benchmarks/runtime-loops.ts
/Users/brian/dev/@briancavalier/fx/src/internal/pipe.ts:282
      return args[0](self)
                   ^

TypeError: args[0] is not a function
    at pipe (/Users/brian/dev/@briancavalier/fx/src/internal/pipe.ts:282:20)
    at Gen.pipe (/Users/brian/dev/@briancavalier/fx/src/internal/generator.ts:162:19)
    at <anonymous> (/Users/brian/dev/@briancavalier/fx/benchmarks/runtime-loops.ts:72:4)
    at ModuleJob.run (node:internal/modules/esm/module_job:430:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:661:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.14.0
[ELIFECYCLE] Command failed with exit code 1.
```
