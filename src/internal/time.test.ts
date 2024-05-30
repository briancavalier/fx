import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, runAsync, runSync } from '../Fx'
import * as Time from '../Time'
import { dispose } from './disposable'
import { VirtualClock } from './time'

describe('time', () => {
  describe('VirtualClock', () => {
    it('now starts at specified origin', () => {
      const origin = BigInt(Date.now())
      const c = new VirtualClock(origin)
      const r = Time.now.pipe(Time.withClock(c), runSync)
      assert.equal(r, origin)
    })

    it('monotonic starts at 0', () => {
      const c = new VirtualClock(BigInt(Date.now()))
      const r = Time.monotonic.pipe(Time.withClock(c), runSync)
      assert.equal(r, 0)
    })

    describe('step', () => {
      it('given duration >= 0, advances time by specified amount', async () => {
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

      it('given duration >= 0, runs all ready tasks', async () => {
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

        await c.step(3000)
        assert.deepEqual(results, [[1000, 1001n], [2000, 2001n], [3000, 3001n]])

        const r = await p
        assert.deepEqual(r, [4000, 4001n])
      })

      it('given negative duration, does not advance', async () => {
        const s = new VirtualClock(1n)
        await s.step(-1000)
        assert.equal(s.now, 1n)
        assert.equal(s.monotonic, 0)
      })
    })

    describe('waitAll', () => {
      it('runs all remaining tasks', async () => {
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

        await c.waitAll()
        assert.deepEqual(results, [[1000, 1001n], [2000, 2001n], [3000, 3001n]])

        const r = await p
        assert.deepEqual(r, [4000, 4001n])
      })
    })

    describe('[Symbol.dispose]', () => {
      it('drops all remaining tasks', async () => {
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

        dispose(c)

        await c.waitAll()
        assert.deepEqual(results, [[1000, 1001n]])
      })
    })

  })
})
