import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise, type Async } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { RaceAllFailed, all, withBoundedConcurrency, firstSuccess, fork, forkEach, forkIn, mapAll, race, withUnboundedConcurrency } from './Concurrent.js'
import { withCoopConcurrency } from './experimental/concurrent/cooperative.js'
import { andFinally, andFinallyExit } from './Finalization.js'
import { bracket, flatMap, fx, ok, runPromise, runTask, type Fx } from './Fx.js'
import { control, handle } from './Handler.js'
import { type HandlerCapture } from './HandlerCapture.js'
import { interruptFrom, recoverInterrupt } from './InterruptFrom.js'
import { uninterruptible } from './Interrupt.js'
import { ReturnFrom, returnFrom } from './ReturnFrom.js'
import { scope, withScope, type Exit } from './Scope.js'
import { Task, wait } from './Task.js'
import { getTrace, snapshotError } from './Trace.js'

const asyncValue = <A>(a: A) => assertPromise(() => Promise.resolve(a))
const delayFx = (ms: number) => assertPromise<void>(() => delay(ms))
type EffectOf<T> = T extends Fx<infer E, unknown> ? E : never
type ResultOf<T> = T extends Fx<unknown, infer A> ? A : never
type IsAny<T> = 0 extends 1 & T ? true : false
type HasFail<T> = Extract<T, Fail<any>> extends never ? false : true

// @ts-expect-error markHandled is runtime-internal bookkeeping, not public API.
const noPublicMarkHandled: typeof import('./Task.js').markHandled = undefined
void noPublicMarkHandled

describe('Fork', () => {
  describe('fork schedulers', () => {
    it('keeps public concurrency helper inference from degrading to any', () => {
      const TestScope = scope('test/Fork/NoAnyInference')
      const forked = fork(ok('value' as const))
      const forkedIn = forkIn(TestScope, ok('scoped' as const))
      const forkedEach = forkEach([ok(1), ok('two')] as const)
      const allValues = all([ok(1), ok('two')] as const)
      const mappedValues = mapAll([1, 2], n => ok(n + 1))
      const raced = race([ok(1), ok('two')] as const)
      const first = firstSuccess([fail(new Error('nope')), ok('yes' as const)] as const)
      const scoped = fx(function* () {
        return yield* returnFrom(TestScope, 'early' as const)
      }).pipe(withScope(TestScope))

      const checks = [
        false satisfies IsAny<EffectOf<typeof forked>>,
        false satisfies IsAny<ResultOf<typeof forked>>,
        false satisfies IsAny<EffectOf<typeof forkedIn>>,
        false satisfies IsAny<ResultOf<typeof forkedIn>>,
        false satisfies IsAny<EffectOf<typeof forkedEach>>,
        false satisfies IsAny<ResultOf<typeof forkedEach>>,
        false satisfies IsAny<EffectOf<typeof allValues>>,
        false satisfies IsAny<ResultOf<typeof allValues>>,
        false satisfies IsAny<EffectOf<typeof mappedValues>>,
        false satisfies IsAny<ResultOf<typeof mappedValues>>,
        false satisfies IsAny<EffectOf<typeof raced>>,
        false satisfies IsAny<ResultOf<typeof raced>>,
        false satisfies IsAny<EffectOf<typeof first>>,
        false satisfies IsAny<ResultOf<typeof first>>,
        false satisfies IsAny<EffectOf<typeof scoped>>,
        false satisfies IsAny<ResultOf<typeof scoped>>
      ]
      assert.deepEqual(checks, Array.from({ length: checks.length }, () => false))
    })

    it('withCoopConcurrency handles explicit Fork and structured concurrency', async () => {
      const program = fx(function* () {
        const task = yield* fork(ok(1))
        const values = yield* all([ok(2), ok(3)])
        return [yield* wait(task), ...values]
      }).pipe(withCoopConcurrency())

      const runnable: Promise<readonly number[]> = program.pipe(runPromise)
      assert.deepEqual(await runnable, [1, 2, 3])
    })

    it('keeps internal operator scope identities private from caller string scope ids', async () => {
      const allScope = scope('fx/Concurrent/all/0')
      const raceScope = scope('fx/Concurrent/race/0')
      const firstSuccessScope = scope('fx/Concurrent/firstSuccess/0')

      const allProgram = all([fx(function* () {
        return yield* returnFrom(allScope, 'collided' as const)
      })]).pipe(
        withUnboundedConcurrency,
        returnFail
      )
      const raceProgram = race([fx(function* () {
        return yield* returnFrom(raceScope, 'collided' as const)
      })]).pipe(
        withUnboundedConcurrency,
        returnFail
      )
      const firstSuccessProgram = firstSuccess([fx(function* () {
        return yield* returnFrom(firstSuccessScope, 'collided' as const)
      })]).pipe(
        withUnboundedConcurrency,
        returnFail
      )
      const allResult = await runPromise(allProgram as never)
      const raceResult = await runPromise(raceProgram as never)
      const firstSuccessResult = await runPromise(firstSuccessProgram as never)

      assertUnhandledReturnFrom(allResult)
      assertUnhandledReturnFrom(raceResult)
      assert.ok(Fail.is(firstSuccessResult))
      assert.ok(firstSuccessResult.arg instanceof RaceAllFailed)
      assert.equal(firstSuccessResult.arg.errors.length, 1)
      assertUnhandledReturnFrom(new Fail(firstSuccessResult.arg.errors[0]))
    })
  })

  describe('withUnboundedConcurrency', () => {
    it('given Fork, returns task', async () => {
      const x = Math.random()
      const t = await asyncValue(x).pipe(fork, withUnboundedConcurrency, runPromise)
      const r = await t.promise
      assert.equal(r, x)
    })

    it('given nested Fork, returns task', async () => {
      const x = Math.random()
      const f = withUnboundedConcurrency(fx(function* () {
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
      const f = withUnboundedConcurrency(fx(function* () {
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

      const t = await f.pipe(fork, withUnboundedConcurrency, runPromise)
      const r = await t.promise
      assert.deepEqual(r, x)
    })

    it('does not mark tasks handled until wait is run', async () => {
      const task = await asyncValue('done').pipe(fork, withUnboundedConcurrency, runPromise)

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
        withUnboundedConcurrency,
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

      const r = await f.pipe(withUnboundedConcurrency, runPromise)

      assert.equal(r, 'handled')
    })

    it('preserves the all call site in indexed child task failure traces', async () => {
      const cause = new Error('all failed')
      const bad = fx(function* () {
        yield* fail(cause)
      })

      const result = await all([bad]).pipe(
        withUnboundedConcurrency,
        returnFail,
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
        withUnboundedConcurrency,
        returnFail,
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
        withUnboundedConcurrency,
        returnFail,
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
        withUnboundedConcurrency,
        returnFail,
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

  describe('withUnboundedConcurrency', () => {
    it('returns child values directly without wait', async () => {
      const result = await all([ok(1), ok('two')]).pipe(
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events.slice(0, 3), ['start 1', 'start 2', 'start 3'])
    })

    it('continues ready children while another child waits on async work', async () => {
      class Step extends Effect('test/Fork/AllAsyncQueue')<string, void> { }
      const events = [] as string[]
      let releaseSlow!: () => void
      const slow = assertPromise<string>(() => new Promise(resolve => {
        releaseSlow = () => resolve('slow')
      }))
      const fast = fx(function* () {
        yield* new Step('fast')
        return 'fast'
      })

      const promise = all([slow, fast]).pipe(
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        withUnboundedConcurrency,
        runPromise
      )

      await eventually(() => events.includes('fast'))
      releaseSlow()

      assert.deepEqual(await promise, ['slow', 'fast'])
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
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('converts rejected async work into recoverable failure', async () => {
      const cause = new Error('all async rejected')

      const result = await all([assertPromise(() => Promise.reject(cause))]).pipe(
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const snapshot = snapshotError(result.arg)
      assert.equal(snapshot.code, 'FX_AWAITED_ASYNC_FAILED')
      assert.equal(snapshot.cause?.message, 'all async rejected')
    })

    it('aborts parked async children when the parent task is interrupted', async () => {
      let started = false
      let aborted = false
      const parked = assertPromise<void>(signal => new Promise(resolve => {
        started = true
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      }))

      const task = all([parked]).pipe(
        withUnboundedConcurrency,
        runTask
      )

      await eventually(() => started)
      await task.interrupt()

      assert.equal(aborted, true)
    })

    it('defers sibling cancellation while a child is interruption-masked', async () => {
      const events = [] as string[]
      const cause = new Error('masked all failed')
      let releaseMasked!: () => void

      const masked = uninterruptible(fx(function* () {
        events.push('masked start')
        yield* assertPromise<void>(() => new Promise(resolve => {
          releaseMasked = () => resolve()
        }))
        events.push('masked released')
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const promise = all([masked, bad]).pipe(
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      await eventually(() => events.includes('masked start'))
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(events, ['masked start'])

      releaseMasked()
      const result = await promise

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(events, ['masked start', 'masked released'])
    })

    it('runs children with handlers between all and withUnboundedConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/AllCurrentValue')<void, string> { }

      const result = await all([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withUnboundedConcurrency,
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('runs children with scopes between all and withUnboundedConcurrency', async () => {
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
        withUnboundedConcurrency,
        returnFail,
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
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
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
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
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
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal(result.arg.errors.length, 3)
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.deepEqual(result.arg.errors.slice(1), [secondReleaseFailure, firstReleaseFailure])
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
        withUnboundedConcurrency,
        runPromise
      )

      assert.deepEqual(result, [1, 'two'])
    })

    it('maps iterable items to child values in input order', async () => {
      const result = await mapAll([3, 1, 2], n => asyncValue(n * 2)).pipe(
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events.slice(0, 3), ['start 1', 'start 2', 'start 3'])
    })

    it('respects withBoundedConcurrency scheduling for mapped children', async () => {
      const events = [] as string[]
      const child = (n: number) => fx(function* () {
        events.push(`start ${n}`)
        yield* asyncValue(undefined)
        events.push(`end ${n}`)
        return n
      })

      const result = await mapAll([1, 2, 3], child).pipe(
        withBoundedConcurrency(1),
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'])
    })

    it('allows advanced unmetered forks to bypass bounded concurrency admission', async () => {
      const events = [] as string[]
      let releaseMetered!: () => void

      const result = await fx(function* () {
        yield* fork(assertPromise<void>(() => new Promise(resolve => {
          events.push('metered start')
          releaseMetered = resolve
        })))
        yield* asyncValue(undefined)
        const unmetered = yield* fork(fx(function* () {
          events.push('unmetered start')
          return 'unmetered' as const
        }), { scheduling: 'unmetered' })
        return yield* wait(unmetered)
      }).pipe(
        withBoundedConcurrency(1),
        runPromise
      )

      releaseMetered()

      assert.equal(result, 'unmetered')
      assert.deepEqual(events, ['metered start', 'unmetered start'])
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
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('runs mapped children with handlers between mapAll and withUnboundedConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/MapAllCurrentValue')<void, string> { }

      const result = await mapAll([1], () => new CurrentValue()).pipe(
        handle(CurrentValue, () => ok('handled')),
        withUnboundedConcurrency,
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('preserves the mapAll call site in indexed child task failure traces', async () => {
      const cause = new Error('mapAll traced failure')

      const result = await mapAll([cause], error => fx(function* () {
        yield* fail(error)
      })).pipe(
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.match(result.arg.stack ?? '', /Concurrent\.test\.ts/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.equal((result.arg as Error).cause, cause)
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
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const error: Error = result.arg
      assert.equal(error.cause, cause)
    })
  })

  describe('withCoopConcurrency', () => {
    it('rejects invalid options', () => {
      assert.throws(() => withCoopConcurrency({ concurrency: 0 }), RangeError)
      assert.throws(() => withCoopConcurrency({ yieldBudget: 0 }), RangeError)
    })

    it('returns child values directly in input order', async () => {
      const result = await all([ok(1), asyncValue('two')]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, [1, 'two'])
    })

    it('maps iterable items to child values in input order', async () => {
      const result = await mapAll([3, 1, 2], n => asyncValue(n * 2)).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, [6, 2, 4])
    })

    it('starts children up to the configured concurrency', async () => {
      const events = [] as string[]
      const child = (n: number) => fx(function* () {
        events.push(`start ${n}`)
        yield* asyncValue(undefined)
        events.push(`end ${n}`)
        return n
      })

      const result = await all([child(1), child(2), child(3)]).pipe(
        withCoopConcurrency({ concurrency: 2 }),
        runPromise
      )

      assert.deepEqual(result, [1, 2, 3])
      assert.deepEqual(events.slice(0, 2), ['start 1', 'start 2'])
      assert.ok(events.indexOf('start 3') > events.indexOf('end 1'))
      assert.deepEqual(events.slice(-1), ['end 3'])
    })

    it('interleaves ready children according to the yield budget', async () => {
      class Step extends Effect('test/Fork/CooperativeAllStep')<string, void> { }
      const events = [] as string[]
      const child = (label: string) => fx(function* () {
        yield* new Step(`${label}1`)
        yield* new Step(`${label}2`)
        return label
      })

      const result = await all([child('A'), child('B')]).pipe(
        withCoopConcurrency({ yieldBudget: 1 }),
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        runPromise
      )

      assert.deepEqual(result, ['A', 'B'])
      assert.deepEqual(events, ['A1', 'B1', 'A2', 'B2'])
    })

    it('lets a ready child run up to the configured yield budget', async () => {
      class Step extends Effect('test/Fork/CooperativeAllStepBudget')<string, void> { }
      const events = [] as string[]
      const child = (label: string) => fx(function* () {
        yield* new Step(`${label}1`)
        yield* new Step(`${label}2`)
        return label
      })

      const result = await all([child('A'), child('B')]).pipe(
        withCoopConcurrency({ yieldBudget: 2 }),
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        runPromise
      )

      assert.deepEqual(result, ['A', 'B'])
      assert.deepEqual(events, ['A1', 'A2', 'B1', 'B2'])
    })

    it('continues ready children while another child waits on async work', async () => {
      class Step extends Effect('test/Fork/CooperativeAllAsyncQueue')<string, void> { }
      const events = [] as string[]
      let releaseSlow!: () => void
      const slow = assertPromise<string>(() => new Promise(resolve => {
        releaseSlow = () => resolve('slow')
      }))
      const fast = fx(function* () {
        yield* new Step('fast')
        return 'fast'
      })

      const promise = all([slow, fast]).pipe(
        withCoopConcurrency(),
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        runPromise
      )

      await eventually(() => events.includes('fast'))
      releaseSlow()

      assert.deepEqual(await promise, ['slow', 'fast'])
    })

    it('runs children with handlers between all and withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeAllCurrentValue')<void, string> { }

      const result = await all([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('preserves non-resuming control handlers inside cooperative children', async () => {
      class Stop extends Effect('test/Fork/CooperativeControlStop')<void, string> { }
      const events: string[] = []

      const result = await all([fx(function* () {
        events.push('before')
        const value = yield* new Stop()
        events.push('after')
        return value
      }).pipe(
        control(Stop, () => ok('stopped'))
      )]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['stopped'])
      assert.deepEqual(events, ['before'])
    })

    it('runs mapped children with handlers between mapAll and withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeMapAllCurrentValue')<void, string> { }

      const result = await mapAll([1], () => new CurrentValue()).pipe(
        handle(CurrentValue, () => ok('handled')),
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('cancels sibling async work when a child fails', async () => {
      const cause = new Error('cooperative all failed')
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
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('does not wait for cancelled async work to settle after abort', async () => {
      const cause = new Error('cooperative all failed')
      let cancelled = false
      const slow = assertPromise<void>(signal => new Promise(() => {
        signal.addEventListener('abort', () => {
          cancelled = true
        }, { once: true })
      }))

      const result = await all([slow, fail(cause)]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.equal(cancelled, true)
    })

    it('converts rejected async work into recoverable failure', async () => {
      const cause = new Error('cooperative async rejected')

      const result = await all([assertPromise(() => Promise.reject(cause))]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const snapshot = snapshotError(result.arg)
      assert.equal(snapshot.code, 'FX_AWAITED_ASYNC_FAILED')
      assert.equal(snapshot.cause?.message, 'cooperative async rejected')
      assert.equal((result.arg as Error).cause, cause)
    })

    it('aborts parked async children when the parent task is interrupted', async () => {
      let started = false
      let aborted = false
      const parked = assertPromise<void>(signal => new Promise(resolve => {
        started = true
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      }))

      const task = all([parked]).pipe(
        withCoopConcurrency(),
        runTask
      )

      await eventually(() => started)
      await task.interrupt()

      assert.equal(aborted, true)
    })

    it('preserves basic diagnostic shape for child failures', async () => {
      const cause = new Error('cooperative traced failure')

      const result = await all([fx(function* () {
        yield* fail(cause)
      })]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.equal((result.arg as Error).cause, cause)
    })

    it('runs scoped finalizers when cancelling a sibling', async () => {
      const TestScope = scope('test/Fork/CooperativeAllCancelScope')
      const released = [] as string[]
      const cause = new Error('cooperative all failed')

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
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(released, ['slow'])
    })

    it('runs structured concurrency yielded by outer cleanup handlers', async () => {
      const TestScope = scope('test/Fork/CooperativeCleanupStructuredScope')
      const events = [] as string[]

      const slow = fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('cleanup before')
          yield* all([fx(function* () {
            events.push('cleanup all child')
          })])
          events.push('cleanup after')
        }))
        yield* awaitAbort()
      })

      const program = race([
        slow,
        assertPromise<string>(() => new Promise(resolve => setImmediate(() => resolve('winner'))))
      ]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail
      )
      // The runtime handles cleanup-yielded concurrency through captured handlers;
      // the current effect type cannot express that cleanup-only narrowing.
      const result = await (program as Fx<Async | HandlerCapture<string>, string | void | Fail<AggregateError>>).pipe(
        runPromise
      )

      assert.ok(!Fail.is(result))
      assert.equal(result, 'winner')
      assert.deepEqual(events, ['cleanup before', 'cleanup all child', 'cleanup after'])
    })

    it('runs explicit forks yielded by outer cleanup handlers', async () => {
      const TestScope = scope('test/Fork/CooperativeCleanupForkScope')
      const events = [] as string[]

      const slow = fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('cleanup before')
          const task = yield* fork(fx(function* () {
            events.push('cleanup fork child')
          }))
          yield* wait(task)
          events.push('cleanup after')
        }))
        yield* awaitAbort()
      })

      const program = race([
        slow,
        assertPromise<string>(() => new Promise(resolve => setImmediate(() => resolve('winner'))))
      ]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail
      )
      // The runtime handles cleanup-yielded concurrency through captured handlers;
      // the current effect type cannot express that cleanup-only narrowing.
      const result = await (program as Fx<Async | HandlerCapture<string>, string | void | Fail<AggregateError>>).pipe(
        runPromise
      )

      assert.ok(!Fail.is(result))
      assert.equal(result, 'winner')
      assert.deepEqual(events, ['cleanup before', 'cleanup fork child', 'cleanup after'])
    })

    it('runs cleanup fork children with handlers outside withCoopConcurrency', async () => {
      const TestScope = scope('test/Fork/CooperativeCleanupForkOuterHandlerScope')
      class CurrentValue extends Effect('test/Fork/CooperativeCleanupForkCurrentValue')<void, string> { }
      const events = [] as string[]

      const slow = fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('cleanup before')
          const task = yield* fork(new CurrentValue())
          events.push(yield* wait(task))
          events.push('cleanup after')
        }))
        yield* awaitAbort()
      })

      const program = race([
        slow,
        assertPromise<string>(() => new Promise(resolve => setImmediate(() => resolve('winner'))))
      ]).pipe(
        withCoopConcurrency(),
        handle(CurrentValue, () => ok('handled')),
        withScope(TestScope),
        returnFail
      )
      // The runtime handles cleanup-yielded concurrency through captured handlers;
      // the current effect type cannot express that cleanup-only narrowing.
      const result = await (program as Fx<Async | HandlerCapture<string>, string | void | Fail<AggregateError>>).pipe(
        runPromise
      )

      assert.ok(!Fail.is(result))
      assert.equal(result, 'winner')
      assert.deepEqual(events, ['cleanup before', 'handled', 'cleanup after'])
    })

    it('aggregates cleanup failures with the primary failure first', async () => {
      const cause = new Error('cooperative all failed')
      const releaseFailure = new Error('cooperative release failed')
      const slow = bracket(
        ok(undefined),
        () => fail(releaseFailure),
        () => awaitAbort()
      )
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow, bad]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.deepEqual(result.arg.errors.slice(1), [releaseFailure])
    })

    it('preserves mapAll indexed child failure traces', async () => {
      const cause = new Error('cooperative mapAll traced failure')

      const result = await mapAll([cause], error => fx(function* () {
        yield* fail(error)
      })).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.match(firstLine(result.arg), /fx\/Fail\/fail/)
      assert.deepEqual(traceMessages(result.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.equal((result.arg as Error).cause, cause)
    })

    it('runs explicit fork and wait with only withCoopConcurrency', async () => {
      const result = await fx(function* () {
        const task = yield* fork(asyncValue('forked'))
        return yield* wait(task)
      }).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'forked')
    })

    it('interleaves explicit forked children according to the yield budget', async () => {
      class Step extends Effect('test/Fork/CooperativeForkStep')<string, void> { }
      const events = [] as string[]
      const child = (label: string) => fx(function* () {
        yield* new Step(`${label}1`)
        yield* new Step(`${label}2`)
        return label
      })

      const result = await fx(function* () {
        const a = yield* fork(child('A'))
        const b = yield* fork(child('B'))
        return [yield* wait(a), yield* wait(b)]
      }).pipe(
        withCoopConcurrency({ yieldBudget: 1 }),
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        runPromise
      )

      assert.deepEqual(result, ['A', 'B'])
      assert.deepEqual(events, ['A1', 'B1', 'A2', 'B2'])
    })

    it('runs explicit forks with handlers between fork and withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeForkCurrentValue')<void, string> { }

      const result = await fx(function* () {
        const task = yield* fork(new CurrentValue())
        return yield* wait(task)
      }).pipe(
        handle(CurrentValue, () => ok('handled')),
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'handled')
    })

    it('runs explicit forks with handlers outside withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeForkOuterCurrentValue')<void, string> { }

      const result = await fx(function* () {
        const task = yield* fork(new CurrentValue())
        return yield* wait(task)
      }).pipe(
        withCoopConcurrency(),
        handle(CurrentValue, () => ok('handled')),
        runPromise
      )

      assert.equal(result, 'handled')
    })

    it('runs nested fork inside all and all inside fork', async () => {
      const result = await all([
        fx(function* () {
          const task = yield* fork(ok('forked'))
          return yield* wait(task)
        }),
        fx(function* () {
          const task = yield* fork(all([ok('nested'), asyncValue('all')]))
          return yield* wait(task)
        })
      ]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['forked', ['nested', 'all']])
    })

    it('releases cooperative slots while a forked operator waits for nested children', async () => {
      const result = await withTimeout(fx(function* () {
        const task = yield* fork(all([
          fx(function* () {
            return yield* all([ok('all')])
          }),
          fx(function* () {
            return yield* race([ok('race')])
          }),
          fx(function* () {
            return yield* firstSuccess([ok('firstSuccess')])
          })
        ]))
        return yield* wait(task)
      }).pipe(
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      ), 100)

      assert.deepEqual(result, [['all'], 'race', 'firstSuccess'])
    })

    it('wraps rejected async work inside an explicit cooperative fork', async () => {
      const cause = new Error('cooperative fork async rejected')

      const result: unknown = await fx(function* () {
        const task = yield* fork(assertPromise(() => Promise.reject(cause)))
        return yield* wait(task)
      }).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const snapshot = snapshotError(result.arg)
      assert.equal(snapshot.code, 'FX_AWAITED_ASYNC_FAILED')
      assert.equal(snapshot.cause?.message, 'cooperative fork async rejected')
      assert.equal((result.arg as Error).cause, cause)
    })

    it('leaves explicit cooperative fork failures caller-owned', async () => {
      const cause = new Error('unhandled cooperative fork failure')

      const result = await all([fx(function* () {
        yield* fork(fx(function* () {
          yield* asyncValue(undefined)
          yield* fail(cause)
        }))
        yield* delayFx(10)
        return 'done'
      })]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(!Fail.is(result))
      assert.deepEqual(result, ['done'])
    })

    it('interrupts explicit cooperative forks and runs scoped finalizers', async () => {
      const TestScope = scope('test/Fork/CooperativeForkInterruptScope')
      const exits = [] as Exit[]
      let started!: () => void
      const startedPromise = new Promise<void>(resolve => { started = resolve })

      const task = taskOrThrow(await fx(function* () {
        return yield* fork(fx(function* () {
          yield* andFinallyExit(TestScope, exit => fx(function* () {
            exits.push(exit)
          }))
          started()
          yield* awaitAbort()
        }))
      }).pipe(
        withScope(TestScope),
        withCoopConcurrency(),
        returnFail,
        runPromise
      ))

      await startedPromise
      await task.interrupt('stop')

      assert.deepEqual(exits.map(exit => exit.type), ['interrupted'])
      assert.deepEqual(exits[0], { type: 'interrupted', scope: TestScope })
    })

    it('aborts handler-produced async work before closing an interrupted fiber', async () => {
      class Park extends Effect('test/Fork/CooperativeHandledAsyncInterrupt')<void, void> { }
      const TestScope = scope('test/Fork/CooperativeHandledAsyncInterruptScope')
      const events: string[] = []
      let release!: () => void
      const released = new Promise<void>(resolve => { release = resolve })

      const task = taskOrThrow(await fx(function* () {
        return yield* fork(fx(function* () {
          yield* andFinallyExit(TestScope, exit => fx(function* () {
            events.push(`finalize:${exit.type}`)
          }))
          events.push('before')
          yield* new Park()
          events.push('after')
        }).pipe(withScope(TestScope)))
      }).pipe(
        withCoopConcurrency(),
        handle(Park, () => assertPromise(() => released)),
        runPromise
      ))

      await delay(0)
      const interrupted = task.interrupt('stop')
      await withTimeout(interrupted, 50)

      release()

      assert.deepEqual(events, ['before', 'finalize:interrupted'])
    })

    it('shares concurrency slots between explicit forks and structured children', async () => {
      const events = [] as string[]
      let releaseFork!: () => void

      const promise = fx(function* () {
        const task = yield* fork(assertPromise<void>(() => new Promise(resolve => {
          events.push('fork start')
          releaseFork = resolve
        })))
        const values = yield* all([fx(function* () {
          events.push('all start')
          return 'all'
        })])
        return [yield* wait(task), ...values]
      }).pipe(
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      )

      await eventually(() => events.includes('fork start'))
      await delay(0)
      assert.deepEqual(events, ['fork start'])

      releaseFork()

      assert.deepEqual(await promise, [undefined, 'all'])
      assert.deepEqual(events, ['fork start', 'all start'])
    })

    it('allows advanced unmetered forks to bypass cooperative concurrency admission', async () => {
      const events = [] as string[]
      let releaseMetered!: () => void

      const result = await fx(function* () {
        yield* fork(assertPromise<void>(() => new Promise(resolve => {
          events.push('metered start')
          releaseMetered = resolve
        })))
        yield* asyncValue(undefined)
        const unmetered = yield* fork(fx(function* () {
          events.push('unmetered start')
          return 'unmetered' as const
        }), { scheduling: 'unmetered' })
        return yield* wait(unmetered)
      }).pipe(
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      )

      releaseMetered()

      assert.equal(result, 'unmetered')
      assert.deepEqual(events, ['metered start', 'unmetered start'])
    })

    it('interrupts queued explicit cooperative forks before they start', async () => {
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
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      )

      await eventually(() => events.includes('start first'))
      await withTimeout(tasks[1].interrupt(), 100)
      assert.deepEqual(events, ['start first'])

      await tasks[0].interrupt()
      await eventually(() => events.includes('start third'))
      assert.deepEqual(events, ['start first', 'start third'])

      await tasks[2].interrupt()
    })

    it('does not instantiate queued cooperative fork iterators interrupted before admission', async () => {
      let iteratorCreated = 0
      const blocker = fx(function* () {
        yield* awaitAbort()
      })
      const queued = {
        [Symbol.iterator]() {
          iteratorCreated++
          return fx(function* () {
            yield* awaitAbort()
          })[Symbol.iterator]()
        }
      } as Fx<Async, void>

      const tasks = await fx(function* () {
        const first = yield* fork(blocker)
        const second = yield* fork(queued)
        return [first, second] as const
      }).pipe(
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      )

      await tasks[1].interrupt('stop queued')
      assert.equal(iteratorCreated, 0)

      await tasks[0].interrupt('stop first')
      assert.equal(iteratorCreated, 0)
    })

    it('defers sibling cancellation while a child is interruption-masked', async () => {
      const TestScope = scope('test/Fork/CooperativeAllMaskedCancelScope')
      const events = [] as string[]
      const cause = new Error('cooperative masked all failed')
      let releaseMasked!: () => void

      const masked = uninterruptible(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('released')
        }))
        events.push('masked start')
        yield* assertPromise<void>(() => new Promise(resolve => {
          releaseMasked = () => resolve()
        }))
        events.push('masked end')
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const promise = all([masked, bad]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail,
        runPromise
      )

      await eventually(() => events.includes('masked start'))
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(events, ['masked start'])

      releaseMasked()
      const result = await promise

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(events, ['masked start', 'masked end', 'released'])
    })

    it('types all as a value tuple and preserves child Fail errors', async () => {
      const cause = new Error('cooperative typed failure')
      const result = await fx(function* () {
        const values = yield* all([ok(1), fail(cause)])
        const tuple: readonly [number, never] = values
        // @ts-expect-error cooperative all returns values directly, not a Task.
        const task: Task<readonly [number, never], Fail<Error>> = values
        void task
        return tuple
      }).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const error: Error = result.arg
      assert.equal(error.cause, cause)
    })
  })

  describe('withCoopConcurrency', () => {
    it('rejects invalid options', () => {
      assert.throws(() => withCoopConcurrency({ concurrency: 0 }), RangeError)
      assert.throws(() => withCoopConcurrency({ concurrency: 0.5 }), RangeError)
      assert.throws(() => withCoopConcurrency({ yieldBudget: 0 }), RangeError)
      assert.throws(() => withCoopConcurrency({ yieldBudget: 0.5 }), RangeError)
    })

    it('returns all and mapAll child values directly in input order', async () => {
      const tuple = await all([ok(1), asyncValue('two')]).pipe(
        withCoopConcurrency(),
        runPromise
      )
      const mapped = await mapAll([3, 1, 2], n => asyncValue(n * 2)).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(tuple, [1, 'two'])
      assert.deepEqual(mapped, [6, 2, 4])
    })

    it('uses first-settled race semantics and cancels losers', async () => {
      let cancelled = false
      const slow = assertPromise<string>(signal => new Promise(resolve => {
        signal.addEventListener('abort', () => {
          cancelled = true
          resolve('cancelled')
        }, { once: true })
      }))

      const result = await race([slow, ok('winner')]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'winner')
      assert.equal(cancelled, true)
    })

    it('can use first-success race semantics', async () => {
      const failed = new Error('fast failure')
      const bad = fx(function* () {
        yield* fail(failed)
      })

      const result = await firstSuccess([bad, asyncValue('winner')]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'winner')
    })

    it('can use cooperative first-settled semantics explicitly', async () => {
      const result = await race([asyncValue('slow'), ok('fast')]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'fast')
    })

    it('keeps empty first-settled races pending until interrupted', async () => {
      const pending = race([]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(await Promise.race([pending, delay(25).then(() => 'pending')]), 'pending')

      const task = race([]).pipe(
        withCoopConcurrency(),
        runTask
      )

      await withTimeout(task.interrupt('stop'), 100)
    })

    it('fails first-success races with input-ordered errors when every child fails', async () => {
      const first = new Error('first failed')
      const second = new Error('second failed')

      const result = await firstSuccess([
        fx(function* () { yield* fail(first) }),
        fx(function* () { yield* fail(second) })
      ]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof RaceAllFailed)
      assert.equal(result.arg.code, 'FX_RACE_ALL_FAILED')
      assert.equal(result.arg.errors.length, 2)
      assert.deepEqual(result.arg.errors.map((e: unknown) => (e as Error).cause), [first, second])
    })

    it('runs nested all to race and firstSuccess-shaped race without hanging', async () => {
      const failed = new Error('primary failed')

      const raceResult = await all([
        race([assertPromise(() => new Promise<string>(resolve => setImmediate(() => resolve('slow')))), ok('fast')])
      ]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      const firstSuccessResult = await all([
        firstSuccess([
          fx(function* () { yield* fail(failed) }),
          asyncValue('replica')
        ])
      ]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(raceResult, ['fast'])
      assert.deepEqual(firstSuccessResult, ['replica'])
    })

    it('runs nested groups at the concurrency limit without deadlocking', async () => {
      const failed = new Error('primary failed')

      const result = await all([
        fx(function* () {
          return yield* all([ok(1)])
        }),
        fx(function* () {
          return yield* race([ok('race')])
        }),
        fx(function* () {
          return yield* firstSuccess([
            fx(function* () { yield* fail(failed) }),
            ok('success')
          ])
        })
      ]).pipe(
        withCoopConcurrency({ concurrency: 1 }),
        runPromise
      )

      assert.deepEqual(result, [[1], 'race', 'success'])
    })

    it('supports mixed first-settled and first-success races in one cooperative region', async () => {
      const failed = new Error('primary failed')

      const result = await all([
        race([
          assertPromise(() => new Promise<string>(resolve => setImmediate(() => resolve('slow')))),
          ok('first-settled')
        ]),
        firstSuccess([
          fx(function* () { yield* fail(failed) }),
          asyncValue('first-success')
        ])
      ]).pipe(
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['first-settled', 'first-success'])
    })

    it('continues ready children while another child waits on async work', async () => {
      class Step extends Effect('test/Fork/CooperativeStructuredAsyncQueue')<string, void> { }
      const events = [] as string[]
      let releaseSlow!: () => void
      const slow = assertPromise<string>(() => new Promise(resolve => {
        releaseSlow = () => resolve('slow')
      }))
      const fast = fx(function* () {
        yield* new Step('fast')
        return 'fast'
      })

      const promise = all([slow, fast]).pipe(
        withCoopConcurrency(),
        handle(Step, step => fx(function* () {
          events.push(step.arg)
        })),
        runPromise
      )

      await eventually(() => events.includes('fast'))
      releaseSlow()

      assert.deepEqual(await promise, ['slow', 'fast'])
    })

    it('runs handlers between structured effects and withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeStructuredCurrentValue')<void, string> { }

      const result = await all([
        race([new CurrentValue()])
      ]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withCoopConcurrency(),
        runPromise
      )

      assert.deepEqual(result, ['handled'])
    })

    it('runs handlers between firstSuccess and withCoopConcurrency', async () => {
      class CurrentValue extends Effect('test/Fork/CooperativeTaggedRaceCurrentValue')<void, string> { }

      const result = await firstSuccess([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withCoopConcurrency(),
        runPromise
      )

      assert.equal(result, 'handled')
    })

    it('aborts parked async children when the parent task is interrupted', async () => {
      let started = false
      let aborted = false
      const parked = assertPromise<void>(signal => new Promise(resolve => {
        started = true
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      }))

      const task = all([parked]).pipe(
        withCoopConcurrency(),
        runTask
      )

      await eventually(() => started)
      await task.interrupt()

      assert.equal(aborted, true)
    })

    it('converts rejected async work into recoverable failure', async () => {
      const cause = new Error('cooperative structured async rejected')

      const result: unknown = await race([assertPromise(() => Promise.reject(cause))]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      const snapshot = snapshotError(result.arg)
      assert.equal(snapshot.code, 'FX_AWAITED_ASYNC_FAILED')
      assert.equal(snapshot.cause?.message, 'cooperative structured async rejected')
      assert.equal((result.arg as Error).cause, cause)
    })

    it('preserves indexed failure traces for all, mapAll, and race', async () => {
      const allCause = new Error('cooperative structured all traced failure')
      const mapAllCause = new Error('cooperative structured mapAll traced failure')
      const raceCause = new Error('cooperative structured race traced failure')

      const allResult = await all([fx(function* () { yield* fail(allCause) })]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )
      const mapAllResult = await mapAll([mapAllCause], error => fx(function* () { yield* fail(error) })).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )
      const raceResult = await race([fx(function* () { yield* fail(raceCause) })]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(allResult))
      assert.ok(Fail.is(mapAllResult))
      assert.ok(Fail.is(raceResult))
      assert.deepEqual(traceMessages(allResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/all[0]', 'fx/Concurrent/all'])
      assert.deepEqual(traceMessages(mapAllResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/mapAll[0]', 'fx/Concurrent/mapAll'])
      assert.deepEqual(traceMessages(raceResult.arg).slice(0, 3), ['fx/Fail/fail', 'fx/Concurrent/race[0]', 'fx/Concurrent/race'])
    })

    it('runs scoped finalizers and aggregates cleanup failures with the primary failure first', async () => {
      const cause = new Error('cooperative structured all failed')
      const releaseFailure = new Error('cooperative structured release failed')
      const slow = bracket(
        ok(undefined),
        () => fail(releaseFailure),
        () => awaitAbort()
      )
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const result = await all([slow, bad]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.deepEqual(result.arg.errors.slice(1), [releaseFailure])
    })

    it('defers sibling cancellation while a child is interruption-masked', async () => {
      const TestScope = scope('test/Fork/CooperativeStructuredMaskedCancelScope')
      const events = [] as string[]
      const cause = new Error('cooperative structured masked all failed')
      let releaseMasked!: () => void

      const masked = uninterruptible(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('released')
        }))
        events.push('masked start')
        yield* assertPromise<void>(() => new Promise(resolve => {
          releaseMasked = () => resolve()
        }))
        events.push('masked end')
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const promise = all([masked, bad]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail,
        runPromise
      )

      await eventually(() => events.includes('masked start'))
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(events, ['masked start'])

      releaseMasked()
      const result = await promise

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(events, ['masked start', 'masked end', 'released'])
    })

    it('awaits async cleanup when masked cooperative cancellation is delivered at unmask', async () => {
      const TestScope = scope('test/Fork/CooperativeStructuredMaskedAsyncCleanup')
      const events = [] as string[]
      const cause = new Error('cooperative structured masked async cleanup failed')
      let releaseMasked!: () => void
      let releaseCleanup!: () => void
      const cleanupReleased = new Promise<void>(resolve => {
        releaseCleanup = resolve
      })

      const masked = uninterruptible(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          events.push('release start')
          yield* assertPromise(() => cleanupReleased)
          events.push('release done')
        }))
        events.push('masked start')
        yield* assertPromise<void>(() => new Promise(resolve => {
          releaseMasked = () => resolve()
        }))
        events.push('masked end')
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const promise = all([masked, bad]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail,
        runPromise
      )

      await eventually(() => events.includes('masked start'))
      await new Promise(resolve => setImmediate(resolve))
      releaseMasked()
      await eventually(() => events.includes('release start'))

      const early = await Promise.race([
        promise.then(() => 'settled' as const),
        delay(20).then(() => 'pending' as const)
      ])
      assert.equal(early, 'pending')
      assert.deepEqual(events, ['masked start', 'masked end', 'release start'])

      releaseCleanup()
      const result = await withTimeout(promise, 100)

      assert.ok(Fail.is(result))
      assert.equal((result.arg as Error).cause, cause)
      assert.deepEqual(events, ['masked start', 'masked end', 'release start', 'release done'])
    })

    it('reports cleanup failures when masked cooperative cancellation is delivered at unmask', async () => {
      const TestScope = scope('test/Fork/CooperativeStructuredMaskedCleanupFailure')
      const cause = new Error('cooperative structured masked cleanup primary failed')
      const releaseFailure = new Error('cooperative structured masked cleanup release failed')
      let releaseMasked!: () => void

      const masked = uninterruptible(fx(function* () {
        yield* andFinally(TestScope, fx(function* () {
          yield* asyncValue(undefined)
          yield* fail(releaseFailure)
        }))
        yield* assertPromise<void>(() => new Promise(resolve => {
          releaseMasked = () => resolve()
        }))
      }))
      const bad = fx(function* () {
        yield* asyncValue(undefined)
        yield* fail(cause)
      })

      const promise = all([masked, bad]).pipe(
        withCoopConcurrency(),
        withScope(TestScope),
        returnFail,
        runPromise
      )

      await new Promise(resolve => setImmediate(resolve))
      releaseMasked()
      const result = await promise

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.equal((result.arg.errors[0] as Error).cause, cause)
      assert.equal(result.arg.errors[1], releaseFailure)
    })

    it('preserves structured result and failure types', async () => {
      class FirstError extends Error { readonly first = true }
      class SecondError extends Error { readonly second = true }

      const allResult = await fx(function* () {
        const values = yield* all([ok(1), ok('two')])
        const tuple: readonly [number, string] = values
        return tuple
      }).pipe(
        withCoopConcurrency(),
        runPromise
      )
      const raceResult = await fx(function* () {
        const value = yield* race([ok(1), ok('two')])
        const union: number | string = value
        return union
      }).pipe(
        withCoopConcurrency(),
        runPromise
      )
      const failed = await firstSuccess([
        fail(new FirstError()),
        fail(new SecondError())
      ]).pipe(
        withCoopConcurrency(),
        returnFail,
        runPromise
      )

      assert.deepEqual(allResult, [1, 'two'])
      assert.equal(raceResult, 1)
      assert.ok(Fail.is(failed))
      assert.ok(failed.arg instanceof RaceAllFailed)
    })
  })

  describe('race', () => {
    it('returns the first settled child value directly without wait', async () => {
      const result = await race([asyncValue('winner'), ok('loser')]).pipe(
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
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
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
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
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.equal(result.arg.message, 'Resource release failed')
      assert.deepEqual(result.arg.errors, [releaseFailure])
    })

    it('runs children with handlers between race and scheduler', async () => {
      class CurrentValue extends Effect('test/Fork/RaceCurrentValue')<void, string> { }

      const result = await race([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withUnboundedConcurrency,
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
        withUnboundedConcurrency,
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

      const result = await firstSuccess([bad, asyncValue('winner')]).pipe(
        withUnboundedConcurrency,
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

      const result = await firstSuccess([ok('winner'), slow]).pipe(
        withUnboundedConcurrency,
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

      const result = await firstSuccess([ok('winner'), slow]).pipe(
        withScope(TestScope),
        withUnboundedConcurrency,
        returnFail,
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

      const result = await firstSuccess([bad(first), bad(second)]).pipe(
        withUnboundedConcurrency,
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof RaceAllFailed)
      assert.equal(result.arg.code, 'FX_RACE_ALL_FAILED')
      assert.equal(result.arg.errors.length, 2)
      const causes = result.arg.errors.map((e: unknown) => (e as Error).cause)
      assert.deepEqual(causes, [first, second])
      assert.deepEqual(Object.keys(result.arg), ['name'])
      assert.equal(snapshotError(result.arg).aggregate?.errors.length, 2)
      assert.equal(snapshotError(result.arg).aggregate?.errors[0].cause?.message, 'first failed')
    })

    it('types all-failed errors by input index', async () => {
      class FirstError extends Error { readonly first = true }
      class SecondError extends Error { readonly second = true }

      const result = await firstSuccess([
        fail(new FirstError()),
        fail(new SecondError())
      ]).pipe(
        withUnboundedConcurrency,
        returnFail,
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

    it('runs children with handlers between firstSuccess and scheduler', async () => {
      class CurrentValue extends Effect('test/Fork/FirstSuccessCurrentValue')<void, string> { }

      const result = await firstSuccess([new CurrentValue()]).pipe(
        handle(CurrentValue, () => ok('handled')),
        withUnboundedConcurrency,
        runPromise
      )

      assert.equal(result, 'handled')
    })
  })
})

describe('Scope-owned fork lifetime', () => {
  it('interrupts forkIn children from parent interruptFrom with the same reason', async () => {
    const TestScope = scope('test/ForkIn/parent-interrupt')
    const reason = { type: 'parent-interrupt' } as const
    const exits = [] as Exit[]

    const child = () => fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* awaitAbort()
    })

    const result = await fx(function* () {
      yield* forkIn(TestScope, child())
      yield* forkIn(TestScope, child())
      yield* delayFx(0)
      yield* interruptFrom(TestScope, reason)
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => ok(r)),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(!Fail.is(result))
    assert.equal(result, reason)
    assert.deepEqual(exits, [
      { type: 'interrupted', scope: TestScope, reason },
      { type: 'interrupted', scope: TestScope, reason }
    ])
  })

  it('lets a forkIn child return from the owning scope and finalize siblings', async () => {
    const RaceScope = scope('test/ForkIn/race-return')
    const events = [] as string[]

    const result = await fx(function* () {
      yield* forkIn(RaceScope, fx(function* () {
        yield* delayFx(0)
        return yield* returnFrom(RaceScope, 'winner')
      }))

      yield* forkIn(RaceScope, fx(function* () {
        yield* andFinallyExit(RaceScope, exit => fx(function* () {
          events.push(exit.type)
        }))
        yield* awaitAbort()
      }))

      return 'parent'
    }).pipe(
      withScope(RaceScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(!Fail.is(result))
    assert.equal(result, 'winner')
    assert.deepEqual(events, ['returnFrom'])
  })

  it('propagates child returns to an outer owning scope while an inner scope is parked', async () => {
    const OuterScope = scope('test/ForkIn/nested-outer-return')
    const InnerScope = scope('test/ForkIn/nested-inner-parked')
    const events = [] as string[]

    const result = await withTimeout(fx(function* () {
      yield* forkIn(OuterScope, fx(function* () {
        yield* delayFx(0)
        return yield* returnFrom(OuterScope, 'outer')
      }))

      yield* fx(function* () {
        yield* andFinally(InnerScope, fx(function* () {
          events.push('inner cleanup')
        }))
        yield* awaitAbort()
        events.push('inner after await')
      }).pipe(withScope(InnerScope))

      events.push('outer after inner')
      return 'parent'
    }).pipe(
      withScope(OuterScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ), 100)

    assert.ok(!Fail.is(result))
    assert.equal(result, 'outer')
    assert.deepEqual(events, ['inner cleanup'])
  })

  it('lets a forkIn child interrupt the owning scope and finalize siblings', async () => {
    const TestScope = scope('test/ForkIn/child-interrupt')
    const reason = { type: 'child-interrupt' } as const
    const exits = [] as Exit[]

    const result = await fx(function* () {
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(0)
        yield* interruptFrom(TestScope, reason)
      }))

      yield* forkIn(TestScope, fx(function* () {
        yield* andFinallyExit(TestScope, exit => fx(function* () {
          exits.push(exit)
        }))
        yield* awaitAbort()
      }))

      return 'parent'
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => ok(r)),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(!Fail.is(result))
    assert.equal(result, reason)
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope, reason }])
  })

  it('fails the owning scope when a forkIn child fails', async () => {
    const TestScope = scope('test/ForkIn/child-failure')
    const primary = new Error('child failed')
    const exits = [] as string[]

    const result = await fx(function* () {
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(0)
        yield* fail(primary)
      }))

      yield* forkIn(TestScope, fx(function* () {
        yield* andFinallyExit(TestScope, exit => fx(function* () {
          exits.push(exit.type)
        }))
        yield* awaitAbort()
      }))

      return 'parent'
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.equal(snapshotError(result.arg).cause?.message, 'child failed')
    assert.deepEqual(exits, ['failure'])
  })

  it('fails the owning scope when a forkIn child fails while the parent body is parked', async () => {
    const TestScope = scope('test/ForkIn/child-failure-while-parent-parked')
    const primary = new Error('child failed')
    let completed = false

    const result = await withTimeout(fx(function* () {
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(0)
        yield* fail(primary)
      }))
      yield* awaitAbort()
      completed = true
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ), 100)

    assert.ok(Fail.is(result))
    assert.equal(snapshotError(result.arg).cause?.message, 'child failed')
    assert.equal(completed, false)
  })

  it('aggregates forkIn child failure before sibling cleanup failures', async () => {
    const TestScope = scope('test/ForkIn/failure-cleanup-aggregate')
    const primary = new Error('primary child failed')
    const cleanup = new Error('sibling cleanup failed')

    const result = await fx(function* () {
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(0)
        yield* fail(primary)
      }))

      yield* forkIn(TestScope, fx(function* () {
        yield* andFinally(TestScope, fail(cleanup))
        yield* awaitAbort()
      }))

      return 'parent'
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(snapshotError(result.arg.errors[0]).cause?.message, 'primary child failed')
    assert.equal(result.arg.errors[1], cleanup)
  })

  it('keeps fork caller-owned across normal scope exit', async () => {
    const TestScope = scope('test/ForkIn/detached-fork')
    const events = [] as string[]

    const task = await fx(function* () {
      return yield* fork(fx(function* () {
        yield* delayFx(10)
        events.push('fork done')
      }))
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      runPromise
    )

    assert.deepEqual(events, [])
    await task.promise
    assert.deepEqual(events, ['fork done'])
  })

  it('keeps forkEach caller-owned across normal scope exit', async () => {
    const TestScope = scope('test/ForkIn/detached-forkEach')
    const events = [] as string[]

    const tasks = await fx(function* () {
      return yield* forkEach([
        fx(function* () {
          yield* delayFx(10)
          events.push('forkEach done')
        })
      ] as const)
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      runPromise
    )

    assert.deepEqual(events, [])
    await tasks[0].promise
    assert.deepEqual(events, ['forkEach done'])
  })

  it('keeps non-daemon forkIn children scope-owned across normal scope exit', async () => {
    const TestScope = scope('test/ForkIn/non-daemon')
    const events = [] as string[]
    let settled = false

    const result = fx(function* () {
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(10)
        events.push('forkIn done')
      }))
      return 'parent done'
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ).then(result => {
      settled = true
      return result
    })

    await Promise.resolve()
    assert.equal(settled, false)
    assert.deepEqual(events, [])

    const r = await result
    assert.ok(!Fail.is(r))
    assert.equal(r, 'parent done')
    assert.equal(settled, true)
    assert.deepEqual(events, ['forkIn done'])
  })

  it('releases cooperative slots while joining non-daemon forkIn children', async () => {
    const TestScope = scope('test/ForkIn/cooperative-join')
    const events = [] as string[]

    const program = fx(function* () {
      const task = yield* fork(fx(function* () {
        yield* forkIn(TestScope, fx(function* () {
          events.push('child start')
          yield* asyncValue(undefined)
          events.push('child done')
        }))
        events.push('parent body done')
        return 'parent done'
      }).pipe(withScope(TestScope)))

      return yield* wait(task)
    }).pipe(
      withCoopConcurrency({ concurrency: 1 })
    )
    const result = await withTimeout(runPromise(program as never), 100)

    assert.equal(result, 'parent done')
    assert.deepEqual(events, ['parent body done', 'child start', 'child done'])
  })

  it('does not keep manually interrupted forkIn tasks alive across normal scope exit', async () => {
    const TestScope = scope('test/ForkIn/manually-interrupted')
    const events = [] as string[]
    let started!: () => void
    const startedPromise = new Promise<void>(resolve => { started = resolve })

    const program = fx(function* () {
      const task = yield* forkIn(TestScope, fx(function* () {
        started()
        yield* andFinallyExit(TestScope, exit => fx(function* () {
          events.push(`finalize ${exit.type}`)
        }))
        yield* awaitAbort()
      }))
      yield* assertPromise(() => startedPromise)
      yield* assertPromise(() => task.interrupt('manual'))
      return 'parent done'
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency
    )
    const result = await withTimeout(runPromise(program as never), 100)

    assert.equal(result, 'parent done')
    assert.deepEqual(events, ['finalize success'])
  })

  it('waits for remaining non-daemon forkIn tasks after ignoring manually interrupted tasks', async () => {
    const TestScope = scope('test/ForkIn/manually-interrupted-with-running')
    const events = [] as string[]

    const program = fx(function* () {
      const interrupted = yield* forkIn(TestScope, awaitAbort())
      yield* forkIn(TestScope, fx(function* () {
        yield* delayFx(10)
        events.push('running done')
      }))
      yield* assertPromise(() => interrupted.interrupt('manual'))
      return 'parent done'
    }).pipe(
      withScope(TestScope),
      withUnboundedConcurrency
    )
    const result = await withTimeout(runPromise(program as never), 100)

    assert.equal(result, 'parent done')
    assert.deepEqual(events, ['running done'])
  })

  it('interrupts queued bounded forkIn children before they start', async () => {
    const TestScope = scope('test/ForkIn/bounded-queued')
    const reason = { type: 'bounded-interrupt' } as const
    const events = [] as string[]

    const child = (label: string) => fx(function* () {
      events.push(`start ${label}`)
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        events.push(`finalize ${label} ${exit.type}`)
      }))
      yield* awaitAbort()
    })

    const result = await fx(function* () {
      yield* forkIn(TestScope, child('first'))
      yield* forkIn(TestScope, child('second'))
      yield* delayFx(0)
      yield* interruptFrom(TestScope, reason)
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => ok(r)),
      withBoundedConcurrency(1),
      returnFail,
      runPromise
    )

    assert.ok(!Fail.is(result))
    assert.equal(result, reason)
    assert.deepEqual(events, ['start first', 'finalize first interrupted'])
  })

  it('preserves forkIn result and scoped return inference', () => {
    const TestScope = scope('test/ForkIn/types')
    const failedFork = forkIn(TestScope, fail('boom' as const))
    const program = fx(function* () {
      const task = yield* forkIn(TestScope, fx(function* () {
        return yield* returnFrom(TestScope, 'early' as const)
      }))
      return task
    }).pipe(withScope(TestScope))

    false satisfies HasFail<EffectOf<typeof failedFork>>
    const failedTask: Fx<unknown, Task<never, Fail<'boom'>>> = failedFork
    const _: Fx<unknown, Task<never, never> | 'early'> = program
    void failedTask
    void _
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
      withUnboundedConcurrency,
      returnFail,
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
      withUnboundedConcurrency,
      returnFail,
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
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ))

    await task.interrupt()

    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('interrupts queued withBoundedConcurrency tasks before semaphore acquisition', async () => {
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
      withBoundedConcurrency(1),
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
      withUnboundedConcurrency,
      returnFail,
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
      withUnboundedConcurrency,
      returnFail,
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
      withUnboundedConcurrency,
      returnFail,
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

    await assert.rejects(race([ok('winner'), slow]).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ), e => {
      const snapshot = snapshotError(e)
      return e instanceof Error
        && snapshot.code === 'FX_AWAITED_ASYNC_FAILED'
        && snapshot.cause?.message === 'async release failed'
        && (e as Error).cause === releaseFailure
    })
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
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.deepEqual(result.arg.errors, [innerFailure, scopeFailure])
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
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.deepEqual(result.arg.errors, [innerFailure, scopeFailure])
  })

  it('preserves interrupted scoped cleanup TypeError failures', async () => {
    const TestScope = scope('test/Fork/InterruptedCleanupTypeError')

    const slow = fx(function* () {
      yield* andFinally(TestScope, fx(function* () {
        const value = undefined as any
        return value.property
      }))
      yield* awaitAbort()
    })

    const result = await race([ok('winner'), slow]).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    )

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.equal(result.arg.message, 'Resource release failed')
    assert.equal(result.arg.errors.length, 1)
    assert.ok(result.arg.errors[0] instanceof TypeError)
    assert.match(result.arg.errors[0].message, /Cannot read properties of undefined/)
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
      withUnboundedConcurrency,
      returnFail,
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
      withUnboundedConcurrency,
      returnFail,
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

const assertUnhandledReturnFrom = (result: unknown) => {
  assert.ok(Fail.is(result))
  assert.ok(result.arg instanceof Error)
  assert.equal(snapshotError(result.arg).code, 'FX_UNHANDLED_FAILURE')
  assert.ok(result.arg.cause instanceof ReturnFrom)
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
