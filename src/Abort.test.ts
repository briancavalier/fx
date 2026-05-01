import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, orReturn } from './Abort.js'
import { ok, run } from './Fx.js'

describe('Abort', () => {
  describe('orReturn', () => {
    it('given Abort, returns alternative', () => {
      const r = Math.random()
      const a = abort.pipe(orReturn(r), run)

      assert.equal(a, r)
    })

    it('given success, returns original value', () => {
      const r = Math.random()
      const a = ok(r).pipe(orReturn(r + 1), run)

      assert.equal(a, r)
    })
  })
})
