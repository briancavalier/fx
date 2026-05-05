import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { unbounded } from './Fork.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { TimeoutError, defaultTimeout, timeout } from './Timeout.js'
import { sleep, withClock } from './Time.js'
import { VirtualClock } from './internal/time.js'

describe('Timeout', () => {
  it('returns the result when the Fx completes before the timeout', async () => {
    const c = new VirtualClock(0)

    const f = fx(function* () {
      yield* sleep(50)
      return 'ok'
    })

    const p = f.pipe(
      timeout({ ms: 100 }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
  })

  it('does not call onTimeout when the Fx completes before the timeout', async () => {
    const c = new VirtualClock(0)
    let timeouts = 0

    const p = sleep(50).pipe(
      timeout({ ms: 100, onTimeout: () => void (timeouts += 1) }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    assert.equal(timeouts, 0)

    await c.step(50)
    const r = await p

    assert.ok(!Fail.is(r))
    assert.equal(timeouts, 0)
  })

  it('fails with TimeoutError when the timeout wins', async () => {
    const c = new VirtualClock(0)
    let completed = false

    const f = fx(function* () {
      yield* sleep(100)
      completed = true
      return 'late'
    })

    const p = f.pipe(
      timeout({ ms: 50 }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(Fail.is(r))
    assert.ok(r.arg instanceof TimeoutError)
    assert.equal(r.arg.ms, 50)

    await c.step(50)
    assert.equal(completed, false)
  })

  it('preserves the timeout call site as the default TimeoutError cause', async () => {
    const c = new VirtualClock(0)

    const p = sleep(100).pipe(
      timeout({ ms: 50 }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(Fail.is(r))
    assert.ok(r.arg instanceof TimeoutError)
    assert.ok(r.arg.cause instanceof Error)
    assert.match(r.arg.cause.stack ?? '', /Timeout\.test\.ts/)
  })

  it('preserves original failures when the Fx fails before the timeout', async () => {
    const c = new VirtualClock(0)

    const f = fx(function* () {
      yield* sleep(50)
      yield* fail('failed')
      return 'unreachable'
    })

    const p = f.pipe(
      timeout({ ms: 100 }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'failed')
  })

  it('uses a custom timeout failure value', async () => {
    const c = new VirtualClock(0)

    class CustomTimeout extends Error {
      readonly name = 'CustomTimeout'
      readonly code = 'TimedOut'

      constructor(readonly ms: number, options?: ErrorOptions) {
        super(`Custom timeout after ${ms}ms`, options)
      }
    }

    const p = sleep(100).pipe(
      timeout({ ms: 50, onTimeout: ({ ms, origin }) => new CustomTimeout(ms, { cause: origin }) }),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(Fail.is(r))
    assert.ok(r.arg instanceof CustomTimeout)
    assert.equal(r.arg.ms, 50)
    assert.ok(r.arg.cause instanceof Error)
    assert.match(r.arg.cause.stack ?? '', /Timeout\.test\.ts/)
  })

  it('runs timed Fx with the captured handler context', async () => {
    class CurrentValue extends Effect('test/Timeout/CurrentValue')<void, string> { }

    const c = new VirtualClock(0)

    const f = fx(function* () {
      yield* sleep(50)
      return yield* new CurrentValue()
    }).pipe(
      timeout({ ms: 100 }),
      handle(CurrentValue, () => ok('handled')),
      defaultTimeout(),
      returnFail,
      unbounded,
      withClock(c)
    )

    const p = f.pipe(runPromise)
    await c.step(50)
    const r = await p

    assert.ok(!Fail.is(r))
    assert.equal(r, 'handled')
  })

  it('does not handle timeout failures until defaultTimeout is applied', () => {
    // @ts-expect-error Timeout is not handled
    run(ok('ok').pipe(timeout({ ms: 1 })))
  })
})
