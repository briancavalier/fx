# Timeout Timers And Unmetered Daemon Forks

## Question

`timeout()` and `timeoutIn()` schedule timer work as scope-owned daemon forks.
That preserves lifetime semantics: the timer belongs to the target scope, can
interrupt that scope, and does not keep the scope alive after normal
completion.

After PR 216, bounded fork scheduling exposes a liveness problem. With
`withBoundedConcurrency(1)`, the protected computation can acquire the only
fork permit and then park in async work such as `sleep`. The internal timeout
timer is queued behind the same permit, so it never starts and cannot interrupt
the protected computation.

Should timer work be detached from concurrency permits?

## Current Shape

`timeout()` builds a private scope and starts two scope-owned forks:

1. The protected computation, wrapped in `attempt(...)`, returns from the
   private scope when it completes.
2. The timer sleeps for the configured duration, then interrupts the same
   scope with the timeout reason.

`timeoutIn(scope, options)` schedules only the second piece for a caller-owned
scope. The timer is represented as:

```ts
new ScopedFork(scope, { fx, ...traceOrigin, daemon: true })
```

The `daemon` flag is a lifetime flag. It means the timer can interrupt the
scope, but it does not keep a normally completing scope alive. It does not
currently affect scheduling.

`withBoundedConcurrency` handles all `Fork` requests by calling
`acquireAndRunFork` with the same semaphore. `withCoopConcurrency` similarly
shares its `concurrency` slots across structured children and explicit forks.
Neither handler distinguishes user work from internal timer work.

## Failure Mode

This should time out:

```ts
sleep(100).pipe(
  timeout({ ms: 10 }),
  withBoundedConcurrency(1)
)
```

Instead, the protected computation starts first and consumes the only permit.
The timer fork is queued. Advancing the clock to 10ms does not help because the
timer has not started its `sleep(10)` yet. The timeout cannot win until the
protected computation releases the permit, which is exactly the work the
timeout is supposed to bound.

This is not just ordering. Scheduling the timer before the protected
computation would make fast computations wait behind their own timeout timer
under `withBoundedConcurrency(1)`. A timeout timer must be able to run
independently of the work it is bounding.

## Proposed Direction

Add a scheduling mode for forked work:

```ts
type ForkScheduling = 'metered' | 'unmetered'

interface ForkContext extends TraceOrigin {
  readonly fx: Fx<unknown, unknown>
  readonly scheduling?: ForkScheduling
}
```

The semantics should be narrow and explicit:

- `scheduling: 'metered'` is the default and consumes normal bounded or
  cooperative concurrency admission.
- `scheduling: 'unmetered'` skips concurrency admission, but keeps normal task
  lifetime, interruption, cleanup, failure, trace, and handler-capture behavior.

`timeoutInWithTrace` should mark its internal timer fork as a daemon with
unmetered scheduling:

```ts
new ScopedFork(scope, {
  fx,
  ...traceOrigin,
  daemon: true,
  scheduling: 'unmetered'
})
```

The public `fork` and `forkIn` constructors may expose the same advanced
`scheduling` option. This makes the backpressure escape explicit rather than
an accidental hidden flag.

## Why This Is Not General Detach

The broader detached-fork question is about lifetime ownership: whether a fork
is attached to a concurrency or scope boundary, and how the caller can take
responsibility for it.

Timeout timers need something narrower. They remain scope-owned:

- The target scope interrupts them during cleanup.
- Their finalizers and async cleanup still run through the normal task
  interruption path.
- They still use captured handlers and runtime context.
- They still report failures through the existing fork/task diagnostics if an
  unexpected failure escapes.

They are only detached from the admission budget. Calling this `detached` would
overload a lifetime term with a scheduling meaning. Use the fork `scheduling`
mode to make that distinction explicit.

## Bounded Runtime Changes

`withBoundedConcurrency` delegates fork start to `acquireAndRunFork`. The
smallest change is to let fork start choose whether to acquire:

```ts
const runForkWith = (s: Semaphore) =>
  (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    ok(fork.arg.scheduling === 'unmetered'
      ? runForkUnmetered(fork.arg)
      : acquireAndRunFork(fork.arg, s))
```

`ScopeController` should pass scoped-fork scheduling through to the lowered
`ForkContext`.

The unmetered path should still use the same child runtime machinery as normal
forks:

- captured handlers are applied in the same place
- runtime context and trace propagation are preserved
- active child tasks are interruptible by their parent runtime
- unhandled failure diagnostics stay consistent

Implementation detail: this may be a new internal function next to
`acquireAndRunFork`, rather than a boolean parameter threaded through call
sites. Keep the public `runFork` options unchanged.

## Cooperative Runtime Changes

`withCoopConcurrency` currently creates a `Fiber`, attempts to acquire a slot,
and waits until a slot is available before stepping the fiber.

For unmetered forks, the runtime should create a fiber that never participates
in slot accounting:

- initialize the fiber as unmetered
- skip initial slot acquisition
- skip `waitForSlotPromise`
- do not call `releaseSlot` for that fiber
- continue to honor async waiting, interruption, masks, cleanup, traces, and
  handler capture

This should be implemented as a property of the fiber, not as a separate
runtime. Timer fibers still need the same scheduler semantics, just without
slot admission.

The existing cooperative async escape hatch,
`markReleaseSlotAsync`, is not enough. It releases a slot after a fiber has
started and reached a marked async operation. The timer bug happens before the
timer fiber starts.

## Scope Semantics

No public scope semantics should change.

`ScopeController` should continue to register timer tasks through
`ScopedFork`, mark them handled, and watch them like other scope-owned tasks.
The existing `daemon` behavior remains correct:

- on normal scope success, daemon-only pending work does not keep the scope
  alive
- on interruption, failure, abort, or return-from, pending work is interrupted
- queued bounded timer work should not start after the scope has already been
  interrupted

The new scheduling mode must not imply "ignore scope cleanup". It only says
"do not count this work against the user's concurrency limit".

## API Surface

Expose this publicly as an advanced option on `fork` and `forkIn`.

Docs should be clear and succinct:

- default scheduling is `metered`
- `unmetered` skips only concurrency admission
- `unmetered` does not detach the task or bypass interruption, cleanup,
  failures, traces, or handler capture
- use `unmetered` only for control-plane work such as timers, watchdogs,
  cancellation coordinators, and schedulers
- do not use `unmetered` for ordinary application work that should respect
  bounded concurrency backpressure

## Tests

Add focused tests before changing implementation:

1. `timeout()` interrupts a parked protected computation under
   `withBoundedConcurrency(1)`.
2. `timeoutIn()` interrupts a caller-owned scope whose body is parked under
   `withBoundedConcurrency(1)`.
3. `timeout()` interrupts a parked protected computation under
   `withCoopConcurrency({ concurrency: 1 })`.
4. `timeoutIn()` interrupts a caller-owned scope whose body is parked under
   `withCoopConcurrency({ concurrency: 1 })`.
5. User forks respect `withBoundedConcurrency(1)` and
   `withCoopConcurrency({ concurrency: 1 })` by default.
6. Explicit `fork(..., { scheduling: 'unmetered' })` can bypass bounded and
   cooperative admission.
7. Timer daemon behavior is unchanged: a normally completing scope does not
   wait for its timer, and the timeout reason is not produced after normal
   completion.
8. Queued or not-yet-started timer work is still interrupted when the owning
   scope exits for another reason.

The first test is the regression that currently hangs:

```ts
const p = sleep(100).pipe(
  timeout({ ms: 10, reason: () => 'timeout' }),
  control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
  withBoundedConcurrency(1),
  returnFail,
  withClock(c),
  runPromise
)

await c.step(10)
assert.equal(await p, 'timeout')
```

Use the virtual clock for deterministic timer behavior.

## Risks

The main risk is creating an explicit priority class. If many unmetered forks
exist, they can bypass the user's concurrency limit and reduce the meaning of
bounded concurrency. Public docs should reserve the option for control-plane
work.

The second risk is confusing lifetime and scheduling. `scheduling:
'unmetered'` still does not imply detached lifetime ownership.

The third risk is duplicated runtime paths. The unmetered bounded path should
reuse the same underlying fork runner as `acquireAndRunFork`; it should only
skip semaphore acquisition.

## Recommendation

Implement advanced unmetered scheduling for forks and use it for timeout
timers.

This is the smallest design that matches the semantic requirement: a timeout's
timer must not need the resource it is bounding. It preserves the existing
scope-owned timeout architecture, avoids adding time-budget policy to
concurrency handlers, and avoids overloading detached lifetime semantics with a
scheduling concern.
