# fx

A small, strongly typed, **scope-centered algebraic runtime** for TypeScript.

`fx` lets programs describe operations, delimit their meaning with named scopes,
and interpret those operations later with handlers.

---

## Why fx?

Typical TypeScript apps mix:

- business logic  
- I/O (DB, HTTP, logging)  
- concurrency  
- dependency wiring  

Most solutions rely on dependency injection or implicit runtime behavior.

`fx` takes a different approach:

> **Programs describe operations. Named scopes define dynamic regions of meaning. Handlers define semantics.**

---

## Core idea

Programs are generator computations:

```ts
Fx<E, A>
```

- `A` = result
- `E` = effects the program may perform

Effects keep required operations visible in the type until handlers eliminate
them:

```ts
yield* consoleLog("hello")
yield* Db.query("select * from users")
yield* fail(new Error("boom"))
yield* fork(otherProgram)
```

Named scopes add an ownership boundary around effects whose meaning depends on a
dynamic region. A scope can own cleanup, interruption, early return, yielding,
and recovery boundaries.

Handlers progressively eliminate effects until the program can run.

---

## Why named scopes?

Many application concerns are not just dependencies. They are regions of
execution:

- a request lifetime that may be interrupted
- a resource lifetime that must be finalized
- a timeout boundary where callers choose the recovery policy
- a progress or event channel that receives yielded values
- a concurrent group that must clean up cancelled work
- a parser or workflow step that may return early

In `fx`, these regions are named scopes. Scope names make ownership explicit
without introducing service containers, global runtimes, or framework wiring.

---

## Example

Application logic performs operations. Handlers decide what those operations
mean:

```ts
import { consoleLog, defaultConsole, fx, handle, runPromise } from "@briancavalier/fx"

const getUser = fx(function* () {
  yield* consoleLog("fetching user")

  const user = yield* Db.query(
    "select * from users where id = ?",
    [1]
  )

  return user
})

const program =
  getUser.pipe(
    handle(DbQuery, ({ arg: { sql, params } }) => runQuery(sql, params)),
    defaultConsole,
    runPromise
  )
```

Scopes let lifecycle semantics stay explicit too. An operation timeout uses a
private scope for the operation, scoped finalizers observe how the operation
exited, and the caller chooses how to recover:

```ts
import {
  assert as assertNoFail,
  consoleLog,
  control,
  defaultConsole,
  fx,
  runPromise
} from "@briancavalier/fx"
import { withUnboundedConcurrency } from "@briancavalier/fx/concurrent"
import { andFinallyExit, InterruptFrom, scope, withScope } from "@briancavalier/fx/scope"
import { defaultTime, sleep } from "@briancavalier/fx/time"
import { timeout, timeoutIn } from "@briancavalier/fx/timeout"

const RequestScope = scope("request")

const loadUser = fx(function* () {
  yield* andFinallyExit(RequestScope, exit =>
    consoleLog(`request cleanup after ${exit.type}`)
  )

  yield* sleep(1000)
  return { id: 1, name: "Ada" }
})

const program = fx(function* () {
  const user = yield* loadUser.pipe(
    timeout({ ms: 500, label: "load user" })
  )

  yield* consoleLog("loaded user", user)
})

await program.pipe(
  withScope(RequestScope),
  control(InterruptFrom, () => consoleLog("request timed out")),
  defaultTime,
  withUnboundedConcurrency,
  defaultConsole,
  assertNoFail,
  runPromise
)
```

Use `timeoutIn(scope, options)` when the deadline belongs to a caller-owned
scope rather than one operation:

```ts
const request = fx(function* () {
  yield* timeoutIn(RequestScope, { ms: 500, label: "request deadline" })
  return yield* loadUser
})
```

Core primitives are exported from `@briancavalier/fx`. Optional features are
exported from named subpaths, so effect signatures stay concise:

```ts
import { tryPromise, type Async, type Fail, type Fx } from "@briancavalier/fx"

const load: Fx<Async | Fail<unknown>, string> =
  tryPromise(() => fetch("/").then(r => r.text()))
```

Use one import rule: core program construction, handling, failure, async
boundaries, env, tasks, interrupts, console, and basic diagnostics come from
`@briancavalier/fx`; optional feature areas and advanced trace tools come from
their named subpaths.

| Capability | Import from |
| --- | --- |
| Core programs, effects, handlers, failure, async, env, task, console, basic diagnostics | `@briancavalier/fx` |
| Encoding and decoding external data with branded codec keys | `@briancavalier/fx/codec` |
| Advanced trace capture, snapshots, and trace formatting options | `@briancavalier/fx/trace` |
| Named scopes, abort, finalization, early return, scoped yielding | `@briancavalier/fx/scope` |
| Sinks for receiving values | `@briancavalier/fx/sink` |
| Scoped mutable state operations | `@briancavalier/fx/state` |
| Structured concurrency | `@briancavalier/fx/concurrent` |
| Time and clock handlers | `@briancavalier/fx/time` |
| Random effects and handlers | `@briancavalier/fx/random` |
| Structured logging | `@briancavalier/fx/log` |
| Retry and timeout policies | `@briancavalier/fx/retry`, `@briancavalier/fx/timeout` |
| HTTP client and transport-neutral HTTP server routes | `@briancavalier/fx/http-client`, `@briancavalier/fx/http-server` |
| Node runtime, process, diagnostics, and HTTP transport | `@briancavalier/fx/platform-node` |

---

## Design philosophy

### Operations over dependencies

There are no privileged concepts like services or environments.

Logging, DB access, concurrency, failure, resource management, and lifecycle
control are all operations that programs can request and handlers can interpret.

---

### Programs describe behavior, not dependencies

Application code performs operations:

```ts
yield* Db.query(...)
yield* consoleLog(...)
yield* yieldFrom(ProgressEvents, event)
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

- **Typed algebraic effects**
  Programs expose the operations they may perform as `Fx<E, A>`

- **Named scopes**
  Scopes delimit lifecycle, cleanup, interruption, early return, and yielding

- **Composable handlers**  
  Handlers remove effects and can introduce new ones

- **Structured concurrency**  
  `Fork`, `Task`, `all`, and `race` provide owned, composable concurrency

- **Guaranteed finalization**
  Finalizers run when a scope succeeds, fails, returns, aborts, or is interrupted

- **Scoped yielding**
  Programs emit values to named channels with `yieldFrom`

- **External data boundaries**
  Branded codec keys keep parsing, serialization, and validation explicit
  without coupling reusable programs to a schema library

- **Explicit runtime boundaries**
  Async, platform, HTTP, time, random, trace, and Node behavior are interpreted
  by handlers near the place a program runs

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
- scopes define **ownership boundaries**
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

### Cooperative interruption

- interruption is cooperative and scope-aware
- `uninterruptible` and `uninterruptibleMask` defer interruption across short
  critical sections
- masking appears as the lightweight `Interrupt` effect until a runtime
  boundary eliminates it
- scoped interruption gives finalizers the reason the scope exited

**Tradeoff:**
- simple runtime-owned interruption model
- uninterruptible regions must remain small to avoid delaying cancellation

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

> **Model operations as effects, delimit their meaning with named scopes, and compose interpretation with handlers.**

This leads to:

- very clean program structure  
- strong composability  
- a small but powerful core  

…but also:

- fewer built-in guarantees  
- more responsibility on the developer  

---

## References

The design of `fx` follows a few active threads in the algebraic effects literature:
separating effect syntax from handler semantics, keeping effect requirements visible
in types, and using explicit handler capture for higher-order effects such as retry,
forking, resource management, and local interpretation.

- Gordon Plotkin and Matija Pretnar, [Handlers of Algebraic Effects](https://doi.org/10.1007/978-3-642-00590-9_7), ESOP 2009.  
  The foundational handler model: computations perform operations, and handlers
  interpret those operations modularly.

- Andrej Bauer and Matija Pretnar, [Programming with Algebraic Effects and Handlers](https://doi.org/10.1016/j.jlamp.2014.02.001), Journal of Logical and Algebraic Methods in Programming, 2015.  
  Describes Eff and the practical programming model of first-class effects and
  composable handlers.

- Matija Pretnar, [An Introduction to Algebraic Effects and Handlers](https://doi.org/10.1016/j.entcs.2015.12.003), Electronic Notes in Theoretical Computer Science, 2015.  
  A compact tutorial covering operational semantics, type-and-effect systems, and
  reasoning principles.

- Daan Leijen, [Koka: Programming with Row Polymorphic Effect Types](https://www.microsoft.com/en-us/research/publication/koka-programming-with-row-polymorphic-effect-types/), MSR-TR-2013-79, 2013.  
  Motivates precise effect rows, effect polymorphism, and safe local state
  encapsulation through typed effect elimination.

- Daan Leijen, [Structured Asynchrony with Algebraic Effects](https://www.microsoft.com/en-us/research/publication/structured-asynchrony-algebraic-effects/), MSR-TR-2017-21, 2017.  
  Shows how async, cancellation, timeout, and block-scoped concurrency can be
  expressed as library-level algebraic effects.

- Lukas Convent, Sam Lindley, Conor McBride, and Craig McLaughlin, [Doo bee doo bee doo](https://doi.org/10.1017/S0956796820000039), Journal of Functional Programming, 2020.  
  Presents Frank, where handlers are interpreters for statically tracked commands
  and effect typing supports encapsulation without effect pollution.

- Jonathan Immanuel Brachthäuser, Philipp Schuster, and Klaus Ostermann, [Effekt: Capability-Passing Style for Type- and Effect-Safe, Extensible Effect Handlers in Scala](https://doi.org/10.1017/S0956796820000027), Journal of Functional Programming, 2020.  
  Supports the idea that scoped access to handlers can be represented by explicit
  capabilities while preserving effect safety and effect polymorphism.

- Jonathan Immanuel Brachthäuser, Philipp Schuster, and Klaus Ostermann, [Effects as Capabilities: Effect Handlers and Lightweight Effect Polymorphism](https://doi.org/10.1145/3428194), OOPSLA 2020.  
  Reframes effect types as contextual requirements, closely matching `Fx<E, A>` as
  a program requiring handlers for `E`.

- Zhixuan Yang, Marco Paviotti, Nicolas Wu, Birthe van den Berg, and Tom Schrijvers, [Structured Handling of Scoped Effects](https://zenodo.org/records/5914134), ESOP 2022.  
  Gives a principled model for scoped operations, addressing effects whose meaning
  depends on a delimited dynamic region.

- Roger Bosman, Birthe van den Berg, Wenhao Tang, and Tom Schrijvers, [A Calculus for Scoped Effects & Handlers](https://doi.org/10.46298/lmcs-20(4:17)2024), Logical Methods in Computer Science, 2024.  
  Formalizes why effects that create or delimit scopes need more structure than
  ordinary algebraic operations.

- Marius Müller, Philipp Schuster, Jonathan Lindegaard Starup, Klaus Ostermann, and Jonathan Immanuel Brachthäuser, [From Capabilities to Regions: Enabling Efficient Compilation of Lexical Effect Handlers](https://doi.org/10.1145/3622831), OOPSLA 2023.  
  Connects capability-based handlers with explicit regions, supporting the
  direction of named handler capture and region-local interpretation.

- Cristina Matache, Sam Lindley, Sean Moss, Sam Staton, Nicolas Wu, and Zhixuan Yang, [Scoped Effects, Scoped Operations, and Parameterized Algebraic Theories](https://doi.org/10.1145/3731678), ACM Transactions on Programming Languages and Systems, 2025.  
  Recent state of the art on scoped effects, including dynamically allocated
  resources and delimited scopes.
