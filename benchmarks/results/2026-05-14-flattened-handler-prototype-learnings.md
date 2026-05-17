# Flattened Handler Prototype Learnings

The flattened adjacent ordinary-handler prototype was correct but not performance-viable as implemented. It still produced useful information for deciding what to prototype next.

## What we learned

### Flattening can remove depth scaling

The prototype made pass-through depth nearly flat:

| Case | Prototype ns/op |
| --- | ---: |
| pass-through depth 0 | 183,510 |
| pass-through depth 16 | 194,118 |

That confirms the core idea is directionally valid: one dispatch frame plus local handler lookup avoids repeated generator pass-through through every non-matching handler.

### Fixed overhead matters more than expected

The same prototype badly regressed the single-handler hot path:

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| matched handler throughput | 10,902 | 181,725 |

This makes the prototype unsuitable as-is. Any future handler-stack optimization must protect the single-handler and depth-0 paths before optimizing deep stacks.

### Module shape and eager imports are performance-sensitive

Several variations showed that adding stack machinery near the hot `handle` path could keep depth 0 slow, even when the original internal `Handler` logic was restored. This suggests V8/module-transform/JIT behavior is sensitive to import graph and class/generator shape.

Future prototypes should keep `src/internal/Handler.ts` byte-for-byte close to the current implementation unless a change is intentionally being measured, and should avoid eager stack machinery in modules that every ordinary `handle` use imports.

### The benchmark suite needs hot-path guardrails

The original target was deep non-matching pass-through, but the prototype showed the benchmark suite also needs to guard:

- `matched handler throughput`
- `pass-through depth 0`
- direct internal `Handler` behavior
- prebuilt handler stack behavior separately from stack construction

Depth-16 improvement is not meaningful if depth 0 regresses materially.

### Captured handler replay needs separate care

The prototype also made replay depth flat but very slow:

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| replay depth 0 | 14,564 | 186,772 |

Captured/replayed handler contexts should not use a flattened shape that regresses the same single-handler path.

## Decision for next prototype

Approach 1 is not disproven, but the integration strategy was wrong. The next prototype should focus on lazy adjacent-handler coalescing:

- keep first `handle(...)` exactly as today
- coalesce only when applying a handler to an existing ordinary `Handler`
- keep stack machinery out of the eager single-handler hot path if possible
- require depth 0 and matched handler throughput to stay near baseline before evaluating depth-16 gains

## Suggested acceptance gates

- `matched handler throughput` and `pass-through depth 0` no worse than 10-15% from baseline
- `pass-through depth 16` materially better than baseline
- full correctness suite passes
- captured handler replay does not regress depth 0 materially
