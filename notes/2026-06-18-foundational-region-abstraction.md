# Foundational Region Abstraction Evaluation

Status: design investigation.

## Question

Could `fx` use a foundational region abstraction, perhaps lower-level than the
`returnExit` / `resumeExit` shape referenced in prior notes, to provide
programmable analogs of:

- `initially`: enter or acquire region-local state;
- `finally`: finalize exactly once after success, failure, return, abort, or
  interruption;
- `return`: decide how a captured exit becomes the region's result or resumes
  outward.

The interesting version is not a public `Region` feature. It is an internal
primitive that could explain lexical finalization, transactional state, parts of
`ScopeBoundary`, and future scope-adjacent handlers without hiding ownership
policy in a generic framework.

## Short Answer

Yes, but the primitive should be smaller than "programmable Scope".

The promising abstraction is an iterator-level region kernel:

1. enter once;
2. run a protected body;
3. classify exits that this region owns;
4. run finalization once with the owned exit;
5. let the caller decide whether to replace, resume, or propagate the exit.

That kernel can unify repeated exit/finalization mechanics. It should not own
scope identity lookup, handler capture, task ownership, scheduler admission,
runtime scope-exit transport, or state semantics.

If the abstraction needs hooks for all of those, it has become a less readable
version of `ScopeBoundary`.

## Current Pressure Points

`bracket` and `finalizing` in `Fx.ts` already express local entry/finalization,
but they are lexical and cannot observe structured exits beyond normal
generator `finally` behavior.

`Finalization.ts` gives named lifetime finalizers through `Finally` effects, but
the finalizer storage and release policy live in `ScopeBoundary`.

`withScope(...)` in `Scope.ts` currently owns several separable concerns:

- matching `Finally`, `ScopedFork`, `ReturnFrom`, `Abort`, and `InterruptFrom`;
- mapping `currentScope` to the nearest live scope;
- maintaining a shared `ScopeController`;
- joining scope-owned tasks;
- running finalizers;
- preserving primary failure before cleanup failures;
- aggregating cleanup failures as `Fail<AggregateError>`;
- propagating runtime scope exits across async boundaries;
- contributing ordinary and targeted handler capture;
- distinguishing root boundaries from shared captured boundaries.

The prior return-exit evaluation correctly identified that only part of this is
generic region behavior. The reusable part is the protected-body and exit-drain
mechanics, not scope ownership itself.

`withState(...)` and `YieldFrom` are instructive counterexamples. Both are
scope-keyed, but their semantics are specific handlers. A foundational region
can own their lifetime or identity boundary; it should not absorb their
protocols.

## Candidate Primitive

A plausible internal shape is a low-level `region(...)` helper, not exported
publicly:

```ts
type RegionExit<A, X> =
  | { readonly type: 'success', readonly value: A }
  | { readonly type: 'captured', readonly exit: X }

type RegionDecision<A> =
  | { readonly type: 'succeed', readonly value: A }
  | { readonly type: 'resume', readonly effect: unknown }
  | { readonly type: 'yield', readonly effect: unknown }

interface RegionSpec<S, A, X> {
  readonly initially: Fx<unknown, S>
  readonly body: (state: S) => Fx<unknown, A>
  readonly classify: (effect: unknown, state: S) => X | undefined
  readonly finally: (state: S, exit: RegionExit<A, X>) => Fx<unknown, void>
  readonly decide: (state: S, exit: RegionExit<A, X>) => Fx<unknown, RegionDecision<A>>
}
```

This exact type is not a recommendation. It shows the useful decomposition:

- `initially` creates region-local state;
- `classify` decides which yielded effects are exits owned by this region;
- `finally` runs after both success and owned exits;
- `decide` expresses the "return" analog: convert the owned exit into a value,
  re-yield the original effect, fail, or propagate another effect.

The implementation would own iterator stepping, `return()` draining, cleanup
draining after cleanup failures, and one-shot finalization. The caller would own
the meaning of effects.

## Smaller Kernel

The first prototype should probably be smaller than the `RegionSpec` sketch.

Start with an `exitRegion(...)` kernel that has no `initially` hook:

```ts
exitRegion(body, {
  classify(effect) { ... },
  finalize(exit) { ... },
  resume(exit) { ... }
})
```

Then express `initially` by local composition:

```ts
fx(function* () {
  const state = yield* initially
  return yield* exitRegion(body(state), {
    classify: effect => classify(effect, state),
    finalize: exit => finally_(state, exit),
    resume: exit => resume(state, exit)
  })
})
```

That keeps acquisition ordinary and avoids making the kernel responsible for
interrupt masking, resource registration, or TypeScript inference across a large
spec object.

If this smaller kernel cannot improve real code, the larger `RegionSpec` shape
is unlikely to be worth adding.

## How It Would Apply

### Lexical finalization

`finalizing(cleanup)(program)` is the simplest region:

- no special exit classification;
- finalization runs on generator exit;
- success remains success;
- yielded effects remain yielded.

It may not need the kernel unless `finalizing` wants identical cleanup-failure
draining behavior to `ScopeBoundary`.

### `bracket`

`bracket(initially, release, use)` is an entered region:

- `initially` acquires a value;
- `use(value)` is the body;
- `release(value)` is finalization;
- no custom return semantics.

The existing direct implementation is clearer today. A region kernel is only
useful if it provides behavior `bracket` should share with other regions, such
as consistent interruption cleanup draining.

### Transactional state

`transactionalState(scope)` is likely the cleanest fit:

- `initially` snapshots state;
- success and matching `returnFrom` commit;
- `Fail`, `Abort`, and `InterruptFrom` roll back;
- non-success exits resume outward as their original effects.

This is region behavior without becoming a lifetime scope. That is the strongest
argument for a primitive below `ScopeBoundary`.

### Scope

`withScope(scope)` can reuse a kernel only below its ownership layer.

Scope-specific code must still handle:

- matching named scope vs `currentScope`;
- registering finalizers;
- owning and joining scoped forks;
- shared controller wrappers for captured scoped work;
- targeted scoped handler capture;
- runtime scope-exit source propagation;
- cleanup failure aggregation policy.

The kernel can help with:

- classifying a protected body's owned exit;
- draining `iterator.return()` after early exit;
- continuing cleanup after cleanup failure;
- ensuring finalization is one-shot;
- resuming or replacing the exit.

The kernel should not know what a scope is.

### Concurrent combinators

`all`, `race`, and `firstSuccess` currently build private scopes and use
`returnFrom` to settle structured results. A region kernel does not replace that
because child task lifetime and sibling interruption are scope-controller
semantics.

It could help only if those private scopes later share an internal "settle this
owned exit and finalize" path with normal scopes.

## Design Constraints

- Keep it internal until at least two concrete call sites improve.
- Do not make it scope-aware.
- Do not make it a service container or runtime context bag.
- Do not hide handler capture inside the primitive.
- Do not use it to weaken effect rows with broad `unknown` or `any` surfaces.
- Keep `Fail` handling explicit; region cleanup failure aggregation should be a
  policy supplied by the caller or a small helper, not hard-coded globally.
- Prefer one small helper plus local duplication over a large configurable
  object with many hooks.

## Type Direction

The public `Fx<E, A>` type should remain the compositional currency.

For an internal kernel, exact effect typing may require local assertions because
TypeScript cannot infer "this classifier removes only these effects" from an
arbitrary callback. That is acceptable only if:

- assertions stay inside the kernel or the narrow adapter;
- public APIs keep precise effect rows;
- type-level tests prove the public elimination behavior.

If using the kernel forces broad assertions in public modules, the abstraction
is too indirect.

## Prototype Criterion

A useful prototype should pick one non-scope boundary and one scope-adjacent
boundary:

1. Extract a kernel behind `returnExit` / `transactionalState`.
2. Try to use the same kernel for one narrow part of `ScopeBoundary`, probably
   body-exit classification plus interrupted cleanup draining.

Success means:

- less duplicated iterator-close code;
- no movement of scope ownership policy into the kernel;
- no behavior changes in existing scope/finalization/concurrency tests;
- no broader public type assertions;
- `ScopeBoundary` remains readable.

Failure means:

- the kernel needs scope/controller/runtime-context hooks;
- the call sites become callback-heavy;
- tests need broad rewrites to preserve existing semantics;
- public types get worse.

If failure happens, keep `ScopeBoundary` direct and extract only smaller helpers
around cleanup draining.

## Recommendation

Investigate a foundational region kernel, but frame it as an internal
exit/finalization primitive rather than a new conceptual owner.

Regions are likely the right conceptual center for execution ownership in `fx`.
The foundational primitive should therefore support region-like code without
claiming ownership of every region specialization. In practice:

- Scope remains the owner of lifetime, children, cleanup, current-scope
  dispatch, and runtime exits.
- Transactional state remains the best first user of a lower exit region.
- Yield and state remain protocol-specific handlers keyed by region/scope
  identity.
- The kernel owns the repetitive, error-prone iterator mechanics.

The next implementation slice should be experimental and internal. Do not
rename or reshape the public `Scope` API around "Region" until this kernel
proves it can simplify at least two real call sites without absorbing their
domain policies.
