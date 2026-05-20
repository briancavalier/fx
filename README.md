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
import { consoleLog, defaultConsole } from "@briancavalier/fx/log"

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

Core primitives are exported from `@briancavalier/fx`. Optional features are
exported from named subpaths, so effect signatures stay concise:

```ts
import { tryPromise, type Async, type Fail, type Fx } from "@briancavalier/fx"

const load: Fx<Async | Fail<unknown>, string> =
  tryPromise(() => fetch("/").then(r => r.text()))
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

### Cooperative interruption

- cancellation is cooperative (disposal/abort)
- `uninterruptible` and `uninterruptibleMask` defer interruption across short
  critical sections
- masking appears as the lightweight `Interrupt` effect until a runtime
  boundary eliminates it

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

> **Model everything as effects, and compose meaning with handlers.**

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
