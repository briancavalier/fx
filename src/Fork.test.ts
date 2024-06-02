import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Async from './Async'
import { fork, unbounded } from './Fork'
import { fx, runToValue } from './Fx'
import * as Task from './Task'

const asyncValue = <A>(a: A) => Async.promise(() => Promise.resolve(a))

describe('Fork', () => {
  describe('unbounded', () => {
    it('given Fork, returns task', async () => {
      const x = Math.random()
      const f = unbounded(fork(asyncValue(x)))
      const t = runToValue(f)
      const r = await t.promise
      assert.equal(r, x)
    })

    it('given nested Fork, returns task', async () => {
      const x = Math.random()
      const f = unbounded(fx(function* () {
        const t = yield* fork(asyncValue(x))
        return t
      }))

      const t = runToValue(f)
      const r = await t.promise
      assert.equal(r, x)
    })

    it('given multiple Forks, returns task', async () => {
      const x1 = Math.random()
      const x2 = Math.random()
      const f = unbounded(fx(function* () {
        const t1 = yield* fork(asyncValue(x1))
        const t2 = yield* fork(asyncValue(x2))
        return [t1, t2]
      }))

      const t = runToValue(f)
      const r = await Promise.all(t.map(t => t.promise))
      assert.deepEqual(r, [x1, x2])
    })

    it('given nested Fork + wait, returns task', async () => {
      const x = Math.random()
      const f = fx(function* () {
        const t1 = yield* fork(asyncValue(x))
        return yield* Task.wait(t1)
      })

      const t = runToValue(unbounded(fork(f)))
      const r = await t.promise
      assert.deepEqual(r, x)
    })
  })
})
