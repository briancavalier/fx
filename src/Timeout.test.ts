import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Fail, fail, returnFail } from './Fail.js'
import { unbounded } from './Concurrent.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { andFinallyExit } from './Finalization.js'
import { control } from './Handler.js'
import { InterruptFrom } from './InterruptFrom.js'
import { scope, type Exit } from './Scope.js'
import { TimeoutInterrupt, timeout } from './Timeout.js'
import { sleep, withClock } from './Time.js'
import { getTrace } from './Trace.js'
import { VirtualClock } from './internal/time.js'

describe('Timeout', () => {
  const TestScope = 'test/Timeout' as const

  it('returns the result when the Fx completes before the timeout', async () => {
    const c = new VirtualClock(0)
    let reasons = 0

    const p = fx(function* () {
      yield* sleep(50)
      return 'ok'
    }).pipe(
      timeout(TestScope, {
        ms: 100,
        reason: () => void (reasons += 1)
      }),
      scope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      returnFail,
      unbounded,
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
      timeout(TestScope, { ms: 50, reason: () => reason }),
      scope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      returnFail,
      unbounded,
      withClock(c),
      runPromise
    )

    await c.step(50)
    const r = await p

    assert.equal(r, reason)
    assert.equal(completed, false)
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope, reason }])
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
      timeout(TestScope, { ms: 50 }),
      scope(TestScope),
      control(InterruptFrom, (_, interrupt) => ok(interrupt.arg)),
      returnFail,
      unbounded,
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
    assert.deepEqual(traceMessages(reason).slice(0, 1), [`Timeout interrupted ${TestScope} after 50ms`])
    assert.equal(exit.type, 'interrupted')
    assert.equal(exit.reason, reason)
  })

  it('preserves original failures when the Fx fails before the timeout', async () => {
    const c = new VirtualClock(0)

    const p = fx(function* () {
      yield* sleep(50)
      yield* fail('failed')
      return 'unreachable'
    }).pipe(
      timeout(TestScope, { ms: 100 }),
      scope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
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
      timeout(TestScope, { ms: 50 }),
      scope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      returnFail,
      unbounded,
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
      run(ok('ok').pipe(timeout(TestScope, { ms: 1 }), scope(TestScope)))
    }, /Unhandled effect in run/)
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
