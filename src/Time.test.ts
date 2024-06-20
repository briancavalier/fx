import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, unsafeRun, unsafeRunPromise } from './Fx'
import * as Time from './Time'
import { VirtualClock } from './internal/time'

describe('Time', () => {
  describe('now', () => {
    it('starts at origin', () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)
      const r = Time.now.pipe(Time.withClock(c), unsafeRun)
      assert.equal(r, origin)
    })

    it('returns milliseconds since origin', async () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = Time.now.pipe(Time.withClock(c), unsafeRun)
      assert.equal(r, origin + Math.floor(step))
    })
  })

  describe('monotonic', () => {
    it('starts at 0', () => {
      const c = new VirtualClock(Date.now())
      const r = Time.monotonic.pipe(Time.withClock(c), unsafeRun)
      assert.equal(r, 0)
    })

    it('returns milliseconds since 0', async () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = Time.monotonic.pipe(Time.withClock(c), unsafeRun)
      assert.equal(r, step)
    })
  })

  describe('sleep', () => {
    it('sleeps for specific milliseconds', async () => {
      const results: (readonly [number, number])[] = []

      const test = fx(function* () {
        yield* Time.sleep(1000)
        results.push([yield* Time.monotonic, yield* Time.now])
        yield* Time.sleep(1000)
        results.push([yield* Time.monotonic, yield* Time.now])
        yield* Time.sleep(1000)
        results.push([yield* Time.monotonic, yield* Time.now])
        yield* Time.sleep(1000)
        return [yield* Time.monotonic, yield* Time.now]
      })

      const c = new VirtualClock(1)
      const p = test.pipe(Time.withClock(c), unsafeRunPromise)

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
