import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise, tryPromise } from './Async'
import { catchFail } from './Fail'
import { runPromise } from './Fx'

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
        .pipe(runPromise), e => (e as Error).cause === expected)
    })
  })

  describe('tryPromise', () => {
    it('given fulfilled promise, returns result', async () => {
      const expected = {}

      const actual = await tryPromise(() => Promise.resolve(expected))
        .pipe(
          catchFail,
          runPromise
        )

      assert.equal(actual, expected)
    })

    it('given rejected promise, produces Fail', async () => {
      const expected = new Error()

      const actual = await tryPromise(() => Promise.reject(expected))
        .pipe(
          catchFail,
          runPromise
        )

      assert.equal(actual.arg, expected)
    })
  })
})
