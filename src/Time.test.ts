import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, run, runPromise } from './Fx.js'
import { monotonic, now, sleep, withClock } from './Time.js'
import { VirtualClock } from './internal/time.js'

describe('Time', () => {
  describe('now', () => {
    it('starts at origin', () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)
      const r = now.pipe(withClock(c), run)
      assert.equal(r, origin)
    })

    it('returns milliseconds since origin', async () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = now.pipe(withClock(c), run)
      assert.equal(r, origin + Math.floor(step))
    })
  })

  describe('monotonic', () => {
    it('starts at 0', () => {
      const c = new VirtualClock(Date.now())
      const r = monotonic.pipe(withClock(c), run)
      assert.equal(r, 0)
    })

    it('returns milliseconds since 0', async () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = monotonic.pipe(withClock(c), run)
      assert.equal(r, step)
    })
  })

  describe('sleep', () => {
    it('sleeps for specific milliseconds', async () => {
      const results: (readonly [number, number])[] = []

      const test = fx(function* () {
        yield* sleep(1000)
        results.push([yield* monotonic, yield* now])
        yield* sleep(1000)
        results.push([yield* monotonic, yield* now])
        yield* sleep(1000)
        results.push([yield* monotonic, yield* now])
        yield* sleep(1000)
        return [yield* monotonic, yield* now]
      })

      const c = new VirtualClock(1)
      const p = test.pipe(withClock(c), runPromise)

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001]])

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001], [2000, 2001]])

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

      await c.step(1000)
      const r = await p
      assert.deepEqual(r, [4000, 4001])
    })
  })
})
