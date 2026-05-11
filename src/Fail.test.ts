import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { at } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { fx, ok, run } from './Fx.js'

import { Fail, fail, failFrom, returnFail, returnIf, returnOnly } from './Fail.js'
import { getTrace } from './Trace.js'
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

      // @ts-expect-error failure is not handled
      const result = run(f.pipe(returnIf((x): x is string => typeof x === 'string')))
      assert.notEqual(result, unexpected)
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

      // @ts-expect-error failure is not handled
      const result = run(f.pipe(returnOnly(CustomError)))
      assert.notEqual(result, unexpected)
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
