import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Fail, fail, returnFail } from './Fail.js'
import { forkIn, withUnboundedConcurrency } from './Concurrent.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { andFinallyExit } from './Finalization.js'
import { control } from './Handler.js'
import { InterruptFrom } from './InterruptFrom.js'
import { scope, withScope, type Exit } from './Scope.js'
import { TimeoutInterrupt, timeout, timeoutIn } from './Timeout.js'
import { sleep, withClock } from './Time.js'
import { getTrace } from './Trace.js'
import { VirtualClock } from './internal/time.js'

describe('Timeout', () => {
  const TestScope = scope('test/Timeout')

  it('returns the result when the Fx completes before the timeout', async () => {
    const c = new VirtualClock(0)
    let reasons = 0

    const p = fx(function* () {
      yield* sleep(50)
      return 'ok'
    }).pipe(
      timeout({
        ms: 100,
        reason: () => void (reasons += 1)
      }),
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(reasons, 0)
  })

  it('interrupts the scope with the timeout reason when the timeout wins', async () => {
    const c = new VirtualClock(0)
    const reason = { type: 'timeout' }
    const exits = [] as Exit[]
    let completed = false

    const p = fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* sleep(100)
      completed = true
    }).pipe(
      timeout({ ms: 50, reason: () => reason }),
      withScope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.equal(r, reason)
    assert.equal(completed, false)
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('uses a trace-bearing TimeoutInterrupt as the default reason', async () => {
    const c = new VirtualClock(0)
    let exit!: Exit

    const p = fx(function* () {
      yield* andFinallyExit(TestScope, e => fx(function* () {
        exit = e
      }))
      yield* sleep(100)
    }).pipe(
      timeout({ ms: 50 }),
      withScope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const reason = await p

    assert.ok(reason instanceof TimeoutInterrupt)
    assert.equal(reason.ms, 50)
    assert.equal(reason.code, 'FX_TIMEOUT_INTERRUPT')
    assert.ok(reason.cause instanceof Error)
    assert.match(reason.cause.stack ?? '', /Timeout\.test\.ts/)
    assert.deepEqual(traceMessages(reason).slice(0, 1), ['Timeout interrupted timeout after 50ms'])
    assert.equal(exit.type, 'interrupted')
    assert.equal(exit.reason, undefined)
  })

  it('uses timeout label in private timeout traces', async () => {
    const c = new VirtualClock(0)

    const p = sleep(100).pipe(
      timeout({ ms: 50, label: 'fetch user' }),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const reason = await p

    assert.ok(reason instanceof TimeoutInterrupt)
    assert.deepEqual(traceMessages(reason).slice(0, 1), ['Timeout interrupted fetch user after 50ms'])
  })

  it('preserves original failures when the Fx fails before the timeout', async () => {
    const c = new VirtualClock(0)

    const p = fx(function* () {
      yield* sleep(50)
      yield* fail('failed')
      return 'unreachable'
    }).pipe(
      timeout({ ms: 100 }),
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'failed')
  })

  it('waits for interrupted cleanup before settling', async () => {
    const c = new VirtualClock(0)
    const events = [] as string[]
    let settled = false

    const p = fx(function* () {
      yield* andFinallyExit(TestScope, () => fx(function* () {
        events.push('cleanup:start')
        yield* sleep(25)
        events.push('cleanup:end')
      }))
      yield* sleep(100)
    }).pipe(
      timeout({ ms: 50 }),
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    ).then(r => {
      settled = true
      return r
    })

    await c.step(50)
    await Promise.resolve()

    assert.equal(settled, false)
    assert.deepEqual(events, ['cleanup:start'])

    await c.step(25)
    assert.equal(await p, 'interrupted')
    assert.equal(settled, true)
    assert.deepEqual(events, ['cleanup:start', 'cleanup:end'])
  })

  it('leaves timeout interruption visible until explicitly handled', () => {
    assert.throws(() => {
      // @ts-expect-error Timeout interruption is not handled
      run(ok('ok').pipe(timeout({ ms: 1 })))
    }, /Unhandled effect in run/)
  })

  it('timeoutIn interrupts a caller-owned scope after the delay', async () => {
    const c = new VirtualClock(0)
    const reason = { type: 'scope-timeout' }
    const exits = [] as Exit[]
    let completed = false

    const p = fx(function* () {
      yield* timeoutIn(TestScope, { ms: 50, reason: () => reason })
      yield* forkIn(TestScope, fx(function* () {
        yield* andFinallyExit(TestScope, exit => fx(function* () {
          exits.push(exit)
        }))
        yield* sleep(100)
        completed = true
      }))
    }).pipe(
      withScope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.equal(r, reason)
    assert.equal(completed, false)
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope, reason }])
  })

  it('timeoutIn timer is finalized when the caller-owned scope exits first', async () => {
    const c = new VirtualClock(0)
    let reasons = 0

    const p = fx(function* () {
      yield* timeoutIn(TestScope, {
        ms: 100,
        reason: () => void (reasons += 1)
      })
      return 'ok'
    }).pipe(
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    const r = await p
    await c.step(100)

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(reasons, 0)
  })

  it('uses timeoutIn label in caller-owned scope timer traces', async () => {
    const c = new VirtualClock(0)

    const p = fx(function* () {
      yield* timeoutIn(TestScope, { ms: 50, label: 'request deadline' })
      yield* forkIn(TestScope, sleep(100))
    }).pipe(
      withScope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      withUnboundedConcurrency,
      returnFail,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const reason = await p

    assert.ok(reason instanceof TimeoutInterrupt)
    assert.deepEqual(traceMessages(reason).slice(0, 1), ['Timeout interrupted request deadline after 50ms'])
  })
})

const traceMessages = (e: unknown) => {
  const messages: string[] = []
  let trace = getTrace(e)
  while (trace !== undefined) {
    messages.push(trace.frame.message)
    trace = trace.parent
  }
  return messages
}
