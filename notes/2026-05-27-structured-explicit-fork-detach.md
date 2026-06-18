# Structured Explicit Forks and Detach

## Question

Explicit `fork` currently participates in concurrency handlers only partially.
`withBoundedConcurrency` and `withUnboundedConcurrency` start forked work through
the shared runtime semaphore, and `withCoopConcurrency` starts scheduler-owned
fibers. In both cases the caller receives a `Task` handle, and the fork can
outlive the computation that created it unless the caller waits for or
interrupts that task.

Could explicit forks be fully owned by the concurrency handler by default, with
an explicit way to detach a fork when the caller wants to assume responsibility
for its lifetime and finalization?

## Current Shape

`fork` is documented as the handle-based form of concurrency. It returns a
`Task`, and `forkEach` says the caller owns each returned task and decides when
to wait for or interrupt it.

The fork-backed handlers already manage some important runtime details:

- `withBoundedConcurrency` handles `Fork` by calling `acquireAndRunFork` with a
  shared semaphore.
- `runFork` tracks active child tasks in `InterruptState`.
- Interrupting the parent runtime interrupts tracked active tasks.
- Structured operations such as `all` and `race` convert child computations into
  tasks, mark those tasks handled, and then use `InterruptAll` to interrupt all
  children after success, failure, or race completion.

`withCoopConcurrency` has a stronger scheduler boundary. It creates explicit
forks as scheduler fibers, shares concurrency slots between explicit forks and
structured children, and can interrupt queued forks before they start. However,
explicit fork lifetime is still represented by the returned `Task`; a fork is
not treated as a lexical child that must complete before the handler scope exits.

## Semantic Gap

The current model answers this question as:

```ts
const task = yield* fork(work)
// caller now owns task
```

A fully structured model would answer it as:

```ts
const task = yield* fork(work)
// concurrency scope owns task unless caller detaches it
```

That is a semantic change. It would make `fork` closer to a scoped child fiber:
the concurrency handler would need to remember every attached task it creates,
wait for or interrupt those tasks when the handler scope exits, and aggregate
cleanup failures through the same paths used by structured `all` and `race`.

The upside is stronger safety. A caller could not accidentally leak a forked
computation by returning without waiting or interrupting it. Unhandled fork
failures and finalization would stay inside the concurrency boundary.

The cost is that some existing fire-and-return uses of `fork` would now keep the
parent computation alive or be interrupted at scope exit. That is usually the
right structured-concurrency default, but it changes the meaning of the current
public docs.

## API Shapes

### Attached by default with explicit detach

```ts
const task = yield* fork(work)
const detached = yield* detach(task)
```

This is the cleanest structured-concurrency story. It makes the safe behavior
the default and makes lifetime escape visible at the call site.

The challenge is typing and runtime ownership. `detach(task)` would need to be a
new effect handled by the same concurrency boundary that owns the task. A plain
method like `task.detach()` would hide cross-cutting ownership behavior inside
`Task`, and `Task` currently does not know which handler-owned task set owns it.

### Separate fork constructors

```ts
const task = yield* fork(work)
const detached = yield* forkDetached(work)
```

This avoids mutating ownership after creation. It is easy to explain and easy to
type: `fork` means attached child, `forkDetached` means caller-owned task.

The downside is migration churn. It changes the meaning of the existing `fork`
docs, and it may require renaming the current behavior to keep compatibility.
For an unreleased API this may be acceptable; for compatibility, a staged path
could introduce `forkScoped` first and decide later whether it should become
`fork`.

### Structured nursery

```ts
yield* forkIn(scope, work)
```

This keeps current `fork` behavior and adds an explicit nursery-like API for
attached forks. It is conservative, but it leaves the footgun as the default and
duplicates some of `all` and `race`'s structured ownership story.

This shape only seems worthwhile if preserving current `fork` semantics matters
more than making structured concurrency the default.

## Implementation Direction

The smallest coherent implementation is an internal handler-owned task set,
separate from `Task` itself.

For `withBoundedConcurrency`, the handler would create an ownership record when
handling a `Fork`:

1. Start the task through `acquireAndRunFork`.
2. Add the task to the handler-owned attached set.
3. Remove it from the set when the task settles.
4. Mark failures as unhandled unless the task is waited, interrupted, detached,
   or the owning handler is already shutting down.
5. On normal handler exit, either wait for attached tasks or interrupt them,
   depending on the chosen semantics.
6. On handler failure or interruption, interrupt attached tasks and aggregate
   cleanup failures.

The important design choice is step 5:

- A nursery usually waits for attached children on normal exit.
- `all` and `race` interrupt remaining children after the policy reaches an
  outcome.

For explicit `fork`, waiting on normal exit is the more useful default. It lets a
parent fork background work and then return after the child finishes. Failure,
interruption, or early scope exit should interrupt attached children.

For `withCoopConcurrency`, the same concept belongs in `CooperativeRuntime`.
`startFork` already owns a `Fiber` and returns a `Task`; it would need to
register attached fibers in a runtime-owned set. Detach would remove the fiber
from that set without interrupting it. The runtime must still share slots with
detached fibers until they finish, unless detach also means moving the task to a
separate unbounded runtime, which would be a much larger semantic jump.

## Detach Semantics

Detach should be explicit and narrow:

- Detaching removes the task from the handler-owned attached set.
- The returned task remains interruptible by the caller.
- The caller becomes responsible for `wait(task)` or `task.interrupt(reason)`.
- The concurrency handler no longer waits for the task on normal exit.
- The concurrency handler no longer interrupts the task on scope exit solely
  because it was originally forked inside that scope.
- If the detached task fails unhandled, the existing unhandled fork diagnostic
  path should still report it unless the caller marked it handled.

Detach should not be a method on `Task` unless `Task` grows a small internal
owner hook. A `Detach` effect is more explicit and keeps ownership in the
concurrency boundary:

```ts
const task = yield* fork(work)
return yield* detach(task)
```

If the task is not owned by the current concurrency handler, `detach(task)` could
be a no-op, or it could fail with a diagnostic `Fail`. A no-op is simpler, but a
diagnostic failure catches mismatched handler boundaries. The stricter behavior
is better if this becomes public API.

## Risks

The main risk is a deadlock-like lifecycle surprise with bounded concurrency.
If attached forks wait on normal handler exit while holding semaphore slots, a
parent that returns before releasing enough slots can block later attached work.
Existing nested concurrency tests already show that low bounds can deadlock when
outer and inner work share a budget. Attached explicit forks would make that
tradeoff more visible.

The second risk is duplicating cleanup behavior. `taskAll`, `taskRace`, and
`taskFirstSuccess` already aggregate cleanup failures through `InterruptAll`.
A handler-level attached task set should reuse that kind of logic rather than
inventing a second cleanup aggregation path.

The third risk is public API confusion. Today `fork` means caller-owned. If
`fork` becomes attached-by-default, docs and examples need to be updated
together, especially examples that intentionally keep a returned task alive.

## Recommendation

The direction is feasible and coherent, but it should be treated as a semantic
cleanup to explicit fork ownership, not as a small fix.

The best end state is:

- `fork` creates an attached child task by default.
- `detach(task)` transfers lifetime responsibility to the caller.
- `forkEach` either returns attached tasks or is renamed/supplemented so detached
  bulk forking is visibly different.
- `all` and `race` remain the result-oriented structured APIs.
- `Task` stays a lifecycle handle, not an owner of concurrency-scope membership.

The best prototype is narrow:

1. Implement attached task tracking for `withBoundedConcurrency`.
2. Add `detach(task)` as an internal/public effect handled by the concurrency
   handler.
3. On normal handler exit, wait for attached explicit forks.
4. On failure/interruption, interrupt attached explicit forks.
5. Add tests for normal waiting, failure cleanup, interruption finalization,
   detach escape, unhandled detached failure, and bounded queued forks.
6. Only after that works, port the same ownership rule to `withCoopConcurrency`.

This keeps the first prototype close to existing `acquireAndRunFork`,
`InterruptState`, and `InterruptAll` behavior before touching the cooperative
scheduler.
