# Cooperative All Evaluation

- Date: 2026-05-26T20:40:36.554Z
- Git SHA: 192e251
- Worktree: M package.json
 M src/Concurrent.test.ts
 M src/Concurrent.ts
 M src/Trace.test.ts
 M src/internal/runFork.ts
?? benchmarks/cooperative-all.ts
?? benchmarks/results/2026-05-26-cooperative-all-evaluation.md
?? src/internal/forkDiagnostics.ts
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:cooperative-all`

## Semantic Checks

- Parity success/failure checks: pass

## Fairness

| Case | Total steps | Max consecutive same-child steps | First-step spread |
| --- | ---: | ---: | ---: |
| defaultAll + unbounded | 256 | 16 | 240 |
| cooperativeAll budget 1 | 256 | 1 | 15 |
| cooperativeAll budget 8 | 256 | 8 | 120 |
| cooperativeAll budget 64 | 256 | 16 | 240 |

## Performance

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative to group baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| defaultAll + unbounded ok fanout 16 | 1,000 | 254.31 | 3932 | 254308 | 1.00x |
| cooperativeAll ok fanout 16 | 1,000 | 73.57 | 13593 | 73567 | 0.29x |
| defaultAll + unbounded async fanout 16 | 1,000 | 419.60 | 2383 | 419600 | 1.00x |
| cooperativeAll async fanout 16 | 1,000 | 292.47 | 3419 | 292469 | 0.70x |
| defaultAll + unbounded yielding 16x16 | 250 | 86.16 | 2902 | 344642 | 1.00x |
| cooperativeAll yielding 16x16 budget 1 | 250 | 57.01 | 4385 | 228055 | 0.66x |
| cooperativeAll yielding 16x16 budget 8 | 250 | 53.80 | 4646 | 215218 | 0.62x |
| cooperativeAll yielding 16x16 budget 64 | 250 | 53.09 | 4709 | 212349 | 0.62x |
| defaultAll + unbounded mixed parked async | 250 | 55.85 | 4476 | 223402 | 1.00x |
| cooperativeAll mixed parked async budget 1 | 250 | 51.16 | 4886 | 204654 | 0.92x |
| defaultAll + unbounded cancel cleanup | 250 | 76.05 | 3287 | 304208 | 1.00x |
| cooperativeAll cancel cleanup | 250 | 66.26 | 3773 | 265048 | 0.87x |
