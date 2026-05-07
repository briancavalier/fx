# Fx Trace Benchmark Results - Baseline

- Date: 2026-05-07T15:04:34.392Z
- Git SHA: 4e1344a
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `npm run benchmark`
- Benchmark file: `benchmarks/trace.ts`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 11.67 | 4285668 | 233 | 1.00x |
| handled fail | 2,000 | 47.91 | 41748 | 23953 | 102.65x |
| unhandled fail | 2,000 | 55.36 | 36128 | 27679 | 118.62x |
| successful assertPromise | 5,000 | 93.78 | 53315 | 18756 | 80.38x |
| rejected assertPromise | 2,000 | 68.17 | 29338 | 34086 | 146.08x |
| nested fork failure | 2,000 | 545.37 | 3667 | 272683 | 1168.63x |
| all structured failure | 2,000 | 202.12 | 9895 | 101058 | 433.10x |
| forkEach structured failure | 2,000 | 186.77 | 10709 | 93383 | 400.21x |
| race structured failure | 2,000 | 164.84 | 12133 | 82419 | 353.22x |
| plain breadcrumb object | 25,000 | 2.03 | 12286769 | 81 | 1.00x |
| capture breadcrumb stack | 25,000 | 189.89 | 131653 | 7596 | 93.33x |
| append trace 1 + 1 | 25,000 | 3.93 | 6357279 | 157 | 1.00x |
| append trace 16 + 16 | 25,000 | 31.15 | 802619 | 1246 | 7.92x |
| format trace 1 frame | 25,000 | 15.81 | 1581344 | 632 | 1.00x |
| format trace 8 frames | 25,000 | 102.51 | 243877 | 4100 | 6.48x |
| format trace 16 frames | 25,000 | 201.75 | 123913 | 8070 | 12.76x |
| format trace 32 frames | 25,000 | 420.00 | 59523 | 16800 | 26.57x |

## Initial Read

- Stack-bearing breadcrumb capture is about 93x slower than a plain breadcrumb object in this run, which strongly supports prioritizing trace capture policy.
- Handled `fail` is expensive relative to pure runtime and likely inherits much of that stack capture cost.
- Successful `assertPromise` is also a significant success-path cost, so lazy async trace allocation is worth evaluating early.
- Nested fork failure is the largest runtime outlier; direct `appendTrace` cost is bounded but measurable, so nested fork performance likely includes both trace merging and fork/task propagation overhead.
- Formatting cost grows roughly linearly with trace depth; optimize string parsing after runtime hot-path changes unless formatting becomes user-visible overhead.
