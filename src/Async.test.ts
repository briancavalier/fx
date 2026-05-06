import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise, tryPromise } from './Async.js'
import { Fail, returnFail } from './Fail.js'
import { runPromise } from './Fx.js'

describe('Async', () => {
  describe('assertPromise', () => {
    it('given fulfilled promise, returns result', async () => {
      const expected = {}

      const actual = await assertPromise(() => Promise.resolve(expected))
        .pipe(runPromise)

      assert.equal(actual, expected)
    })

    it('given rejected promise, throws', async () => {
      const expected = new Error()

      await assert.rejects(assertPromise(() => Promise.reject(expected))
        .pipe(runPromise), e => e instanceof Error
          && firstLine(e).includes('fx/Async/assertPromise')
          && (e.stack ?? '').includes('Async.test.ts')
          && e.cause === expected)
    })

    it('given thrown error, throws', async () => {
      const expected = new Error()

      await assert.rejects(assertPromise<never>(() => { throw expected })
        .pipe(runPromise), e => e instanceof Error
          && firstLine(e).includes('fx/Async/assertPromise')
          && (e.stack ?? '').includes('Async.test.ts')
          && e.cause === expected)
    })
  })

  describe('tryPromise', () => {
    it('given fulfilled promise, returns result', async () => {
      const expected = {}

      const actual = await tryPromise(() => Promise.resolve(expected))
        .pipe(
          returnFail,
          runPromise
        )

      assert.equal(actual, expected)
    })

    it('given rejected promise, produces Fail', async () => {
      const expected = new Error()

      const actual = await tryPromise(() => Promise.reject(expected))
        .pipe(
          returnFail,
          runPromise
        )

      assert.ok(Fail.is(actual))
      assert.equal(actual.arg, expected)
    })

    it('given thrown error, produces Fail', async () => {
      const expected = new Error()

      const actual = await tryPromise<never>(() => { throw expected })
        .pipe(
          returnFail,
          runPromise
        )

      assert.ok(Fail.is(actual))
      assert.equal(actual.arg, expected)
    })
  })
})

const firstLine = (e: Error): string =>
  e.stack?.split('\n')[0] ?? ''
