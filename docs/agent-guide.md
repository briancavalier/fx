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

## Import surface

Use `@briancavalier/fx` for the write-and-run core: `fx`, `Fx`, `Effect`,
`handle`, `control`, `ok`, `fail`, `tryPromise`, `get`, `run`, `runPromise`,
`runTask`, simple console output, and basic diagnostics helpers. Use named
subpaths for optional feature areas and advanced trace tools.

| Need | Import from |
| --- | --- |
| Encoding and decoding external data with branded codec keys | `@briancavalier/fx/codec` |
| Scopes, abort, finalization, early return, scoped yielding | `@briancavalier/fx/scope` |
| Sinks for receiving values | `@briancavalier/fx/sink` |
| Scoped mutable state operations | `@briancavalier/fx/state` |
| Structured concurrency | `@briancavalier/fx/concurrent` |
| Advanced trace capture, snapshots, and trace formatting options | `@briancavalier/fx/trace` |
| Time and random | `@briancavalier/fx/time`, `@briancavalier/fx/random` |
| Structured logging | `@briancavalier/fx/log` |
| Retry and timeout | `@briancavalier/fx/retry`, `@briancavalier/fx/timeout` |
| HTTP and Node platform boundaries | `@briancavalier/fx/http-client`, `@briancavalier/fx/http-server`, `@briancavalier/fx/platform-node` |

For simple console output, use `consoleLog` with `defaultConsole` from the root
import. Use `log`, `info`, `warn`, `error`, and `withConsoleLog` from
`@briancavalier/fx/log` for structured log messages.

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
import { consoleLog, defaultConsole, fx, handle, runPromise } from "@briancavalier/fx"

const registerUser = (input: RegisterInput) => fx(function* () {
  const user = validateUser(input)
  const saved = yield* saveUser(user)
  yield* consoleLog("user registered", { id: saved.id })
  return saved
})
```

At platform boundaries, interpret effects with handlers and then run the program.

```ts
const result = registerUser(input).pipe(
  handle(SaveUser, effect => databaseSave(effect.arg)),
  defaultConsole,
  runPromise
)
```

## Use `Fail` for recoverable errors

Recoverable domain and boundary errors should be values in `Fail<E>`, not thrown
JavaScript exceptions. Use `fail`, `trySync`, and `tryPromise` to convert
recoverable exceptional states into effects.

```ts
import { catchOnly, fail, ok } from "@briancavalier/fx"

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
import { defaultConsole, runPromise } from "@briancavalier/fx"
import { defaultTime } from "@briancavalier/fx/time"

const main = program.pipe(
  memoryUserStore(),
  defaultConsole,
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

Use `all`, `race`, and `firstSuccess` as structured concurrency operators.
Then choose a scheduling strategy with `withBoundedConcurrency`,
`withUnboundedConcurrency`, or `withCoopConcurrency`.

Use named scopes and finalization helpers when resources need cleanup. Keep
acquire/register critical sections small and explicit.

Use `timeout(options)` for a private operation timeout. It uses a
diagnostic-hidden scope owned by the timeout operator. Use
`timeoutIn(scope, options)` when installing a delayed interruption for a
caller-owned scope; the caller must still handle that scope with `withScope`
and place a fork scheduler outside it. The internal timer is daemon scoped work:
it can interrupt the scope, but it does not keep the scope alive by itself.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import { all, withBoundedConcurrency } from "@briancavalier/fx/concurrent"

const program = fx(function* () {
  const [user, posts] = yield* all([fetchUser, fetchPosts])
  return { user, posts }
}).pipe(
  withBoundedConcurrency(4),
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
