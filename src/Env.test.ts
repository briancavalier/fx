import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fx, run } from './Fx'

import { get, provide, provideAll } from './Env'

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
  })
})
