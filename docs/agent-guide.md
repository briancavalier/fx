# Agent Guide

This guide is for coding agents writing application code with `fx`. The root
`AGENTS.md` files are contributor guidance for changing this repository.

## Core model

An `Fx<E, A>` is a computation that returns `A` and may request effects `E`.
Programs describe operations with `yield*`; handlers interpret those operations.

```ts
import { Effect, fx, handle, ok, run } from "@briancavalier/fx"

class AskName extends Effect("app/AskName")<void, string> {}

const askName = new AskName()

const greet = fx(function* () {
  return `Hello, ${yield* askName}`
})

const message = greet.pipe(
  handle(AskName, () => ok("Ada")),
  run
)
```

The effect union should stay meaningful. If a program needs logging, storage, and
recoverable validation, keep those effects visible in its `Fx<E, A>` type until
a handler eliminates them.

## Define effects directly

Use `Effect(...)` classes for ordinary requests. Add a small constructor value or
function only when it improves call-site clarity.

```ts
class SaveUser extends Effect("app/User/Save")<User, User> {}

const saveUser = (user: User) => new SaveUser(user)
```

Avoid service containers, dependency graphs, and wrappers that only rename an
existing effect. An effect should describe a request, not a hidden dependency.

## Write business logic against effects

Application logic should request operations and compose results. It should not
perform platform side effects directly.

```ts
const registerUser = (input: RegisterInput) => fx(function* () {
  const user = validateUser(input)
  const saved = yield* saveUser(user)
  yield* log("user registered", { id: saved.id })
  return saved
})
```

At platform boundaries, interpret effects with handlers and then run the program.

```ts
const result = registerUser(input).pipe(
  handle(SaveUser, effect => databaseSave(effect.arg)),
  defaultLog,
  runPromise
)
```

## Use `Fail` for recoverable errors

Recoverable domain and boundary errors should be values in `Fail<E>`, not thrown
JavaScript exceptions. Use `fail`, `trySync`, and `tryPromise` to convert
recoverable exceptional states into effects.

```ts
import { catchOnly, fail } from "@briancavalier/fx"

class InvalidEmail extends Error {}

const parseEmail = (value: string) =>
  value.includes("@")
    ? ok(value)
    : fail(new InvalidEmail(value))

const recovered = parseEmail(input).pipe(
  catchOnly(InvalidEmail, () => ok("unknown@example.com"))
)
```

Reserve `throw` for hard crashes, internal invariants, and explicitly unsafe
assertions.

## Wrap async boundaries with `tryPromise`

Use `tryPromise` when a promise can reject and the rejection is recoverable.
Use `assertPromise` only when rejection should crash the running program.

```ts
import { tryPromise } from "@briancavalier/fx"

const readUser = (id: string) =>
  tryPromise(signal =>
    fetch(`/users/${id}`, { signal }).then(response => response.json())
  )
```

The runtime provides an `AbortSignal`; pass it to cancellable platform APIs.

## Compose handlers explicitly

Handlers are ordinary pipe transforms. Keep the final interpreter pipeline easy
to scan.

```ts
const main = program.pipe(
  memoryUserStore(),
  defaultLog,
  defaultTime,
  runPromise
)
```

Do not hide large handler stacks behind broad framework-like layers unless the
named boundary is real and useful for the application.

## Choose the right runner

- Use `run` only after all async, failure, handler-capture, and platform effects
  have been eliminated.
- Use `runPromise` for async programs when the caller does not need cancellation.
- Use `runTask` when the caller needs to cancel or wait for disposal.
- Use `runNodeMain` from `@briancavalier/fx/platform-node` for Node entrypoints
  that should shut down on process signals.

## Concurrency and resources

Use `all` and `race` to describe structured concurrency, then choose semantics
with handlers such as `defaultAll`, `firstSettled`, `firstSuccess`, `bounded`,
and `unbounded`.

Use named scopes and finalization helpers when resources need cleanup. Keep
acquire/register critical sections small and explicit.

```ts
const program = fx(function* () {
  const [user, posts] = yield* all([fetchUser, fetchPosts])
  return { user, posts }
}).pipe(
  defaultAll,
  bounded(4),
  runPromise
)
```

## Boundary discipline

Do:

- keep domain programs platform-neutral,
- model external work as effects,
- convert recoverable thrown/rejected errors to `Fail`,
- use pure handlers in tests,
- compose handlers explicitly near runtime boundaries.

Avoid:

- direct `console.log`, `fetch`, file, or database calls inside reusable `Fx`
  programs when an effect would keep the boundary explicit,
- broad service-container abstractions,
- hiding effect requirements behind ambient state,
- wrapping one effect in a generator unless the wrapper adds sequencing or a
  real domain operation.
