import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Async from '../Async'
import { fx, runAsync } from '../Fx'
import * as Time from '../Time'
import { dispose } from './disposable'
import { TimeStep } from './time'

describe('time', () => {
  describe('TimeStep', () => {
    it('now starts at specified origin', async () => {
      const origin = Date.now()
      const s = new TimeStep(origin)
      const r = await Time.now.pipe(s.handle, runAsync).promise
      assert.equal(r, origin)
    })

    it('monotonic starts at 0', async () => {
      const s = new TimeStep(Date.now())
      const r = await Time.monotonic.pipe(s.handle, runAsync).promise
      assert.equal(r, 0)
    })

    describe('step', () => {
      it('advances time by specified amount', async () => {
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

        const s = new TimeStep(1)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001]])

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001], [2000, 2001]])

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

        await s.step(1000)
        const r = await p
        assert.deepEqual(r, [4000, 4001])
      })

      it('runs all ready tasks', async () => {
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

        const s = new TimeStep(1)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001]])

        await s.step(3000)
        assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

        const r = await p
        assert.deepEqual(r, [4000, 4001])
      })
    })

    describe('waitAll', () => {
      it('runs all remaining tasks', async () => {
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

        const s = new TimeStep(1)
        const p = test.pipe(s.handle, runAsync).promise

        await s.waitAll()
        assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

        const r = await p
        assert.deepEqual(r, [4000, 4001])
      })
    })

    describe('[Symbol.dispose]', () => {
      it('drops all remaining tasks', async () => {
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

        const s = new TimeStep(1)
        const p = test.pipe(s.handle, runAsync).promise

        await s.step(1000)
        assert.deepEqual(results, [[1000, 1001]])

        dispose(s)

        await s.waitAll()
        assert.deepEqual(results, [[1000, 1001]])
      })
    })

  })
})
