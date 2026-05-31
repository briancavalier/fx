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

Add an internal scheduling mode for daemon scope-owned timer forks:

```ts
type ScopedForkContext = TraceOrigin & {
  readonly fx: Fx<unknown, unknown>
  readonly failure?: 'scope' | 'task' | 'join'
} & (
  | { readonly daemon?: false | undefined; readonly scheduling?: undefined }
  | { readonly daemon: true; readonly scheduling?: 'metered' | 'unmetered' }
)
```

The exact name can change, but the semantics should be narrow:

- `daemon: true` means the task does not keep scope success alive.
- `scheduling: 'unmetered'` means a daemon task does not consume a concurrency
  permit or cooperative concurrency slot.
- non-daemon scoped forks cannot use `scheduling: 'unmetered'`.

`timeoutInWithTrace` should mark only its internal timer fork as a daemon with
unmetered scheduling:

```ts
new ScopedFork(scope, {
  fx,
  ...traceOrigin,
  daemon: true,
  scheduling: 'unmetered'
})
```

This keeps the fix local to internal runtime work. It does not introduce a
public detached-fork API, and it does not change normal user fork admission.

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
overload a lifetime term with a scheduling meaning. Use the scoped fork
`scheduling` mode to make that distinction explicit.

## Bounded Runtime Changes

`withBoundedConcurrency` delegates fork start to `acquireAndRunFork`. The
smallest change is to let fork start choose whether to acquire:

```ts
const runForkWith = (s: Semaphore) =>
  (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    ok(fork.arg.unmetered
      ? runForkUnmetered(fork.arg)
      : acquireAndRunFork(fork.arg, s))
```

`ScopeController` should lower `scheduling: 'unmetered'` to this scheduler-level
`ForkContext.unmetered` flag only when `daemon: true`.

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

The new scheduling flag must not imply "ignore scope cleanup". It only says
"do not count this work against the user's concurrency limit".

## API Surface

Do not expose this publicly at first.

Reasons:

- The immediate use case is internal timeout machinery.
- A public unmetered fork can bypass backpressure and would need a stronger
  story about fairness and resource use.
- The existing public design questions around attached and detached forks are
  lifetime questions, and should not be coupled to this scheduling escape.
- The name and exact semantics are easier to change while internal.

If more internal uses appear, the flag can remain internal. If user demand
emerges, evaluate a separate public API with explicit resource caveats.

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
5. User forks still respect `withBoundedConcurrency(1)` and
   `withCoopConcurrency({ concurrency: 1 })`; only the internal timer fork is
   unmetered.
6. Timer daemon behavior is unchanged: a normally completing scope does not
   wait for its timer, and the timeout reason is not produced after normal
   completion.
7. Queued or not-yet-started timer work is still interrupted when the owning
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

The main risk is creating an accidental priority class. If many unmetered forks
exist, they can bypass the user's concurrency limit and reduce the meaning of
bounded concurrency. Keeping the flag internal and timeout-only controls that
risk.

The second risk is confusing lifetime and scheduling. The scoped-fork union
keeps them related but not independent: only daemon scoped forks may choose a
non-default scheduling mode, and `scheduling: 'unmetered'` still does not imply
detached lifetime ownership.

The third risk is duplicated runtime paths. The unmetered bounded path should
reuse the same underlying fork runner as `acquireAndRunFork`; it should only
skip semaphore acquisition.

## Recommendation

Implement internal unmetered daemon forks for timeout timers.

This is the smallest design that matches the semantic requirement: a timeout's
timer must not need the resource it is bounding. It preserves the existing
scope-owned timeout architecture, avoids adding time-budget policy to
concurrency handlers, and avoids committing to a public detached-fork API before
the broader lifetime design is settled.
