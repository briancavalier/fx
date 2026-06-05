import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { at } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { fx, ok, run, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { captureHandlers, closeHandlerCapture, withHandlerContext } from './HandlerCapture.js'

import { Catch, Fail, catchAll, fail, failFrom, returnFail, returnIf, returnOnly, runCatch } from './Fail.js'
import { getTrace, withTraceCapture } from './Trace.js'
import { runFork } from './internal/runFork.js'

describe('Fail', () => {
  describe('fail', () => {
    it('reports the fail call site for unhandled failures', async () => {
      const cause = new Error('failed')

      await assert.rejects(
        runFork(fail(cause)).promise,
        e => e instanceof Error
          && firstLine(e).includes('fx/Fail/fail')
          && (e.stack ?? '').includes('Fail.test.ts')
          && traceMessages(e)[0] === 'fx/Fail/fail'
          && traceMessages(e).includes('fx/runFork')
          && e.cause === cause
      )
    })

    it('accepts an explicit origin', async () => {
      const cause = new Error('failed')
      const origin = at('test/fail-origin')

      await assert.rejects(
        runFork(fail(cause, origin)).promise,
        e => e instanceof Error
          && firstLine(e).includes('test/fail-origin')
          && traceMessages(e)[0] === 'test/fail-origin'
          && e.cause === cause
      )
    })
  })

  describe('failFrom', () => {
    it('uses its fallback origin when the effect has no trace origin', async () => {
      class TestEffect extends Effect('test/Effect')<void, void> { }
      const cause = new Error('failed')
      const origin = at('test/fail-from-fallback')

      await assert.rejects(
        runFork(failFrom(new TestEffect(), cause, origin)).promise,
        e => e instanceof Error
          && firstLine(e).includes('test/fail-from-fallback')
          && traceMessages(e)[0] === 'test/fail-from-fallback'
          && e.cause === cause
      )
    })
  })

  describe('Catch', () => {
    it('raw Catch is an effect that needs runCatch', () => {
      assert.throws(() => {
        run(new Catch({
          body: ok('body'),
          match: (_): _ is never => true,
          recover: ok
        }) as never)
      }, /Unhandled effect in run/)
    })

    it('runCatch answers raw Catch with an Fx', () => {
      const expected = Math.random()

      const handled = run(runCatch(new Catch({
        body: ok(expected),
        match: (_): _ is never => true,
        recover: ok
      })))

      const actual = run(handled)
      assert.equal(actual, expected)
    })

    it('explicit direct use works with two yield* calls', () => {
      const expected = Math.random()

      const actual = run(fx(function* () {
        const handled = yield* new Catch({
          body: ok(expected),
          match: (_): _ is never => true,
          recover: ok
        })
        return yield* handled
      }).pipe(runCatch))

      assert.equal(actual, expected)
    })

    it('helper usage interprets Catch internally', () => {
      const actual = run(fail('failed').pipe(catchAll(ok)))

      assert.equal(actual, 'failed')
    })

    it('given matching failure, runs recovery and skips the rest of the body', () => {
      const events: string[] = []
      const f = fx(function* () {
        events.push('before')
        yield* fail('failed')
        events.push('after')
        return 'body'
      })

      const actual = run(f.pipe(catchAll(error => {
        events.push(`recover:${error}`)
        return ok('recovered')
      })))

      assert.equal(actual, 'recovered')
      assert.deepEqual(events, ['before', 'recover:failed'])
    })

    it('given recovery failure, propagates recovery failure outward', () => {
      const actual = run(fail('body').pipe(
        catchAll(() => fail('recovery')),
        returnFail
      ))

      assert.ok(actual instanceof Fail)
      assert.equal(actual.arg, 'recovery')
    })

    it('runs recovery in the caught failure runtime context', async () => {
      const actual = await fail('body').pipe(
        withTraceCapture('off'),
        catchAll(() => fail(new Error('recovery'))),
        returnFail,
        runPromise
      )

      assert.ok(actual instanceof Fail)
      assert.equal(actual.trace, undefined)
    })

    it('uses the nearest matching catch region', () => {
      const actual = run(fail('inner').pipe(
        catchAll(error => fail(`outer:${error}`).pipe(
          catchAll(inner => ok(`inner:${inner}`))
        ))
      ))

      assert.equal(actual, 'inner:outer:inner')
    })

    it('lets an outer catch recover a non-matching failure from a nested raw Catch', () => {
      const f = fx(function* () {
        const handled = yield* new Catch({
          body: fail('nested'),
          match: (_): _ is never => false,
          recover: ok
        })
        return yield* handled
      })

      const actual = run(f.pipe(
        runCatch,
        catchAll(error => ok(`outer:${error}`))
      ))

      assert.equal(actual, 'outer:nested')
    })

    it('runs body cleanup when failure stops the body', () => {
      const events: string[] = []
      const f = fx(function* () {
        try {
          events.push('body')
          yield* fail('failed')
        } finally {
          events.push('cleanup')
        }
      })

      const actual = run(f.pipe(catchAll(error => {
        events.push('recover')
        return ok(error)
      })))

      assert.equal(actual, 'failed')
      assert.deepEqual(events, ['body', 'recover', 'cleanup'])
    })

    it('handles matching failures yielded during stopped body cleanup', () => {
      const actual = run(fx(function* () {
        try {
          yield* fail('body')
        } finally {
          yield* fail('cleanup')
        }
      }).pipe(catchAll(ok)))

      assert.equal(actual, 'body')
    })

    it('runs body cleanup when an active catch region is closed', () => {
      class Wait extends Effect('test/Fail/Catch/Wait')<void, void> { }
      const events: string[] = []
      const f = fx(function* () {
        const handled = yield* new Catch({
          body: fx(function* () {
            try {
              yield* new Wait()
            } finally {
              events.push('cleanup')
            }
          }),
          match: (_): _ is never => true,
          recover: ok
        })
        return yield* handled
      }).pipe(runCatch)

      const iterator = f[Symbol.iterator]()
      iterator.next()
      iterator.return?.()

      assert.deepEqual(events, ['cleanup'])
    })

    it('lets ordinary handlers interpret body and recovery effects', () => {
      class Ask extends Effect('test/Fail/Catch/Ask')<void, string> { }

      const actual = run(fx(function* () {
        const fromBody = yield* new Ask()
        yield* fail(fromBody)
      }).pipe(
        catchAll(error => fx(function* () {
          return `${error}:${yield* new Ask()}`
        })),
        handle(Ask, () => ok('handled'))
      ))

      assert.equal(actual, 'handled:handled')
    })

    it('does not need a captured Fail control handler for delayed catch regions', () => {
      class Ask extends Effect('test/Fail/Catch/CapturedAsk')<void, string> { }

      const delayed = run(fx(function* () {
        const context = yield* captureHandlers('test/Fail/Catch')
        return withHandlerContext(context, fail('failed').pipe(
          catchAll(() => new Ask())
        ))
      }).pipe(
        handle(Ask, () => ok('captured')),
        closeHandlerCapture('test/Fail/Catch')
      ))
      const actual = run(delayed as never)

      assert.equal(actual, 'captured')
    })
  })

  describe('returnIf', () => {
    it('given no failures, returns result', () => {
      const expected = Math.random()
      const f = ok(expected)

      const actual = run(f.pipe(returnIf((_): _ is never => true)))
      assert.equal(actual, expected)
    })

    it('given non-matching failure, return neither result nor failure', () => {
      const unexpected = Math.random()
      const f = fx(function* () {
        yield* fail(unexpected)
        return unexpected
      })

      assert.throws(() => {
        // @ts-expect-error failure is not handled
        run(f.pipe(returnIf((x): x is string => typeof x === 'string')))
      }, /Unhandled effect in run/)
    })

    it('given matching failure, returns failure', () => {
      const expected = Math.random()
      const f = fx(function* () {
        yield* fail(expected)
        return -1
      })

      const actual = run(f.pipe(returnIf((x): x is number => typeof x === 'number')))
      assert.equal(actual, expected)
    })
  })

  describe('returnOnly', () => {
    class CustomError extends Error {
      name = 'CustomError' as const
    }

    it('given no failures, returns result', () => {
      const expected = Math.random()
      const f = ok(expected)
      const actual = run(f.pipe(returnOnly(Error)))
      assert.equal(actual, expected)
    })

    it('given non-matching failure, return neither result nor failure', () => {
      const unexpected = Math.random()
      const f = fx(function* () {
        yield* fail(new Error('Unexpected'))
        return unexpected
      })

      assert.throws(() => {
        // @ts-expect-error failure is not handled
        run(f.pipe(returnOnly(CustomError)))
      }, /Unhandled effect in run/)
    })

    it('given matching failure, returns failure', () => {
      const expected = new CustomError('expected')
      const f = fx(function* () {
        yield* fail(expected)
        return -1
      })

      const actual = run(f.pipe(returnOnly(CustomError)))
      assert.equal(actual, expected)
    })
  })

  describe('returnFail', () => {
    it('given no failures, returns result', () => {
      const expected = Math.random()
      const f = ok(expected)

      const actual = f.pipe(returnFail, run)
      assert.equal(actual, expected)
    })

    it('given failure, returns failure wrapped with Fail', () => {
      const expected = Math.random()
      const f = fx(function* () {
        yield* fail(expected)
        return -1
      })

      const actual = f.pipe(returnFail, run)
      assert.ok(actual instanceof Fail)
      assert.equal(actual.arg, expected)
    })
  })
})

const firstLine = (e: Error): string =>
  e.stack?.split('\n')[0] ?? ''

const traceMessages = (e: Error) => {
  const messages: string[] = []
  let trace = getTrace(e)
  while (trace !== undefined) {
    messages.push(trace.frame.message)
    trace = trace.parent
  }
  return messages
}
