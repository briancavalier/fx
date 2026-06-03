# Scoped Handler Capture Design

Status: prototype design note for `codex/scoped-handler-capture-prototype`.

## Goal

Redesign internal handler capture so that delayed runnable work runs with the
handler context that belongs to the ownership boundary where the work is
registered.

The motivating failure came from HTTP request scopes:

- A route handler runs later, outside the original `serve(...)` call stack.
- The route handler should use application handlers installed around
  `serve(...)`, such as `Log`.
- The route handler should execute inside the private request scope, so route
  code and app-provided route-effect handlers can allocate request-owned work.

A simple wrapper-order fix in the HTTP interpreter is not enough. Placing
captured handlers outside the request scope lets cleanup use those handlers, but
moves handler implementations themselves outside the request scope. Placing
captured handlers inside the request scope gives handler implementations the
right current scope, but cleanup effects yielded during ordinary scope release
may still be outside those handlers.

The scoped handler capture prototype should solve the delayed-runnable part of
the problem without turning finalizers into implicitly captured handler
closures.

## Split From Finalizer Context Capture

Scoped handler capture and finalizer context capture are related, but they
should be separate designs.

Scoped handler capture is the smaller, directionally aligned primitive:

- `serve(...)` captures handlers so request route programs can run later.
- `forkIn(...)` captures handlers so scope-owned child tasks can start later.
- timeout daemon forks use the same scope-owned runnable path.
- root/top-level capture remains a delimiter for runtime-owned work.

Finalizers are different. `andFinally` / `andFinallyIn` register cleanup in the
current interpreter flow, and the cleanup effect surface is intentionally visible
through `withScope(...)` today. Automatically wrapping finalizer payloads when
they pass through ordinary handlers makes runtime behavior convenient, but the
static `Fx<E, A>` surface cannot currently express "this cleanup effect will be
handled later by a handler captured at registration time." That creates a type
ergonomics gap and makes finalizer behavior more implicit than the rest of
`fx`.

For this prototype:

- Do not add special propagation for `Finally` through ordinary handlers.
- Do not replace raw finalizer storage with context-bearing finalizer records.
- Keep finalizer effects explicit in the owning scope's cleanup surface.
- Treat effectful finalizer context capture as a follow-on design that should
  use an explicit API or an internal call site that makes the capture boundary
  visible.

This means scoped handler capture may improve HTTP route execution and scoped
fork behavior, but it is not by itself the full answer for "request finalizers
can use app handlers." That finalizer-specific problem should be solved
deliberately, not smuggled into the capture primitive.

## Current Model

`HandlerCapture` is currently an unbounded capture request by name:

```ts
export class HandlerCapture<const Name extends string>
  extends Effect('fx/HandlerCapture')<Name, readonly CapturedHandler[]> { }
```

Each ordinary handler implements `CapturedHandler`. When it sees a matching
`HandlerCapture`, it contributes itself to the captured handler list and
continues yielding the request outward. `withHandlerContext(context, fx)` then
replays that list around `fx`.

`ScopeBoundary` also implements `CapturedHandler`. When a capture request passes
through a scope, the scope can contribute a wrapper that recreates a scope
boundary around captured work. It already has a separate shared-controller
variant for scope-owned fork behavior where the child must share the live scope
controller rather than create a fresh boundary.

The current unbounded capture model is sufficient for simple top-level capture,
but it does not make the intended target scope explicit. Scope-owned runnable
work needs capture to stop at the scope that owns the work, then combine that
local segment with the owning scope's outer context when the work starts.

## Proposed Model

Make handler capture target-aware and scope-delimited for delayed runnable work.

Instead of treating capture as "collect every handler outward until the request
is closed," targeted capture can stop at a scope boundary:

- Capturing for `currentScope` stops at the nearest live scope.
- Capturing for a named scope stops at the matching live scope.
- Capturing for root/top-level work stops at an implicit root boundary.

This gives scopes a consistent role:

- `withScope(scope)` delimits lifetime.
- `withScope(scope)` delimits `currentScope` / nearest-scope operations.
- `withScope(scope)` delimits handler capture for runnable work owned by that
  scope.

For scope-owned runnable work, the execution context is:

```text
handlers between registration site and owning scope
        +
owning scope captured handler
        +
outer handlers already captured by the owning scope
        =
execution context for the delayed runnable
```

This should apply to runnable work whose execution is intentionally delayed or
detached from the original interpreter stack:

- route programs run by HTTP server interpreters
- scoped forks started with `forkIn(currentScope, ...)` or `forkIn(scope, ...)`
- timeout daemon forks registered with `timeoutIn(...)`

It should not automatically apply to finalizers in this prototype.

## Recursive Capture Invariant

Handler capture must be recursive across matching scope boundaries.

When a scope answers or participates in a capture request, it does not only
return "handlers below me." For work that belongs to that scope, it must be able
to include:

1. the local handler segment collected below that scope
2. the scope's own captured handler, using the shared live controller for
   scope-owned runnable work
3. the handlers outside the scope that the scope captures by continuing the
   request outward

Conceptually:

```text
capture request inside scope S
  -> handlers between request site and S
  -> captured handler for S
  -> handlers outside S collected by root capture
```

This preserves both nearest-scope behavior and application handlers around the
owning scope. Without the scope's own captured handler, replayed work may run
outside the intended boundary. Without the outer context, replayed work may lose
handlers that were around the scope when the owned runnable was registered.

## Sketch

Add an internal capture target concept:

```ts
type ScopedHandlerCaptureTarget =
  | { readonly type: 'root' }
  | { readonly type: 'nearestScope' }
  | { readonly type: 'scope', readonly scope: AnyScope }
```

The prototype can introduce a new internal effect rather than changing public
`HandlerCapture` immediately:

```ts
class ScopedHandlerCapture
  extends Effect('fx/internal/ScopedHandlerCapture')<
    ScopedHandlerCaptureTarget,
    readonly CapturedHandler[]
  > { }
```

`ScopeBoundary` is the capture delimiter:

- For `nearestScope`, stop at the first scope boundary and use its shared
  captured handler.
- For named scope capture, stop only when `sameScope(target.scope, scope)` is
  true; non-matching inner scopes forward the request without contributing
  themselves.
- For root capture, contribute the current scope wrapper and continue outward
  until the runtime root closes capture.

The exact list order must match `withHandlerContext`'s current reduce order:
earlier entries become inner wrappers and later entries become outer wrappers.
Local registration handlers should be closer to the runnable than handlers
around the owning scope. The scope's own captured handler must sit between the
local segment and the already-captured outer segment.

## Interaction With Existing Capture Sites

### HTTP Server

`serve(...)` should continue capturing application handlers around the server
boundary so the Node interpreter can run route handlers later.

`runNodeRequest` should prefer the natural structure:

```ts
withHandlerContext(context, program).pipe(
  withScope(requestScope),
  ...
)
```

That order makes route handler implementations execute inside the request
scope. It also lets app-provided route-effect handlers allocate request-owned
forks or explicit cleanup. Scoped handler capture does not by itself make
ordinary request finalizers use app handlers after scope release; that remains
the finalizer-context-capture design.

### Scoped Forks

`forkIn(scope, fx)` should let the matching scope boundary capture the handler
context for the child when it consumes the `ScopedFork` request. When the scope
controller starts the underlying `Fork`, it should run `fx` through the combined
context.

For `forkIn(currentScope, fx)`, the capture target is nearest scope. For
`forkIn(namedScope, fx)`, the capture target is that named scope.

Non-matching nested scopes must not contribute their own scope boundary to a
named-scope capture, otherwise replayed work could accidentally see the wrong
nearest scope.

### Timeout

`timeoutIn(scope, ...)` creates an internal daemon scoped fork. It should use
the same named-scope capture rule as user `forkIn(scope, ...)`, while preserving
daemon and unmetered scheduling metadata.

### Finalizers

Finalizer behavior should stay as it is in the base scope model:

- The scope stores raw finalizer functions.
- The release path runs them through the handlers outside the scope release
  path.
- The finalizer result is interpreted through `returnFail(...)`.
- Cleanup failure aggregation preserves primary failure ordering.

If an HTTP or resource-management use case needs registration-site handler
capture for finalizers, add a separate explicit API or internal operation and
give that API its own type story.

## Open Design Questions

1. Should targeted scoped capture remain a new internal effect, or should it
   eventually extend `HandlerCapture` directly?

   Extending `HandlerCapture` is conceptually unified, but a new internal effect
   lets the prototype prove scope-delimited runnable capture with less public
   migration noise.

2. How should the root capture delimiter be implemented long term?

   Options:

   - add an internal `RootScopeBoundary` around runtime entrypoints
   - make runtime entrypoints answer root-targeted scoped capture directly
   - keep root capture as a minimal runtime-special case during the prototype

3. Should `ScopeBoundary` capture its outer context at construction time or at
   iterator creation time?

   Iterator creation is likely more correct because handlers are dynamic
   interpreter wrappers. Construction can happen before the program is actually
   run.

4. What explicit API, if any, should support registration-site finalizer context
   capture?

   Possible directions include a separate `andFinallyCaptured(...)`, an
   internal HTTP-only operation, or no API until a second concrete use case
   justifies it.

## Prototype Plan

1. Keep the public API unchanged.

2. Add targeted scoped capture internally for:

   - nearest scope
   - named scope
   - root

3. Update ordinary handlers to contribute to the internal scoped capture effect.

4. Update `ScopeBoundary` so scoped forks combine:

   - the local handler segment
   - the owning scope's shared captured handler
   - the outer root-captured handler context

5. Route `forkIn(...)`, structured scoped forks, and `timeoutIn(...)` through
   the same scoped-fork ownership path.

6. Do not add finalizer-specific handler wrapping in this prototype.

7. Add focused tests:

   - `forkIn(currentScope, ...)` inside an inner handler starts the child with
     that handler available
   - `forkIn(namedScope, ...)` from inside a nested scope targets the named
     owner, not the nearest scope
   - timeout daemon forks preserve existing daemon and unmetered behavior
   - existing finalizer typing and cleanup aggregation behavior remains
     unchanged

8. Validate:

   ```sh
   corepack pnpm build
   corepack pnpm typecheck
   corepack pnpm lint
   node --import tsx --test src/Concurrent.test.ts src/Timeout.test.ts src/Finalization.test.ts
   corepack pnpm test
   ```

## Success Criteria

- No public API changes are required.
- Scoped forks and timeout daemon forks follow one scope-delimited handler
  capture rule.
- Finalizer behavior remains explicit and unchanged.
- HTTP request scopes can run captured route handlers inside the request scope;
  finalizer-specific context capture remains a separate decision.
- Existing handler capture behavior either remains compatible or has a clearly
  documented migration path inside the internal runtime.
- Scope-owned work remains explicit; runtime context does not become a service
  container or broad ambient capability mechanism.
