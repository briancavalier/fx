import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { fork, unbounded } from './Fork.js'
import { fx, ok, run } from './Fx.js'
import { handle } from './Handler.js'
import { wait } from './Task.js'
import { GetHandlerContext } from './internal/HandlerContext.js'

const asyncValue = <A>(a: A) => assertPromise(() => Promise.resolve(a))

const emptyHandlerContext = handle(GetHandlerContext, () => ok([]))

describe('Fork', () => {
  describe('unbounded', () => {
    it('given Fork, returns task', async () => {
      const x = Math.random()
      const t = asyncValue(x).pipe(fork, unbounded, emptyHandlerContext, run)
      const r = await t.promise
      assert.equal(r, x)
    })

    it('given nested Fork, returns task', async () => {
      const x = Math.random()
      const f = unbounded(fx(function* () {
        const t = yield* fork(asyncValue(x))
        return t
      }))

      const t = f.pipe(emptyHandlerContext, run)
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

      const t = f.pipe(emptyHandlerContext, run)
      const r = await Promise.all(t.map(t => t.promise))
      assert.deepEqual(r, [x1, x2])
    })

    it('given nested Fork + wait, returns task', async () => {
      const x = Math.random()
      const f = fx(function* () {
        const t1 = yield* fork(asyncValue(x))
        return yield* wait(t1)
      })

      const t = f.pipe(fork, unbounded, emptyHandlerContext, run)
      const r = await t.promise
      assert.deepEqual(r, x)
    })
  })
})
