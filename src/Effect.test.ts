import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect'

describe('Effect', () => {
  describe('is', () => {
    it('given instance of the same effect, returns true', () => {
      class T extends Effect('T')<void, void> { }
      assert.ok(T.is(new T()))
    })

    it('given instace of a different effect, returns false', () => {
      class T extends Effect('T')<void, void> { }
      class U extends Effect('U')<void, void> { }
      assert.ok(!T.is(new U()))
      assert.ok(!U.is(new T()))
    })
  })
})
