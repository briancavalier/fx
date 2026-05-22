import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { RaceAllFailed, all, bounded, defaultAll, firstSettled, firstSuccess, fork, forkEach, mapAll, race, unbounded } from './Concurrent.js'
import { andFinally, andFinallyExit } from './Finalization.js'
import { bracket, flatMap, fx, ok, runPromise } from './Fx.js'
import { handle } from './Handler.js'
import { scope, withScope, type Exit } from './Scope.js'
import { Task, wait } from './Task.js'
import { getTrace, snapshotError } from './Trace.js'

const asyncValue = <A>(a: A) => assertPromise(() => Promise.resolve(a))

// @ts-expect-error markHandled is runtime-internal bookkeeping, not public API.
const noPublicMarkHandled: typeof import('./Task.js').markHandled = undefined
void noPublicMarkHandled

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

    it('does not mark tasks handled until wait is run', async () => {
      const task = await asyncValue('done').pipe(fork, unbounded, runPromise)

      const constructed = wait(task)
      assert.equal(task._handled, false)

      const result = await constructed.pipe(runPromise)

      assert.equal(result, 'done')
      assert.equal(task._handled, true)
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

    it('preserves the all call site in indexed child task failure traces', async () => {
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
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.equal((result.arg as Error).cause, cause)
    })

    it('preserves the forkEach call site in indexed child task failure traces', async () => {
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
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/forkEach[0]', 'fx/Concurrent/forkEach'])
      assert.equal((result.arg as Error).cause, cause)
    })

    it('preserves the race call site in indexed child task failure traces', async () => {
      const cause = new Error('race failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await race([bad]).pipe(
        firstSettled,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/race[0]', 'fx/Concurrent/race'])
      assert.equal((result.arg as Error).cause, cause)
    })

    it('snapshots indexed child task frame metadata', async () => {
      const cause = new Error('race metadata failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await race([bad]).pipe(
        firstSettled,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      const snapshot = snapshotError(result.arg)
      assert.equal(snapshot.trace?.frames[1].message, 'fx/Concurrent/race[0]')
      assert.equal(snapshot.trace?.frames[1].kind, 'race')
      assert.equal(snapshot.trace?.frames[1].index, 0)
    })

    it('codes awaited async failures and snapshots async frame metadata', async () => {
      const cause = new Error('async rejected')

      await assert.rejects(
        assertPromise(() => Promise.reject(cause)).pipe(runPromise),
        e => {
          const snapshot = snapshotError(e)
          return e instanceof Error
            && snapshot.code === 'FX_AWAITED_ASYNC_FAILED'
            && snapshot.trace?.frames[0].kind === 'async'
            && snapshot.cause?.message === 'async rejected'
        }
      )
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

    it('runs children with scopes between all and defaultAll', async () => {
      const TestScope = scope('test/Fork/AllScope')
      const released = [] as string[]
      const cause = new Error('all scope failed')

      const result = await all([fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          released.push('child')
        }))
        yield* fail(cause)
      })]).pipe(
        withScope(TestScope),
        defaultAll,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(released, ['child'])
    })

    it('releases scoped finalizers when all cancels a sibling', async () => {
      const TestScope = scope('test/Fork/AllCancelScope')
      const released = [] as string[]
      const cause = new Error('all failed')

      const slow = fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          released.push('slow')
        }))
        yield* awaitAbort()
      })
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow, bad]).pipe(
        defaultAll,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(released, ['slow'])
    })

    it('surfaces cleanup failures when all cancels a sibling', async () => {
      const TestScope = scope('test/Fork/AllCancelCleanupFailure')
      const cause = new Error('all failed')
      const releaseFailure = new Error('release failed')

      const slow = fx(function* () {
        yield* andFinally(TestScope, fail(releaseFailure))
        yield* awaitAbort()
      })
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow, bad]).pipe(
        defaultAll,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal(result.arg.errors.length, 2)
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.equal(result.arg.errors[1], releaseFailure)
    })

    it('reports every cleanup failure when all cancels siblings', async () => {
      const TestScope = scope('test/Fork/AllCancelMultipleCleanupFailures')
      const cause = new Error('all failed')
      const firstReleaseFailure = new Error('first release failed')
      const secondReleaseFailure = new Error('second release failed')

      const slow = (releaseFailure: Error) => fx(function* () {
        yield* andFinally(TestScope, fail(releaseFailure))
        yield* awaitAbort()
      })
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow(firstReleaseFailure), bad, slow(secondReleaseFailure)]).pipe(
        defaultAll,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal(result.arg.errors.length, 3)
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.deepEqual(result.arg.errors.slice(1), [firstReleaseFailure, secondReleaseFailure])
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

    it('maps iterable items to child values in input order', async () => {
      const result = await mapAll([3, 1, 2], n => asyncValue(n * 2)).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [6, 2, 4])
    })

    it('passes the zero-based index to the mapper', async () => {
      const indexes = [] as number[]

      const result = await mapAll(['a', 'b', 'c'], (value, index) => {
        indexes.push(index)
        return ok(`${index}:${value}`)
      }).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(indexes, [0, 1, 2])
      assert.deepEqual(result, ['0:a', '1:b', '2:c'])
    })

    it('supports general iterables', async () => {
      function* values() {
        yield 1
        yield 2
        yield 3
      }

      const result = await mapAll(values(), n => ok(n + 10)).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [11, 12, 13])
    })

    it('starts mapped children concurrently', async () => {
      const events = [] as string[]
      const child = (n: number) => fx(function* () {
        events.push(`start ${n}`)
        yield* asyncValue(undefined)
        events.push(`end ${n}`)
        return n
      })

      const result = await mapAll([1, 2, 3], child).pipe(
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events.slice(0, 3), ['start 1', 'start 2', 'start 3'])
    })

    it('respects bounded scheduling for mapped children', async () => {
      const events = [] as string[]
      const child = (n: number) => fx(function* () {
        events.push(`start ${n}`)
        yield* asyncValue(undefined)
        events.push(`end ${n}`)
        return n
      })

      const result = await mapAll([1, 2, 3], child).pipe(
        defaultAll,
        bounded(1),
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'])
    })

    it('cancels mapped siblings when a child fails', async () => {
      const cause = new Error('mapAll failed')
      let cancelled = false
      const slow = assertPromise<void>(signal => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          cancelled = true
          resolve()
        }, { once: true })
      }))
      const child = (n: number) => n === 1
        ? slow
        : fx(function* () {
          yield* asyncValue(undefined)
          yield* fail(cause)
        })

      const result = await mapAll([1, 2], child).pipe(
        defaultAll,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('runs mapped children with handlers between mapAll and defaultAll', async () => {
      class CurrentValue extends Effect('test/Fork/MapAllCurrentValue')<void, string> { }

      const result = await mapAll([1], () => new CurrentValue()).pipe(
        handle(CurrentValue, () => ok('handled')),
        defaultAll,
        unbounded,
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('types mapAll as a value array and preserves child Fail errors', async () => {
      const cause = new Error('mapAll typed failure')
      const result = await fx(function* () {
        const values = yield* mapAll([1, 2], n => n === 1 ? ok(n) : fail(cause))
        const array: readonly number[] = values
        // @ts-expect-error mapAll returns values directly, not a Task.
        const task: Task<readonly number[], Fail<Error>> = values
        void task
        return array
      }).pipe(
        defaultAll,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      const error: Error = result.arg
      assert.equal(error.cause, cause)
    })
  })

  describe('firstSettled', () => {
    it('returns the first settled child value directly without wait', async () => {
      const result = await race([asyncValue('winner'), ok('loser')]).pipe(
        firstSettled,
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
        firstSettled,
        unbounded,
        runPromise
      )

      assert.equal(result, 'winner')
      assert.equal(cancelled, true)
    })

    it('releases scoped finalizers when race cancels the loser', async () => {
      const TestScope = scope('test/Fork/RaceCancelScope')
      const released = [] as string[]

      const slow = fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          released.push('slow')
        }))
        yield* awaitAbort()
      })

      const result = await race([ok('winner'), slow]).pipe(
        firstSettled,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.equal(result, 'winner')
      assert.deepEqual(released, ['slow'])
    })

    it('fails when a race loser cleanup fails after a successful winner', async () => {
      const TestScope = scope('test/Fork/RaceCancelCleanupFailure')
      const releaseFailure = new Error('release failed')

      const slow = fx(function* () {
        yield* andFinally(TestScope, fail(releaseFailure))
        yield* awaitAbort()
      })

      const result = await race([ok('winner'), slow]).pipe(
        firstSettled,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.deepEqual(result.arg.errors, [releaseFailure])
    })

    it('runs children with handlers between race and firstSettled', async () => {
      class CurrentValue extends Effect('test/Fork/RaceCurrentValue')<void, string> { }

      const result = await race([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        firstSettled,
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
        firstSettled,
        unbounded,
        runPromise
      )

      assert.equal(result, 1)
    })
  })

  describe('firstSuccess', () => {
    it('ignores an early failure and returns the first successful child', async () => {
      const failed = new Error('fast failure')
      const bad = fx(function* () {
        yield* fail(failed)
      })

      const result = await race([bad, asyncValue('winner')]).pipe(
        firstSuccess,
        unbounded,
        runPromise
      )

      assert.equal(result, 'winner')
    })

    it('cancels losers after the first success', async () => {
      let cancelled = false
      const slow = assertPromise<string>(signal => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          cancelled = true
          resolve('cancelled')
        }, { once: true })
      }))

      const result = await race([ok('winner'), slow]).pipe(
        firstSuccess,
        unbounded,
        runPromise
      )

      assert.equal(result, 'winner')
      assert.equal(cancelled, true)
    })

    it('fails when firstSuccess loser cleanup fails after a successful winner', async () => {
      const TestScope = scope('test/Fork/FirstSuccessCancelCleanupFailure')
      const releaseFailure = new Error('release failed')

      const slow = fx(function* () {
        yield* andFinally(TestScope, fail(releaseFailure))
        yield* awaitAbort()
      })

      const result = await race([ok('winner'), slow]).pipe(
        firstSuccess,
        withScope(TestScope),
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.deepEqual(result.arg.errors, [releaseFailure])
    })

    it('fails with input-ordered errors when every child fails', async () => {
      const first = new Error('first failed')
      const second = new Error('second failed')
      const bad = (cause: Error) => fx(function* () {
        yield* fail(cause)
      })

      const result = await race([bad(first), bad(second)]).pipe(
        firstSuccess,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof RaceAllFailed)
      assert.equal(result.arg.code, 'FX_RACE_ALL_FAILED')
      assert.equal(result.arg.errors.length, 2)
      const causes = result.arg.errors.map(e => (e as Error).cause)
      assert.deepEqual(causes, [first, second])
      assert.deepEqual(Object.keys(result.arg), ['name'])
      assert.equal(snapshotError(result.arg).aggregate?.errors.length, 2)
      assert.equal(snapshotError(result.arg).aggregate?.errors[0].cause?.message, 'first failed')
    })

    it('types all-failed errors by input index', async () => {
      class FirstError extends Error { readonly first = true }
      class SecondError extends Error { readonly second = true }

      const result = await race([
        fail(new FirstError()),
        fail(new SecondError())
      ]).pipe(
        firstSuccess,
        returnFail,
        unbounded,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof RaceAllFailed)

      const first: FirstError = result.arg.errors[0]
      const second: SecondError = result.arg.errors[1]
      // @ts-expect-error errors preserve input indexes.
      const wrong: FirstError = result.arg.errors[1]
      void first
      void second
      void wrong
    })

    it('runs children with handlers between race and firstSuccess', async () => {
      class CurrentValue extends Effect('test/Fork/FirstSuccessCurrentValue')<void, string> { }

      const result = await race([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        firstSuccess,
        unbounded,
        runPromise
      )

      assert.equal(result, 'handled')
    })
  })
})

describe('Task interruption finalization', () => {
  it('explicit task interruption releases scoped finalizers', async () => {
    const TestScope = scope('test/Fork/DisposeScope')
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          released.push('task')
        }))
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['task'])
  })

  it('runs interrupted scoped finalizers once when task interruption is repeated', async () => {
    const TestScope = scope('test/Fork/DisposeOnceScope')
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          released.push('task')
        }))
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()
    await task.interrupt()

    assert.deepEqual(released, ['task'])
  })

  it('provides interrupted exit to exit-aware finalizers', async () => {
    const TestScope = scope('test/Fork/InterruptedExitScope')
    const exits = [] as Exit[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinallyExit(TestScope, exit => fx(function* () {
          exits.push(exit)
        }))
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('interrupts queued bounded tasks before semaphore acquisition', async () => {
    const events = [] as string[]
    const child = (label: string) => fx(function* () {
      events.push(`start ${label}`)
      yield* awaitAbort()
    })

    const tasks = await fx(function* () {
      const first = yield* fork(child('first'))
      const second = yield* fork(child('second'))
      const third = yield* fork(child('third'))
      return [first, second, third] as const
    }).pipe(
      bounded(1),
      runPromise
    )

    assert.deepEqual(events, ['start first'])
    await withTimeout(tasks[1].interrupt(), 100)

    await tasks[0].interrupt()
    await eventually(() => events.includes('start third'))
    assert.deepEqual(events, ['start first', 'start third'])

    await tasks[2].interrupt()
  })

  it('runs async effects in interrupted finalizers before interruption completes', async () => {
    const TestScope = scope('test/Fork/InterruptedAsyncFinalizer')
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          yield* asyncValue(undefined)
          released.push('task')
        }))
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['task'])
  })

  it('drains effects yielded from wrapped iterator return during interruption', async () => {
    const TestScope = scope('test/Fork/InterruptedInnerReturn')
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* bracket(
          ok(undefined),
          () => fx(function* () {
            yield* asyncValue(undefined)
            released.push('inner')
          }),
          () => awaitAbort()
        )
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['inner'])
  })

  it('drains wrapped iterator return after interrupted scoped finalizer yields', async () => {
    const TestScope = scope('test/Fork/InterruptedScopeThenInnerReturn')
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          yield* asyncValue(undefined)
          released.push('scope')
        }))
        yield* bracket(
          ok(undefined),
          () => fx(function* () {
            yield* asyncValue(undefined)
            released.push('inner')
          }),
          () => awaitAbort()
        )
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['scope', 'inner'])
  })

  it('documents async cleanup rejection wrapper during interruption', async () => {
    const TestScope = scope('test/Fork/InterruptedAsyncCleanupRejection')
    const releaseFailure = new Error('async release failed')

    const slow = fx(function* () {
      yield* andFinally(TestScope, assertPromise(() => Promise.reject(releaseFailure)))
      yield* awaitAbort()
    })

    const result = await race([ok('winner'), slow]).pipe(
      firstSettled,
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.equal(result.arg.errors.length, 1)
    const [cleanupFailure] = result.arg.errors
    const snapshot = snapshotError(cleanupFailure)
    assert.equal(snapshot.code, 'FX_AWAITED_ASYNC_FAILED')
    assert.equal(snapshot.cause?.message, 'async release failed')
  })

  it('aggregates interrupted scoped and wrapped iterator cleanup failures', async () => {
    const TestScope = scope('test/Fork/InterruptedMultipleCleanupFailures')
    const scopeFailure = new Error('scope release failed')
    const innerFailure = new Error('inner release failed')

    const slow = fx(function* () {
      yield* andFinally(TestScope, fail(scopeFailure))
      yield* bracket(
        ok(undefined),
        () => fail(innerFailure),
        () => awaitAbort()
      )
    })

    const result = await race([ok('winner'), slow]).pipe(
      firstSettled,
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.deepEqual(result.arg.errors, [scopeFailure, innerFailure])
  })

  it('aggregates interrupted scoped cleanup failure with synchronous iterator return throw', async () => {
    const TestScope = scope('test/Fork/InterruptedReturnThrow')
    const scopeFailure = new Error('scope release failed')
    const innerFailure = new Error('inner hard throw')
    const throwsOnReturn = (): ReturnType<typeof awaitAbort> => ({
      pipe: ok(undefined).pipe.bind(ok(undefined)),
      [Symbol.iterator]() {
        const iterator = awaitAbort()[Symbol.iterator]()
        return {
          next: iterator.next.bind(iterator),
          return() {
          throw innerFailure
          }
        } satisfies Iterator<unknown, void, unknown>
      }
    })

    const slow = fx(function* () {
      yield* andFinally(TestScope, fail(scopeFailure))
      yield* throwsOnReturn()
    })

    const result = await race([ok('winner'), slow]).pipe(
      firstSettled,
      withScope(TestScope),
      returnFail,
      unbounded,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.deepEqual(result.arg.errors, [scopeFailure, innerFailure])
  })

  it('runs interrupted finalizers through outer handlers', async () => {
    const TestScope = scope('test/Fork/InterruptedOuterHandler')
    class Release extends Effect('test/Fork/InterruptedOuterHandler/Release')<void, void> { }
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, new Release())
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      returnFail,
      unbounded,
      handle(Release, () => fx(function* () {
        released.push('task')
      })),
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['task'])
  })

  it('runs interrupted finalizers through captured handlers', async () => {
    const TestScope = scope('test/Fork/InterruptedCapturedHandler')
    class Release extends Effect('test/Fork/InterruptedCapturedHandler/Release')<void, void> { }
    const released = [] as string[]

    const task = taskOrThrow(await fx(function* () {
      return yield* fork(fx(function* () {
        yield* andFinally(TestScope, new Release())
        yield* awaitAbort()
      }))
    }).pipe(
      withScope(TestScope),
      handle(Release, () => fx(function* () {
        released.push('task')
      })),
      returnFail,
      unbounded,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(released, ['task'])
  })
})

const firstLine = (e: unknown): string =>
  e instanceof Error ? e.stack?.split('\n')[0] ?? '' : ''

const traceMessages = (e: unknown) => {
  const messages: string[] = []
  let trace = getTrace(e)
  while (trace !== undefined) {
    messages.push(trace.frame.message)
    trace = trace.parent
  }
  return messages
}

const awaitAbort = () => assertPromise<void>(signal => new Promise(resolve => {
  signal.addEventListener('abort', () => resolve(), { once: true })
}))

const withTimeout = async <A>(promise: Promise<A>, ms: number): Promise<A> =>
  await Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`Timed out after ${ms}ms`)
    })
  ])

const eventually = async (f: () => boolean): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    if (f()) return
    await delay(5)
  }
  assert.equal(f(), true)
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const taskOrThrow = <A, E>(task: Task<A, E> | Fail<unknown>): Task<A, E> => {
  assert.ok(!Fail.is(task))
  return task
}
