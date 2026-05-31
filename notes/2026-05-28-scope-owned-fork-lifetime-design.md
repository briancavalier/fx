# Scope-Owned Fork Lifetime Prototype

Status: experimental design note for branch `codex/scope-owned-fork-lifetime`.

## Goal

Separate fork scheduling from fork lifetime:

- Lifetime is owned by a named `Scope`.
- Scheduling is owned by the nearest fork scheduling handler.
- Forked computations can be interrupted, waited, and finalized through the scope that owns them.
- Scheduling policy remains independently configurable through handlers such as `withUnboundedConcurrency` and `withBoundedConcurrency`.

The motivating use cases are:

1. Fork many computations in the same named scope, then use `interruptFrom(scope, reason)` to interrupt that scope and all owned computations.
2. Implement a simple race by forking two computations in one scope; each computation either completes work and uses `returnFrom(scope, result)` or uses `interruptFrom(scope, reason)`, causing the other computation to finalize.

## Current Tension In fx

Today, `fork` returns a `Task`. The caller owns the returned task's lifetime. Fork scheduling is partly mediated by the concurrency handlers, but task lifetime is not fully structured by `Scope`.

The two motivating use cases require more than wrapping a forked computation in another copy of `withScope(scope)`. If each forked child gets an independent `ScopeBoundary`, then `returnFrom(scope, value)` or `interruptFrom(scope, reason)` inside a child only exits that child-local boundary. It cannot signal the parent scope boundary or finalize sibling children.

That means a viable design needs a shared scope controller/state for each live named scope. The controller must be visible to all computations whose lifetime belongs to that named scope, including forked children.

## Related Systems And Research

### Algebraic Effects And Structured Asynchrony

Daan Leijen's "Structured Asynchrony with Algebraic Effects" demonstrates async/await-style programming with algebraic effects and highlights cancellation and timeout as reusable asynchronous abstractions. The paper is a direct precedent for treating async control as effect interpretation rather than hard-wiring it into the base runtime.

Source: [Structured Asynchrony with Algebraic Effects](https://www.microsoft.com/en-us/research/wp-content/uploads/2017/05/asynceffects-msr-tr-2017-21.pdf)

### Scoped Effects Research

Recent scoped-effects work is directly relevant because scope-forming operations are not ordinary first-order algebraic operations. They delimit a region and split the continuation into "inside the scope" and "outside the scope" parts. That matches the hard part here: a forked child needs to act on the shared scope boundary, not just perform a local operation.

Sources:

- [A Calculus for Scoped Effects & Handlers](https://lmcs.episciences.org/14832)
- [Structured Handling of Scoped Effects](https://arxiv.org/abs/2201.10287)

### Trio

Trio separates lifetime into nurseries and cancellation scopes. Starting a task requires a nursery, the nursery waits for child tasks before exit, and failure in a task cancels siblings. Cancellation scopes must remain outside the nursery to cancel child tasks because the child cancellation exceptions surface through the nursery boundary.

Source: [Trio core reference](https://trio.readthedocs.io/en/stable/reference-core.html)

Design lesson for fx: scope-owned fork lifetime needs a live boundary that can observe child exits. A child-local handler copy is not enough.

### Kotlin Coroutines

Kotlin distinguishes coroutine lifecycle from dispatching policy. `CoroutineScope` owns coroutine structure and cancellation, while dispatchers decide where coroutines execute. The docs explicitly describe `CoroutineScope` as lifecycle management and dispatchers as execution/thread selection.

Sources:

- [Kotlin coroutines basics](https://kotlinlang.org/docs/coroutines-basics.html)
- [Coroutine context and dispatchers](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html)

Design lesson for fx: scheduling handlers should behave more like dispatchers/semaphores, while named scopes own lifetime.

### OCaml Eio

Eio uses `Switch` values to group fibers and resources. `Switch.run` waits for attached fibers, releases resources, and can cancel fibers by failing the switch. `Fiber.fork` takes a switch argument, making lifetime ownership explicit at the call site.

Source: [Eio README](https://github.com/ocaml-multicore/eio)

Design lesson for fx: an explicit `forkIn(scope, work)` fits well with capability-style structured concurrency.

### ZIO

ZIO distinguishes several lifetime strategies: parent-supervised `fork`, global `forkDaemon`, local-scope `forkScoped`, and specific-scope `forkIn`. It also treats `Scope` as a resource lifetime boundary that can own fibers beyond their immediate parent.

Source: [ZIO Fiber](https://zio.dev/reference/fiber/fiber.md/)

Design lesson for fx: explicit scope-owned fork APIs are a proven shape, and `forkIn` is especially close to the desired prototype.

### Cats Effect

Cats Effect has `start` for caller-owned fibers and `Supervisor` for fibers whose lifetimes are bound to a supervisor resource. The supervisor has an explicit finalization policy: wait for active fibers or cancel them.

Sources:

- [Cats Effect Spawn](https://typelevel.org/cats-effect/docs/typeclasses/spawn)
- [Cats Effect Supervisor](https://typelevel.org/cats-effect/docs/std/supervisor)

Design lesson for fx: separating raw fiber creation from a lifetime owner is a practical, established design.

## Required Invariants

- Strong effect typing must remain meaningful. Scope handling should narrow `ReturnFrom`, `Abort`, and `InterruptFrom` effects in the same spirit as today.
- `Fail` remains the recoverable error channel. Normal cancellation, interruption, and cleanup failure should not become JS throws.
- Cleanup failures are aggregated with primary failures in primary-first order.
- Child finalizers must observe the correct interruption reason. Internally, this implies using `Task.interrupt(reason)` or equivalent reason-preserving interruption.
- Handler capture must remain explicit at fork/runtime boundaries. Forked children should run under the captured handler/runtime context expected by current concurrency semantics.
- Interrupt masks must still be honored.
- Existing caller-owned fork behavior should not be broken until a migration path is chosen.

## Design Alternative A: Shared Scope Controller Plus Scheduling Effect

Add an internal shared controller for each live named scope. `withScope(scope)` creates the controller and installs it for the dynamic extent of the scope boundary. Fork lifetime registration goes through the controller; actual task start goes through the nearest scheduling handler.

Sketch:

```ts
const task = yield* forkIn(scope, work)
```

Potential internal flow:

1. `forkIn(scope, work)` asks the named scope controller to own `work`.
2. The scope controller emits an internal scheduling request for the nearest fork scheduling handler.
3. The scheduling handler applies its policy, starts the child with captured handlers/runtime context, and returns a `Task`.
4. The scope controller records the task until it settles.
5. On `interruptFrom(scope, reason)`, `returnFrom(scope, value)`, failure, or external interruption, the controller transitions once, interrupts owned children, waits for finalization, releases scope finalizers, and propagates the proper exit.

This is the recommended prototype direction.

Pros:

- Satisfies both motivating use cases.
- Makes lifetime ownership a property of `Scope`, not a side effect of concurrency handlers.
- Keeps scheduling policy local to scheduler handlers.
- Matches Eio `Switch`, ZIO `forkIn`, and Kotlin scope/dispatcher separation.
- Gives a clear future path for detached/caller-owned forks.

Cons:

- Requires a real `Scope` internals refactor from local finalizer array to shared controller/state.
- Requires careful result typing for `returnFrom(scope, value)` from forked children.
- Requires precise settlement and cleanup ordering rules.
- Requires a disciplined internal carrier for live scope controllers; a broad runtime metadata bag would make the design harder to reason about.

## Design Alternative B: Scope Handles Fork Registration Directly

Keep one public operation, for example `forkIn(scope, work)`, and let `withScope(scope)` handle it directly by calling the existing `Fork` effect under the hood.

Pros:

- Smaller initial patch.
- Reuses existing `Fork` scheduling behavior.
- Keeps the new public surface narrow.

Cons:

- Still needs shared controller state for child-originated `returnFrom` and `interruptFrom`.
- Risks tangling scope lifetime logic with existing `Fork` semantics.
- May become a hidden half-step where scheduling and lifetime are still coupled through `Fork`.

This is useful only if implemented as a stepping stone toward Alternative A, not as the final architecture.

## Design Alternative C: Concurrency Handler Owns Lifetime With Scope Labels

Keep the current concurrency handler as the owner of fork lifetime, but tag forks with a scope name. `interruptFrom(scope)` would ask the handler to interrupt matching tasks.

Pros:

- Closest to the previous attached-fork experiment.
- Smaller changes to `Scope.ts`.
- Scheduling and lifetime interactions are already near `withBoundedConcurrency` and `withUnboundedConcurrency`.

Cons:

- Violates the core goal: lifetime remains owned by the concurrency handler.
- `withScope(scope)` would not be the actual owner of scoped resources and forked children.
- Composition order becomes surprising: a scope without the right concurrency handler cannot own the work that claims to belong to it.
- Does not cleanly model `returnFrom(scope, value)` from a forked child as a shared scope exit.

This is not recommended for the prototype.

## Design Alternative D: Only Add Structured Combinators

Avoid a general scope-owned fork. Add operation-specific helpers such as `raceIn(scope, left, right)` or `allIn(scope, fs)` that own their children directly.

Pros:

- Easier to prove locally.
- Good user-facing ergonomics for common operations.
- Avoids exposing a general lifetime API too early.

Cons:

- Does not satisfy the general "fork many computations in the same scope" use case.
- Leaves the primitive operation unresolved.
- Encourages duplicated lifetime implementations across combinators.

This can be layered later, after the primitive scope-owned fork semantics are sound.

## Design Alternative E: Runtime-Central Scope And Task Registry

Move both live scope controllers and child task registration into the runtime runner. Handlers become policy modules that consult runtime-managed state.

Pros:

- Coherent global model.
- Can enforce cross-cutting invariants centrally.
- May simplify future diagnostics.

Cons:

- Broad runtime rewrite.
- Risks hiding cross-cutting behavior in base abstractions.
- Too heavy for the current fx design style.

This is not recommended now.

## Recommended Prototype

Implement Alternative A as a prototype with explicit APIs and narrow support:

```ts
const ParentScope = Scope<"Parent", Result, InterruptReason>()

const program = fx(function* () {
  yield* forkIn(ParentScope, child1)
  yield* forkIn(ParentScope, child2)

  // Parent can still do work. Scope owns the children.
}).pipe(
  withScope(ParentScope),
  withBoundedConcurrency(4)
)
```

Prototype public API:

- `forkIn(scope, work)` starts `work` under the nearest fork scheduling handler and registers its lifetime with `scope`.
- Keep existing `fork(work)` caller-owned during the prototype.
- Keep existing `forkEach` unchanged during the prototype unless a scoped variant is explicitly added later.

Prototype implementation scope:

- Support `withUnboundedConcurrency` and `withBoundedConcurrency`.
- Leave `withCoopConcurrency` as a follow-up.
- Do not change `dist/`.
- Do not add stable docs; use notes and examples only.

## Semantics

Normal scope completion:

- The scope waits for owned children to finish.
- If any owned child fails, the scope fails and interrupts remaining owned children.
- Cleanup failures are aggregated after the primary failure.

`interruptFrom(scope, reason)`:

- The scope controller transitions to interrupted exactly once.
- Owned children receive `reason`.
- Owned children finalize.
- Scope finalizers run with the interrupted exit.
- The interrupted exit propagates from the scope boundary.

`returnFrom(scope, value)`:

- The scope controller transitions to returned exactly once.
- Owned children other than the returning child are interrupted/finalized.
- Scope finalizers run.
- The scope boundary returns `value`.

Child failure:

- A failing owned child fails the owning scope.
- Siblings are interrupted and finalized.
- The scope boundary re-yields or reports the failure according to existing `Fail` semantics.

Detached/caller-owned fork:

- Scheduled by the nearest scheduler.
- Not registered with any named scope.
- Not interrupted by `interruptFrom(scope)` except through normal parent task interruption if applicable.

## Simple Race Sketch

The race use case should become a direct pattern rather than a special case:

```ts
const Race = Scope<"Race", A, RaceInterrupted>()

const race = <E1, A, E2, B>(
  left: Fx<E1, A>,
  right: Fx<E2, B>
) =>
  fx(function* () {
    yield* forkIn(Race, fx(function* () {
      const a = yield* left
      return yield* returnFrom(Race, a)
    }))

    yield* forkIn(Race, fx(function* () {
      const b = yield* right
      return yield* returnFrom(Race, b)
    }))

    return yield* never
  }).pipe(withScope(Race))
```

The important property is not the exact helper shape. The important property is that `returnFrom(Race, value)` from either child resolves the shared `Race` scope boundary and finalizes the loser.

## Type Questions

The hardest type question is whether `forkIn(scope, work)` hides the child's `ReturnFrom<typeof scope, R>` effect or exposes it in the parent effect row.

If `returnFrom(scope, value)` from a child can determine the parent scope result, then the parent `withScope(scope)` boundary must know that result type. Options:

1. Require the scope result type to be declared by the `Scope` value, and allow forked children to use that result type.
2. Make `forkIn(scope, work)` expose the scope's `ReturnFrom` effect in the parent row, even though the operation happens in a child.
3. Start with `interruptFrom` support only and defer child-originated `returnFrom` until the type story is clearer.

Option 1 seems most coherent for named scopes because the scope value already carries the named boundary identity.

## Open Questions

- Should the eventual default `fork(work)` become scope-owned by the nearest active scope, or should scope ownership remain explicit through `forkIn(scope, work)`?
- Should there be `forkScoped(work)` for nearest active scope if named scope inference becomes ergonomic?
- What is the exact finalizer ordering between parent scope finalizers and child task finalizers?
- Should normal scope completion wait forever for owned children, or should scope exit always interrupt still-running children? Trio and Eio wait; some supervisors make this configurable.
- Should cleanup failure aggregation reuse current `Resource release failed` structure exactly or introduce a scope-specific diagnostic?
- How should controller lookup be represented internally without turning `runtimeContext` into a broad metadata bag?
- Should a scope controller own scheduled-but-not-started children for bounded concurrency, so interruption can prevent queued work from starting?

## Test Plan For Prototype

- `forkIn` children in one scope are interrupted by parent `interruptFrom(scope, reason)`.
- Child finalizers observe the same interruption reason.
- A child can `returnFrom(scope, value)` and cause the parent scope boundary to return that value.
- A child `returnFrom(scope, value)` finalizes losing siblings.
- A child `interruptFrom(scope, reason)` finalizes siblings and propagates the interrupted exit.
- A child failure fails the owning scope and interrupts siblings.
- Cleanup failure aggregates after a primary failure in primary-first order.
- Existing `fork` remains caller-owned.
- Existing `forkEach` remains caller-owned.
- `withBoundedConcurrency(1)` does not start queued scoped children after the owning scope has been interrupted or returned.
- Missing fork scheduling handler leaves the scheduling effect visible or fails with the existing unhandled-effect path.
- Handler capture behavior remains consistent with existing `fork`.
- Type-level tests cover `forkIn` result and failure inference, including child-originated `returnFrom`.

## Suggested Prototype Sequence

1. Add failing tests for the two motivating use cases.
2. Introduce internal shared scope controller state behind `withScope(scope)`.
3. Add an internal scheduling request separate from scope ownership.
4. Add public experimental `forkIn(scope, work)`.
5. Teach `withUnboundedConcurrency` and `withBoundedConcurrency` to schedule the internal request.
6. Rework `interruptFrom` and `returnFrom` inside `withScope` so child-originated scope exits transition the shared controller.
7. Add a temporary example under `examples/experimental/` showing scope-owned fork interruption and race.
8. Run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`, and `corepack pnpm lint`.

## Recommendation

Proceed with `forkIn(scope, work)` plus a shared named-scope controller. Treat the scheduler as policy-only and leave existing caller-owned `fork` unchanged during the experiment.

This keeps the first prototype explicit, makes the intended ownership visible at the call site, and gives us room to revisit whether `fork` should later mean nearest-scope-owned, parent-supervised, or caller-owned.
