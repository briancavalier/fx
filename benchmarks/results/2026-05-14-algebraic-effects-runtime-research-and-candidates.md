# Algebraic Effects Runtime Research and Optimization Candidates

- Date: 2026-05-14
- Worktree: `/private/tmp/fx-effect-runtime-experiments`
- Base: merged PR #170, `406f203`
- Purpose: guide a new benchmark-driven round of `fx` runtime experiments.

## Context

`fx` is a generator-based TypeScript algebraic effects runtime. Programs are `Fx<E, A>` generator computations; effects are ordinary yielded values; handlers progressively eliminate effects with `handle` and `control`.

The implementation should stay small and explicit. Most state-of-the-art effect-handler implementation techniques come from compilers or native runtimes, so the goal is not to copy their machinery. The useful transfer is narrower: identify which costs matter, then adapt the data-structure or fast-path idea only when it fits the existing generator runtime.

PR #170 added the missing benchmark layer for this work:

- `pnpm benchmark:runtime-loops`
- handler matched throughput and pass-through depth
- direct internal `Handler` execution
- `Control` resume, short-circuit, and pass-through
- handler capture, replay, and `mapCapturedHandlers`
- `ScopeBoundary` pass-through, finalizer registration, and capture
- `HandlerCaptureBoundary` pass-through and close
- `runFork`, sequential async, fork fanout, `all`, `race`
- interruption and disposal paths

Use those results as the first guardrail. Any candidate that improves a deep path but regresses matched/depth-0 hot paths should be rejected unless the regression is intentionally accepted for a specific workload.

## External Research Summary

### One-shot continuations

OCaml 5 and several efficient effect-handler runtimes focus on one-shot continuations. One-shot continuations avoid the cost and semantic complexity of reusable continuation copies.

Applicability to `fx`: good conceptual fit. `Control` already enforces single resume. Ordinary `handle` is effectively a tail-resume operation. This suggests specializing single-shot/tail-resume paths is more plausible than adding a multi-shot continuation abstraction.

Sources:

- https://arxiv.org/abs/2104.00250
- https://ocaml.org/news/multicore-2021-09

### Evidence and capability passing

Koka's generalized evidence passing and Effekt's capability/region designs avoid repeated dynamic handler lookup by carrying handler evidence through compiled code.

Applicability to `fx`: limited directly because `fx` is a TypeScript library, not a compiler. However, the idea maps to runtime data structures: avoid repeated generator-frame bubbling when the active handler set is already known.

Sources:

- https://www.microsoft.com/en-us/research/publication/generalized-evidence-passing-for-effect-handlers/
- https://effekt-lang.org/publications

### Tail-resumption optimization

Leijen's C implementation shows that optimized tail resumptions can deliver large wins for common handler paths.

Applicability to `fx`: strong as a principle. The normal `handle` path handles an effect and immediately resumes the underlying iterator. Candidate optimizations should protect this path first.

Source:

- https://www.microsoft.com/en-us/research/publication/implementing-algebraic-effects-in-c/

### Coroutine-backed native runtimes

`libseff` and related work use native coroutine machinery and reified effects to avoid closure-heavy handler chains.

Applicability to `fx`: low architecturally, but useful as motivation to reduce per-effect closure/object churn and repeated wrapper dispatch.

Source:

- https://research.birmingham.ac.uk/en/publications/effect-handlers-for-c-via-coroutines/

### JavaScript engine sensitivity

V8 async/generator performance depends heavily on allocation patterns, promise/microtask counts, object shapes, and optimization stability. PR #170's flattened/coalesced handler prototypes showed this clearly: module/import/class shape changes can move a hot generator path into a much slower regime.

Applicability to `fx`: very high. Prefer small local reductions first. Structural changes require built-JS benchmarks and V8 optimization/deoptimization checks, not only `tsx` benchmark runs.

Sources:

- https://v8.dev/blog/fast-async
- https://v8.dev/blog/maglev

## PR #170 Benchmark Implications

The new runtime-loop baseline identified these major costs:

| Area | Signal |
| --- | --- |
| Handler pass-through depth | roughly linear growth through non-matching handler frames |
| Fork fanout | 16 pure forks around 50x pure `runPromise`; bounded vs unbounded nearly identical |
| Sequential async | 10 async steps around 14x pure `runPromise` |
| Handler capture | capture depth grows sharply; replay depth mostly flat |
| Scope pass-through | depth remains expensive after PR #170 |

Important accepted/rejected findings:

- Keep: lazy captured-wrapper allocation and direct `HandlerCapture` id check in `Handler`.
- Keep: direct id check in `HandlerCaptureBoundary`.
- Keep: inline runtime-context presence check in `attachRuntimeContext`.
- Reject: flattened/coalesced handler prototypes as integrated; they reduced depth scaling but caused massive matched/depth-0 regressions.
- Reject: lazy `Control` resume closure; pass-through improved but `control resume` regressed.
- Reject for now: analogous scope capture/direct-check change; results were noisy and included regressions.
- Reject: direct interrupt-mask checks in `run`; existing checks appear well optimized.

## Candidate Experiments

### 1. Scope no-finalizer release fast path

Hypothesis: `ScopeBoundary.release` can return `[]` directly when no finalizers were registered. This should help scoped programs that use scope boundaries but do not register cleanup.

Current shape:

- `release` always delegates through `withActiveScope(scopeName, releaseSafely(finalizers, exit))`.
- `releaseSafely` then loops over an empty array and returns `[]`.

Candidate:

- In `ScopeBoundary.release`, add `if (finalizers.length === 0) return []` before constructing/running cleanup `Fx`.

Why promising:

- Narrow local fast path.
- Does not alter handler/capture/module shape.
- Preserves cleanup semantics because there are no finalizers to run.

Benchmark gap:

- Add a specific scope-without-finalizers case.
- Existing scope pass-through benchmarks may catch some signal but are not isolated enough.

Guardrails:

- `scope pass-through depth 0`
- `scope pass-through depth 16`
- `scope finalizer registration depth 16`
- full finalization tests

### 2. Scope pass-through miss-path reduction, isolated from capture

Hypothesis: scope pass-through remains expensive because every scope wrapper repeats effect checks and yields outward. A smaller miss-path-only reduction may help if it avoids touching capture/finalizer paths.

Why this is distinct from the rejected scope candidate:

- The rejected candidate mixed lazy capture allocation and direct capture id checks.
- The next candidate should target pass-through only and leave capture allocation behavior unchanged unless separately measured.

Possible directions:

- Reorder checks to put likely pass-through effects on a cheaper path without changing semantics.
- Cache scope-specific ids/constants locally in the iterator.
- Avoid creating exit objects unless a matching scope effect or `Fail` is actually observed.

Guardrails:

- `scope pass-through depth 0/16`
- `scope finalizer registration depth 0/16`
- `scope capture depth 0/16`
- `Finalization.test.ts`, `Abort.test.ts`, `ReturnFrom.test.ts`, `Interrupt.test.ts`

### 3. HandlerCapture context cons-list or builder

Hypothesis: handler capture currently pays array spreading at each captured layer. A private cons-list or builder could make capture construction cheaper, then materialize the array once at the boundary.

Current shape:

- `Handler`: `ir = i.next([captured, ...(yield effect) as any])`
- `ScopeBoundary`: same pattern.

Candidate:

- Internally represent captured context as a compact linked structure or mutable builder while bubbling.
- Convert to `readonly CapturedHandler[]` only when returning to user-level APIs.

Risks:

- Public `HandlerCapture` answer type is currently an array.
- Handler capture order is semantically important.
- Effects may observe or pass captured contexts across boundaries.

Suggested approach:

- Prototype behind a private internal representation only if type/API boundaries remain unchanged.
- Add focused tests for capture order and replay behavior before benchmarking.

Guardrails:

- `capture depth 0/16`
- `replay depth 0/16`
- `mapCapturedHandlers fanout 64`
- `HandlerCapture.test.ts`

### 4. Lazy unhandled-fork monitor in `runFork`

Hypothesis: every `runForkInternal` creates an unhandled-fork promise and every `Async` awaits `Promise.race([promise, unhandled])`, even when no child fork is active. Avoiding that race until a fork exists may reduce per-`Async` overhead.

Current costs on sequential async path:

- `Task`
- `AbortController`
- disposable add/remove
- `Promise.race`
- runtime-context resume
- failure trace preparation on rejection

Candidate:

- Keep the unhandled-fork channel lazy.
- For programs with no active child fork, await the async task promise directly.
- Create/use the race only after a `Fork` effect has been interpreted.

Risks:

- Parent async waits must still be interrupted by unhandled child failures once children exist.
- Race/fork failure diagnostics must remain prompt.
- Interruption while awaiting async must still close the iterator correctly.

Benchmark gap:

- Existing `sequential async x10` is useful.
- Add a sequential async case after a fork has been started, so the lazy/no-lazy split is visible.
- Add rejected async failure and unhandled fork failure cases.

Guardrails:

- `sequential async x10`
- `fork fanout 16`
- `all fanout 16`
- `race fanout 16`
- `Async.test.ts`, `Concurrent.test.ts`, `Interrupt.test.ts`, `Fail.test.ts`

### 5. Fast path pure/immediate handler result

Hypothesis: many handlers return `ok(value)`. If the handled `Fx` is a known immediate result, `Handler` may avoid `yield* withRuntimeContext(context, handled)` and resume the iterator directly.

Why promising:

- Matched handler throughput is a core hot path.
- PR #170 shows matched/depth-0 paths must be protected, so any improvement here is valuable.

Risks:

- `Ok` is internal and not currently part of a public fast-path contract.
- Runtime context attachment around handler-produced effects/errors must stay correct.
- Handler-thrown exceptions must preserve existing behavior.

Suggested approach:

- Consider a narrow internal marker or helper for immediate `Ok` only.
- Do not broaden into a generic interpreter shortcut without benchmark evidence.

Guardrails:

- `matched handler throughput`
- `prebuilt matched handler throughput`
- `direct internal matched handler throughput`
- handled fail benchmarks in `benchmark:trace`
- runtime-context benchmarks with regional context

### 6. Runtime-context attachment alternatives

Hypothesis: regional runtime context is still expensive because every iterator step wraps execution and may attach metadata via a symbol property. `WeakMap` metadata or more precise no-op fast paths may improve regional context without changing semantics.

Current PR #170 state:

- Inline context presence check was kept.
- Existing `benchmark:runtime-context` still remains the right primary suite.

Candidates:

- Benchmark `WeakMap<object, RuntimeContext>` versus `Object.defineProperty`.
- Avoid constructing `RuntimeContextFx` when the new context is semantically empty or equal to the current one.
- Avoid merging context objects when there is no overlap or when previous is undefined.

Risks:

- Metadata must survive yielded effect/error boundary behavior.
- `getRuntimeContext` is used in handler and runFork paths.
- Object identity and garbage collection behavior may change.

Guardrails:

- `pnpm benchmark:runtime-context`
- `pnpm benchmark:trace`
- trace tests and runtime-context-sensitive async/failure tests

### 7. Built-JS benchmark path for structural prototypes

Hypothesis: `tsx` benchmarks are useful, but structural changes need built-JS validation because PR #170 showed V8/module-shape cliffs.

Candidate:

- Add a documented command or script for:
  - `pnpm build`
  - `node dist-or-built benchmark equivalent`

This is not a runtime optimization, but it is a measurement prerequisite for anything that changes handler/module/class shape.

Use for:

- any future flattened handler frame
- adjacent coalescing
- new handler-stack class
- public `Handler.ts` import graph changes

Guardrail:

- Reject structural candidates unless both `tsx` and built JS preserve matched/depth-0 paths.

## Candidates To Avoid For Now

### Broad flattened handler stack

PR #170 showed this is directionally valid for depth scaling but too risky in current integration form. Do not retry without first designing around the matched/depth-0 V8 cliff and adding built-JS optimization diagnostics.

### Lazy `Control` resume closure

Already measured and rejected. The matching resume path regressed.

### Direct interrupt-mask checks in `run`

Already measured and rejected. Existing checks appear well optimized.

### Framework-level runtime services

Avoid broad handler registries, ambient capability systems, schedulers, or service-container-like infrastructure. They do not fit the library's design goals and are not justified by current benchmark evidence.

## Suggested Experiment Order

1. Add missing benchmark cases:
   - scope without finalizers
   - sequential async after a fork exists
   - runFork failure paths if touching async/fork monitoring
   - built-JS runtime-loop command for structural candidates

2. Try the scope no-finalizer release fast path.

3. Try `runFork` lazy unhandled-fork monitoring.

4. Try a narrow `Ok` immediate handler fast path.

5. Try handler capture context builder only after adding order/replay tests.

6. Explore runtime-context metadata alternatives with `benchmark:runtime-context`.

7. Reconsider structural handler stack work only after the smaller candidates and built-JS benchmark path are in place.

## Validation Checklist

For every runtime candidate:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- relevant benchmark:
  - `pnpm benchmark:runtime-loops`
  - `pnpm benchmark:runtime-context`
  - `pnpm benchmark:trace`
- save benchmark result markdown under `benchmarks/results/YYYY-MM-DD-*.md`
- record rejected prototypes, not only accepted ones

Acceptance rule of thumb:

- protect matched/depth-0 handler paths
- reject changes with fixed-cost cliffs
- prefer small local reductions over structural machinery
- require focused tests for iterator `return`, cleanup, interruption, handler capture order, runtime context, and async failure propagation when those paths are touched
