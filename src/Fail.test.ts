import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fx, ok, run } from './Fx'

import { Fail, fail, returnFail, returnIf } from './Fail'

describe('Fail', () => {
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
