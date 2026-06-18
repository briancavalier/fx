import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertPromise } from '../Async.js'
import { abort } from '../Abort.js'
import { Effect } from '../Effect.js'
import { fail, Fail } from '../Fail.js'
import { finalizing, fx, ok, run, runTask } from '../Fx.js'
import { handle } from '../Handler.js'
import { interruptFrom } from '../InterruptFrom.js'
import { ReturnFrom, returnFrom } from '../ReturnFrom.js'
import { scope, type Control } from '../Scope.js'
import { getState, modifyState, withState, type Stateful } from '../State.js'
import { drainExitRegionReturn } from './exitRegion.js'
import { returnExit, resumeExit } from './returnExit.js'

describe('returnExit', () => {
  const ControlScope = scope<Control>()('test/returnExit/control')
  const StateScope = scope<Stateful<number>>()('test/returnExit/state')

  it('returns and resumes successful exits', () => {
    const exit = ok('value').pipe(returnExit, run)

    assert.deepEqual(exit, { type: 'success', value: 'value' })
    assert.equal(run(resumeExit(exit)), 'value')
  })

  it('preserves and resumes the original Fail effect', () => {
    const failure = new Fail(new Error('failed'))
    const exit = failure.pipe(returnExit, run)

    assert.equal(exit.type, 'failure')
    assert.equal(exit.effect, failure)

    const next = resumeExit(exit)[Symbol.iterator]().next()
    assert.equal(next.done, false)
    assert.equal(next.value, failure)
  })

  it('preserves and resumes the original ReturnFrom effect', () => {
    const returned = returnFrom(ControlScope, 'returned')
    const exit = returned.pipe(returnExit, run)

    assert.equal(exit.type, 'returnFrom')
    assert.equal(exit.effect, returned)

    const next = resumeExit(exit)[Symbol.iterator]().next()
    assert.equal(next.done, false)
    assert.equal(next.value, returned)
  })

  it('preserves and resumes the original Abort effect', () => {
    const aborted = abort(ControlScope)
    const exit = aborted.pipe(returnExit, run)

    assert.equal(exit.type, 'abort')
    assert.equal(exit.effect, aborted)

    const next = resumeExit(exit)[Symbol.iterator]().next()
    assert.equal(next.done, false)
    assert.equal(next.value, aborted)
  })

  it('preserves and resumes the original InterruptFrom effect', () => {
    const interrupted = interruptFrom(ControlScope, 'reason')
    const exit = interrupted.pipe(returnExit, run)

    assert.equal(exit.type, 'interrupted')
    assert.equal(exit.effect, interrupted)

    const next = resumeExit(exit)[Symbol.iterator]().next()
    assert.equal(next.done, false)
    assert.equal(next.value, interrupted)
  })

  it('runs lexical cleanup before returning an exit', () => {
    const events: string[] = []

    const exit = fail('body').pipe(
      finalizing(ok(void events.push('cleanup'))),
      returnExit,
      run
    )

    assert.equal(exit.type, 'failure')
    assert.deepEqual(events, ['cleanup'])
  })

  it('lets outer handlers interpret cleanup effects', () => {
    class Cleanup extends Effect('test/returnExit/Cleanup')<string, void> { }
    const handled: string[] = []

    const exit = ok('body').pipe(
      finalizing(new Cleanup('cleanup')),
      returnExit,
      handle(Cleanup, effect => ok(void handled.push(effect.arg))),
      run
    )

    assert.equal(exit.type, 'success')
    assert.deepEqual(handled, ['cleanup'])
  })

  it('returns cleanup failure after body success', () => {
    const cleanupFailure = new Error('cleanup failed')
    const exit = ok('body').pipe(
      finalizing(fail(cleanupFailure)),
      returnExit,
      run
    )

    assert.equal(exit.type, 'failure')
    assert.equal(exit.effect.arg, cleanupFailure)
  })

  it('returns body returnFrom with cleanup failure after body returnFrom', () => {
    const cleanupFailure = new Error('cleanup failed')
    const exit = returnFrom(ControlScope, 'returned').pipe(
      finalizing(fail(cleanupFailure)),
      returnExit,
      run
    )

    assert.equal(exit.type, 'withCleanupExit')
    assert.equal(exit.primary.type, 'returnFrom')
    assert.equal(exit.primary.effect.arg, 'returned')
    assert.equal(exit.cleanup.type, 'failure')
    assert.equal(exit.cleanup.effect.arg, cleanupFailure)
  })

  it('returns later cleanup failure after cleanup returnFrom', () => {
    const cleanupFailure = new Error('cleanup failed')
    const exit = returnFrom(ControlScope, 'body').pipe(
      finalizing(returnFrom(ControlScope, 'cleanup')),
      finalizing(fail(cleanupFailure)),
      returnExit,
      run
    )

    assert.equal(exit.type, 'withCleanupExit')
    assert.equal(exit.primary.type, 'returnFrom')
    assert.equal(exit.primary.effect.arg, 'body')
    assert.equal(exit.cleanup.type, 'failure')
    assert.equal(exit.cleanup.effect.arg, cleanupFailure)

    const next = resumeExit(exit)[Symbol.iterator]().next()
    assert.equal(next.done, false)
    assert.ok(Fail.is(next.value))
    assert.equal(next.value.arg, cleanupFailure)
  })

  it('preserves body failure and keeps closing after cleanup failure', () => {
    const bodyFailure = new Error('body failed')
    const cleanupFailure = new Error('cleanup failed')
    const events: string[] = []

    const [exit, state] = fx(function* () {
      const exit = yield* fail(bodyFailure).pipe(
        finalizing(fx(function* () {
          events.push('failing cleanup')
          yield* fail(cleanupFailure)
          events.push('unreachable cleanup')
        })),
        finalizing(fx(function* () {
          events.push('state cleanup')
          yield* modifyState(StateScope, count => [count + 1, undefined])
        })),
        returnExit
      )

      return [exit, yield* getState(StateScope)] as const
    }).pipe(withState(StateScope, 0), run)

    assert.equal(exit.type, 'withCleanupExit')
    assert.equal(exit.primary.type, 'failure')
    assert.equal(exit.primary.effect.arg, bodyFailure)
    assert.equal(exit.cleanup.type, 'failure')
    assert.equal(exit.cleanup.effect.arg, cleanupFailure)
    assert.deepEqual(events, ['failing cleanup', 'state cleanup'])
    assert.equal(state, 1)
  })

  it('preserves a recorded cleanup exit when cleanup interpretation completes', () => {
    const cleanupFailure = new Fail(new Error('cleanup failed'))
    const cleanupReturn = returnFrom(ControlScope, 'cleanup')
    let interrupted = false
    const iterator: Iterator<Fail<Error> | typeof cleanupReturn, void, unknown> = {
      next: () => ({ done: true, value: undefined }),
      return: () => ({ done: false, value: cleanupFailure }),
      throw: () => {
        interrupted = true
        return { done: false, value: cleanupReturn }
      }
    }

    const result = drainExitRegionReturn(iterator, {
      classify: effect => Fail.is(effect) ? effect : undefined,
      step: function* (effect) {
        assert.equal(ReturnFrom.is(effect), true)
        return { type: 'done', value: undefined }
      }
    }).next()

    assert.deepEqual(result, { done: true, value: cleanupFailure })
    assert.equal(interrupted, true)
  })

  it('closes the wrapped iterator when interrupted on a forwarded effect', () => {
    class Wait extends Effect('test/returnExit/Wait')<void, void> { }
    const events: string[] = []
    const iterator = fx(function* () {
      yield* new Wait(undefined)
    }).pipe(
      finalizing(fx(function* () {
        events.push('cleanup')
      })),
      returnExit
    )[Symbol.iterator]()

    let result = iterator.next()
    while (!result.done && !Wait.is(result.value)) {
      result = iterator.next()
    }

    assert.equal(result.done, false)
    assert.equal(Wait.is(result.value), true)
    assert.deepEqual(events, [])

    const returned = iterator.return?.()
    if (returned !== undefined) {
      result = returned
      while (!result.done) {
        result = iterator.next()
      }
    }

    assert.deepEqual(events, ['cleanup'])
  })

  it('surfaces cleanup failures when interrupted on a forwarded effect', async () => {
    const cleanupFailure = new Error('cleanup failed')
    const task = fx(function* () {
      yield* assertPromise(() => new Promise(() => { }))
    }).pipe(
      finalizing(fail(cleanupFailure)),
      returnExit,
      runTask
    )

    await assert.rejects(
      () => task.interrupt(),
      (e: unknown) =>
        e instanceof Error
        && e.message === 'Unhandled failure in forked task'
        && e.cause === cleanupFailure
    )
  })
})
