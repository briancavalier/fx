# Scope/Concurrency Performance

- Date: 2026-05-31
- Worktree: `/private/tmp/fx-scope-concurrency-perf`
- Branch: `codex/scope-concurrency-perf`
- Baseline SHA: `e176462`
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `corepack pnpm benchmark:cooperative-all:js`

## Baseline

Baseline was captured from a clean worktree before edits.

| Case | Baseline median ns/op | Baseline relative |
| --- | ---: | ---: |
| withCoopConcurrency ok fanout 16 | 881023 | 1.33x |
| withCoopConcurrency async fanout 16 | 1282605 | 1.48x |
| withCoopConcurrency explicit fork fanout 16 | 881563 | 1.32x |
| withCoopConcurrency yielding 16x16 budget 1 | 1036615 | 1.32x |
| withCoopConcurrency mixed parked async budget 1 | 635578 | 1.44x |
| withCoopConcurrency nested race | 592626 | 1.83x |
| withCoopConcurrency nested firstSuccess | 567548 | 1.60x |
| withCoopConcurrency cancel cleanup | 498167 | 1.41x |

Fairness rows were unchanged from the post-PR-216 baseline:

| Case | Total steps | Max consecutive same-child steps | First-step spread |
| --- | ---: | ---: | ---: |
| withUnboundedConcurrency | 256 | 16 | 240 |
| withCoopConcurrency budget 1 | 256 | 16 | 240 |
| withCoopConcurrency budget 8 | 256 | 16 | 240 |
| withCoopConcurrency budget 64 | 256 | 16 | 240 |

## After Changes

The post-change run used the same built benchmark command. The worktree was dirty with the implementation changes.

| Case | Median ns/op | Relative |
| --- | ---: | ---: |
| withCoopConcurrency ok fanout 16 | 774405 | 1.40x |
| withCoopConcurrency async fanout 16 | 1177433 | 1.52x |
| withCoopConcurrency explicit fork fanout 16 | 891562 | 1.35x |
| withCoopConcurrency yielding 16x16 budget 1 | 935009 | 1.39x |
| withCoopConcurrency mixed parked async budget 1 | 529840 | 1.38x |
| withCoopConcurrency nested race | 424632 | 1.50x |
| withCoopConcurrency nested firstSuccess | 366561 | 1.37x |
| withCoopConcurrency cancel cleanup | 461650 | 1.39x |

New focused rows:

| Case | Median ns/op | Relative |
| --- | ---: | ---: |
| withCoopConcurrency explicit fork fanout 16 limit 1 | 1286990 | 1.48x |
| withCoopConcurrency scoped join fanout 16 | 1337027 | 1.52x |

Fairness rows stayed intentionally unchanged. The `yieldBudget` issue remains deferred.

## Notes

- The largest improvements in this run were the nested structured cases, which now avoid repeated per-settlement `Promise.race(pending.map(...))` allocation.
- `ok fanout`, `async fanout`, and cleanup rows remain noisy enough that only larger repeated movements should be treated as signal.
- `benchmark:runtime-loops` was not used for this change. It is not currently build-clean under `tsconfig.benchmarks.json` because that config only supports the cooperative benchmark path.
