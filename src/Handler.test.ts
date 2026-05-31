import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ScopedEffect } from './Effect.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { handleScoped } from './Handler.js'
import { scope, type AnyScope } from './Scope.js'

describe('Handler', () => {
  describe('handleScoped', () => {
    const TestScope = scope('test/Handler/handleScoped')
    const OtherScope = scope('test/Handler/handleScoped/other')

    class Request<const Scope extends AnyScope> extends ScopedEffect('test/Handler/Request')<Scope, {
      readonly value: number
    }, string> { }

    const request = <const Scope extends AnyScope>(scope: Scope, value: number): Request<Scope> =>
      new Request(scope, { value })

    it('handles effects from the matching scope', () => {
      const result = fx(function* () {
        return yield* request(TestScope, 1)
      }).pipe(
        handleScoped(Request, TestScope, effect => {
          const _: typeof TestScope = effect.scope
          return ok(`handled ${effect.arg.value}`)
        }),
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

    it('handles same-type effects from a same-id scope token', () => {
      const FirstScope = scope('test/Handler/same-id')
      const SecondScope = scope('test/Handler/same-id')
      const result = fx(function* () {
        return yield* request(SecondScope, 1)
      }).pipe(handleScoped(Request, FirstScope, () => ok('handled')))

      assert.equal(run(result), 'handled')
    })

    it('narrows only matching scoped effects', () => {
      const f = fx(function* () {
        yield* request(TestScope, 1)
        yield* request(OtherScope, 2)
        return 'done'
      }).pipe(handleScoped(Request<typeof TestScope>, TestScope, () => ok('handled')))

      const _: typeof f extends Fx<Request<typeof OtherScope>, 'done'> ? true : false = true
    })

    it('narrows residual union scopes', () => {
      const scope = (true as boolean) ? TestScope : OtherScope
      const f = fx(function* () {
        yield* request(scope, 1)
        return 'done'
      }).pipe(handleScoped(Request<typeof TestScope | typeof OtherScope>, TestScope, () => ok('handled')))

      type ResidualScope = typeof f extends Fx<infer E, 'done'>
        ? E extends { readonly scope: infer Scope } ? Scope : never
        : never

      const _: ResidualScope extends typeof OtherScope ? true : false = true
    })
  })
})
