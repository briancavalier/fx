# Cooperative All Evaluation

- Date: 2026-05-26T23:00:08.550Z
- Git SHA: a7bbca9
- Worktree: M benchmarks/cooperative-all.ts
 M examples/advanced/diagnostics.ts
 M examples/advanced/incident-collector/cli.ts
 M src/Concurrent.test.ts
 M src/Concurrent.ts
 M src/Trace.test.ts
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
| cooperativeStructured budget 1 | 256 | 1 | 15 |
| cooperativeAll budget 8 | 256 | 8 | 120 |
| cooperativeAll budget 64 | 256 | 16 | 240 |

## Performance

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative to group baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| defaultAll + unbounded ok fanout 16 | 1,000 | 254.00 | 3937 | 253999 | 1.00x |
| cooperativeAll ok fanout 16 | 1,000 | 71.14 | 14056 | 71142 | 0.28x |
| cooperativeStructured ok fanout 16 | 1,000 | 75.39 | 13265 | 75386 | 0.30x |
| defaultAll + unbounded async fanout 16 | 1,000 | 425.67 | 2349 | 425674 | 1.00x |
| cooperativeAll async fanout 16 | 1,000 | 291.35 | 3432 | 291352 | 0.68x |
| cooperativeStructured async fanout 16 | 1,000 | 291.79 | 3427 | 291789 | 0.69x |
| defaultAll + unbounded yielding 16x16 | 250 | 89.26 | 2801 | 357021 | 1.00x |
| cooperativeAll yielding 16x16 budget 1 | 250 | 59.76 | 4183 | 239041 | 0.67x |
| cooperativeStructured yielding 16x16 budget 1 | 250 | 66.26 | 3773 | 265041 | 0.74x |
| cooperativeAll yielding 16x16 budget 8 | 250 | 54.64 | 4576 | 218543 | 0.61x |
| cooperativeAll yielding 16x16 budget 64 | 250 | 54.82 | 4560 | 219281 | 0.61x |
| defaultAll + unbounded mixed parked async | 250 | 56.65 | 4413 | 226585 | 1.00x |
| cooperativeAll mixed parked async budget 1 | 250 | 53.22 | 4697 | 212892 | 0.94x |
| cooperativeStructured mixed parked async budget 1 | 250 | 54.16 | 4616 | 216623 | 0.96x |
| defaultAll + firstSettled + unbounded nested race | 250 | 53.31 | 4689 | 213245 | 1.00x |
| cooperativeStructured nested race | 250 | 40.70 | 6142 | 162807 | 0.76x |
| defaultAll + firstSuccess + unbounded nested firstSuccess | 250 | 56.33 | 4438 | 225311 | 1.00x |
| cooperativeStructured nested firstSuccess | 250 | 38.29 | 6528 | 153179 | 0.68x |
| defaultAll + unbounded cancel cleanup | 250 | 79.42 | 3148 | 317672 | 1.00x |
| cooperativeAll cancel cleanup | 250 | 69.47 | 3599 | 277865 | 0.87x |
| cooperativeStructured cancel cleanup | 250 | 75.76 | 3300 | 303038 | 0.95x |
