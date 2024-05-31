import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dispose } from './disposable'
import { Clock, VirtualClock } from './time'

const sleep = (c: Clock, ms: number) =>
  new Promise<void>(resolve => c.schedule(ms, resolve))

describe('time', () => {
  describe('VirtualClock', () => {
    it('now starts at specified origin', () => {
      const origin = Date.now()
      const c = new VirtualClock(origin)
      assert.equal(c.now, origin)
    })

    it('monotonic starts at 0', () => {
      const c = new VirtualClock(Date.now())
      assert.equal(c.monotonic, 0)
    })

    describe('step', () => {
      it('given duration >= 0, advances time by specified amount', async () => {
        const results: (readonly [number, number])[] = []

        const test = async (c: Clock, progress: (readonly [number, number])[]) => {
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          return [c.monotonic, c.now]
        }

        const c = new VirtualClock(1)
        const p = test(c, results)

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

      it('given duration >= 0, runs all ready tasks', async () => {
        const results: (readonly [number, number])[] = []

        const test = async (c: Clock, progress: (readonly [number, number])[]) => {
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          return [c.monotonic, c.now]
        }

        const c = new VirtualClock(1)
        const p = test(c, results)

        await c.step(1000)
        assert.deepEqual(results, [[1000, 1001]])

        await c.step(3000)
        assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

        const r = await p
        assert.deepEqual(r, [4000, 4001])
      })

      it('given negative duration, does not advance', async () => {
        const s = new VirtualClock(1)
        await s.step(-1000)
        assert.equal(s.now, 1)
        assert.equal(s.monotonic, 0)
      })
    })

    describe('waitAll', () => {
      it('runs all remaining tasks', async () => {
        const results: (readonly [number, number])[] = []

        const test = async (c: Clock, progress: (readonly [number, number])[]) => {
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          return [c.monotonic, c.now]
        }

        const c = new VirtualClock(1)
        const p = test(c, results)

        await c.waitAll()
        assert.deepEqual(results, [[1000, 1001], [2000, 2001], [3000, 3001]])

        const r = await p
        assert.deepEqual(r, [4000, 4001])
      })
    })

    describe('[Symbol.dispose]', () => {
      it('drops all remaining tasks', async () => {
        const results: (readonly [number, number])[] = []

        const test = async (c: Clock, progress: (readonly [number, number])[]) => {
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          progress.push([c.monotonic, c.now])
          await sleep(c, 1000)
          return [c.monotonic, c.now]
        }

        const c = new VirtualClock(1)
        const p = test(c, results)

        await c.step(1000)
        assert.deepEqual(results, [[1000, 1001]])

        dispose(c)

        await c.waitAll()
        assert.deepEqual(results, [[1000, 1001]])
      })
    })

  })
})
