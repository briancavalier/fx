import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, runSync } from './Fx'
import { int32, int32n, split, xoroshiro128plus } from './Random'

describe('Random', () => {
  describe('xoroshiro128plus', () => {
    describe('int32', () => {
      it('given same seed, generates same sequence', () => {
        const f = fx(function* () {
          const a = yield* int32
          const b = yield* int32
          const c = yield* int32
          return [a, b, c]
        })

        const seed = Date.now()
        const r1 = f.pipe(xoroshiro128plus(seed), runSync)
        const r2 = f.pipe(xoroshiro128plus(seed), runSync)

        assert.deepEqual(r1, r2)
      })

      it('given different seed, generates different sequence', () => {
        const f = fx(function* () {
          const a = yield* int32
          const b = yield* int32
          const c = yield* int32
          return [a, b, c]
        })

        const seed = Date.now()
        const r1 = f.pipe(xoroshiro128plus(seed), runSync)
        const r2 = f.pipe(xoroshiro128plus(seed / 2), runSync)

        assert.notDeepEqual(r1, r2)
      })
    })

    describe('int32s', () => {
      it('given same seed, generates same sequence', () => {
        const f = fx(function* () {
          return yield* int32n(10)
        })

        const seed = Date.now()
        const r1 = f.pipe(xoroshiro128plus(seed), runSync)
        const r2 = f.pipe(xoroshiro128plus(seed), runSync)

        assert.deepEqual(r1, r2)
      })

      it('given different seed, generates different sequence', () => {
        const f = fx(function* () {
          return yield* int32n(10)
        })

        const seed = Date.now()
        const r1 = f.pipe(xoroshiro128plus(seed), runSync)
        const r2 = f.pipe(xoroshiro128plus(seed / 2), runSync)

        assert.notDeepEqual(r1, r2)
      })
    })

    describe('split', () => {
      it('given same seed, split generates different sequence', () => {
        const f = fx(function* () {
          return yield* int32n(10)
        })

        const seed = Date.now()
        const r1 = f.pipe(xoroshiro128plus(seed), runSync)
        const r2 = split(f).pipe(xoroshiro128plus(seed), runSync)

        assert.notDeepEqual(r1, r2)
      })
    })
  })
})
