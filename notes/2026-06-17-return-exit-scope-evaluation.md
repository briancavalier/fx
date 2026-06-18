# Rebuilding Scope with returnExit/resumeExit

Status: evaluation after PR 234 (`transactionalState`) introduced the internal
`returnExit` and `resumeExit` region handlers.

## Short Answer

`returnExit`/`resumeExit` are useful for scope-adjacent region code, but they are
not a direct replacement for `ScopeBoundary`.

They may be worth using to factor out part of scope's "run body, observe exit,
drain lexical cleanup, then re-emit non-success exits" loop. A full rebuild of
Scope on top of them would still need almost all of Scope's ownership machinery:
nearest/current-scope dispatch, finalizer storage, scoped fork ownership,
handler-capture composition, runtime scope-exit propagation, task joining, and
cleanup failure aggregation.

The likely good slice is therefore not "Scope becomes returnExit plus handlers".
It is "extract a shared internal exit-region primitive only if it can preserve
Scope's matching and ownership rules without making `returnExit` scope-aware".

## What PR 234 Adds

PR 234 uses `returnExit` inside `transactionalState(scope)` so state-specific
transactional code can observe how a protected body exits:

- success commits local state;
- `returnFrom` also commits;
- `Fail`, `Abort`, and `InterruptFrom` roll back;
- non-success exits are resumed with the original effect object.

That is a good fit because `transactionalState` is intentionally not a scope
boundary. It needs outcome visibility without becoming the nearest lifetime
scope, and without taking over finalizers or scope-owned work.

## What Scope Owns Today

`withScope(scope)` currently does more than observe body outcome:

- It interprets `Finally` for the named scope and for `currentScope`.
- It interprets `ScopedFork` for the named scope and for `currentScope`.
- It handles `ReturnFrom`, `Abort`, and `InterruptFrom` only when the effect is
  owned by this boundary, while preserving outer-scope exits.
- It maps `currentScope` to the nearest live scope dynamically.
- It contributes captured handlers for ordinary handler capture and targeted
  scoped handler capture.
- It exposes a runtime scope-exit source so parked async work and scoped forked
  work can be interrupted when the scope exits.
- It joins scope-owned tasks and combines task failures with finalizer failures.
- It runs finalizers after success, failure, return, abort, and interruption.
- It preserves primary failure ordering before cleanup failures.
- It aggregates cleanup failures as `Fail<AggregateError>`.
- It has separate root vs shared-boundary behavior so captured scoped work uses
  the same controller without each wrapper trying to release the scope.

Those responsibilities are not incidental implementation details. They define
Scope's public semantics.

## Where returnExit Helps

The part that overlaps is the iterator-level exit-region logic:

- classify success vs non-success exit;
- close the protected iterator when a non-success exit stops the body;
- continue draining cleanup after cleanup failures;
- preserve original exit effects when resuming;
- avoid converting the region into a nearest scope boundary.

Those are exactly the concerns that made `transactionalState` need an internal
primitive. Scope has a similar local problem in parts of `ScopeBoundary.step` and
in the interrupted-close cleanup paths.

If Scope keeps accumulating exit variants, `returnExit` is a useful proof that
this lower-level iterator handling can be centralized.

## Where returnExit Is Not Enough

### Scope matching is not generic exit observation

`returnExit` captures every `Fail`, `ReturnFrom`, `Abort`, and `InterruptFrom`
it sees. Scope cannot do that blindly for scoped exits. It has to ask:

- does this effect target my named scope?
- does this effect target `currentScope`, and am I the nearest live boundary?
- should this exit be owned here, shared with this controller, or propagated to
  an outer scope?

`resumeExit` can re-emit an effect, but the hard part is deciding whether the
effect should have been captured in the first place.

### Scope is a boundary, not just a region

`transactionalState` intentionally does not become the nearest scope. `withScope`
must become the nearest scope. That difference affects `currentScope`,
`andFinally`, `forkIn(currentScope, ...)`, targeted scoped handler capture, and
diagnostics.

Using `returnExit` as the outer shape of Scope would need an additional
Scope-owned handler layer around the body anyway. At that point, the composition
can become less direct than the current `ScopeBoundary` loop.

### Runtime scope exits are outside resumeExit

Scope exit is also transported through runtime context for parked async work.
When an async operation races against a `RuntimeScopeExit`, `ScopeBoundary`
must decide whether the exit belongs to this scope, release this scope, or
propagate an outer runtime exit.

That behavior is controller-owned and runtime-context-owned. It is not expressible
as "resume this captured effect".

### Shared controller wrappers matter

Captured scoped work uses shared `ScopeBoundary` wrappers so it contributes to
the same controller without becoming a second root release point. A direct
`returnExit` rewrite would still need that root/shared split.

Losing that distinction risks the class of bugs where nested or captured work
consumes the wrong scope exit or releases the same scope twice.

### Finalizer context remains explicit

Prior finalizer work settled that finalizer handler context should be captured at
registration time where needed, and cleanup `Fail` aggregation belongs at the
scope boundary. A broad `returnExit`-based rewrite should not smuggle new
implicit context capture into Scope's base abstraction.

## Plausible Refactor Shape

A reasonable prototype would keep `ScopeController` and the scope matching loop,
but extract the body-exit/cleanup-drain part behind a lower-level configurable
region primitive.

The important distinction is that `returnExit` should not become scope-aware.
Instead, its current implementation can be split into:

- a generic internal `exitRegion(...)` implementation that owns iterator
  stepping, interrupted close, cleanup draining, and "resume the captured exit";
- the existing `returnExit` API as one thin use of `exitRegion(...)`, with a
  classifier that captures every `Fail`, `ReturnFrom`, `Abort`, and
  `InterruptFrom`;
- a Scope-specific use with a classifier that captures only exits owned by this
  scope boundary.

In rough terms:

```ts
const exit = yield* exitRegion(body, {
  classify(effect) {
    if (matchesScope(effect, scope) && ReturnFrom.is(effect)) {
      return { type: 'returnFrom', scope, value: effect.arg, effect }
    }

    if (matchesScope(effect, scope) && Abort.is(effect)) {
      return { type: 'abort', scope, effect }
    }

    if (matchesLifetimeScope(effect, scope) && InterruptFrom.is(effect)) {
      return {
        type: 'interrupted',
        scope,
        reason: effect.arg,
        effect: matchesScope(effect, scope)
          ? effect
          : new InterruptFrom(scope, effect.arg)
      }
    }

    if (root && Fail.is(effect)) {
      return { type: 'failure', failure: effect, effect }
    }

    return undefined
  },
  resume(exit) {
    return resumeScopeExit(exit)
  }
})
```

That classifier is the key. It lets an inner `withScope(InnerScope)` pass
`returnFrom(OuterScope, ...)` outward instead of treating it as the inner
region's exit. It also lets `currentScope` interruption become an exit of the
actual nearest scope.

Scope would still need to handle Scope-specific non-exit effects before the
generic exit classifier sees them:

```ts
const exit = yield* body.pipe(
  scopeBoundaryEffects(controller, scope),
  scopeExitRegion(controller, scope, root)
)

return yield* finishScopeExit(controller, scope, exit)
```

That shape is only viable if `scopeBoundaryEffects(...)` still handles matching
`Finally`, `ScopedFork`, targeted handler capture, and matching scoped exits
before `returnExit` sees exits that belong to outer scopes.

In practice, the order probably wants to be closer to:

```ts
const exit = yield* scopeOwnedRegion(body, controller, scope)
return yield* finishScopeExit(controller, scope, exit)
```

where `scopeOwnedRegion` can reuse lower-level helpers from `returnExit`, but is
not merely `returnExit` itself.

## What Stays Scope-Specific

Even with a shared `exitRegion(...)`, Scope still owns:

- matching `Finally` and storing finalizers on `ScopeController`;
- matching `ScopedFork`, starting tasks through the controller, and marking them
  handled;
- root vs shared controller behavior for captured scoped work;
- ordinary `HandlerCapture` and targeted `ScopedHandlerCapture` contribution;
- runtime scope-exit sources for parked async work;
- `RuntimeScopeExit` ownership and propagation;
- joining tasks before finalizer release;
- finalizer release ordering;
- primary failure plus cleanup failure aggregation;
- active-scope diagnostics.

This is still a worthwhile separation if it makes the iterator-close behavior
common without pulling any of those policies into the generic region primitive.

## Risks To Test In A Prototype

A prototype should start with behavior tests before broad rewrites:

- `returnFrom(OuterScope)` through an inner `withScope(InnerScope)` is owned by
  the outer scope, not captured by the inner region.
- `currentScope` finalizers and `forkIn(currentScope, ...)` bind to the nearest
  live scope.
- `forkIn(OuterScope, ...)` inside an inner scope is owned by the named outer
  scope, not by the inner current scope.
- Parked async work wakes and interrupts when its owning scope exits.
- Captured scoped work uses the owning scope's shared controller.
- Failure remains primary before cleanup failures.
- Cleanup continues draining after a cleanup failure.
- Cleanup failures from interrupted iterator return remain aggregated.
- A runtime scope exit for an outer scope is propagated, while the current scope
  is released as interrupted.

## Recommendation

Do not rebuild Scope wholesale on `returnExit` right now.

Keep `returnExit` as an internal region primitive for non-scope-boundary code
like `transactionalState`. For Scope, prototype only a narrow extraction if the
goal is reducing duplicated iterator-close/exit-drain logic. The success
criterion should be that `ScopeBoundary` becomes smaller without moving scope
ownership, runtime-exit propagation, or handler-capture policy into a generic
region abstraction.

If the prototype requires making `returnExit` scope-aware, teaching it about
controllers, or adding callback hooks for every Scope-specific decision, that is
a sign the abstraction boundary is wrong. Keep the current direct
`ScopeBoundary` implementation and consider only smaller helper extraction.
