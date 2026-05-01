import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareAndSet, of } from './Ref'

describe('Ref', () => {
  describe('compareAndSet', () => {
    it('given equal current value, sets new value and returns true', () => {
      const r = of(1)
      assert.ok(compareAndSet(r, 1, 2))
    })

    it('given unequal current value, does not set new value and returns false', () => {
      const r = of(1)
      assert.ok(!compareAndSet(r, 2, 3))
    })
  })
})
