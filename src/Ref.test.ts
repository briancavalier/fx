import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Ref } from './Ref.js'

describe('Ref', () => {
  it('gets the initial value', () => {
    const r = new Ref(1)

    assert.equal(r.get(), 1)
  })

  describe('compareAndSet', () => {
    it('given equal current value, sets new value and returns true', () => {
      const r = new Ref(1)

      assert.equal(r.compareAndSet(1, 2), true)
      assert.equal(r.get(), 2)
    })

    it('given unequal current value, does not set new value and returns false', () => {
      const r = new Ref(1)

      assert.equal(r.compareAndSet(2, 3), false)
      assert.equal(r.get(), 1)
    })

    it('uses Object.is equality by default', () => {
      assert.equal(new Ref(NaN).compareAndSet(NaN, 1), true)

      const r = new Ref(0)
      assert.equal(r.compareAndSet(-0, 1), false)
      assert.equal(r.get(), 0)
    })

    it('uses custom equality when provided', () => {
      const r = new Ref({ id: 1, value: 'one' }, (current, expected) => current.id === expected.id)

      assert.equal(r.compareAndSet({ id: 1, value: 'uno' }, { id: 2, value: 'two' }), true)
      assert.deepEqual(r.get(), { id: 2, value: 'two' })
    })
  })
})
