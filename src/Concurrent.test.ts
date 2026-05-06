import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { all, defaultAll, defaultRace, fork, forkEach, race, unbounded } from './Concurrent.js'
import { flatMap, fx, ok, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { Task, wait } from './Task.js'

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

    it('preserves the all call site in indexed child task failures', async () => {
      const cause = new Error('all failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await all([bad]).pipe(
        defaultAll,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Concurrent\/all\[0\]/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.equal((result.arg as Error).cause, cause)
    })

    it('preserves the forkEach call site in indexed child task failures', async () => {
      const cause = new Error('forkEach failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await forkEach([bad]).pipe(
        flatMap(([task]) => wait(task)),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Concurrent\/forkEach\[0\]/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.equal((result.arg as Error).cause, cause)
    })

    it('preserves the race call site in indexed child task failures', async () => {
      const cause = new Error('race failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await race([bad]).pipe(
        defaultRace,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Concurrent\/race\[0\]/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.equal((result.arg as Error).cause, cause)
    })
  })

  describe('defaultAll', () => {
    it('returns child values directly without wait', async () => {
      const result = await all([ok(1), ok('two')]).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [1, 'two'])
    })

    it('starts children concurrently', async () => {
      const events = [] as string[]
      const child = (n: number) => fx(function* () {
        events.push(`start ${n}`)
        yield* asyncValue(undefined)
        events.push(`end ${n}`)
        return n
      })

      const result = await all([child(1), child(2), child(3)]).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events.slice(0, 3), ['start 1', 'start 2', 'start 3'])
    })

    it('cancels sibling tasks when a child fails', async () => {
      const cause = new Error('all failed')
      let cancelled = false
      const slow = assertPromise<void>(signal => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          cancelled = true
          resolve()
        }, { once: true })
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow, bad]).pipe(
        defaultAll,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('runs children with handlers between all and defaultAll', async () => {
      class CurrentValue extends Effect('test/Fork/AllCurrentValue')<void, string> { }

      const result = await all([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('types all as a value tuple rather than a Task', async () => {
      const result = await fx(function* () {
        const values = yield* all([ok(1), ok('two')])
        const tuple: readonly [number, string] = values
        // @ts-expect-error all returns values directly, not a Task.
        const task: Task<readonly [number, string], never> = values
        void task
        return tuple
      }).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [1, 'two'])
    })
  })

  describe('defaultRace', () => {
    it('returns the first settled child value directly without wait', async () => {
      const result = await race([asyncValue('winner'), ok('loser')]).pipe(
        defaultRace,
        unbounded,
        runPromise
      )

      assert.equal(result, 'loser')
    })

    it('cancels losers after the first child settles', async () => {
      let cancelled = false
      const slow = assertPromise<string>(signal => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          cancelled = true
          resolve('cancelled')
        }, { once: true })
      }))

      const result = await race([ok('winner'), slow]).pipe(
        defaultRace,
        unbounded,
        runPromise
      )

      assert.equal(result, 'winner')
      assert.equal(cancelled, true)
    })

    it('runs children with handlers between race and defaultRace', async () => {
      class CurrentValue extends Effect('test/Fork/RaceCurrentValue')<void, string> { }

      const result = await race([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        defaultRace,
        unbounded,
        runPromise
      )

      assert.equal(result, 'handled')
    })

    it('types race as a value rather than a Task', async () => {
      const result = await fx(function* () {
        const value = yield* race([ok(1), ok(2)])
        const n: number = value
        // @ts-expect-error race returns a value directly, not a Task.
        const task: Task<number, never> = value
        void task
        return n
      }).pipe(
        defaultRace,
        unbounded,
        runPromise
      )

      assert.equal(result, 1)
    })
  })
})

const firstLine = (e: unknown): string =>
  e instanceof Error ? e.stack?.split('\n')[0] ?? '' : ''
