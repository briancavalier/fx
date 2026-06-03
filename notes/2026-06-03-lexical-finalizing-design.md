# Lexical Finalizing Design

Status: design note for a small companion to `bracket`.

## Goal

Add a lexical finalization helper for computations that need cleanup tied to a
visible dynamic extent, without changing scope-owned finalizer registration.

Current `andFinally(...)` registers cleanup with the current or named scope. That
is useful for request-owned resources and helper APIs that attach cleanup to an
ambient lifetime, but it reads like cleanup will happen "when the owner exits."
For local cleanup, users often want the lifetime to be visible where the program
is written.

`bracket(...)` already provides lexical acquire/use/release. A `finalizing(...)`
helper would provide the same lexical guarantee when there is no acquired
resource value.

## Proposed API

Prefer a pipe-friendly companion to `bracket`:

```ts
export const finalizing =
  <const FE>(finally_: Fx<FE, void>) =>
    <const E, const A>(fx: Fx<E, A>): Fx<E | FE | Interrupt, A> =>
      ...
```

Usage:

```ts
program.pipe(
  finalizing(cleanup)
)
```

Naming preference: `finalizing`. It reads as an operation and avoids a
misspelled-looking public name. `finally` is reserved JavaScript syntax and
`fina11y` is memorable but probably too cute for a core API.

## Semantics

`finalizing(cleanup)(program)` runs `program` and runs `cleanup` when that
lexical region exits:

- after success
- after failure
- after interruption
- when iterator return cleanup is required

The finalizer runs after the protected program exits and before the lexical
finalizing region returns to its caller. The first version should be
exit-agnostic: cleanup runs regardless of why the region exits, but the cleanup
function does not receive an exit value.

Handlers around the lexical combinator apply naturally to both the protected
program and the cleanup because both are part of the same explicit dynamic
extent:

```ts
program.pipe(
  finalizing(cleanupThatNeedsLog),
  handle(Log, ...)
)
```

This is intentionally different from `andFinally(cleanup)`, where cleanup is
registered with a scope and may run later during that scope's release path.

## Relationship To Existing APIs

### `bracket`

`finalizing(cleanup)(program)` is the no-resource-value companion to `bracket`.
It should reuse the same implementation strategy where possible:

- protect acquisition/registration with interruption masking where needed
- restore interruption while running the protected program
- always run cleanup once the protected region exits

An object-parameter `bracket` overload could express the same thing:

```ts
bracket({
  use: program,
  finally: cleanup
})
```

That is worth considering later, but a standalone `finalizing` helper is smaller
and keeps the existing `bracket(initially, finally, use)` API simple.

### `andFinally`

`andFinally` remains scope-owned finalizer registration:

```ts
yield* andFinally(cleanup)
```

It means "register this cleanup with the current owner." Cleanup effects remain
nested in `Finally<S, FE>` until the matching `withScope(...)` releases them back
to the top-level effect row.

`finalizing` is lexical:

```ts
program.pipe(finalizing(cleanup))
```

It means "run this cleanup when this computation exits." Cleanup effects are
part of the returned program's top-level effect row.

The two APIs should be documented as different lifetime models, not two spellings
for the same behavior.

## Type Shape

For a simple cleanup:

```ts
finalizing(cleanup: Fx<FE, void>)(program: Fx<E, A>): Fx<E | FE | Interrupt, A>
```

Cleanup `Fail<E>` should follow the same policy as `bracket` initially. If
lexical cleanup failure aggregation becomes necessary, it should be handled as a
separate consistency pass across `bracket` and `finalizing`.

Exit-aware lexical cleanup is intentionally out of scope for the first version.
Classifying `Fail`, `Abort`, `ReturnFrom`, interruption, and hard JS throws for
lexical cleanup needs a separate design with a deliberately defined lexical exit
model.

## Tests

Add focused tests alongside `bracket` / interruption tests:

- runs cleanup after success
- runs cleanup after failure
- runs cleanup after interruption
- runs cleanup exactly once
- handlers around `finalizing(...)` handle cleanup effects
- handlers inside `program` do not accidentally become registration-site
  handlers for cleanup unless they also wrap the `finalizing(...)` call

## Non-Goals

- Do not change `andFinally`, `andFinallyIn`, `using`, or `usingIn`.
- Do not add registration-site handler capture for scope-owned finalizers.
- Do not add a context-resource DSL in this change.
- Do not replace `bracket`.

## Future Direction

Context-parameter resource providers are an interesting follow-on direction:

```ts
program.pipe(
  provideUsing({
    db: { initially: openDb, finally: closeDb },
    cache: { initially: openCache, finally: closeCache }
  })
)
```

That would compose named lexical resources more ergonomically than nested
`bracket(...)` calls. It should get a separate design note covering acquisition
order, reverse release order, partial acquisition cleanup, release failure
aggregation, and context inference.
