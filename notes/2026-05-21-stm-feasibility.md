# STM Feasibility

## Context

This note evaluates whether `fx` should add software transactional memory
(STM), using Haskell STM and effect-oriented libraries as the main reference
points.

The current `fx` concurrency surface is deliberately small:

- `Concurrent` provides `fork`, `all`, `race`, and scheduler handlers.
- `Task.interrupt(reason?)` and scoped finalization are explicit runtime
concepts.
- `Async` is the runtime boundary for awaited async work.
- `State` provides scoped, handler-owned state with `getState`, `modifyState`,
  `withState`, and `withStateInit`.

That means STM would fill a real gap: composable concurrent mutation across
multiple cells. It would also be the first feature in `fx` that needs a
separate transactional sub-runtime rather than a normal one-request/one-answer
handler.

The new scoped state effect changes the framing. STM should not be positioned
as a replacement for a removed low-level `Ref`; it should be evaluated as a
separate shared-concurrency primitive. Scoped state is local to a handled
execution and is excellent for explicit state threading through an effect
scope. STM would be for shared transactional cells observed and modified by
multiple concurrently running tasks.

## Prior Art

### Haskell

GHC's STM is built around:

- atomic blocks
- transactional variables
- `retry`
- `orElse`
- data invariants

Source: https://ghc.gitlab.haskell.org/ghc/doc/users_guide/exts/stm.html

The essential programming model is `atomically :: STM a -> IO a`: build a
transaction in the `STM` computation type, then commit it at the `IO` boundary.
`readTVar` and `writeTVar` are only available inside `STM`; the type system
keeps arbitrary `IO` out of transactions.

The `retry`/`orElse` pair is the distinctive part. `retry` abandons the current
transaction and may block until one of the read `TVar`s changes. `orElse a b`
runs `b` only when `a` explicitly retries. It does not choose the fallback just
because a commit conflict caused the runtime to rerun `a`.

The STM Haskell operational model treats successful `atomically` as one visible
step. If a transaction retries, it is aborted and queued for later execution.
For `orElse`, if the first branch retries, its effects are discarded and the
second branch runs against the original heap.

Source: https://www.microsoft.com/en-us/research/wp-content/uploads/2009/01/stm-haskell09.pdf

### Haskell effect libraries

The `effectful` library does not reimplement STM as an algebraic effect. It
lifts GHC STM into the effect system:

```hs
atomically :: Concurrent :> es => STM a -> Eff es a
retry :: STM a
orElse :: STM a -> STM a -> STM a
```

Its docs preserve the Haskell separation: transactions are still `STM a`, while
`atomically` is the bridge into `Eff`.

Source: https://hackage-content.haskell.org/package/effectful-2.6.1.0/docs/Effectful-Concurrent-STM.html

This is the most relevant precedent for `fx`: do not model each TVar operation
as an ordinary resumable effect in the main effect row. Use a separate
transactional computation type, then expose a small bridge into `Fx`.

### Effect / Effect-TS

Effect's STM has its own type:

```ts
STM<A, E, R>
commit: <A, E, R>(self: STM<A, E, R>) => Effect<A, E, R>
```

The docs describe STM as a technique for composing arbitrary atomic operations
and state that the API is lifted from Haskell's `Control.Concurrent.STM`, even
though the implementation is different.

Source: https://effect-ts.github.io/effect/effect/STM.ts.html

This reinforces the same architectural point: STM is a sibling computation
model that can be committed into the main effect system, not merely another
ordinary effect handled by user handlers.

### Arrow FX STM

Arrow's STM is also Haskell-shaped: `TVar`, `retry`, `orElse`, and `catch`.
Its guide emphasizes that a transaction is only a description until it is run
with `atomically`, and that STM protects multi-`TVar` updates from deadlocks,
race conditions, and intermediate states.

Source: https://arrow-kt.io/learn/coroutines/stm/

Arrow also calls out an important safety boundary: ordinary Kotlin
`try/catch` does not roll back state changes in a transaction; STM-specific
`catch` is needed. The same issue would apply in TypeScript if `fx` allowed
ordinary JS exceptions or arbitrary `Fx` effects inside transactions.

### Algebraic effects languages

Eff presents algebraic effects as a way to reinterpret state and even group
state modifications in transactions.

Source: https://www.eff-lang.org/

Effekt's public tour shows the general handler model: operations request
behavior from the nearest handler, and resumptive handlers can decide whether
to resume the suspended continuation.

Source: https://effekt-lang.org/tour/effects

These languages show that transaction-like behavior can be expressed with
handlers in principle. They do not remove the hard part for `fx`: real
concurrent STM needs conflict detection, read/write logs, waiting/wakeup, and
rerun semantics. That machinery lives below the surface handler syntax.

## What STM Would Add To `fx`

STM would add a capability that scoped state intentionally does not provide:
atomic coordination over shared state across concurrent tasks.

Scoped state already improves the local-state story. For example, a session,
accumulator, or interpreter state can be modeled as named scoped operations:

```ts
const SessionState = brand<Stateful<Session>>()('example/SessionState')

const recordRequest = (route: string) =>
  modifyState(SessionState, session => [
    { requests: session.requests + 1, lastRoute: route },
    session.requests + 1
  ] as const)
```

That is the right abstraction when one handler owns the state for one
execution. It does not solve the same problem as STM. If multiple forked tasks
need to coordinate through shared mutable cells, scoped state gives each
handled execution local handler state unless a handler intentionally closes
over shared mutable storage. Once a handler closes over shared mutable storage,
the programmer is back to designing concurrency control manually.

STM would target cases such as:

- two-account transfer
- bounded queues
- work-stealing or pending-work registries
- cache entry state machines
- coordinated request deduplication
- "wait until a condition over multiple cells holds"

With STM, those become atomic, composable transactions:

```ts
const transfer = (from: TVar<number>, to: TVar<number>, amount: number) =>
  stm(function* () {
    const balance = yield* readTVar(from)
    yield* check(balance >= amount)
    yield* writeTVar(from, balance - amount)
    yield* modifyTVar(to, n => n + amount)
  })
```

Then the `Fx` boundary would look like:

```ts
yield* atomically(transfer(a, b, 10))
```

The key value is compositional blocking. `retry` lets a transaction say "the
state I observed is not ready; wake me when any relevant cell changes", and
`orElse` lets transactions define fallback choices without introducing locks or
explicit condition variables.

## Feasible Shape

A minimal `fx` design should follow Haskell/effectful/Effect rather than making
`readTVar` a normal `Fx` effect. It should also not be implemented as a thin
handler wrapper around `getState` and `modifyState`.

Likely public surface:

```ts
export interface STM<E, A> {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

export class TVar<A> {
  constructor(initial: A)
}

export const stm: <E, A>(f: () => Generator<E, A>) => STM<E, A>
export const atomically: <E, A>(tx: STM<E, A>) => Fx<Async | Fail<E>, A>

export const readTVar: <A>(tvar: TVar<A>) => STM<never, A>
export const writeTVar: <A>(tvar: TVar<A>, value: A) => STM<never, void>
export const modifyTVar: <A>(tvar: TVar<A>, f: (a: A) => A) => STM<never, void>
export const retry: STM<never, never>
export const check: (condition: boolean) => STM<never, void>
export const orElse: <E1, A, E2, B>(left: STM<E1, A>, right: STM<E2, B>) => STM<E1 | E2, A | B>
export const failSTM: <E>(error: E) => STM<E, never>
export const catchSTM: ...
```

Important constraints:

- `STM` should be separate from `Fx`, at least initially.
- `atomically` is the only bridge into `Fx`.
- `STM` should not allow arbitrary `Async`, `Fork`, `Fail`, or user effects
  inside transactions.
- `STM` should not reuse the scoped `State` handler semantics for transaction
  storage. Transactional variables need identity, versioning, read/write logs,
  waiter registration, and rollback.
- Recoverable transaction failures should be STM-local and committed into
  `Fx<Fail<E>, A>` only at `atomically`.
- JS `throw` inside STM should be treated as an unsafe hard failure or converted
  through a clearly named STM constructor, not treated like rollback-safe
  recoverable failure.

## Runtime Model

A plausible internal model:

- `TVar<A>` stores `{ value, version, waiters }`.
- Each transaction attempt has a read set and write set.
- `readTVar` returns the staged write if present, otherwise records
  `{ tvar, value, version }`.
- `writeTVar` records a staged write without mutating the cell.
- Commit validates that every read `TVar` still has the recorded version, then
  applies writes and increments versions.
- Commit conflicts rerun the transaction immediately or after yielding.
- Explicit `retry` validates the read set, registers a waiter on each read
  `TVar`, and suspends until one is written.
- `orElse` runs the left branch in a nested transaction log. If it retries,
  discard that log and run the right branch against the original parent log.
  If both retry, the combined read set determines wakeup.

Because JavaScript is single-threaded within one event loop, commit can be
synchronous and does not need low-level locks. The value is not CPU-thread
parallelism; it is safe coordination among interleaved async tasks.

`atomically` probably needs to be an `Async` effect because `retry` may suspend.
It also needs to observe `AbortSignal`/task interruption so a task blocked on
`retry` can unregister its waiters and run normal `fx` cleanup. This is the
main place STM must integrate with the recent `Task.interrupt(reason?)` runtime
direction.

## Fit With `fx`

Good fit:

- It is a concrete concurrency primitive, not a service container or dependency
  graph.
- It complements scoped state by covering shared concurrent state rather than
  local handler-owned state.
- It pairs naturally with structured concurrency: many tasks can coordinate
  through transactional variables while `all`/`race` still own task lifetime.
- A separate `STM` type keeps transaction reruns and rollback explicit.

Poor fit if designed as:

- ambient mutable context
- ordinary effect handlers around scoped state
- a generic dependency/capability layer
- a database transaction abstraction
- a way to run arbitrary effects atomically

STM is valuable only if it stays narrow: in-memory transactional variables for
coordinating concurrent `fx` tasks.

## Risks

### Rerunning effects

STM may rerun a transaction many times. Any side effect inside the transaction
would be duplicated or rolled back incorrectly. This is why `STM` must not be
just `Fx` plus a handler.

### Blocking and interruption

`retry` can suspend forever if no read `TVar` changes. In `fx`, a blocked
transaction must be interruptible and must unregister waiters. This needs
focused tests around `Task.interrupt`, `race`, `all`, and scoped finalizers.

### Fairness

Naive wake-all can be correct but noisy. Sophisticated fairness is likely not
needed for a first slice, but starvation and retry storms should be documented.

### Type surface

`STM<E, A>` adds another computation type next to `Fx<E, A>`. That is justified
only if the boundary is very clear and the API remains small.

### Memory leaks

Waiter registration for `retry` is easy to leak on interruption, failure, or
successful wakeup unless cleanup is centralized.

### Semantic mismatch with scoped state

Scoped state is immediate handler-local state transformation. `TVar` should not
reuse the `State` API directly because staged writes, rollback, conflict
validation, and retry wakeups are different semantics.

There may be naming symmetry, but the ownership model is different:

- scoped state belongs to a named effect scope and is handled by `withState`
- transactional state belongs to explicit `TVar` identities and is committed by
  `atomically`

## Recommendation

STM is feasible and potentially valuable, but it should not be added as a broad
feature yet. The right next step is a small internal prototype with one concrete
teaching example and interruption tests.

Prototype scope:

1. Add an internal `STM` interpreter and `TVar`.
2. Support `readTVar`, `writeTVar`, `modifyTVar`, `retry`, `check`, `orElse`,
   and `atomically`.
3. Keep it out of package exports initially, or expose only through a draft
   subpath in the prototype worktree.
4. Prove:
   - atomic multi-`TVar` transfer
   - commit conflict reruns without intermediate states
   - `retry` blocks and wakes on relevant writes
   - `orElse` discards left-branch writes when left retries
   - blocked `atomically` is interrupted cleanly
   - transaction-local failure rolls back writes
5. Compare ergonomics against a scoped-state implementation and explain why the
   scoped-state version either cannot share state safely across tasks or must
   add its own concurrency-control machinery.

Do not prototype:

- transactional queues beyond what is needed for tests
- invariants
- priorities/fairness policy
- nested `atomically`
- arbitrary `Fx` effects inside `STM`
- database-backed transactions

If the prototype stays small and the examples cover real shared-concurrency
cases that scoped state does not cover cleanly, STM is a good candidate for a
curated `@briancavalier/fx/stm` subpath. If the prototype needs broad runtime
machinery or effect capture to feel useful, it is probably too heavy for `fx`
right now.

## Bottom Line

The value is real for async task coordination, especially multi-cell state and
condition-based blocking. The feasible design is not "STM as another handler";
it is "STM as a small separate transaction DSL with `atomically` as the `Fx`
boundary." That is consistent with Haskell, Haskell effect libraries, and
Effect-style TypeScript, and it preserves `fx`'s preference for explicit,
minimal runtime boundaries.
