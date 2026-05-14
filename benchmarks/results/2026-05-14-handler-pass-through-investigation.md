# Deep Non-Matching Handler Pass-Through Investigation

## Current signal

The runtime-loop baseline shows steep growth as ordinary effects pass through non-matching handlers before reaching the matching handler:

| Case | ns/op |
| --- | ---: |
| pass-through depth 0 | 13,156 |
| pass-through depth 1 | 21,537 |
| pass-through depth 4 | 46,733 |
| pass-through depth 8 | 81,043 |
| pass-through depth 16 | 190,649 |

With 100 yielded effects per operation, the saved baseline implies roughly 1.1 microseconds for each additional non-matching handler per yielded effect at depth 16.

## Focused measurement

I compared rebuilding the handler stack per measured operation with prebuilding the stack once:

| Case | ns/op |
| --- | ---: |
| prebuilt depth 0 | 10,887 |
| rebuilt depth 0 | 9,787 |
| prebuilt depth 1 | 19,221 |
| rebuilt depth 1 | 18,212 |
| prebuilt depth 4 | 42,345 |
| rebuilt depth 4 | 42,846 |
| prebuilt depth 8 | 76,492 |
| rebuilt depth 8 | 77,219 |
| prebuilt depth 16 | 187,919 |
| rebuilt depth 16 | 188,575 |

Conclusion: stack construction is not the primary cause. The steady-state iterator path dominates.

## CPU profile

A V8 CPU profile for a prebuilt depth-16 pass-through case attributes almost all samples to repeated `src/internal/Handler.ts` generator frames:

| Samples | Location |
| ---: | --- |
| 24,455 | `src/internal/Handler.ts :: (anonymous)` |
| 1,120 | garbage collector |
| 972 | `src/Effect.ts :: (anonymous)` |
| 427 | `src/Effect.ts :: is` |

The profile shape matches the implementation: every non-matching handler wrapper resumes its own generator frame, checks the yielded effect, then yields it to the next outer frame.

## Hot path

The hot path is `Handler.[Symbol.iterator]` in `src/internal/Handler.ts`:

- `isEffect(ir.value)`
- `effectId === effect._fxEffectId`
- `HandlerCapture.is(effect)`
- `yield effect`
- `i.next(...)`

Each non-matching handler repeats that sequence for every yielded effect.

## Semantic constraints for optimization

Any optimization has to preserve:

- Inner handlers get the first chance to handle effects from the original program.
- Effects yielded by a handler implementation are handled only by handlers outside that handler, not by the same handler or handlers inside it.
- `HandlerCapture` preserves captured handler order and does not capture handler boundaries.
- Iterator `return()` cleanup still drains through the same interpretation path.
- `Control` remains separate unless a later investigation proves it can share machinery safely.

## Highest-value optimization direction

The most promising direction is a flattened handler frame for adjacent ordinary `Handler` wrappers:

- Store adjacent handlers in one object rather than nesting one generator wrapper per handler.
- On each yielded effect, scan handler metadata in semantic order and dispatch to the first matching handler.
- When a handler matches, run its handler-produced `Fx` under only the outer portion of the handler stack, preserving current scoping semantics.
- On `HandlerCapture`, return captured handler entries in the same order as today.

This targets the repeated generator frame bounce directly. A smaller micro-optimization, such as replacing `HandlerCapture.is(effect)` with a cached `_fxEffectId` comparison, may help but is unlikely to address the depth scaling.

## Suggested next step

Prototype an internal `HandlerStack` or equivalent inside `src/internal/Handler.ts`, initially only for adjacent ordinary `Handler` instances. Keep `Control` unchanged. Add focused tests for:

- Matching order with multiple handlers for different effect types.
- Handler-produced effects being handled only by outer handlers.
- Handler capture order through flattened handlers.
- Cleanup behavior when a flattened stack is closed early.
