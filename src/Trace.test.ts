import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise, tryPromise } from './Async.js'
import { at } from './Breadcrumb.js'
import { RaceAllFailed, all, firstSuccess, fork, forkIn, mapAll, race, withUnboundedConcurrency } from './Concurrent.js'
import { withCoopConcurrency } from './experimental/concurrent/cooperative.js'
import { Fail, fail, returnFail } from './Fail.js'
import { andFinally } from './Finalization.js'
import { fx, runPromise } from './Fx.js'
import { control } from './Handler.js'
import { InterruptFrom } from './InterruptFrom.js'
import { defaultRetry, retry } from './Retry.js'
import { scope, scopeId, withScope } from './Scope.js'
import { ScopeTypeId } from './internal/scopeIdentity.js'
import { wait } from './Task.js'
import { sleep, withClock } from './Time.js'
import { TimeoutInterrupt, timeout, timeoutIn } from './Timeout.js'
import { MaxTraceDepth, appendTrace, attachTrace, captureTrace, formatDiagnostic, formatError, formatTrace, getTrace, getTraceCapturePolicy, prependTrace, setTraceCapturePolicy, snapshotError, snapshotTrace, withTraceCapture } from './Trace.js'
import type { Trace, TraceOptions } from './Trace.js'
import type { Breadcrumb } from './Breadcrumb.js'
import { VirtualClock } from './internal/time.js'

describe('Trace', () => {
  it('requires trace options with a trace to include its origin', () => {
    const origin = at('trace/options')
    const trace = prependTrace(origin)

    const complete = { origin, trace } satisfies TraceOptions
    const defaultTrace = { origin } satisfies TraceOptions
    // @ts-expect-error trace options require origin when trace is supplied
    const missingOrigin = { trace } satisfies TraceOptions

    assert.equal(complete.origin, origin)
    assert.equal(defaultTrace.origin, origin)
    assert.equal(missingOrigin.trace, trace)
  })

  it('defaults to full stack capture', () => {
    assert.equal(getTraceCapturePolicy(), 'full')
  })

  it('setTraceCapturePolicy returns the previous policy', () => {
    const previous = setTraceCapturePolicy('labels')
    try {
      assert.equal(previous, 'full')
      assert.equal(setTraceCapturePolicy('full'), 'labels')
    } finally {
      setTraceCapturePolicy('full')
    }
  })

  it('labels policy preserves trace messages without stack locations', () => {
    const previous = setTraceCapturePolicy('labels')
    try {
      const trace = captureTrace(at('labels/frame'))

      assert.ok(trace !== undefined)
      assert.equal(formatTrace(trace), '  at labels/frame')
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('off policy avoids attaching runtime trace metadata', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      await assert.rejects(
        runPromise(fail(new Error('off')) as never),
        e => e instanceof Error && getTrace(e) === undefined
      )
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('withTraceCapture off avoids attaching traces captured inside the region', async () => {
    const f = fx(function* () {
      yield* fail(new Error('regional off'))
    })

    await assert.rejects(
      runPromise(f.pipe(withTraceCapture('off')) as never),
      e => e instanceof Error && getTrace(e) === undefined
    )
  })

  it('withTraceCapture labels captures regional frames without stack locations', async () => {
    const f = fx(function* () {
      yield* fail(new Error('regional labels'))
    })

    await assert.rejects(
      runPromise(f.pipe(withTraceCapture('labels')) as never),
      e => {
        const trace = snapshotError(e).trace
        return e instanceof Error
          && trace?.frames[0]?.message === 'fx/Fail/fail'
          && trace.frames[0].kind === 'fail'
          && trace.frames[0].location === undefined
      }
    )
  })

  it('withTraceCapture uses the innermost regional policy', async () => {
    const inner = fx(function* () {
      yield* fail(new Error('inner labels'))
    })

    const outer = fx(function* () {
      yield* inner.pipe(withTraceCapture('labels'))
    })

    await assert.rejects(
      runPromise(outer.pipe(withTraceCapture('off')) as never),
      e => {
        const trace = snapshotError(e).trace
        return e instanceof Error
          && trace?.frames[0]?.message === 'fx/Fail/fail'
          && trace.frames[0].location === undefined
      }
    )
  })

  it('withTraceCapture overrides the global default only inside the region', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const f = fx(function* () {
        yield* fail(new Error('regional full'))
      })

      await assert.rejects(
        runPromise(f.pipe(withTraceCapture('full')) as never),
        e => e instanceof Error && getTrace(e) !== undefined
      )

      await assert.rejects(
        runPromise(fail(new Error('global off')) as never),
        e => e instanceof Error && getTrace(e) === undefined
      )
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('captures active scopes in trace snapshots ordered outer-to-inner', async () => {
    const DbTransaction = scope('db/transaction')
    const HttpRequest = scope('http/request')
    const f = fx(function* () {
      yield* fail(new Error('scoped failure'))
    }).pipe(
      withScope(DbTransaction),
      withScope(HttpRequest)
    )

    await assert.rejects(
      runPromise(f as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [
          { id: 'http/request', label: 'http/request' },
          { id: 'db/transaction', label: 'db/transaction' }
        ])
        return true
      }
    )
  })

  it('keeps scope ids symbol-keyed and non-enumerable', () => {
    const TestScope = scope('test/Trace/non-enumerable', { label: 'non-enumerable' })

    assert.equal(Object.getOwnPropertyDescriptor(TestScope, ScopeTypeId)?.enumerable, false)
    assert.deepEqual(Object.keys(TestScope), ['label'])
    assert.equal(scopeId(TestScope), 'test/Trace/non-enumerable')
    assert.equal(TestScope.label, 'non-enumerable')
  })

  it('supports symbol scope ids with labels', () => {
    const id = Symbol('test/Trace/symbol-id')
    const TestScope = scope(id, { label: 'symbol scope' })

    assert.equal(scopeId(TestScope), id)
    assert.equal(TestScope.label, 'symbol scope')
  })

  it('uses scope labels in active-scope diagnostics', async () => {
    const RequestScope = scope('test/Trace/request', { label: 'request' })
    const f = fx(function* () {
      yield* fail(new Error('labeled scope'))
    }).pipe(withScope(RequestScope))

    await assert.rejects(
      runPromise(f as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'test/Trace/request',
          label: 'request'
        }])
        assert.match(formatDiagnostic(e, { colors: 'never' }), /Active scopes: request/)
        return true
      }
    )
  })

  it('keeps distinct active scopes with the same diagnostic text', async () => {
    const OuterRequest = scope('test/Trace/outer-request', {
      label: 'request'
    })
    const InnerRequest = scope('test/Trace/inner-request', {
      label: 'request'
    })
    const f = fx(function* () {
      yield* fail(new Error('same diagnostic text'))
    }).pipe(
      withScope(InnerRequest),
      withScope(OuterRequest)
    )

    await assert.rejects(
      runPromise(f as never),
      e => {
        const activeScopes = snapshotError(e).trace?.activeScopes
        assert.deepEqual(activeScopes, [
          { id: 'test/Trace/outer-request', label: 'request' },
          { id: 'test/Trace/inner-request', label: 'request' }
        ])
        assert.match(formatDiagnostic(e, { colors: 'never' }), /Active scopes: request > request/)
        return true
      }
    )
  })

  it('omits active scope diagnostics for unscoped traced errors', () => {
    const formatted = formatDiagnostic(tracedError('unscoped', 'plain trace'), { colors: 'never' })

    assert.doesNotMatch(formatted, /Active scopes:/)
  })

  it('formats active scopes compactly on one line', async () => {
    const DbTransaction = scope('db/transaction')
    const HttpRequest = scope('http/request')
    const f = fx(function* () {
      yield* fail(new Error('scoped formatting'))
    }).pipe(
      withScope(DbTransaction),
      withScope(HttpRequest)
    )

    await assert.rejects(
      runPromise(f as never),
      e => {
        assert.match(formatDiagnostic(e, { colors: 'never' }), /Active scopes: http\/request > db\/transaction/)
        assert.match(formatError(e), /Active scopes: http\/request > db\/transaction/)
        return true
      }
    )
  })

  it('compacts deep active scope stacks', async () => {
    const scoped = ['a', 'b', 'c', 'd', 'e'].map(name => scope(name)).reduceRight(
      (f, name) => f.pipe(withScope(name)),
      fx(function* () {
        yield* fail(new Error('deep scopes'))
      })
    )

    await assert.rejects(
      runPromise(scoped as never),
      e => {
        assert.match(formatDiagnostic(e, { colors: 'never' }), /Active scopes: a > \.\.\. > c > d > e/)
        return true
      }
    )
  })


  it('does not rewrite traces captured before entering a region', async () => {
    const prebuilt = fail(new Error('prebuilt'))

    await assert.rejects(
      runPromise(prebuilt.pipe(withTraceCapture('off')) as never),
      e => e instanceof Error && getTrace(e) !== undefined
    )
  })

  it('propagates regional trace policy to forked children without sibling interference', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const labelsError = new Error('labels child')
      const offChild = fx(function* () {
        yield* fail(new Error('off child'))
      }).pipe(withTraceCapture('off'))
      const labelsChild = fx(function* () {
        yield* fail(labelsError)
      }).pipe(withTraceCapture('labels'))

      const f = fx(function* () {
        const off = yield* fork(offChild)
        const labels = yield* fork(labelsChild)
        const offResult = yield* wait(off).pipe(returnFail)
        const labelsResult = yield* wait(labels).pipe(returnFail)
        return [offResult, labelsResult] as const
      })

      const [offResult, labelsResult] = await f.pipe(withUnboundedConcurrency, runPromise)

      assert.ok(Fail.is(offResult))
      assert.ok(Fail.is(labelsResult))
      assert.equal(getTrace(offResult.arg), undefined)
      assert.equal(snapshotError(labelsResult.arg).trace?.frames[0]?.location, undefined)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('propagates regional trace policy and frame metadata through concurrency operators', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const allError = new Error('all failed')
      const mapAllError = new Error('mapAll failed')
      const raceError = new Error('race failed')
      const firstSuccessError = new Error('firstSuccess failed')
      const allProgram = fx(function* () {
        return yield* all([fx(function* () { yield* fail(allError) })]).pipe(withTraceCapture('labels'))
      })
      const mapAllProgram = fx(function* () {
        return yield* mapAll([mapAllError], error => fx(function* () { yield* fail(error) })).pipe(withTraceCapture('labels'))
      })
      const raceProgram = fx(function* () {
        return yield* race([fx(function* () { yield* fail(raceError) })]).pipe(withTraceCapture('labels'))
      })
      const firstSuccessProgram = fx(function* () {
        return yield* firstSuccess([fx(function* () { yield* fail(firstSuccessError) })]).pipe(withTraceCapture('labels'))
      })

      const allResult = await allProgram.pipe(withUnboundedConcurrency, returnFail, runPromise)
      const mapAllResult = await mapAllProgram.pipe(withUnboundedConcurrency, returnFail, runPromise)
      const raceResult = await raceProgram.pipe(withUnboundedConcurrency, returnFail, runPromise)
      const firstSuccessResult = await firstSuccessProgram.pipe(withUnboundedConcurrency, returnFail, runPromise)

      assert.ok(Fail.is(allResult))
      assert.ok(Fail.is(mapAllResult))
      assert.ok(Fail.is(raceResult))
      assert.ok(Fail.is(firstSuccessResult))
      assert.ok(firstSuccessResult.arg instanceof RaceAllFailed)
      assert.deepEqual(traceMessages(allResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(mapAllResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(raceResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/race[0]', 'fx/Concurrent/race'])
      assert.equal(snapshotError(raceResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(raceResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(firstSuccessResult.arg.errors[0]).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/firstSuccess[0]', 'fx/Concurrent/firstSuccess'])
      assert.equal(snapshotError(firstSuccessResult.arg.errors[0]).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(firstSuccessResult.arg.errors[0]).trace?.frames[1]?.index, 0)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('keeps firstSuccess child traces race-kind under full trace capture', async () => {
    const previous = setTraceCapturePolicy('full')
    try {
      const raceError = new Error('firstSuccess full trace failed')
      const raceProgram = fx(function* () {
        return yield* firstSuccess([fx(function* () { yield* fail(raceError) })])
      })

      const raceResult = await raceProgram.pipe(withUnboundedConcurrency, returnFail, runPromise)

      assert.ok(Fail.is(raceResult))
      assert.ok(raceResult.arg instanceof RaceAllFailed)
      assert.deepEqual(traceMessages(raceResult.arg.errors[0]).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/firstSuccess[0]', 'fx/Concurrent/firstSuccess'])
      assert.equal(snapshotError(raceResult.arg.errors[0]).trace?.frames[1]?.kind, 'race')
      assert.equal(snapshotError(raceResult.arg.errors[0]).trace?.frames[1]?.index, 0)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('propagates regional trace policy and frame metadata through withCoopConcurrency', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const allError = new Error('cooperative all failed')
      const mapAllError = new Error('cooperative mapAll failed')
      const allProgram = fx(function* () {
        return yield* all([fx(function* () { yield* fail(allError) })]).pipe(withTraceCapture('labels'), withCoopConcurrency())
      })
      const mapAllProgram = fx(function* () {
        return yield* mapAll([mapAllError], error => fx(function* () { yield* fail(error) })).pipe(withTraceCapture('labels'), withCoopConcurrency())
      })

      const allResult = await allProgram.pipe(returnFail, runPromise)
      const mapAllResult = await mapAllProgram.pipe(returnFail, runPromise)

      assert.ok(Fail.is(allResult))
      assert.ok(Fail.is(mapAllResult))
      assert.deepEqual(traceMessages(allResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(mapAllResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.index, 0)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('propagates regional trace policy and frame metadata through withCoopConcurrency', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const allError = new Error('cooperative structured all failed')
      const mapAllError = new Error('cooperative structured mapAll failed')
      const raceError = new Error('cooperative structured race failed')
      const allProgram = fx(function* () {
        return yield* all([fx(function* () { yield* fail(allError) })]).pipe(withTraceCapture('labels'), withCoopConcurrency())
      })
      const mapAllProgram = fx(function* () {
        return yield* mapAll([mapAllError], error => fx(function* () { yield* fail(error) })).pipe(withTraceCapture('labels'), withCoopConcurrency())
      })
      const raceProgram = fx(function* () {
        return yield* race([fx(function* () { yield* fail(raceError) })]).pipe(withTraceCapture('labels'), withCoopConcurrency())
      })

      const allResult = await allProgram.pipe(returnFail, runPromise)
      const mapAllResult = await mapAllProgram.pipe(returnFail, runPromise)
      const raceResult = await raceProgram.pipe(returnFail, runPromise)

      assert.ok(Fail.is(allResult))
      assert.ok(Fail.is(mapAllResult))
      assert.ok(Fail.is(raceResult))
      assert.deepEqual(traceMessages(allResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(allResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(mapAllResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(mapAllResult.arg).trace?.frames[1]?.index, 0)
      assert.deepEqual(traceMessages(raceResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/race[0]', 'fx/Concurrent/race'])
      assert.equal(snapshotError(raceResult.arg).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(raceResult.arg).trace?.frames[1]?.index, 0)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('propagates regional trace policy through firstSuccess with cooperative scheduling', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const raceError = new Error('cooperative firstSuccess failed')
      const raceProgram = fx(function* () {
        return yield* firstSuccess([fx(function* () { yield* fail(raceError) })]).pipe(
          withTraceCapture('labels'),
          withCoopConcurrency()
        )
      })

      const raceResult = await raceProgram.pipe(returnFail, runPromise)

      assert.ok(Fail.is(raceResult))
      assert.ok(raceResult.arg instanceof RaceAllFailed)
      assert.deepEqual(traceMessages(raceResult.arg.errors[0]).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/firstSuccess[0]', 'fx/Concurrent/firstSuccess'])
      assert.equal(snapshotError(raceResult.arg.errors[0]).trace?.frames[1]?.kind, 'fork')
      assert.equal(snapshotError(raceResult.arg.errors[0]).trace?.frames[1]?.index, 0)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('propagates active scopes to forked children', async () => {
    const HttpRequest = scope('http/request')
    const f = fx(function* () {
      const task = yield* fork(fx(function* () {
        yield* fail(new Error('fork scoped'))
      }))
      yield* wait(task)
    }).pipe(withScope(HttpRequest))

    await assert.rejects(
      runPromise(f.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
  })

  it('propagates active scopes through structured concurrency handlers', async () => {
    const HttpRequest = scope('http/request')
    const allProgram = fx(function* () {
      yield* all([fx(function* () { yield* fail(new Error('all scoped')) })])
    }).pipe(withScope(HttpRequest))
    const raceProgram = fx(function* () {
      yield* race([fx(function* () { yield* fail(new Error('race scoped')) })])
    }).pipe(withScope(HttpRequest))

    await assert.rejects(
      runPromise(allProgram.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
    await assert.rejects(
      runPromise(raceProgram.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
  })

  it('keeps hidden operator scopes out of active-scope diagnostics', async () => {
    const HttpRequest = scope('http/request')
    const allProgram = fx(function* () {
      yield* all([fx(function* () { yield* fail(new Error('hidden all scope')) })])
    }).pipe(withScope(HttpRequest))
    const raceProgram = fx(function* () {
      yield* race([fx(function* () { yield* fail(new Error('hidden race scope')) })])
    }).pipe(withScope(HttpRequest))
    const firstSuccessProgram = fx(function* () {
      yield* firstSuccess([fx(function* () { yield* fail(new Error('hidden firstSuccess scope')) })])
    }).pipe(withScope(HttpRequest))

    await assert.rejects(
      runPromise(allProgram.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
    await assert.rejects(
      runPromise(raceProgram.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
    await assert.rejects(
      runPromise(firstSuccessProgram.pipe(withUnboundedConcurrency) as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        assert.ok(e instanceof Error)
        assert.ok(e.cause instanceof RaceAllFailed)
        assert.deepEqual(snapshotError(e.cause.errors[0]).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
  })

  it('keeps private timeout scopes out of active-scope diagnostics', async () => {
    const clock = new VirtualClock(0)
    const HttpRequest = scope('http/request')
    const timeoutProgram = fx(function* () {
      return yield* sleep(100).pipe(timeout({ ms: 50, label: 'request timeout' }))
    })

    const timeoutPromise = runPromise(timeoutProgram.pipe(
      withScope(HttpRequest),
      control(InterruptFrom, (_, interrupt) => fx(function* () {
        return interrupt.arg
      })),
      withUnboundedConcurrency,
      withClock(clock)
    ) as never)
    await clock.step(50)
    const timeoutResult = await timeoutPromise

    assert.ok(timeoutResult instanceof TimeoutInterrupt)
    assert.deepEqual(snapshotError(timeoutResult).trace?.activeScopes, [{
      id: 'http/request',
      label: 'http/request'
    }])
  })

  it('propagates active scopes to async failures', async () => {
    const HttpRequest = scope('http/request')
    const f = fx(function* () {
      yield* tryPromise(() => Promise.reject(new Error('async scoped')))
    }).pipe(withScope(HttpRequest))

    await assert.rejects(
      runPromise(f as never),
      e => {
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'http/request',
          label: 'http/request'
        }])
        return true
      }
    )
  })

  it('captures active scopes for cleanup failures', async () => {
    const DbTransaction = scope('db/transaction')
    const f = fx(function* () {
      yield* andFinally(DbTransaction, fail(new Error('cleanup scoped')))
    }).pipe(withScope(DbTransaction))

    await assert.rejects(
      runPromise(f as never),
      e => {
        const formatted = formatDiagnostic(e, { colors: 'never' })
        assert.deepEqual(snapshotError(e).trace?.activeScopes, [{
          id: 'db/transaction',
          label: 'db/transaction'
        }])
        assert.match(formatted, /AggregateError: Resource release failed/)
        assert.match(formatted, /Active scopes: db\/transaction/)
        return true
      }
    )
  })

  it('wait converts task failures using the task runtime context', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const failingTask = await fx(function* () {
        return yield* fork(fx(function* () {
          yield* fail(new Error('task context'))
        }).pipe(withTraceCapture('full')))
      }).pipe(withUnboundedConcurrency, runPromise)

      const result = await wait(failingTask).pipe(
        withTraceCapture('off'),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.deepEqual(traceMessages(result.arg).slice(0, 1), ['fx/Fail/fail'])
      assert.ok(snapshotError(result.arg).trace?.frames[0]?.location !== undefined)
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('uses regional trace policy for rejected async and synchronous exceptions', async () => {
    await assert.rejects(
      runPromise(fx(function* () {
        yield* assertPromise(() => Promise.reject(new Error('async off')))
      }).pipe(withTraceCapture('off'))),
      e => e instanceof Error && getTrace(e) === undefined
    )

    await assert.rejects(
      runPromise(fx(function* () {
        throw new Error('sync off')
      }).pipe(withTraceCapture('off'))),
      e => e instanceof Error && getTrace(e) === undefined
    )
  })

  it('uses regional trace policy when tryPromise converts rejection to Fail', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      const result = await tryPromise(() => Promise.reject(new Error('try labels')))
        .pipe(withTraceCapture('labels'), returnFail, runPromise)

      assert.ok(Fail.is(result))
      const trace = result.trace === undefined ? undefined : snapshotTrace(result.trace)
      assert.equal(trace?.frames[0]?.message, 'fx/Fail/fail')
      assert.equal(trace?.frames[0]?.kind, 'fail')
      assert.equal(trace?.frames[0]?.location, undefined)
    } finally {
      setTraceCapturePolicy(previous)
    }

    const fullPrevious = setTraceCapturePolicy('full')
    try {
      const result = await tryPromise(() => Promise.reject(new Error('try off')))
        .pipe(withTraceCapture('off'), returnFail, runPromise)

      assert.ok(Fail.is(result))
      assert.equal(result.trace, undefined)
    } finally {
      setTraceCapturePolicy(fullPrevious)
    }
  })

  it('propagates regional trace policy through timeout and retry handlers', async () => {
    const clock = new VirtualClock(0)
    const TimeoutScope = scope('test/Trace/timeout')
    const timeoutProgram = fx(function* () {
      return yield* sleep(100).pipe(timeout({ ms: 50 }))
    })

    const timeoutPromise = runPromise(timeoutProgram.pipe(
      withScope(TimeoutScope),
      control(InterruptFrom, (_, interrupt) => fx(function* () {
        return interrupt.arg
      })),
      withTraceCapture('labels'),
      withUnboundedConcurrency,
      withClock(clock)
    ) as never)
    await clock.step(50)
    const timeoutResult = await timeoutPromise

    assert.ok(!Fail.is(timeoutResult))
    assert.ok(timeoutResult instanceof TimeoutInterrupt)
    assert.equal(snapshotError(timeoutResult).trace?.frames[0]?.message, 'Timeout interrupted timeout after 50ms')
    assert.equal(snapshotError(timeoutResult).trace?.frames[0]?.kind, 'timeout')
    assert.equal(snapshotError(timeoutResult).trace?.frames[0]?.location, undefined)

    const retryError = new Error('retry failed')
    const retryProgram = fx(function* () {
      return yield* fail(retryError).pipe(retry({ retries: 0 }), defaultRetry())
    })
    const retryResult = await retryProgram.pipe(withTraceCapture('labels'), returnFail, runPromise)

    assert.ok(Fail.is(retryResult))
    assert.equal(retryResult.arg, retryError)
    assert.equal(snapshotError(retryError).trace?.frames[0]?.kind, 'fail')
    assert.equal(snapshotError(retryError).trace?.frames[0]?.location, undefined)
    assert.equal(snapshotError(retryError).trace?.frames[1]?.kind, 'retry')
    assert.equal(snapshotError(retryError).trace?.frames[1]?.location, undefined)
  })

  it('uses private timeout labels without exposing private timeout scopes', async () => {
    const clock = new VirtualClock(0)
    const timeoutProgram = fx(function* () {
      return yield* sleep(100).pipe(timeout({ ms: 50, label: 'fetch user' }))
    })

    const timeoutPromise = runPromise(timeoutProgram.pipe(
      control(InterruptFrom, (_, interrupt) => fx(function* () {
        return interrupt.arg
      })),
      withUnboundedConcurrency,
      withClock(clock)
    ) as never)
    await clock.step(50)
    const timeoutResult = await timeoutPromise

    assert.ok(timeoutResult instanceof TimeoutInterrupt)
    assert.equal(snapshotError(timeoutResult).trace?.frames[0]?.message, 'Timeout interrupted fetch user after 50ms')
    assert.equal(snapshotError(timeoutResult).trace?.frames[0]?.kind, 'timeout')
    assert.equal(snapshotError(timeoutResult).trace?.activeScopes, undefined)
  })

  it('uses timeoutIn labels and caller-owned scope labels in timeout traces', async () => {
    const labelClock = new VirtualClock(0)
    const LabeledDeadline = scope('test/Trace/labeled-timeout-in', { label: 'request scope' })
    const labeledProgram = fx(function* () {
      yield* timeoutIn(LabeledDeadline, { ms: 50, label: 'request deadline' })
      yield* forkIn(LabeledDeadline, sleep(100))
    })

    const labeledPromise = runPromise(labeledProgram.pipe(
      withScope(LabeledDeadline),
      control(InterruptFrom, (_, interrupt) => fx(function* () {
        return interrupt.arg
      })),
      withUnboundedConcurrency,
      withClock(labelClock)
    ) as never)
    await labelClock.step(50)
    const labeledResult = await labeledPromise

    assert.ok(labeledResult instanceof TimeoutInterrupt)
    assert.equal(snapshotError(labeledResult).trace?.frames[0]?.message, 'Timeout interrupted request deadline after 50ms')
    assert.equal(snapshotError(labeledResult).trace?.frames[0]?.kind, 'timeout')

    const fallbackClock = new VirtualClock(0)
    const FallbackDeadline = scope('test/Trace/fallback-timeout-in', { label: 'fallback request' })
    const fallbackProgram = fx(function* () {
      yield* timeoutIn(FallbackDeadline, { ms: 50 })
      yield* forkIn(FallbackDeadline, sleep(100))
    })

    const fallbackPromise = runPromise(fallbackProgram.pipe(
      withScope(FallbackDeadline),
      control(InterruptFrom, (_, interrupt) => fx(function* () {
        return interrupt.arg
      })),
      withUnboundedConcurrency,
      withClock(fallbackClock)
    ) as never)
    await fallbackClock.step(50)
    const fallbackResult = await fallbackPromise

    assert.ok(fallbackResult instanceof TimeoutInterrupt)
    assert.equal(snapshotError(fallbackResult).trace?.frames[0]?.message, 'Timeout interrupted fallback request after 50ms')
    assert.equal(snapshotError(fallbackResult).trace?.frames[0]?.kind, 'timeout')
  })

  it('prepends frames newest first', () => {
    const root = prependTrace(breadcrumb('root'))
    const trace = prependTrace(breadcrumb('child'), root)

    assert.equal(trace.frame.message, 'child')
    assert.equal(trace.parent?.frame.message, 'root')
    assert.equal(trace.depth, 2)
    assert.equal(trace.truncated, false)
  })

  it('caps trace depth and drops oldest frames', () => {
    let trace = prependTrace(breadcrumb('frame-0'))
    for (let i = 1; i < MaxTraceDepth + 5; i++) {
      trace = prependTrace(breadcrumb(`frame-${i}`), trace)
    }

    const messages = messagesOf(trace)

    assert.equal(trace.depth, MaxTraceDepth)
    assert.equal(trace.truncated, true)
    assert.deepEqual(messages.slice(0, 3), ['frame-36', 'frame-35', 'frame-34'])
    assert.equal(messages.at(-1), 'frame-5')
  })

  it('appends parent traces while preserving newest frames', () => {
    const trace = appendTrace(
      prependTrace(breadcrumb('child')),
      prependTrace(breadcrumb('parent'))
    )

    assert.deepEqual(messagesOf(trace), ['child', 'parent'])
  })

  it('caps appended traces and drops oldest frames', () => {
    let child = prependTrace(breadcrumb('child-0'))
    for (let i = 1; i < MaxTraceDepth; i++) child = prependTrace(breadcrumb(`child-${i}`), child)

    const trace = appendTrace(child, prependTrace(breadcrumb('parent')))

    assert.equal(trace.depth, MaxTraceDepth)
    assert.equal(trace.truncated, true)
    assert.equal(messagesOf(trace)[0], 'child-31')
    assert.equal(messagesOf(trace).includes('parent'), false)
  })

  it('does not read stack sources when constructing or trimming traces', () => {
    let reads = 0
    let trace = prependTrace(stackReadingBreadcrumb('frame-0', () => { reads += 1 }))

    for (let i = 1; i < MaxTraceDepth + 5; i++) {
      trace = prependTrace(stackReadingBreadcrumb(`frame-${i}`, () => { reads += 1 }), trace)
    }

    assert.equal(reads, 0)
    assert.equal(trace.depth, MaxTraceDepth)
  })

  it('reads stack sources when formatting traces', () => {
    let reads = 0
    const trace = prependTrace(stackReadingBreadcrumb('frame', () => { reads += 1 }))

    const formatted = formatTrace(trace)

    assert.equal(reads, 1)
    assert.match(formatted, /at frame/)
    assert.match(formatted, /Trace\.test\.ts/)
  })

  it('snapshots traces with metadata and lazily parsed stack locations', () => {
    let reads = 0
    const trace = prependTrace(
      stackReadingBreadcrumb('child', () => { reads += 1 }),
      prependTrace(breadcrumb('parent'), undefined, { kind: 'race' }),
      { kind: 'race', index: 1 }
    )

    assert.equal(reads, 0)

    const snapshot = snapshotTrace(trace)

    assert.equal(reads, 1)
    assert.equal(snapshot.truncated, false)
    assert.equal(snapshot.cycleDetected, false)
    assert.equal(snapshot.frames[0].message, 'child')
    assert.equal(snapshot.frames[0].kind, 'race')
    assert.equal(snapshot.frames[0].index, 1)
    assert.equal(snapshot.frames[0].location?.functionName, 'fake')
    assert.equal(snapshot.frames[0].location?.file, import.meta.filename)
    assert.equal(snapshot.frames[0].location?.line, 1)
    assert.equal(snapshot.frames[0].location?.column, 1)
    assert.equal(snapshot.frames[1].kind, 'race')
  })

  it('snapshots file-only stack locations and preserves unparsed raw locations', () => {
    const fileOnly = prependTrace(stackBreadcrumb('file', `Error: file\n    at file://${import.meta.filename}:2:3`))
    const unknown = prependTrace(stackBreadcrumb('unknown', 'Error: unknown\n    at native'))

    assert.equal(snapshotTrace(fileOnly).frames[0].location?.file, `file://${import.meta.filename}`)
    assert.equal(snapshotTrace(fileOnly).frames[0].location?.line, 2)
    assert.equal(snapshotTrace(fileOnly).frames[0].location?.column, 3)
    assert.equal(snapshotTrace(unknown).frames[0].location?.raw, 'at native')
    assert.equal(snapshotTrace(unknown).frames[0].location?.file, undefined)
  })

  it('detects cycles while formatting traces', () => {
    const trace = { frame: { message: 'cycle' }, depth: 1, truncated: false } as Trace & { parent?: Trace }
    trace.parent = trace

    assert.match(formatTrace(trace), /<trace cycle detected>/)
    assert.equal(snapshotTrace(trace).cycleDetected, true)
  })

  it('attaches trace metadata non-enumerably', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const error = new Error('boom')

    attachTrace(error, trace)

    assert.equal(getTrace(error), trace)
    assert.deepEqual(Object.keys(error), [])
  })

  it('formats untraced errors as an error message', () => {
    assert.equal(formatError(new TypeError('boom')), 'TypeError: boom')
  })

  it('formats traced errors with root cause message and Fx trace', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const cause = new Error('root failed')
    const error = new Error('wrapper failed', { cause })
    attachTrace(error, trace)

    assert.equal(formatError(error), [
      'Error: root failed',
      '  at frame'
    ].join('\n'))
  })

  it('formats Fail values using the wrapped error and Fail trace', () => {
    const failure = new Fail(new Error('boom'), {
      origin: breadcrumb('failed here'),
      trace: prependTrace(breadcrumb('failed here'))
    })

    assert.equal(formatDiagnostic(failure, { colors: 'never' }), [
      'Error: boom',
      'Fx trace:',
      '  at failed here'
    ].join('\n'))
  })

  it('formats aggregate errors with compact indexed child summaries', () => {
    const child = new Error('wrapped child', { cause: new TypeError('root child') })
    const aggregate = new AggregateError([child, 'plain failure'], 'aggregate failed')

    assert.equal(formatError(aggregate), [
      'AggregateError: aggregate failed',
      '  [0] TypeError: root child',
      '  [1] plain failure'
    ].join('\n'))
  })

  it('formats RaceAllFailed with compact child failure summaries', () => {
    const first = new Error('Unhandled failure in forked task', { cause: new Error('primary failed') })
    const second = new Error('Unhandled failure in forked task', { cause: new Error('replica failed') })
    const aggregate = raceAllFailed([first, second])

    assert.equal(formatError(aggregate), [
      'RaceAllFailed: All raced computations failed',
      '  [0] Error: primary failed',
      '  [1] Error: replica failed'
    ].join('\n'))
  })

  it('snapshots errors with trace, cause, code, and aggregates', () => {
    const child = new TypeError('child failed')
    attachTrace(child, prependTrace(breadcrumb('child trace'), undefined, { kind: 'fail' }))

    const aggregate = new AggregateError([child, 'plain failure'], 'aggregate failed', { cause: new Error('root cause') })
    Object.defineProperty(aggregate, 'code', { value: 'TEST_AGGREGATE' })

    const snapshot = snapshotError(aggregate)

    assert.equal(snapshot.name, 'AggregateError')
    assert.equal(snapshot.code, 'TEST_AGGREGATE')
    assert.equal(snapshot.cause?.message, 'root cause')
    assert.equal(snapshot.aggregate?.errors.length, 2)
    assert.equal(snapshot.aggregate?.errors[0].trace?.frames[0].message, 'child trace')
    assert.equal(snapshot.aggregate?.errors[0].trace?.frames[0].kind, 'fail')
    assert.equal(snapshot.aggregate?.errors[1].type, 'string')
    assert.equal(snapshot.aggregate?.errors[1].message, 'plain failure')
  })

  it('snapshots enumerable error fields without duplicating standard fields', () => {
    const error = new Error('lookup failed') as Error & {
      errno: number
      code: string
      syscall: string
      hostname: string
      request: { readonly url: URL }
    }
    error.errno = -3008
    error.code = 'ENOTFOUND'
    error.syscall = 'getaddrinfo'
    error.hostname = 'jsonplaceholderx.typicode.com'
    error.request = { url: new URL('https://jsonplaceholderx.typicode.com/users/1') }

    const snapshot = snapshotError(error)

    assert.equal(snapshot.code, 'ENOTFOUND')
    assert.deepEqual(snapshot.fields, [
      { key: 'errno', value: '-3008' },
      { key: 'syscall', value: 'getaddrinfo' },
      { key: 'hostname', value: 'jsonplaceholderx.typicode.com' },
      { key: 'request', value: '{ url: https://jsonplaceholderx.typicode.com/users/1 }' }
    ])
  })

  it('formats expanded diagnostics without changing compact error formatting', () => {
    const cause = new Error('root failed')
    attachTrace(cause, prependTrace(stackBreadcrumb('cause trace', `Error: cause\n    at fn (${import.meta.filename}:4:5)`), undefined, { kind: 'async' }))
    const error = new Error('wrapper failed', { cause })
    Object.defineProperty(error, 'code', { value: 'TEST_WRAPPER' })

    assert.equal(formatError(error), 'Error: wrapper failed')
    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /Error \[TEST_WRAPPER\]: wrapper failed/)
    assert.match(formatted, /Fx trace:/)
    assert.match(formatted, /Caused by:/)
    assert.match(formatted, /at cause trace \[async\]/)
    assert.match(formatted, new RegExp(`${escapeRegExp(import.meta.filename)}:4:5`))
  })

  it('formats enumerable error fields in expanded diagnostics', () => {
    const error = new Error('HTTP request failed') as Error & {
      request: { readonly method: string, readonly url: URL }
      cause: Error & { readonly code: string, readonly syscall: string, readonly hostname: string }
    }
    error.request = {
      method: 'GET',
      url: new URL('https://jsonplaceholderx.typicode.com/users/1')
    }
    Object.defineProperty(error, 'cause', {
      value: Object.assign(new TypeError('fetch failed'), {
        code: 'ENOTFOUND',
        syscall: 'getaddrinfo',
        hostname: 'jsonplaceholderx.typicode.com'
      })
    })

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /Error: HTTP request failed/)
    assert.match(formatted, /request: \{ method: GET, url: https:\/\/jsonplaceholderx\.typicode\.com\/users\/1 \}/)
    assert.match(formatted, /Caused by:\n  TypeError \[ENOTFOUND\]: fetch failed/)
    assert.match(formatted, /syscall: getaddrinfo/)
    assert.match(formatted, /hostname: jsonplaceholderx\.typicode\.com/)
  })

  it('formats diagnostics without ansi escapes when colors are disabled', () => {
    const error = tracedError('plain', 'plain trace', { kind: 'fail' })
    Object.defineProperty(error, 'code', { value: 'TEST_PLAIN' })

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.doesNotMatch(formatted, ansiPattern)
    assert.match(formatted, /Error \[TEST_PLAIN\]: plain/)
  })

  it('formats diagnostics with ansi escapes when colors are forced', () => {
    const error = tracedError('colored', 'colored trace', { kind: 'timeout' })
    Object.defineProperty(error, 'code', { value: 'TEST_COLOR' })

    const formatted = formatDiagnostic(error, { colors: 'always' })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /Error \[TEST_COLOR\]: colored/)
    assert.match(stripAnsi(formatted), /at colored trace \[timeout\]/)
    assert.match(stripAnsi(formatted), new RegExp(`${escapeRegExp(import.meta.filename)}:10:11`))
  })

  it('formats diagnostics without ansi escapes by default in non-tty test runs', () => {
    const previousNoColor = process.env.NO_COLOR
    const previousForceColor = process.env.FORCE_COLOR
    delete process.env.FORCE_COLOR
    process.env.NO_COLOR = '1'
    try {
      const formatted = formatDiagnostic(tracedError('default plain', 'default trace'))

      assert.doesNotMatch(formatted, ansiPattern)
    } finally {
      restoreEnv('FORCE_COLOR', previousForceColor)
      restoreEnv('NO_COLOR', previousNoColor)
    }
  })

  it('formats indexed race metadata as a child label', () => {
    const error = tracedError('race failed', 'race trace', { kind: 'race', index: 1 })

    assert.match(formatDiagnostic(error, { colors: 'never' }), /at race trace \[race child #1\]/)
  })

  it('compacts same-location all child and parent frames', () => {
    const error = tracedError(
      'all failed',
      'fx/Fail/fail',
      { kind: 'fail' },
      concurrencyTrace('all', 0, 20, 21, 20, 21)
    )

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /at fx\/Concurrent\/all\[0\] \[all child #0\]/)
    assert.doesNotMatch(formatted, /at fx\/Concurrent\/all \[all\]/)
  })

  it('compacts same-location race child and parent frames', () => {
    const error = tracedError(
      'race failed',
      'fx/Fail/fail',
      { kind: 'fail' },
      concurrencyTrace('race', 1, 20, 21, 20, 21)
    )

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /at fx\/Concurrent\/race\[1\] \[race child #1\]/)
    assert.doesNotMatch(formatted, /at fx\/Concurrent\/race \[race\]/)
  })

  it('compacts same-location firstSuccess child and parent race-kind frames', () => {
    const error = tracedError(
      'firstSuccess failed',
      'fx/Fail/fail',
      { kind: 'fail' },
      concurrencyTrace('race', 1, 20, 21, 20, 21, 'fx/Concurrent/firstSuccess')
    )

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /at fx\/Concurrent\/firstSuccess\[1\] \[race child #1\]/)
    assert.doesNotMatch(formatted, /at fx\/Concurrent\/firstSuccess \[race\]/)
  })

  it('keeps different-location concurrency child and parent frames', () => {
    const error = tracedError(
      'all failed',
      'fx/Fail/fail',
      { kind: 'fail' },
      concurrencyTrace('all', 0, 20, 21, 22, 23)
    )

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.match(formatted, /at fx\/Concurrent\/all\[0\] \[all child #0\]/)
    assert.match(formatted, /at fx\/Concurrent\/all \[all\]/)
  })

  it('formats source snippets with default one-line context', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.match(formatted, /9 \| const previous = value/)
    assert.match(formatted, /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.match(formatted, /\| {11}\^/)
    assert.match(formatted, /11 \| return previous/)
  })

  it('formats source snippets with zero context lines', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => sourceFixture, contextLines: 0 }
    })

    assert.doesNotMatch(formatted, /9 \| const previous = value/)
    assert.match(formatted, /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.doesNotMatch(formatted, /11 \| return previous/)
  })

  it('falls back when source lookup is missing or throws', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })

    assert.doesNotThrow(() => formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => { throw new Error('lookup failed') } }
    }))
    assert.doesNotMatch(formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => undefined }
    }), /10 \|/)
  })

  it('formats one source snippet per aggregate child unique trace prefix', () => {
    const first = tracedErrorAt('primary failed', 'fx/Fail/fail', 10, 11, { kind: 'fail' }, sharedRaceTrace(0))
    const second = tracedErrorAt('replica failed', 'fx/Fail/fail', 10, 11, { kind: 'fail' }, sharedRaceTrace(1))
    const aggregate = raceAllFailed([first, second])
    const formatted = formatDiagnostic(aggregate, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.equal(countOccurrences(formatted, "10 | yield* fail(new Error('boom'))"), 2)
    assert.match(formatted, /Shared parent trace:/)
    assert.doesNotMatch(formatted, /19 \|/)
  })

  it('colors source snippet gutter and caret when colors are forced', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'always',
      source: { lookup: () => sourceFixture }
    })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.match(stripAnsi(formatted), /\| {11}\^/)
    const esc = String.fromCharCode(27)

    assert.ok(formatted.includes(`${esc}[2m 9 |${esc}[0m ${esc}[2mconst previous = value${esc}[0m`))
    assert.ok(formatted.includes(`${esc}[2m10 |${esc}[0m ${esc}[2myield* fai${esc}[0ml(new Error('boom'))`))
    assert.ok(formatted.includes(`${esc}[2m11 |${esc}[0m ${esc}[2mreturn previous${esc}[0m`))
  })

  it('compacts cause traces already shown by the parent trace', () => {
    const cause = tracedError('child failed', 'shared child trace', { kind: 'fail' })
    const parent = new Error('wrapper failed', { cause })
    attachTrace(parent, appendTrace(getTrace(cause) as ReturnType<typeof prependTrace>, prependTrace(breadcrumb('parent trace'))))

    const formatted = formatDiagnostic(parent, { colors: 'never' })

    assert.equal(countOccurrences(formatted, 'Fx trace:'), 1)
    assert.match(formatted, /<trace already shown above>/)
    assert.match(formatted, /Caused by:\n  Error: child failed/)
  })

  it('compacts nested fork-style wrapper traces without duplicating source snippets', () => {
    const root = new Error('root failed')
    const inner = new Error('Unhandled failure in forked task', { cause: root })
    Object.defineProperty(inner, 'code', { value: 'FX_UNHANDLED_FAILURE' })
    attachTrace(inner, prependTrace(
      stackBreadcrumb('fx/Fail/fail', `Error: fail\n    at fail (${import.meta.filename}:10:11)`),
      prependTrace(stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:20:21)`), undefined, { kind: 'fork' }),
      { kind: 'fail' }
    ))

    const outer = new Error('Unhandled failure in forked task', { cause: inner })
    Object.defineProperty(outer, 'code', { value: 'FX_UNHANDLED_FAILURE' })
    attachTrace(outer, prependTrace(
      stackBreadcrumb('fx/Fail/fail', `Error: fail\n    at fail (${import.meta.filename}:10:11)`),
      prependTrace(
        stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:20:21)`),
        prependTrace(stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:30:31)`), undefined, { kind: 'fork' }),
        { kind: 'fork' }
      ),
      { kind: 'fail' }
    ))

    const formatted = formatDiagnostic(outer, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.equal(countOccurrences(formatted, 'Error [FX_UNHANDLED_FAILURE]: Unhandled failure in forked task'), 2)
    assert.equal(countOccurrences(formatted, '<trace already shown above>'), 1)
    assert.equal(countOccurrences(formatted, "10 | yield* fail(new Error('boom'))"), 1)
    assert.match(formatted, /Caused by:\n    Error: root failed/)
  })

  it('does not compact cause traces not shown by the parent trace', () => {
    const cause = tracedError('child failed', 'child trace', { kind: 'fail' })
    const parent = tracedError('wrapper failed', 'parent trace', { kind: 'fork' })
    Object.defineProperty(parent, 'cause', { value: cause })

    const formatted = formatDiagnostic(parent, { colors: 'never' })

    assert.equal(countOccurrences(formatted, 'Fx trace:'), 2)
    assert.doesNotMatch(formatted, /<trace already shown above>/)
    assert.match(formatted, /at child trace \[fail\]/)
  })

  it('colors compacted cause trace notes when colors are forced', () => {
    const cause = tracedError('child failed', 'shared child trace', { kind: 'fail' })
    const parent = new Error('wrapper failed', { cause })
    attachTrace(parent, appendTrace(getTrace(cause) as ReturnType<typeof prependTrace>, prependTrace(breadcrumb('parent trace'))))

    const formatted = formatDiagnostic(parent, { colors: 'always' })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /<trace already shown above>/)
  })

  it('formats RaceAllFailed aggregates as failed race children with shared parent trace', () => {
    const first = tracedError('primary failed', 'fx/Fail/fail', { kind: 'fail' }, sharedRaceTrace(0))
    const second = tracedError('replica failed', 'fx/Fail/fail', { kind: 'fail' }, sharedRaceTrace(1))
    const aggregate = raceAllFailed([first, second])

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.match(formatted, /RaceAllFailed \[FX_RACE_ALL_FAILED\]: All raced computations failed/)
    assert.match(formatted, /Failed race children:/)
    assert.match(formatted, /\n  \[0\]\n/)
    assert.match(formatted, /\n  \[1\]\n/)
    assert.match(formatted, /at fx\/Concurrent\/race\[1\] \[race child #1\]/)
    assert.match(formatted, /Shared parent trace:/)
    assert.equal(countOccurrences(formatted, 'at fx/Concurrent/race [race]'), 1)
  })

  it('formats generic aggregates as aggregate errors', () => {
    const first = tracedError('child failed', 'child trace', { kind: 'fail' })
    const aggregate = new AggregateError([first, 'plain failure'], 'aggregate failed')

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.match(formatted, /AggregateError: aggregate failed/)
    assert.match(formatted, /Aggregate errors:/)
    assert.match(formatted, /\n  \[0\]\n/)
    assert.match(formatted, /\n  \[1\]\n/)
    assert.match(formatted, /string: plain failure/)
  })

  it('does not deduplicate aggregate traces without a common trailing parent frame', () => {
    const first = tracedError('first failed', 'first child', { kind: 'fail' }, prependTrace(breadcrumb('first parent'), undefined, { kind: 'fork' }))
    const second = tracedError('second failed', 'second child', { kind: 'fail' }, prependTrace(breadcrumb('second parent'), undefined, { kind: 'fork' }))
    const aggregate = new AggregateError([first, second], 'aggregate failed')

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.doesNotMatch(formatted, /Shared parent trace:/)
    assert.match(formatted, /at first parent \[fork\]/)
    assert.match(formatted, /at second parent \[fork\]/)
  })

  it('keeps compact error and trace formatting unchanged', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const cause = new Error('root failed')
    const error = new Error('wrapper failed', { cause })
    attachTrace(error, trace)

    assert.equal(formatError(error), [
      'Error: root failed',
      '  at frame'
    ].join('\n'))
    assert.equal(formatTrace(trace), '  at frame')
  })
})

const breadcrumb = (message: string): Breadcrumb => ({ message })

const stackReadingBreadcrumb = (message: string, onRead: () => void): Breadcrumb => ({
  message,
  get stack() {
    onRead()
    return `Error: ${message}\n    at fake (${import.meta.filename}:1:1)`
  }
})

const stackBreadcrumb = (message: string, stack: string): Breadcrumb => ({
  message,
  stack
})

const tracedError = (
  message: string,
  traceMessage: string,
  metadata = {},
  parent?: ReturnType<typeof prependTrace>
) => {
  return tracedErrorAt(message, traceMessage, 10, 11, metadata, parent)
}

const tracedErrorAt = (
  message: string,
  traceMessage: string,
  line: number,
  column: number,
  metadata = {},
  parent?: ReturnType<typeof prependTrace>
) => {
  const error = new Error(message)
  attachTrace(error, prependTrace(
    stackBreadcrumb(traceMessage, `Error: ${traceMessage}\n    at fn (${import.meta.filename}:${line}:${column})`),
    parent,
    metadata
  ))
  return error
}

const sharedRaceTrace = (index: number) =>
  prependTrace(
    stackBreadcrumb(`fx/Concurrent/race[${index}]`, `Error: race child\n    at child (${import.meta.filename}:20:21)`),
    prependTrace(
      stackBreadcrumb('fx/Concurrent/race', `Error: race\n    at race (${import.meta.filename}:19:20)`),
      undefined,
      { kind: 'race' }
    ),
    { kind: 'race', index }
  )

const concurrencyTrace = (
  kind: 'all' | 'race',
  index: number,
  childLine: number,
  childColumn: number,
  parentLine: number,
  parentColumn: number,
  message = `fx/Concurrent/${kind}`
) =>
  prependTrace(
    stackBreadcrumb(
      `${message}[${index}]`,
      `Error: ${kind} child\n    at child (${import.meta.filename}:${childLine}:${childColumn})`
    ),
    prependTrace(
      stackBreadcrumb(
        message,
        `Error: ${kind}\n    at ${kind} (${import.meta.filename}:${parentLine}:${parentColumn})`
      ),
      undefined,
      { kind }
    ),
    { kind, index }
  )

const raceAllFailed = (errors: readonly unknown[]) => {
  const error = new Error('All raced computations failed')
  Object.defineProperty(error, 'name', { value: 'RaceAllFailed' })
  Object.defineProperty(error, 'code', { value: 'FX_RACE_ALL_FAILED' })
  Object.defineProperty(error, 'errors', { value: errors })
  return error
}

const messagesOf = (trace: ReturnType<typeof prependTrace>) => {
  const messages: string[] = []
  let current: typeof trace | undefined = trace
  while (current !== undefined) {
    messages.push(current.frame.message)
    current = current.parent
  }
  return messages
}

const traceMessages = (e: unknown) => {
  const trace = getTrace(e)
  return trace === undefined ? [] : messagesOf(trace)
}

const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ansiPattern = ansiRegex()

const stripAnsi = (s: string) =>
  s.replaceAll(ansiRegex('g'), '')

const countOccurrences = (s: string, pattern: string) =>
  s.split(pattern).length - 1

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const sourceFixture = [
  'const one = 1',
  'const two = 2',
  'const three = 3',
  'const four = 4',
  'const five = 5',
  'const six = 6',
  'const seven = 7',
  'const value = one + two',
  'const previous = value',
  "yield* fail(new Error('boom'))",
  'return previous',
  'const done = true'
].join('\n')

function ansiRegex(flags?: string): RegExp {
  return new RegExp(`${escapeRegExp(String.fromCharCode(27))}\\[[0-9;]+m`, flags)
}
