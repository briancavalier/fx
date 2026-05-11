import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { RetryEvent, defaultRetry, retry } from './Retry.js'
import { sleep, withClock } from './Time.js'
import { formatDiagnostic, getTrace, setTraceCapturePolicy, snapshotError, withTraceCapture } from './Trace.js'
import { nodeSourceLookup } from './TraceNode.js'
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

  it('attaches failure and retry trace frames when retries are exhausted', () => {
    const previous = setTraceCapturePolicy('full')
    try {
      const cause = new Error('nope')

      const r = fail(cause).pipe(
        retry({ retries: 5 }),
        defaultRetry(),
        returnFail,
        run
      )

      assert.ok(Fail.is(r))
      assert.equal(r.arg, cause)
      assert.equal(r.trace?.frame.message, 'fx/Fail/fail')
      assert.equal(r.trace?.parent, undefined)
      assert.deepEqual(traceMessages(cause), ['fx/Fail/fail', 'fx/Retry/retry'])

      const frames = snapshotError(cause).trace?.frames ?? []
      assert.equal(frames[0]?.kind, 'fail')
      assert.ok(frames[0]?.location?.file?.endsWith('Retry.test.ts'))
      assert.doesNotMatch(frames[0]?.location?.file ?? '', /\/Fail\.ts$/)
      assert.equal(frames[1]?.kind, 'retry')
      assert.ok(frames[1]?.location?.file?.endsWith('Retry.test.ts'))
      assert.equal(typeof frames[1]?.location?.line, 'number')
      assert.equal(typeof frames[1]?.location?.column, 'number')
      assert.doesNotMatch(frames[1]?.location?.file ?? '', /internal\/pipe/)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('preserves label-only retry traces without locations', async () => {
    const cause = new Error('nope')
    const program = fx(function* () {
      return yield* fail(cause).pipe(retry({ retries: 0 }), defaultRetry())
    })

    const r = await program.pipe(withTraceCapture('labels'), returnFail, runPromise)

    assert.ok(Fail.is(r))
    assert.equal(r.arg, cause)
    assert.deepEqual(traceMessages(cause), ['fx/Fail/fail', 'fx/Retry/retry'])
    assert.equal(snapshotError(cause).trace?.frames[0]?.location, undefined)
    assert.equal(snapshotError(cause).trace?.frames[1]?.location, undefined)
  })

  it('formats source snippets for retry-only traces', () => {
    const cause = new Error('nope')
    const previous = setTraceCapturePolicy('off')
    const failed = fail(cause)

    try {
      setTraceCapturePolicy('full')
      const r = failed.pipe(
        retry({ retries: 0 }),
        defaultRetry(),
        returnFail,
        run
      )

      assert.ok(Fail.is(r))
      assert.equal(r.arg, cause)

      const formatted = formatDiagnostic(cause, {
        colors: 'never',
        source: { lookup: nodeSourceLookup() }
      })

      assert.match(formatted, /at fx\/Retry\/retry \[retry\]/)
      assert.match(formatted, /src\/Retry\.test\.ts:\d+:\d+/)
      assert.match(formatted, /\d+ \|/)
      assert.match(formatted, /\| +\^/)
    } finally {
      setTraceCapturePolicy(previous)
    }
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

const traceMessages = (e: unknown) => {
  const messages: string[] = []
  let trace = getTrace(e)
  while (trace !== undefined) {
    messages.push(trace.frame.message)
    trace = trace.parent
  }
  return messages
}
