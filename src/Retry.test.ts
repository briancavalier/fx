import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { RetryEvent, defaultRetry, retry } from './Retry.js'
import { sleep, withClock } from './Time.js'
import { VirtualClock } from './internal/time.js'

describe('Retry', () => {
  it('retries a failing Fx until it succeeds', () => {
    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      if (attempts < 3) yield* fail('not yet')
      return 'ok'
    })

    const r = f.pipe(
      retry({ retries: 2 }),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      returnFail,
      run
    )

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(attempts, 3)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'not yet', retrying: true },
      { type: 'failure', attempt: 2, failure: 'not yet', retrying: true },
      { type: 'success', attempt: 3 }
    ])
  })

  it('fails with the final failure after retries are exhausted', () => {
    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      yield* fail('nope')
    })

    const r = f.pipe(
      retry({ retries: 1 }),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      returnFail,
      run
    )

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'nope')
    assert.equal(attempts, 2)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'nope', retrying: true },
      { type: 'failure', attempt: 2, failure: 'nope', retrying: false }
    ])
  })

  it('stops retrying when the predicate rejects the failure', () => {
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      yield* fail(attempts)
    })

    const r = f.pipe(retry({ retries: 3, while: (e: number) => e < 2 }), defaultRetry(), returnFail, run)

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 2)
    assert.equal(attempts, 2)
  })

  it('does not retry when retries is zero', () => {
    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      yield* fail('once')
    })

    const r = f.pipe(
      retry({ retries: 0 }),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      returnFail,
      run
    )

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'once')
    assert.equal(attempts, 1)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'once', retrying: false }
    ])
  })

  it('observes success on the first attempt', () => {
    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      return 'ok'
    })

    const r = f.pipe(
      retry({ retries: 2 }),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      returnFail,
      run
    )

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(attempts, 1)
    assert.deepEqual(events, [
      { type: 'success', attempt: 1 }
    ])
  })

  it('fails when observe fails', () => {
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      if (attempts < 2) yield* fail('retryable')
      return 'ok'
    })

    const r = f.pipe(
      retry({ retries: 2 }),
      defaultRetry({ observe: () => fail('observe failed') }),
      returnFail,
      run
    )

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'observe failed')
    assert.equal(attempts, 1)
  })

  it('runs each attempt with the captured handler context', () => {
    class CurrentPrefix extends Effect('test/CurrentPrefix')<void, string> { }

    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      const prefix = yield* new CurrentPrefix()
      if (attempts < 2) yield* fail('again')
      return `${prefix}:${attempts}`
    })

    const r = f.pipe(
      retry({ retries: 1 }),
      defaultRetry(),
      returnFail,
      handle(CurrentPrefix, () => ok('handled')),
      run
    )

    assert.ok(!Fail.is(r))
    assert.equal(r, 'handled:2')
  })

  it('handles nested Retry effects in retried Fx', () => {
    let innerAttempts = 0

    const inner = fx(function* () {
      innerAttempts += 1
      if (innerAttempts < 2) yield* fail('inner')
      return 'ok'
    })

    const outer = fx(function* () {
      return yield* inner.pipe(retry({ retries: 1 }))
    }).pipe(retry({ retries: 1 }))

    const r = outer.pipe(defaultRetry(), returnFail, run)

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(innerAttempts, 2)
  })

  it('retries failures introduced by handlers between retry and defaultRetry', () => {
    class NeedsHandler extends Effect('test/Retry/NeedsHandler')<void, string> { }

    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      return yield* new NeedsHandler()
    })

    const r = f.pipe(
      retry({ retries: 2 }),
      handle(NeedsHandler, () =>
        attempts < 3 ? fail('from handler') : ok('ok')),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      returnFail,
      run
    )

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(attempts, 3)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'from handler', retrying: true },
      { type: 'failure', attempt: 2, failure: 'from handler', retrying: true },
      { type: 'success', attempt: 3 }
    ])
  })

  it('does not retry failures introduced by handlers outside defaultRetry', () => {
    class NeedsHandler extends Effect('test/Retry/OuterNeedsHandler')<void, string> { }

    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      return yield* new NeedsHandler()
    })

    const r = f.pipe(
      retry({ retries: 2 }),
      defaultRetry({ observe: e => fx(function* () { events.push(e) }) }),
      handle(NeedsHandler, () => fail('outside retry')),
      returnFail,
      run
    )

    assert.ok(Fail.is(r))
    assert.equal(r.arg, 'outside retry')
    assert.equal(attempts, 1)
    assert.deepEqual(events, [])
  })

  it('runs observe before each retry', async () => {
    const events: RetryEvent[] = []
    let attempts = 0

    const f = fx(function* () {
      attempts += 1
      if (attempts < 3) yield* fail('later')
      return 'ok'
    })

    const c = new VirtualClock(0)
    const p = f.pipe(retry({
      retries: 2
    }), defaultRetry({
      observe: event => fx(function* () {
        events.push(event)
        if (event.type === 'failure' && event.retrying) {
          yield* sleep(event.attempt * 100)
        }
      })
    }), returnFail, withClock(c), runPromise)

    await c.step(100)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'later', retrying: true },
      { type: 'failure', attempt: 2, failure: 'later', retrying: true }
    ])
    assert.equal(attempts, 2)

    await c.step(199)
    assert.equal(attempts, 2)

    await c.step(1)
    const r = await p

    assert.ok(!Fail.is(r))
    assert.equal(r, 'ok')
    assert.equal(attempts, 3)
    assert.deepEqual(events, [
      { type: 'failure', attempt: 1, failure: 'later', retrying: true },
      { type: 'failure', attempt: 2, failure: 'later', retrying: true },
      { type: 'success', attempt: 3 }
    ])
  })
})
