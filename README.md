# fx

A small, strongly-typed **algebraic effects and handlers** system for TypeScript.

`fx` lets you write programs in terms of *what they do* (effects), and interpret them later with *how they do it* (handlers).

---

## Why fx?

Typical TypeScript apps mix:

- business logic  
- I/O (DB, HTTP, logging)  
- concurrency  
- dependency wiring  

Most solutions rely on dependency injection or implicit runtime behavior.

`fx` takes a different approach:

> **Programs describe operations. Handlers define semantics.**

---

## Core idea

Everything is an effect.

```ts
yield* log("hello")
yield* Db.query("select * from users")
yield* fail(new Error("boom"))
yield* fork(otherProgram)
```

A program is:

```ts
Fx<E, A>
```

- `A` = result  
- `E` = effects it may perform  

Handlers progressively eliminate effects until the program can run.

---

## Example

```ts
import { fx, handle, runPromise } from "@briancavalier/fx"
import { defaultConsole, log } from "@briancavalier/fx/Console"

const getUser = fx(function* () {
  yield* log("fetching user")

  const user = yield* Db.query(
    "select * from users where id = ?",
    [1]
  )

  return user
})

const program =
  getUser.pipe(
    handle(DbQuery, ({ sql, params }) => runQuery(sql, params)),
    defaultConsole,
    runPromise
  )
```

Core primitives are exported from `@briancavalier/fx`. Built-in effects are
exported from named subpaths, so effect signatures stay concise:

```ts
import { Fx, fx, runPromise } from "@briancavalier/fx"
import { Async, tryPromise } from "@briancavalier/fx/Async"
import { defaultTime, sleep } from "@briancavalier/fx/Time"

const load: Fx<Async, string> = tryPromise(() => fetch("/").then(r => r.text()))
```

---

## Design philosophy

### Everything is an effect

There are no privileged concepts like services or environments.

Logging, DB access, concurrency, failure, and resource management are all effects.

---

### Programs describe behavior, not dependencies

Application code performs operations:

```ts
yield* Db.query(...)
```

It does not request services.

---

### Handlers are just functions

A handler is essentially:

```ts
Fx<E1, A> → Fx<E2, A>
```

So handler composition is just function composition:

```ts
program.pipe(
  handlerA,
  handlerB,
  handlerC
)
```

No container, no wiring graph—just a pipeline.

---

## Key features

- **Algebraic effects with static typing**  
  Effects are explicit in `Fx<E, A>`

- **Composable handlers**  
  Handlers remove effects and can introduce new ones

- **Structured concurrency**  
  `Fork` and `Task` provide owned, composable concurrency

- **Resource safety**  
  `bracket` and `Scope` ensure cleanup

- **Async stack traces**  
  Logical stacks across async and fork boundaries

---

## Design tradeoffs

`fx` intentionally stays minimal. Some “missing features” are deliberate design choices.

---

### No dependency graph abstraction

There is no built-in concept of:
- services  
- layers  
- dependency injection  

Instead:
- programs express **operations**  
- handlers provide **interpretations**

**Tradeoff:**
- simpler, more uniform model  
- but large systems require discipline in organizing handlers

---

### Minimal runtime

The runtime is small and focused:
- no scheduler framework  
- no supervision system  
- no built-in observability stack  

**Tradeoff:**
- easy to understand and reason about  
- but fewer out-of-the-box capabilities

---

### No first-class interruption semantics (yet)

- cancellation is cooperative (disposal/abort)  
- no masking (`uninterruptible`, etc.)

**Tradeoff:**
- simpler model  
- but weaker guarantees under complex concurrency

---

### Simple failure model

Failures are values:

```ts
Fail<E>
```

No built-in support for:
- parallel failure aggregation  
- causal chains  
- defect vs interruption distinction  

**Tradeoff:**
- easy to understand  
- but less expressive in complex workflows

---

### Some guarantees rely on discipline

Because the core is minimal:
- some safety properties are cooperative  
- misuse is possible without care  

---

## Summary

`fx` explores a simple idea:

> **Model everything as effects, and compose meaning with handlers.**

This leads to:

- very clean program structure  
- strong composability  
- a small but powerful core  

…but also:

- fewer built-in guarantees  
- more responsibility on the developer  
