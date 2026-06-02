# Cooperative Runtime Scheduler Design

Status: design note moved into the implementation worktree for
`codex/coop-runtime-scheduler-impl`.

## Goal

Make `withCoopConcurrency({ yieldBudget })` enforce a real cooperative
scheduling budget among forked `Fx` computations.

The current cooperative handler stores and decrements `yieldBudget`, but each
fork owns its own async drain loop. When a fiber exhausts its budget, that loop
continues the same fiber after a resolved promise. This yields back to the JS
microtask queue, but it does not re-enter a shared scheduler that can choose a
different ready fiber.

The stronger design is a single runtime-owned scheduler for all forks handled by
one `withCoopConcurrency` region.

## What The Budget Can Mean

`yieldBudget` can count only boundaries visible to the `Fx` interpreter:

- resuming a fiber iterator with `next` or `throw`
- yielded `Async`
- yielded `Fork`
- yielded `Fail`
- yielded interrupt-mask effects
- yielded `HandlerCapture`
- yielded ordinary effects that are delegated to outer handlers

It cannot preempt synchronous JavaScript between yields. A CPU-heavy loop inside
a generator still monopolizes the current JS turn until it yields, returns,
throws, or fails.

## Runtime Model

`withCoopConcurrency` creates one `CooperativeRuntime` per handled region. That
runtime owns:

- a FIFO ready queue
- a set or count of acquired concurrency slots
- waiters for slot availability
- fiber records for every explicit `fork` and scope-owned `forkIn` translated to
  `Fork`
- one pump loop that schedules ready fibers

Each `Fork` handler returns a `Task` immediately, but the task is backed by a
runtime-owned fiber rather than by an independent `runFork`-style loop.

## Fiber State

A fiber should have an explicit state machine:

```txt
ready -> running -> ready
ready -> running -> waiting
ready -> running -> done
waiting -> ready
waiting -> done
```

Recommended fiber fields:

- `iterator`: the child `Fx` iterator
- `resume`: the next resume action, either `next(value)` or `throw(error)`
- `status`: `ready | running | waiting | done`
- `slotAcquired`: whether this fiber currently consumes a concurrency slot
- `queued`: whether it is already present in the ready queue
- `abort`: active async abort controller, if waiting on async work
- `cancelRequested`: whether `Task.interrupt()` has requested cancellation
- `masks`: interrupt-mask state
- `done`: task result resolver
- `interrupted`: task interruption resolver
- `cleanupFailures`: failures collected while closing the iterator
- `runtimeContext` and `traceOrigin`: diagnostics and runtime context captured
  at fork creation

`queued` is important. Without it, async completion, cancellation, and slot
release can enqueue the same ready fiber more than once.

## Scheduler Loop

The scheduler pump is the only code path that runs ready fibers.

High-level loop:

```txt
while a runnable fiber exists:
  remove the next runnable fiber from the ready queue
  mark it running
  ensure it has a concurrency slot, unless it is only being cancelled
  run at most yieldBudget interpreter-visible steps
  if still runnable, mark ready and enqueue at the tail
  if waiting, leave it parked
  if done, settle the Task and release its slot
```

A fiber is runnable when:

- it is `ready`, and
- it already has a slot, or a slot is available, or it is being cancelled before
  it ever acquired a slot.

The pump should be scheduled with `queueMicrotask` when the ready queue changes.
It should avoid re-entrant execution with a `pumping` guard.

## Budget Semantics

For each scheduler turn:

1. Initialize `budget = config.yieldBudget`.
2. Resume the fiber iterator.
3. Decrement the budget for that resume.
4. Interpret the yielded boundary.
5. Continue only while the fiber remains running and `budget > 0`.
6. If the budget reaches zero and the fiber is still running, mark it `ready`
   and enqueue it at the tail.

This makes `yieldBudget: 1` a true round-robin policy over ready fibers. Larger
budgets allow locality but still bound how many interpreter-visible steps one
fiber can take before other ready fibers get a chance.

## Interpreting Yielded Values

### Async

When a fiber yields `Async`:

- create an `AbortController`
- mark the fiber `waiting`
- if the async operation is marked with `cooperativeAssertPromise`, release the
  slot while waiting
- race the async promise with active scope-exit sources when interrupts are
  unmasked
- on fulfillment, set `resume = next(value)`, mark `ready`, and enqueue
- on rejection, fail the fiber with the current `FX_AWAITED_ASYNC_FAILED`
  diagnostic shape
- on abort, mark `ready` so the pump can close the fiber in scheduler order

Async completion must enqueue the fiber into the runtime ready queue. It should
not wake a per-fiber drain loop.

### Fork

When a fiber yields `Fork`:

- create a new scheduler-owned child fiber in the same `CooperativeRuntime`
- return the child `Task` to the parent by setting the parent's `resume`
- keep the parent running until its budget expires or it yields another
  boundary that parks it

Explicit forks and `forkIn` children should therefore compete for the same
concurrency slots and the same ready queue.

### Ordinary Effects

For ordinary effects, the cooperative runtime still delegates to outer handlers
by yielding the effect from the scheduler's internal `Fx`.

This is a cooperative boundary and counts against the budget, but it is not
preemptive while the outer handler is running. If a custom handler performs a lot
of synchronous work before returning, the scheduler cannot interrupt it.

### HandlerCapture

`HandlerCapture` remains a boundary where the runtime may need to release a slot
before delegating and reacquire one before resuming. This preserves the current
handler-capture behavior and avoids deadlocks when the delegated operation waits
on scheduler-owned children.

## Slots And Concurrency

The runtime should keep `concurrency` and `yieldBudget` independent:

- `concurrency` controls how many fibers may actively run or hold unreleased
  slots.
- `yieldBudget` controls how many interpreter-visible steps a running fiber gets
  before it is requeued.

When a fiber releases a slot, the scheduler should be notified because a queued
fiber may now be runnable.

The scheduler must not spin on queued fibers when no slot is available. It can
scan the ready queue for a runnable fiber; if none exists, it stops until a slot
release, async completion, or cancellation schedules another pump.

## Scope Interaction

After PR #216, scope-owned lifetime is handled by `withScope`:

- `forkIn(scope, work)` yields `ScopedFork`.
- `withScope(scope)` translates matching `ScopedFork` to `Fork`.
- The nearest concurrency handler schedules that `Fork`.
- The scope controller records the returned `Task` and owns its lifetime.

The stronger cooperative scheduler should preserve that separation:

- `ScopeController` owns lifetime, settlement, sibling interruption, and
  finalizer ordering.
- `CooperativeRuntime` owns execution policy, slots, ready queues, async wakeup,
  and task settlement.

`ScopeController.join()` currently uses `cooperativeAssertPromise()` so a parent
waiting for owned children releases its cooperative slot. That remains valuable.
In the stronger scheduler, this means the parent scope fiber parks on async
join, releases its slot, and later re-enters the ready queue when scope children
settle.

The scheduler should not move scope lifetime logic into
`withCoopConcurrency`. Doing so would re-couple scheduling policy and lifetime
ownership.

## Cancellation And Cleanup

Cancellation should be scheduler-owned but must preserve current semantics:

- `Task.interrupt(reason)` sets `cancelRequested`.
- If the fiber is waiting on async work and interrupts are unmasked, abort the
  active async operation.
- The fiber is enqueued so the pump can close it.
- The pump calls `iterator.return()` through `withInterpretedReturn`.
- Cleanup-yielded `Async`, `Fork`, `Fail`, interrupt-mask effects, and
  `HandlerCapture` are interpreted with the same diagnostics and handler capture
  rules as today.
- Cleanup failures are collected and surfaced as `AggregateError("Resource
  release failed")`.
- The task's interrupted promise resolves only after cleanup finishes.

Cleanup does not have to be fairness-budgeted in the first implementation if
that would make finalization semantics harder to preserve. If cleanup drains to
completion as a semantic exception, the code and tests should make that explicit.

## Diagnostics And Context Invariants

The design must preserve:

- `FX_UNHANDLED_FORK_FAILURE` for unhandled task failures
- `FX_UNHANDLED_FAILURE` for unhandled `Fail` in a forked task
- `FX_UNHANDLED_EXCEPTION` for thrown exceptions in a forked task
- `FX_AWAITED_ASYNC_FAILED` for rejected async work
- existing trace parent/child frame shape for `all`, `mapAll`, `race`, and
  explicit `fork`
- runtime context propagation through fork, async, handler capture, and scope
  exit paths
- interrupt-mask behavior

These are part of the runtime contract, not incidental implementation details.

## Acceptance Tests

The first implementation should add tests that fail against the current design.

Required fairness tests:

```txt
structured all, yieldBudget 1:
A1, B1, A2, B2
```

with children that yield handled synchronous effects, not async effects.

```txt
explicit fork, yieldBudget 1:
A1, B1, A2, B2
```

again using handled synchronous effects so the test proves budget requeueing, not
Promise scheduling.

Budget contrast test:

```txt
yieldBudget 2:
A1, A2, B1, B2
```

This confirms the budget value changes scheduling behavior.

Existing behavior tests that must remain green:

- `concurrency: 1` does not deadlock nested structured children.
- Scope-owned `forkIn` join releases cooperative slots.
- Async rejection diagnostics are unchanged.
- Parent interruption aborts parked async children.
- Cleanup finalizers run for interrupted siblings.
- Cleanup failures aggregate primary failure first.
- Handler capture works both inside and outside `withCoopConcurrency`.
- Explicit fork failures remain caller-owned unless unhandled diagnostics apply.

## Implementation Phases

### Phase 1: Scheduler Skeleton

Refactor `CooperativeRuntime` to own a ready queue and pump loop. Keep existing
fiber interpretation code as intact as possible.

Expected changes:

- add ready queue and `enqueue`
- replace per-fiber `drainFork` ownership with runtime pump ownership
- make budget expiry enqueue the current fiber at the tail
- keep current async and cleanup behavior initially

### Phase 2: Async Wakeup Integration

Remove the per-fiber `Wake` queue. Async completion should call
`runtime.enqueue(fiber)`.

Expected changes:

- async fulfillment sets `resume` and enqueues
- async rejection fails the fiber and schedules settlement
- abort while waiting enqueues for cleanup
- slot release schedules the pump

### Phase 3: Cancellation And Cleanup

Move cancellation through the scheduler path and preserve `Task.interrupt()`
completion semantics.

Expected changes:

- `Task.interrupt()` marks `cancelRequested`
- waiting fibers abort and requeue
- ready/running fibers close through the pump
- interrupted promise resolves after cleanup
- cleanup failure aggregation remains unchanged

### Phase 4: Scope Regression Hardening

Run the scope-owned fork lifetime tests against the new scheduler and add any
missing tests for scope join plus budget fairness.

Expected focus:

- parent scope fiber releases slots while joining
- child `returnFrom(scope)` and `interruptFrom(scope)` still settle the shared
  scope
- scope exit races still wake parked fibers

### Phase 5: Benchmark And Trace Review

Rerun cooperative benchmarks after correctness is established. Compare:

- budget 1 fairness
- budget 8 and 64 overhead
- async fanout
- explicit fork fanout
- nested race/firstSuccess
- cleanup-heavy cases

Benchmark results should decide whether any additional public knobs are needed.

## Open Decisions

1. Should cleanup be budgeted, or explicitly drained to completion?

   Initial fit judgment: drain to completion first. Cleanup correctness matters
   more than fairness during finalization, and it matches current behavior more
   closely.

2. Should the ready queue be strict FIFO, or should async completions have a
   separate queue?

   Initial fit judgment: strict FIFO. It is simpler, easier to test, and enough
   to make `yieldBudget` honest.

3. Should the root program itself become a scheduler fiber?

   Initial fit judgment: no for this design. `withCoopConcurrency` handles
   `Fork`, not the root runner. The root program participates when it yields
   forks and waits on tasks, but the scheduler owns forked fibers only. A true
   root scheduler belongs to a separate `runCooperative` design.

4. Should `yieldBudget` count only child-visible effects, or every interpreter
   resume including internal mask and capture effects?

   Initial fit judgment: count every interpreter resume. It is simpler,
   observable in the same place, and avoids hidden unlimited internal progress.

## Non-Goals

- Do not add a new public runner.
- Do not change public `Scope` or `forkIn` APIs.
- Do not make arbitrary synchronous JavaScript preemptible.
- Do not move scope-owned lifetime into `withCoopConcurrency`.
- Do not introduce broad scheduler policy infrastructure before FIFO budget
  enforcement is correct.
