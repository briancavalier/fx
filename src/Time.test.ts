import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, runAsync, runSync } from './Fx'
import * as Time from './Time'
import { VirtualClock } from './internal/time'

describe('Time', () => {
  describe('now', () => {
    it('starts at origin', () => {
      const origin = BigInt(Date.now())
      const c = new VirtualClock(origin)
      const r = Time.now.pipe(Time.withClock(c), runSync)
      assert.equal(r, origin)
    })

    it('returns milliseconds since origin', async () => {
      const origin = BigInt(Date.now())
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = Time.now.pipe(Time.withClock(c), runSync)
      assert.equal(r, origin + BigInt(Math.floor(step)))
    })
  })

  describe('monotonic', () => {
    it('starts at 0', () => {
      const c = new VirtualClock(BigInt(Date.now()))
      const r = Time.monotonic.pipe(Time.withClock(c), runSync)
      assert.equal(r, 0)
    })

    it('returns milliseconds since 0', async () => {
      const origin = BigInt(Date.now())
      const c = new VirtualClock(origin)

      const step = 10000 * Math.random()
      await c.step(step)

      const r = Time.monotonic.pipe(Time.withClock(c), runSync)
      assert.equal(r, step)
    })
  })

  describe('sleep', () => {
    it('sleeps for specific milliseconds', async () => {
      const results: (readonly [number, bigint])[] = []
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

      const c = new VirtualClock(1n)
      const p = test.pipe(Time.withClock(c), runAsync).promise

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001n]])

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001n], [2000, 2001n]])

      await c.step(1000)
      assert.deepEqual(results, [[1000, 1001n], [2000, 2001n], [3000, 3001n]])

      await c.step(1000)
      const r = await p
      assert.deepEqual(r, [4000, 4001n])
    })
  })
})
