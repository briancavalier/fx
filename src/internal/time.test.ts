import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, runAsync } from '../Fx'
import * as Time from '../Time'
import { dispose } from './disposable'
import { TimeStep } from './time'

describe('time', () => {
  describe('TimeStep', () => {
    it('now starts at specified origin', async () => {
      const origin = BigInt(Date.now())
      const s = new TimeStep(origin)
      const r = await Time.now.pipe(s.handle, runAsync).promise
      assert.equal(r, origin)
    })

    it('monotonic starts at 0', async () => {
      const s = new TimeStep(BigInt(Date.now()))
      const r = await Time.monotonic.pipe(s.handle, runAsync).promise
      assert.equal(r, 0)
    })

    describe('step', () => {
      it('advances time by specified amount', async () => {
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

        const s = new TimeStep(1n)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001n]])

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001n], [2000, 2001n]])

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001n], [2000, 2001n], [3000, 3001n]])

        await s.step(1000)
        const r = await p
        assert.deepEqual(r, [4000, 4001n])
      })

      it('runs all ready tasks', async () => {
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

        const s = new TimeStep(1n)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001n]])

        await s.step(3000)
        assert.deepEqual(results, [[1000, 1001n], [2000, 2001n], [3000, 3001n]])

        const r = await p
        assert.deepEqual(r, [4000, 4001n])
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

        const s = new TimeStep(1n)
        const p = test.pipe(s.handle, runAsync).promise

        await s.waitAll()
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

        const s = new TimeStep(1n)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001n]])

        dispose(s)

        await s.waitAll()
        assert.deepEqual(results, [[1000, 1001n]])
      })
    })

  })
})
