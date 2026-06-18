# Cooperative Concurrency Boundary

## Question

Could `fx` support alternative concurrency boundary handlers, such as a handler
that manually multiplexes the computations it manages, gives each computation a
yield budget, and queues computations that are waiting on async work?

## Current Shape

The public concurrency surface is already split into requests and policies:

- `fork` requests a `Fork` and returns a `Task`.
- `all` requests an `All`.
- `race` requests a `Race`.
- `defaultAll`, `firstSettled`, and `firstSuccess` choose structured
  concurrency result semantics.
- `bounded` and `unbounded` handle `Fork` by starting child tasks through
  `acquireAndRunFork`.

The execution boundary still lives in `src/internal/runFork.ts`.
`runFork` drives one iterator until it hits a runtime effect such as `Async`,
`Fork`, `Fail`, `HandlerCapture`, or interruption masking. For `Async`, it
starts a promise-backed `Task` and awaits it. For `Fork`, it starts another
`runFork` task behind a semaphore. The semaphore limits how many child tasks
can be running, but it does not time-slice already running computations.

This means the current scheduler is concurrency-limited, but not
yield-budgeted. A computation can monopolize its JS turn until it yields an
effect, awaits async work, returns, throws, or fails.

## Feasibility

A cooperative yield-budget scheduler is feasible, but it is not a thin
replacement for `bounded`.

The smallest honest implementation would be a sibling runtime boundary to
`runFork`, or an internal scheduler used by a boundary handler. It would manage
fibers directly:

1. Create an iterator for each child `Fx`.
2. Keep a ready queue of runnable fibers.
3. Step the fiber for up to `yieldBudget` yielded effects or resume operations.
4. If the fiber yields `Async`, start the async operation with an
   `AbortController`, remove the fiber from the ready queue, and requeue it
   when the promise settles.
5. If the fiber yields `Fork`, create a child fiber or delegate according to the
   scheduler policy.
6. If the fiber yields `Fail`, returns, throws, or is interrupted, settle the
   fiber and apply the parent policy.
7. On cancellation, run iterator `return()` and drive any cleanup effects to
   completion, preserving current finalization semantics.

That is real runtime machinery. It must preserve the behaviors currently owned
by `runFork`:

- async rejection diagnostics and `FX_AWAITED_ASYNC_FAILED`
- unhandled fork failure reporting
- `HandlerCapture` context propagation
- runtime context and trace propagation
- `Fail` handling at the runtime boundary
- interrupt masks
- `Task.interrupt(reason?)`
- scoped finalizer cleanup through iterator `return()`
- cleanup failure aggregation for `all` and `race`

The current handler machinery is generator-transforming machinery. It can
rewrite and resume a computation, but it does not expose enough control to park
multiple suspended computations, resume them later from promise callbacks, and
return `Task` handles whose lifetime is tied to a scheduler-owned fiber. That
control exists at the interpreter boundary.

## Handler Shapes

There are three plausible public shapes.

### Fork Scheduler Handler

```ts
program.pipe(defaultAll, cooperative({ concurrency: 8, yieldBudget: 64 }), runPromise)
```

This is the most compatible shape because it mirrors `bounded`. The problem is
that a `Fork` handler must still return a `Task` immediately. Returning a
scheduler-owned `Task` is possible, but only if the handler is backed by a
running scheduler loop. At that point, the handler is a facade over a scheduler
runtime, not a simple `handle(Fork, ...)` implementation like `bounded`.

This shape is attractive if the goal is a drop-in policy for existing `fork`,
`all`, and `race` programs.

### Structured-Only Handler

```ts
program.pipe(defaultAllCooperative({ concurrency: 8, yieldBudget: 64 }), runPromise)
```

This handles `All` directly without elaborating to `Fork` and `Task`. It is
smaller because `all` only needs ordered results and sibling cancellation. It
does not need to expose externally waitable `Task` handles for every child.

This is the best prototype target. It can validate the manual multiplexing loop
against one structured operation before committing to full `Fork` semantics.

The downside is that it does not help programs using explicit `fork` directly.

### New Boundary Runner

```ts
runCooperative(program.pipe(defaultAll), { concurrency: 8, yieldBudget: 64 })
```

This is the most honest architecture: a runner with a different scheduling
policy. It avoids pretending that the feature is just a normal handler.

The downside is API weight. `fx` already has `run`, `runPromise`, and `runTask`;
adding another runner should require a strong use case.

## What Yield Budget Can Mean

The budget can only count cooperative boundaries that the runtime can see:

- yielded effects
- resumes after handled effects
- resumes after async completion
- child fiber scheduling turns

It cannot preempt synchronous JavaScript inside a generator between yields.
For example, a CPU-heavy loop that does not yield remains non-preemptive. If
that matters, the program must yield an explicit scheduling effect or async
boundary. A cooperative scheduler can improve fairness among effectful
computations; it cannot make arbitrary JS code preemptible.

## Async Waiting Queue

An async wait queue fits naturally:

- A fiber yielding `Async` moves from `ready` to `waiting`.
- The async operation receives an `AbortSignal`.
- On promise fulfillment, the fiber stores the resume value and returns to
  `ready`.
- On rejection, the fiber stores the rejection and returns to `ready`, where
  the scheduler turns it into the same failure/diagnostic path as `runFork`.
- On interruption, the scheduler aborts outstanding async operations and then
  drives cleanup.

The queue should probably be FIFO at first. Priority, aging, or work-stealing
would be extra policy and should wait for concrete need.

## Risks

The biggest semantic risk is cleanup. Current interruption support has many
focused tests around iterator `return()`, scoped finalizers, async finalizers,
masked interruption, and cleanup failure aggregation. A cooperative scheduler
must pass the same class of tests or it will create a second, subtly different
runtime.

The second risk is duplicated diagnostics. `runFork` contains trace and runtime
context handling that has been optimized and tested. A separate scheduler loop
would either duplicate that logic or require extracting a lower-level
interpreter stepper. Extracting shared interpreter pieces is probably justified
only after a prototype proves the scheduling semantics are worth keeping.

The third risk is API confusion. A handler named like a normal scheduler policy
but backed by a distinct runtime may lead users to expect it to compose exactly
like `bounded`. Any public API should document whether it handles explicit
`fork`, structured `all`/`race`, or only computations run through a new
boundary.

## Recommendation

Prototype structured-only cooperative `All` first.

That prototype should:

1. Interpret the child `Fx` values directly in one scheduler loop.
2. Support `Async`, `Fail`, `HandlerCapture`, and interruption masking before
   supporting nested `Fork`.
3. Preserve ordered `all` results.
4. Cancel siblings on first child failure.
5. Drive iterator cleanup and scoped finalizers on cancellation.
6. Include tests copied in spirit from existing `Concurrent.test.ts`
   interruption/finalization cases.
7. Add one fairness test showing that children that repeatedly yield visible
   effects make progress according to the budget.

If that prototype is small and the semantics hold, the next step is deciding
whether to generalize it to a scheduler-owned `Fork` handler. If it becomes a
large copy of `runFork`, the better direction is a shared internal interpreter
stepper plus separate scheduling policies.

The feature should not start as a broad public runner. Start with one concrete
structured operation and force the runtime tradeoffs to become visible.
