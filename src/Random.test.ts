import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, runToValue } from './Fx'
import { defaultRandom, float, int, split, xoroshiro128plus } from './Random'

describe('Random', () => {

  describe('defaultRandom', () => {
    it('given same seed, distinct handlers generate same sequences', () => {
      const f = fx(function* () {
        return [yield* int(10), yield* int(10), yield* int(10)]
      })

      const seed = 42
      const r1 = f.pipe(defaultRandom(seed), runToValue)
      const r2 = f.pipe(defaultRandom(seed), runToValue)

      assert.deepEqual(r1, r2)
    })

    it('given no seed, distinct handlers generate different sequences', () => {
      const f = fx(function* () {
        return [yield* int(10), yield* int(10), yield* int(10)]
      })

      const r1 = f.pipe(defaultRandom(), runToValue)
      const r2 = f.pipe(defaultRandom(), runToValue)

      assert.notDeepEqual(r1, r2)
    })
  })

  describe('xoroshiro128plus', () => {
    describe('int', () => {
      const ints = fx(function* () {
        const a = yield* int()
        const b = yield* int()
        const c = yield* int()
        return [a, b, c]
      })

      it('given same seed, generates same sequence', () => {
        const seed = 42
        const r1 = ints.pipe(xoroshiro128plus(seed), runToValue)
        const r2 = ints.pipe(xoroshiro128plus(seed), runToValue)

        assert.deepEqual(r1, r2)
      })

      it('given different seed, generates different sequence', () => {
        const seed = 42
        const r1 = ints.pipe(xoroshiro128plus(seed), runToValue)
        const r2 = ints.pipe(xoroshiro128plus(seed + 1), runToValue)

        assert.notDeepEqual(r1, r2)
      })
    })

    describe('float', () => {
      const floats = fx(function* () {
        const a = yield* float
        const b = yield* float
        const c = yield* float
        return [a, b, c]
      })

      it('given same seed, generates same sequence', () => {
        const seed = 42
        const r1 = floats.pipe(xoroshiro128plus(seed), runToValue)
        const r2 = floats.pipe(xoroshiro128plus(seed), runToValue)

        assert.deepEqual(r1, r2)
      })

      it('given different seed, generates different sequence', () => {
        const seed = 42
        const r1 = floats.pipe(xoroshiro128plus(seed), runToValue)
        const r2 = floats.pipe(xoroshiro128plus(seed + 1), runToValue)

        assert.notDeepEqual(r1, r2)
      })
    })

    describe('split', () => {
      it('given same seed, split generates different sequence', () => {
        const f = fx(function* () {
          return [yield* int(), yield* int(), yield* int()]
        })

        const seed = 42
        const r1 = f.pipe(xoroshiro128plus(seed), runToValue)
        const r2 = split(f).pipe(xoroshiro128plus(seed), runToValue)

        assert.notDeepEqual(r1, r2)
      })
    })
  })
})
