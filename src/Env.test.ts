import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Fx, fx, run } from './Fx.js'

import { Effect } from './Effect.js'
import { Get, get, provide, provideAll, provideFrom } from './Env.js'
import { handle } from './Handler.js'

describe('Env', () => {
  describe('get', () => {
    it('given environment, returns requested items', () => {
      const f = get<{ x: number, y: string }>()
      const expected = { x: Math.random(), y: `${Math.random()}` }
      const result = run(f.pipe(provideAll(expected)))
      assert.equal(result, expected)
    })

    it('given environment, returns requested item subset', () => {
      const f = get<{ x: number }>()
      const expected = Math.random()
      const { x } = run(f.pipe(provideAll({ x: expected })))
      assert.equal(x, expected)
    })

    it('given environment, returns same items one-at-time vs all-at-once', () => {
      const f = fx(function* () {
        return [
          yield* get<{ x: number, y: string }>(),
          yield* get<{ x: number }>(),
          yield* get<{ y: string }>()
        ]
      })

      const expected = { x: Math.random(), y: `${Math.random()}` }
      const f2 = f.pipe(provideAll(expected))
      const [xy, { x }, { y }] = run(f2)

      assert.deepEqual(xy, { x, y })
    })
  })

  describe('provide', () => {
    it('given incomplete environment, is type error', () => {
      const f = get<{ x: number, y: string }>()
      // @ts-expect-error y is missing
      f.pipe(provideAll({ x: 1 }))
    })

    it('given nested environment, returns nearest items', () => {
      const f = get<{ x: number, y: string }>()
      const x = Math.random()
      const y = `${Math.random()}`

      const result = run(f.pipe(provide({ y }), provide({ x, y: '' })))

      assert.equal(result.x, x)
      assert.equal(result.y, y)
    })

    it('given partial environment, leaves missing items required', () => {
      type Ctx = {
        readonly a: string
        readonly b: number
      }

      const f = fx(function* ({ a, b }: Ctx) {
        return `${a}:${b}`
      })

      const partial = f.pipe(provide({ a: 'x' }))

      // @ts-expect-error b is still required
      const _missingB: Fx<never, string> = partial

      assert.equal(run(partial.pipe(provideAll({ b: 1 }))), 'x:1')
    })
  })

  describe('provideFrom', () => {
    type Request = {
      readonly id: string
    }

    type User = {
      readonly id: string
    }

    class Authenticate extends Effect('test/Env/Authenticate')<Request, User> { }

    const authenticate = (request: Request) =>
      new Authenticate(request)

    it('given context Fx, computes context once per run', () => {
      let runs = 0

      const withUser = provideFrom(fx(function* ({ request }: { readonly request: Request }) {
        runs += 1
        return {
          user: yield* authenticate(request)
        }
      }))

      const f = fx(function* ({ user }: { readonly user: User }) {
        return [
          user,
          (yield* get<{ readonly user: User }>()).user
        ]
      })

      const request = { id: 'request' }
      const actual = run(f.pipe(
        withUser,
        provideAll({ request }),
        handle(Authenticate, request => fx(function* () {
          return { id: `user:${request.id}` }
        }))
      ))

      assert.deepEqual(actual, [
        { id: 'user:request' },
        { id: 'user:request' }
      ])
      assert.equal(runs, 1)
    })

    it('given context Fx, provides matching keys and leaves unsatisfied keys', () => {
      const withUser = provideFrom(fx(function* ({ request }: { readonly request: Request }) {
        return {
          user: yield* authenticate(request)
        }
      }))

      const f = fx(function* ({ request, user }: { readonly request: Request, readonly user: User }) {
        return `${request.id}:${user.id}`
      })

      const secured = f.pipe(withUser)
      const request = { id: 'request' }

      const _: Fx<Get<{ readonly request: Request }> | Authenticate, string> = secured

      // @ts-expect-error request remains required
      const _missingRequest: Fx<never, string> = secured.pipe(handle(Authenticate, request => fx(function* () {
        return { id: `user:${request.id}` }
      })))

      // @ts-expect-error Authenticate remains required
      const _missingAuth: Fx<never, string> = secured.pipe(provideAll({ request }))

      const actual = run(secured.pipe(
        provideAll({ request }),
        handle(Authenticate, request => fx(function* () {
          return { id: `user:${request.id}` }
        }))
      ))

      assert.equal(actual, 'request:user:request')
    })
  })
})
