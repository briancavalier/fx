# Miss-Path Minimal Handler Confirmation

- Date: 2026-05-14T20:38:29.414Z
- Git SHA: d72d784
- Worktree: dirty
- Node: v25.9.0
- Platform: darwin 25.3.0 arm64
- Command: `pnpm benchmark:runtime-loops`
- Result: repeated run confirms the miss-path minimal Handler change remains positive and does not trigger the V8/module-shape cliff.

## Primary Guardrails

| Case | Original baseline ns/op | Confirmation ns/op |
| --- | ---: | ---: |
| matched handler throughput | 10,902 | 10,194 |
| prebuilt matched handler throughput | n/a | 9,858 |
| direct internal matched handler throughput | n/a | 10,230 |
| pass-through depth 0 | 13,156 | 12,632 |
| pass-through depth 16 | 190,649 | 180,142 |
| prebuilt pass-through depth 16 | n/a | 178,595 |
| direct internal pass-through depth 16 | n/a | 178,671 |
| capture depth 16 | 37,526 | 26,325 |
| replay depth 0 | 14,564 | 12,749 |

## Recommendation

Keep the miss-path minimal `Handler` change as the current accepted point. It preserves matched/depth-0 hot paths and provides small but repeatable reductions in deep pass-through and capture depth.
