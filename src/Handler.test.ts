import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ScopedEffect } from './Effect.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { handleScoped } from './Handler.js'

describe('Handler', () => {
  describe('handleScoped', () => {
    const TestScope = 'test/Handler/handleScoped' as const
    const OtherScope = 'test/Handler/handleScoped/other' as const

    class Request<const Scope extends string> extends ScopedEffect('test/Handler/Request')<Scope, {
      readonly value: number
    }, string> { }

    const request = <const Scope extends string>(scope: Scope, value: number): Request<Scope> =>
      new Request(scope, { value })

    it('handles effects from the matching scope', () => {
      const result = fx(function* () {
        return yield* request(TestScope, 1)
      }).pipe(
        handleScoped(Request<typeof TestScope>, TestScope, effect => ok(`handled ${effect.arg.value}`)),
        run
      )

      assert.equal(result, 'handled 1')
    })

    it('propagates same-type effects from a different scope', () => {
      const f = fx(function* () {
        yield* request(OtherScope, 2)
        return 'done'
      }).pipe(handleScoped(Request<typeof TestScope>, TestScope, () => ok('handled')))

      const _: typeof f extends Fx<Request<typeof OtherScope>, 'done'> ? true : false = true
      const next = f[Symbol.iterator]().next()

      assert.equal(Request.is(next.value), true)
      const effect = next.value as Request<typeof OtherScope>
      assert.equal(effect.scope, OtherScope)
      assert.deepEqual(effect.arg, { value: 2 })
    })

    it('narrows only matching scoped effects', () => {
      const f = fx(function* () {
        yield* request(TestScope, 1)
        yield* request(OtherScope, 2)
        return 'done'
      }).pipe(handleScoped(Request<typeof TestScope>, TestScope, () => ok('handled')))

      const _: typeof f extends Fx<Request<typeof OtherScope>, 'done'> ? true : false = true
    })
  })
})
