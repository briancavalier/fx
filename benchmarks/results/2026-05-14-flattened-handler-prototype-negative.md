# Fx Runtime Loop Benchmark Results

- Date: 2026-05-14T19:30:47.620Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Handler programs yield 100 effects per operation.
- Prototype: flattened adjacent ordinary handlers in `src/Handler.ts`.
- Outcome: negative. The prototype reduced depth scaling but regressed the single/matched handler hot path enough to make it unsuitable as-is.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| matched handler throughput | 20,000 | 3634.50 | 5503 | 181725 | 1.00x |
| pass-through depth 0 | 20,000 | 3670.20 | 5449 | 183510 | 1.01x |
| pass-through depth 1 | 20,000 | 3696.14 | 5411 | 184807 | 1.02x |
| pass-through depth 4 | 20,000 | 3739.05 | 5349 | 186953 | 1.03x |
| pass-through depth 8 | 20,000 | 3791.41 | 5275 | 189571 | 1.04x |
| pass-through depth 16 | 20,000 | 3882.35 | 5152 | 194118 | 1.07x |
| matched handler outermost | 20,000 | 6316.07 | 3167 | 315803 | 1.74x |
| matched handler middle | 20,000 | 4626.84 | 4323 | 231342 | 1.27x |
| matched handler innermost | 20,000 | 3713.56 | 5386 | 185678 | 1.02x |
| control resume | 20,000 | 246.67 | 81079 | 12334 | 0.07x |
| control short-circuit | 20,000 | 84.87 | 235666 | 4243 | 0.02x |
| capture depth 0 | 20,000 | 79.19 | 252555 | 3960 | 1.00x |
| capture depth 1 | 20,000 | 91.10 | 219530 | 4555 | 1.15x |
| capture depth 4 | 20,000 | 126.21 | 158471 | 6310 | 1.59x |
| capture depth 8 | 20,000 | 163.86 | 122055 | 8193 | 2.07x |
| capture depth 16 | 20,000 | 248.28 | 80555 | 12414 | 3.14x |
| replay depth 0 | 20,000 | 3735.44 | 5354 | 186772 | 47.17x |
| replay depth 1 | 20,000 | 3715.69 | 5383 | 185785 | 46.92x |
| replay depth 4 | 20,000 | 3733.15 | 5357 | 186658 | 47.14x |
| replay depth 8 | 20,000 | 3719.36 | 5377 | 185968 | 46.97x |
| replay depth 16 | 20,000 | 3715.79 | 5382 | 185789 | 46.92x |
| mapCapturedHandlers fanout 1 | 20,000 | 89.17 | 224289 | 4459 | 1.13x |
| mapCapturedHandlers fanout 4 | 20,000 | 87.01 | 229865 | 4350 | 1.10x |
| mapCapturedHandlers fanout 16 | 20,000 | 102.54 | 195037 | 5127 | 1.29x |
| mapCapturedHandlers fanout 64 | 20,000 | 171.60 | 116549 | 8580 | 2.17x |
| pure runPromise | 2,000 | 25.05 | 79842 | 12525 | 1.00x |
| sequential async x10 | 2,000 | 358.57 | 5578 | 179283 | 14.31x |
| fork fanout 16 unbounded | 2,000 | 1369.12 | 1461 | 684559 | 54.66x |
| fork fanout 16 bounded 1 | 2,000 | 1379.03 | 1450 | 689517 | 55.05x |
| fork fanout 16 bounded 4 | 2,000 | 1360.65 | 1470 | 680326 | 54.32x |
| fork fanout 16 bounded 16 | 2,000 | 1349.05 | 1483 | 674527 | 53.86x |
| all fanout 16 | 2,000 | 477.42 | 4189 | 238710 | 19.06x |
| race fanout 16 | 2,000 | 463.30 | 4317 | 231649 | 18.50x |
| dispose blocked task | 1,000 | 22.53 | 44390 | 22528 | 1.00x |
| dispose blocked scoped task | 1,000 | 40.67 | 24590 | 40668 | 1.81x |
| dispose blocked fork | 1,000 | 66.95 | 14937 | 66949 | 2.97x |
