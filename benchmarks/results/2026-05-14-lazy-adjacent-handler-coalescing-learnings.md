# Lazy Adjacent Handler Coalescing Learnings

The lazy adjacent-handler coalescing prototype was correct, but it is not a viable production direction as implemented. It confirmed that flattening adjacent ordinary handlers can reduce deep pass-through scaling, but also exposed a large fixed-cost cliff that affects the ordinary single-handler path.

## What we learned

### Coalescing can reduce depth scaling

The built-JS isolated benchmark showed the intended depth win:

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| public pass-through depth 16 | 179,428 | 121,797 |
| public prebuilt pass-through depth 16 | 175,833 | 117,163 |
| direct internal prebuilt pass-through depth 16 | 177,140 | 116,495 |

This means a single dispatch frame over an adjacent handler stack is directionally useful for deep non-matching pass-through.

### Fixed overhead still dominates

The same prototype badly regressed the common path:

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| public matched prebuilt | 10,182 | 110,190 |
| direct internal matched prebuilt | 10,588 | 111,662 |
| public pass-through depth 0 | 11,655 | 115,777 |

The deep-stack improvement does not compensate for a roughly 10x regression in matched and depth-0 handler execution.

### This is not only a `tsx` artifact

Running the same isolated benchmark through `tsx` made the cliff worse:

| Case | Baseline `tsx` ns/op | Prototype `tsx` ns/op |
| --- | ---: | ---: |
| public matched prebuilt | 13,615 | 183,184 |
| direct internal matched prebuilt | 12,955 | 185,245 |
| public pass-through depth 0 | 14,145 | 187,063 |

However, built `dist` output still regressed substantially. That rules out treating this purely as an esbuild/`tsx` development-runner issue.

### V8 appears sensitive to module and class shape

The most important signal is that `direct internal matched prebuilt` regressed even when `src/internal/Handler.ts` itself had no diff. Moving coalescing machinery into a separate internal module did not protect the hot path.

That points to V8 optimization sensitivity around the broader ESM import graph, class identity/shape, generator code, or inlining decisions. The regression is too large to explain by the coalesced dispatch loop alone.

### Production integration is too fragile right now

Both flattened and lazy coalescing prototypes found the same failure mode: depth scaling improves only after moving the single-handler path into a much slower regime. Any handler-stack optimization must first prove that matched handler throughput and depth-0 pass-through stay near baseline.

## Decision

Do not continue with production-path adjacent-handler coalescing as the next optimization. Keep the benchmark improvements and negative results, but revert the lazy coalescing runtime changes before pursuing another runtime optimization.

The next higher-value direction is to optimize within the existing `Handler` implementation without changing public handler module shape, adding alternate frame classes, or changing the ordinary handler import graph.

Suggested next prototype: a minimal miss-path optimization inside the existing `Handler.[Symbol.iterator]`, preserving the current class/module structure and measuring:

- matched handler throughput
- public and direct internal depth-0 pass-through
- prebuilt pass-through depth 16
- capture and replay depth 0

## Benchmark files

Related results:

- `2026-05-14-lazy-adjacent-handler-coalescing-negative.md`
- `2026-05-14-isolated-handler-transpile-v8-comparison.md`
- `2026-05-14-flattened-handler-prototype-learnings.md`
