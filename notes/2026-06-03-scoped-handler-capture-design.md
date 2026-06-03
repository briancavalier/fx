# Scoped Handler Capture Design

Status: design note for a future prototype branch, likely
`codex/scoped-handler-capture-prototype`.

## Goal

Redesign internal handler capture so that scope-owned work runs with the
handler context that belongs to its ownership boundary.

The motivating failure came from HTTP request scopes:

- A route handler can register current-scope cleanup.
- The cleanup should be owned by the private request scope.
- The cleanup should still be able to use application handlers, such as `Log`,
  that were installed around `serve(...)`.
- A handler installed around `serve(...)` should also be able to allocate
  request-scoped cleanup or request-scoped forks while handling a route effect.

A simple wrapper-order fix in the HTTP interpreter is not enough. Placing the
captured handlers outside the request scope lets finalizers use those handlers,
but moves handler implementations themselves outside the request scope. Placing
the captured handlers inside the request scope gives handler implementations the
right current scope, but leaves cleanup effects yielded during scope release
outside those handlers.

The desired design should make this a scope/handler-capture invariant, not an
HTTP-specific arrangement.

## Current Model

`HandlerCapture` is currently an unbounded capture request by name:

```ts
export class HandlerCapture<const Name extends string>
  extends Effect('fx/HandlerCapture')<Name, readonly CapturedHandler[]> { }
```

Each ordinary handler implements `CapturedHandler`. When it sees a matching
`HandlerCapture`, it prepends or appends itself to the captured handler list and
continues yielding the request outward. `withHandlerContext(context, fx)` then
replays that list around `fx`.

`ScopeBoundary` also implements `CapturedHandler`. When a capture request passes
through a scope, the scope can contribute a wrapper that recreates a scope
boundary around captured work. It already has a separate `wrapShared(...)`
variant for scope-owned fork behavior where the child must share the live scope
controller rather than creating a fresh boundary.

Current finalizer storage is simpler than the semantic model now needs:

```ts
readonly finalizers = [] as Finalizer<unknown>[]
```

The scope stores only raw finalizer functions. At release, it runs those
functions through whatever handlers happen to be outside the scope release path.
That works for simple programs, but it cannot express "run this cleanup with the
handler segment between the registration site and the owning scope plus the
handler segment around the owning scope."

## Proposed Model

Make handler capture scope-delimited.

Instead of treating capture as "collect every handler outward until the request
is closed," capture should always stop at a scope boundary:

- Capturing for `currentScope` stops at the nearest live scope.
- Capturing for a named scope stops at the matching live scope.
- Capturing for root/top-level work stops at an implicit root scope.

This gives scopes a consistent role:

- `withScope(scope)` delimits lifetime.
- `withScope(scope)` delimits `currentScope`/nearest-scope operations.
- `withScope(scope)` delimits handler capture for work owned by that scope.

For scope-owned work, the execution context is the concatenation of two handler
segments:

1. The local handler segment from the registration site up to the owning scope.
2. The owning scope's recursive scope context:
   - the owning scope's own captured handler, so replayed work re-enters the
     right scope boundary or shared controller
   - the owning scope's outer handler segment, captured when the scope is
     created or first installed

In other words:

```text
handlers between registration site and owning scope
        +
owning scope captured handler
        +
outer handlers already captured by owning scope
        =
execution context for scope-owned work
```

This should apply to all scope-owned runnable work, not only finalizers:

- finalizers registered with `andFinally` / `andFinallyIn`
- scoped forks started with `forkIn(currentScope, ...)` or `forkIn(scope, ...)`
- timeout daemon forks registered with `timeoutIn(...)`

The scope controller should own runnable work items that already carry the
handler context needed to execute them later. It should not own only raw
functions plus a mutable global handler set.

## Recursive Capture Invariant

Handler capture must be recursive across scope boundaries.

When a scope answers or participates in a capture request, it does not only
return "handlers below me." It must be able to include:

1. the local handler segment collected below that scope
2. the scope's own captured handler
3. the handlers outside the scope that the scope already captured

Conceptually:

```text
capture request inside scope S
  -> handlers between request site and S
  -> captured handler for S
  -> handlers outside S that S captured when it was installed
```

This is what lets captured work preserve both nearest-scope behavior and the
application handlers around the owning scope. Without the scope's own captured
handler, replayed work may run outside the intended boundary. Without the
scope's already-captured outer context, replayed work may lose handlers that
were around the scope when the owned work was registered.

The prototype may expose this internally as two related operations:

- `captureLocalTo(scope)` returns only the handlers below the target scope.
- `captureRunnableFor(scope)` returns local handlers plus the target scope's
  recursive scope context.

Scope-owned finalizers and scoped forks should use the runnable form. A lower
level implementation may still store the local segment separately and append
the scope context at execution time, but the observable behavior must be the
same as recursive capture.

## Sketch

Add an internal capture target concept:

```ts
type HandlerCaptureTarget =
  | { readonly type: 'root' }
  | { readonly type: 'nearestScope' }
  | { readonly type: 'scope', readonly scope: AnyScope }
```

Then make handler capture carry both a name and a target:

```ts
class HandlerCapture<Name extends string>
  extends Effect('fx/HandlerCapture')<
    { readonly name: Name, readonly target: HandlerCaptureTarget },
    readonly CapturedHandler[]
  > { }
```

The existing unbounded capture sites should migrate to explicit root capture
when they really need top-level capture. For example, `serve(...)` likely wants
to capture handlers between the `serve(...)` call and the root boundary, because
the server interpreter will run route handlers later and outside the original
call stack.

`ScopeBoundary` becomes the capture delimiter:

- For `nearestScope`, stop at the first scope boundary and return the handlers
  collected so far, while also allowing the scope to know that this work belongs
  to that boundary.
- For named scope capture, stop only when `sameScope(effect.scope, scope)` is
  true.
- For root capture, contribute the scope wrapper as today and continue outward
  until the root boundary closes capture.

Owned work should store the local captured segment. The scope controller should
combine it with the scope's recursive context when running the work.

```ts
type OwnedFinalizer = {
  readonly finalizer: Finalizer<unknown>
  readonly localContext: readonly CapturedHandler[]
}

type OwnedScopedFork = ScopedForkContext & {
  readonly localContext: readonly CapturedHandler[]
}
```

The release path becomes:

```ts
withHandlerContext(
  [...localContext, scopeCapturedHandler, ...scopeContext],
  finalizer(exit)
)
```

The exact list order must match `withHandlerContext`'s current reduce order:
earlier entries become inner wrappers and later entries become outer wrappers.
Local registration handlers should be closer to the finalizer than handlers
around the owning scope. The scope's own captured handler must sit between the
local registration segment and the already-captured outer segment.

## Why Not Only Capture Finalizers?

Capturing only finalizers solves the HTTP `Log` symptom, but it leaves a split
model:

- finalizers carry their own handler context
- scoped forks still rely on runtime wrapper order
- timeout daemon forks have another set of assumptions

That is hard to explain and easy to regress. The scope controller already owns
lifetime for finalizers and scoped forks. It should also own the runnable work
context for both.

## Why Not A Single Global Handler Set On The Scope?

A scope-level global handler set is attractive, but it cannot represent nested
handler regions inside one scope:

```ts
withScope(S)(
  fx(function* () {
    yield* using(resourceA, releaseA).pipe(handle(A, ...))
    yield* using(resourceB, releaseB).pipe(handle(B, ...))
  })
)
```

`releaseA` should see `A`, and `releaseB` should see `B`. A single handler set
on the scope either misses both local handlers or becomes mutable in a way that
does not reflect the registration site. The two-segment model avoids that:
scope context is stable, and each owned work item carries its local segment.

## Root Scope

The design needs an implicit conceptual root scope. It does not need to be a
public API at first.

Root exists to make top-level handler capture delimited. Existing uses such as
`serve(...)` and runtime fork execution need a clear stop point even when the
program is not inside an explicit user-created `withScope(...)`.

Root capture should not make root a public lifetime boundary. It is an internal
capture delimiter that prevents "capture every handler forever" from remaining
the primitive model.

## Interaction With Existing Capture Sites

### HTTP Server

`serve(...)` should continue capturing application handlers around the server
boundary so the Node interpreter can run route handlers later.

After scoped capture exists, `runNodeRequest` should use the natural structure:

```ts
withHandlerContext(context, program).pipe(
  withScope(requestScope),
  ...
)
```

or the equivalent order that makes route handler implementations execute inside
the request scope. It should not need to wrap captured handlers on both sides of
the scope. Request finalizers should use their owned-work context.

### Scoped Forks

`forkIn(scope, fx)` should capture handlers up to the owning scope and store
that local context in the owned fork item. When the controller starts the
underlying `Fork`, it should run `fx` through the combined context.

For `forkIn(currentScope, fx)`, the capture target is nearest scope. For
`forkIn(namedScope, fx)`, the capture target is that named scope.

The existing special capture path for `fx/Concurrent/ForkIn` and shared
`ScopeBoundary` controllers is a useful starting point. The prototype should
either reuse it or replace it with a general "targeted scoped capture" mechanism
that preserves the same shared-controller behavior.

### Timeout

`timeoutIn(scope, ...)` creates an internal daemon scoped fork. It should use
the same named-scope capture rule as user `forkIn(scope, ...)`, while preserving
daemon and unmetered scheduling metadata.

### Cleanup Failure Handling

Cleanup failures should remain aggregated as they are today. The change is only
how cleanup work is wrapped before it runs.

The finalizer result should still be interpreted through `returnFail(...)`, and
cleanup failure aggregation should preserve primary failure ordering.

## Open Design Questions

1. Should targeted handler capture be a new internal effect, or should it extend
   `HandlerCapture` directly?

   Extending `HandlerCapture` is conceptually unified, but it may create more
   migration noise. A new internal effect can prototype the semantics with less
   immediate disruption.

2. How should the root capture delimiter be implemented?

   Options:

   - add an internal `RootScopeBoundary` around `runFork`
   - make `closeHandlerCapture(...)` act as the root delimiter for root-targeted
     captures
   - keep root capture as the only unbounded mode during the prototype

3. Should `ScopeBoundary` capture its outer context at construction time or at
   iterator creation time?

   Iterator creation is likely more correct because handlers are dynamic
   interpreter wrappers. Construction can happen before the program is actually
   run. Whatever mechanism is chosen must make the scope context recursively
   available when the scope later answers targeted capture requests.

4. Should local context be captured before or after interpreting `Finally` /
   `ScopedFork`?

   It must reflect the handlers between the operation site and the owning scope.
   The prototype should add tests that fail if capture includes handlers outside
   the owning scope or excludes handlers installed around the operation site.

## Prototype Plan

1. Start from a new worktree based on `origin/main`:

   ```sh
   git worktree add /private/tmp/fx-scoped-handler-capture \
     -b codex/scoped-handler-capture-prototype origin/main
   ```

2. Add targeted scoped capture internally.

   Prefer the smallest implementation that can target:

   - nearest scope
   - named scope
   - root

   Keep the public API unchanged.

3. Refactor `ScopeController` owned work storage.

   Replace raw finalizer storage with owned finalizer records. Add local context
   to scoped fork records, or wrap their `fx` at registration time if that keeps
   types and runtime behavior simpler.

4. Update finalizer release and scoped fork start paths to apply the combined
   local-plus-scope context.

5. Revert HTTP-specific handler sandwiching in the HTTP request runner if it
   exists in the prototype branch.

6. Add focused tests before broad refactoring:

   - finalizer registered under an inner handler can use that handler after the
     handler has unwound
   - finalizer can also use a handler installed around the owning scope
   - local handler wins over outer handler for the same effect type
   - `forkIn(currentScope, ...)` inside an inner handler starts the child with
     that handler available
   - `forkIn(namedScope, ...)` from inside a nested scope targets the named
     owner, not the nearest scope
   - HTTP route finalizers can use `Log`, and captured route-effect handlers can
     register request-owned cleanup

7. Validate:

   ```sh
   corepack pnpm build
   corepack pnpm typecheck
   corepack pnpm lint
   node --import tsx --test src/Finalization.test.ts src/Concurrent.test.ts src/HttpServer.test.ts
   corepack pnpm test
   ```

## Success Criteria

- No public API changes are required.
- Finalizers and scoped forks follow one handler-context rule.
- HTTP request scopes no longer need handler wrappers on both sides.
- Existing handler capture behavior either remains compatible or has a clearly
  documented migration path inside the internal runtime.
- Scope-owned work remains explicit; runtime context does not become a service
  container or broad ambient capability mechanism.
