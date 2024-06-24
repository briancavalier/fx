import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fx, ok, run } from './Fx'

import { catchOnly, fail } from './Fail'

describe('Fail', () => {
  describe('catchOnly', () => {
    it('given no failures, returns result', () => {
      const expected = Math.random()
      const f = ok(expected)

      const actual = run(f.pipe(catchOnly((x): x is unknown => true)))
      assert.equal(actual, expected)
    })

    it('given non-matching failure, return neither result nor failure', () => {
      const unexpected = Math.random()
      const f = fx(function* () {
        yield* fail(unexpected)
        return unexpected
      })

      // @ts-expect-error failure is not handled
      const result = run(f.pipe(catchOnly((x): x is string => typeof x === 'string')))
      assert.notEqual(result, unexpected)
    })

    it('given matching failure, returns failure', () => {
      const result = Math.random()
      const expected = 1 + result
      const f = fx(function* () {
        yield* fail(expected)
        return result
      })

      const actual = run(f.pipe(catchOnly((x): x is number => typeof x === 'number')))
      assert.equal(actual, expected)
    })
  })

})
