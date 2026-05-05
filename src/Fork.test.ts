import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { fork, unbounded } from './Fork.js'
import { fx, ok, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { wait } from './Task.js'

const asyncValue = <A>(a: A) => assertPromise(() => Promise.resolve(a))

describe('Fork', () => {
  describe('unbounded', () => {
    it('given Fork, returns task', async () => {
      const x = Math.random()
      const t = await asyncValue(x).pipe(fork, unbounded, runPromise)
      const r = await t.promise
      assert.equal(r, x)
    })

    it('given nested Fork, returns task', async () => {
      const x = Math.random()
      const f = unbounded(fx(function* () {
        const t = yield* fork(asyncValue(x))
        return t
      }))

      const t = await f.pipe(runPromise)
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

      const t = await f.pipe(runPromise)
      const r = await Promise.all(t.map(t => t.promise))
      assert.deepEqual(r, [x1, x2])
    })

    it('given nested Fork + wait, returns task', async () => {
      const x = Math.random()
      const f = fx(function* () {
        const t1 = yield* fork(asyncValue(x))
        return yield* wait(t1)
      })

      const t = await f.pipe(fork, unbounded, runPromise)
      const r = await t.promise
      assert.deepEqual(r, x)
    })

    it('runs forked tasks with handlers outside the fork handler', async () => {
      class CurrentValue extends Effect('test/Fork/CurrentValue')<void, string> { }

      const f = fx(function* () {
        const t = yield* fork(new CurrentValue())
        return yield* wait(t)
      })

      const r = await f.pipe(
        unbounded,
        handle(CurrentValue, () => ok('handled')),
        runPromise
      )

      assert.equal(r, 'handled')
    })

    it('runs forked tasks with handlers between fork and the fork handler', async () => {
      class CurrentValue extends Effect('test/Fork/LocalCurrentValue')<void, string> { }

      const f = fx(function* () {
        const t = yield* fork(new CurrentValue())
        return yield* wait(t)
      }).pipe(
        handle(CurrentValue, () => ok('handled'))
      )

      const r = await f.pipe(unbounded, runPromise)

      assert.equal(r, 'handled')
    })
  })
})
