import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, Abort, orReturn } from './Abort.js'
import { fx, ok, run } from './Fx.js'
import { scope } from './Scope.js'

describe('Abort', () => {
  const TestScope = 'test/Abort' as const

  describe('scope', () => {
    it('given matching Abort with fallback, returns alternative', () => {
      const r = Math.random()
      const a = abort(TestScope).pipe(scope(TestScope), orReturn(TestScope, r), run)

      assert.equal(a, r)
    })

    it('given success, returns original value', () => {
      const r = Math.random()
      const a = ok(r).pipe(scope(TestScope), orReturn(TestScope, r + 1), run)

      assert.equal(a, r)
    })

    it('leaves matching Abort unhandled when fallback is omitted', () => {
      const f = abort(TestScope).pipe(scope(TestScope))
      const _: typeof f extends import('./Fx.js').Fx<Abort<typeof TestScope>, never> ? true : false = true

      assert.equal(Abort.is(f[Symbol.iterator]().next().value), true)
    })

    it('does not handle Abort from a different scope', () => {
      const OtherScope = 'test/Abort/other' as const
      const f = fx(function* () {
        yield* abort(OtherScope)
        return 'done'
      }).pipe(scope(TestScope), orReturn(TestScope, 'aborted'))

      assert.equal(Abort.is(f[Symbol.iterator]().next().value), true)
    })
  })
})
