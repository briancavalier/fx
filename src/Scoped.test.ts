import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { abort } from './Abort.js'
import { forkIn, withUnboundedConcurrency } from './Concurrent.js'
import { assert as assertNoFail, fail, Fail, returnFail } from './Fail.js'
import { andFinally, andFinallyExit } from './Finalization.js'
import { fx, ok, run, runPromise, type Fx } from './Fx.js'
import { interruptFrom, InterruptFrom } from './InterruptFrom.js'
import { returnFrom } from './ReturnFrom.js'
import { collectScoped, scoped } from './Scoped.js'
import { getState, modifyState } from './State.js'
import { yieldFrom } from './YieldFrom.js'

describe('scoped', () => {
  it('runs private-scope finalizers after success', () => {
    const exits: string[] = []

    const result = run(scoped(scope => fx(function* () {
      yield* andFinallyExit(scope, exit => ok(void exits.push(exit.type)))
      return 'done' as const
    })).pipe(assertNoFail))

    assert.equal(result, 'done')
    assert.deepEqual(exits, ['success'])
  })

  it('runs private-scope finalizers after failure', () => {
    const failure = new Error('boom')
    const exits: string[] = []

    const result = run(scoped(scope => fx(function* () {
      yield* andFinallyExit(scope, exit => ok(void exits.push(exit.type)))
      return yield* fail(failure)
    })).pipe(returnFail))

    assert.equal(result instanceof Fail, true)
    assert.equal((result as Fail<Error>).arg, failure)
    assert.deepEqual(exits, ['failure'])
  })

  it('runs private-scope finalizers before re-yielding interruption', () => {
    const reason = new Error('stop')
    const exits: string[] = []
    const program = scoped(scope => fx(function* () {
      yield* andFinallyExit(scope, exit => ok(void exits.push(exit.type)))
      return yield* interruptFrom(scope, reason)
    }))

    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(InterruptFrom.is(next.value), true)
    assert.deepEqual(exits, ['interrupted'])
  })

  it('owns forkIn child lifetime with the private scope', async () => {
    const events: string[] = []

    const result = await scoped(scope => fx(function* () {
      yield* forkIn(scope, fx(function* () {
        events.push('child ran')
        yield* andFinally(scope, ok(void events.push('child cleanup')))
        return 'child' as const
      }))
      events.push('parent done')
      return 'parent' as const
    })).pipe(
      withUnboundedConcurrency,
      assertNoFail,
      runPromise
    )

    assert.equal(result, 'parent')
    assert.deepEqual(events, ['parent done', 'child ran', 'child cleanup'])
  })

  it('only provides lifetime authority', () => {
    scoped(scope => fx(function* () {
      // @ts-expect-error A lifetime-only current scope cannot perform control return.
      yield* returnFrom(scope, 'returned' as const)
      // @ts-expect-error A lifetime-only current scope cannot abort.
      yield* abort(scope)
      // @ts-expect-error A lifetime-only current scope does not create a yielding protocol.
      yield* yieldFrom(scope, 'event' as const)
      // @ts-expect-error A lifetime-only current scope does not create a state protocol.
      yield* getState(scope)
      // @ts-expect-error A lifetime-only current scope does not create a state protocol.
      yield* modifyState(scope, state => [state, undefined] as const)
      return 'done' as const
    }))
  })
})

describe('collectScoped', () => {
  it('collects private scoped yields before they escape', () => {
    const program = collectScoped<'a' | 'b'>()(scope => fx(function* () {
      yield* yieldFrom(scope, 'a' as const)
      yield* yieldFrom(scope, 'b' as const)
      return 'done' as const
    }))

    const _: typeof program extends Fx<never, readonly ['done', readonly ('a' | 'b')[]]> ? true : false = true

    assert.deepEqual(run(program), ['done', ['a', 'b']])
  })

  it('does not provide control authority to the private yield protocol scope', () => {
    collectScoped<number>()(scope => fx(function* () {
      yield* yieldFrom(scope, 1)
      // @ts-expect-error A private yield protocol scope is not a control scope.
      return yield* returnFrom(scope, 'returned' as const)
    }))
  })
})
