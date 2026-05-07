# Fx Trace Benchmark Results - Policy And Fast Paths

- Date: 2026-05-07T15:28:21.844Z
- Git SHA: 4e1344a
- Worktree: dirty
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `npm run benchmark`
- Benchmark file: `benchmarks/trace.ts`

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| pure runtime baseline | 50,000 | 11.66 | 4289713 | 233 | 1.00x |
| handled fail | 2,000 | 48.59 | 41162 | 24294 | 104.21x |
| prebuilt handled fail | 2,000 | 32.84 | 60894 | 16422 | 70.45x |
| handled fail labels | 2,000 | 2.02 | 992392 | 1008 | 4.32x |
| handled fail off | 2,000 | 1.81 | 1104642 | 905 | 3.88x |
| unhandled fail | 2,000 | 60.25 | 33195 | 30125 | 129.23x |
| successful assertPromise | 5,000 | 98.22 | 50908 | 19643 | 84.26x |
| prebuilt successful assertPromise | 5,000 | 52.29 | 95618 | 10458 | 44.86x |
| successful assertPromise labels | 5,000 | 8.35 | 598641 | 1670 | 7.17x |
| successful assertPromise off | 5,000 | 7.89 | 633386 | 1579 | 6.77x |
| rejected assertPromise | 2,000 | 70.22 | 28480 | 35112 | 150.62x |
| nested fork failure | 2,000 | 542.65 | 3686 | 271326 | 1163.91x |
| nested fork success | 2,000 | 343.75 | 5818 | 171875 | 737.29x |
| nested fork failure labels | 2,000 | 126.51 | 15809 | 63256 | 271.35x |
| nested fork failure off | 2,000 | 118.45 | 16884 | 59227 | 254.07x |
| all structured failure | 2,000 | 190.27 | 10511 | 95137 | 408.11x |
| forkEach structured failure | 2,000 | 184.67 | 10830 | 92336 | 396.10x |
| race structured failure | 2,000 | 165.72 | 12068 | 82861 | 355.45x |
| plain breadcrumb object | 25,000 | 2.20 | 11359764 | 88 | 1.00x |
| capture breadcrumb stack | 25,000 | 189.97 | 131599 | 7599 | 86.32x |
| capture breadcrumb labels | 25,000 | 2.35 | 10639806 | 94 | 1.07x |
| capture breadcrumb off | 25,000 | 2.33 | 10749221 | 93 | 1.06x |
| append trace 1 + 1 | 25,000 | 2.95 | 8476013 | 118 | 1.00x |
| append trace 16 + 16 | 25,000 | 9.93 | 2517570 | 397 | 3.37x |
| format trace 1 frame | 25,000 | 15.78 | 1584786 | 631 | 1.00x |
| format trace 8 frames | 25,000 | 101.97 | 245164 | 4079 | 6.46x |
| format trace 16 frames | 25,000 | 199.99 | 125005 | 8000 | 12.68x |
| format trace 32 frames | 25,000 | 402.33 | 62138 | 16093 | 25.50x |

## Initial Read

- Label-only and off policies remove most measured stack capture overhead: handled `fail` drops from about 23.8us/op to about 1us/op.
- Successful `assertPromise` improves under labels/off because request-site stack capture is skipped; the prebuilt async case isolates runtime overhead once construction-time capture is removed from the measurement.
- Nested fork failure remains expensive in full mode, but labels/off show that much of the failure cost is stack capture rather than trace list merging alone.
- The `appendTrace` 16+16 benchmark improves sharply compared with the baseline, showing the bounded fast path is effective for common acyclic traces.
