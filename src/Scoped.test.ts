import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { abort, Abort } from './Abort.js'
import { forkIn, withUnboundedConcurrency } from './Concurrent.js'
import { assert as assertNoFail, fail, Fail, returnFail } from './Fail.js'
import { andFinally, andFinallyIn } from './Finalization.js'
import { fx, ok, run, runPromise, type Fx } from './Fx.js'
import { interruptFrom, InterruptFrom, recoverInterrupt } from './InterruptFrom.js'
import { returnFrom, ReturnFrom } from './ReturnFrom.js'
import { scoped } from './Scoped.js'
import { currentScope, scope, withScope, type Control } from './Scope.js'
import { getState, modifyState } from './State.js'
import { yieldFrom } from './YieldFrom.js'

describe('currentScope', () => {
  it('is eliminated by withScope', () => {
    const TestScope = scope('test/CurrentScope/type')
    const program = andFinally(ok(undefined)).pipe(withScope(TestScope))

    const _: typeof program extends Fx<Fail<AggregateError>, void> ? true : false = true

    assert.equal(run(program.pipe(returnFail)) instanceof Fail, false)
  })

  it('supports lifetime APIs without exposing control protocols', async () => {
    const events: string[] = []

    const result = await scoped(fx(function* () {
      yield* andFinally(fx(function* () {
        events.push('cleanup')
      }))
      yield* forkIn(currentScope, fx(function* () {
        events.push('child')
      }))
      events.push('parent')
      return 'done' as const
    })).pipe(
      withUnboundedConcurrency,
      assertNoFail,
      runPromise
    )

    assert.equal(result, 'done')
    assert.deepEqual(events, ['parent', 'child', 'cleanup'])
  })

  it('only exposes lifetime authority', () => {
    fx(function* () {
      // @ts-expect-error The current scope cannot perform control return.
      yield* returnFrom(currentScope, 'returned' as const)
      // @ts-expect-error The current scope cannot abort.
      yield* abort(currentScope)
      // @ts-expect-error The current scope does not create a yielding protocol.
      yield* yieldFrom(currentScope, 'event' as const)
      // @ts-expect-error The current scope does not create a state protocol.
      yield* getState(currentScope)
      // @ts-expect-error The current scope does not create a state protocol.
      yield* modifyState(currentScope, state => [state, undefined] as const)
      return 'done' as const
    })
  })

  it('is a logical nearest-scope token, not a snapshot', () => {
    const events: string[] = []
    const saved = currentScope

    const result = run(scoped(fx(function* () {
      yield* andFinallyIn(saved, fx(function* () {
        events.push('outer cleanup')
      }))
      yield* scoped(fx(function* () {
        yield* andFinallyIn(saved, fx(function* () {
          events.push('inner cleanup')
        }))
      }))
      events.push('body done')
      return 'done' as const
    })).pipe(assertNoFail))

    assert.equal(result, 'done')
    assert.deepEqual(events, ['inner cleanup', 'body done', 'outer cleanup'])
  })

  it('re-yields current-scope interruption as the handled concrete scope', () => {
    const TestScope = scope('test/CurrentScope/interrupt')
    const reason = { type: 'stop' }

    const result = run(fx(function* () {
      return yield* interruptFrom(currentScope, reason)
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => ok(r)),
      assertNoFail
    ))

    assert.equal(result, reason)
  })
})

describe('scoped', () => {
  it('runs private-scope finalizers after success', () => {
    const exits: string[] = []

    const result = run(scoped(fx(function* () {
      yield* andFinally(exit => ok(void exits.push(exit.type)))
      return 'done' as const
    })).pipe(assertNoFail))

    assert.equal(result, 'done')
    assert.deepEqual(exits, ['success'])
  })

  it('runs private-scope finalizers after failure', () => {
    const failure = new Error('boom')
    const exits: string[] = []

    const result = run(scoped(fx(function* () {
      yield* andFinally(exit => ok(void exits.push(exit.type)))
      return yield* fail(failure)
    })).pipe(returnFail))

    assert.equal(result instanceof Fail, true)
    assert.equal((result as Fail<Error>).arg, failure)
    assert.deepEqual(exits, ['failure'])
  })

  it('runs private-scope finalizers before re-yielding interruption', () => {
    const reason = new Error('stop')
    const exits: string[] = []
    const program = scoped(fx(function* () {
      yield* andFinally(exit => ok(void exits.push(exit.type)))
      return yield* interruptFrom(currentScope, reason)
    }))

    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(InterruptFrom.is(next.value), true)
    assert.deepEqual(exits, ['interrupted'])
  })

  it('owns forkIn child lifetime with the private scope', async () => {
    const events: string[] = []

    const result = await scoped(fx(function* () {
      yield* forkIn(currentScope, fx(function* () {
        events.push('child ran')
        yield* andFinally(ok(void events.push('child cleanup')))
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

  it('handles currentScope for direct Fx programs', () => {
    const exits: string[] = []

    const result = run(scoped(fx(function* () {
      yield* andFinally(exit => ok(void exits.push(exit.type)))
      return 'done' as const
    })).pipe(assertNoFail))

    assert.equal(result, 'done')
    assert.deepEqual(exits, ['success'])
  })

  it('leaves caller-owned scoped effects visible', () => {
    const Outer = scope<Control>()('test/Scoped/outer')

    const program = scoped(fx(function* () {
      return yield* returnFrom(Outer, 'outer' as const)
    }))

    const _: typeof program extends Fx<ReturnFrom<typeof Outer, 'outer'>, never> ? true : false = true
    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(ReturnFrom.is(next.value), true)
    assert.equal(next.value.scope, Outer)
  })

  it('only provides lifetime authority', () => {
    scoped(fx(function* () {
      // @ts-expect-error A lifetime-only current scope cannot perform control return.
      yield* returnFrom(currentScope, 'returned' as const)
      // @ts-expect-error The ReturnFrom constructor also requires control scope authority.
      yield* new ReturnFrom(currentScope, 'constructed' as const)
      // @ts-expect-error A lifetime-only current scope cannot abort.
      yield* abort(currentScope)
      // @ts-expect-error The Abort constructor also requires control scope authority.
      yield* new Abort(currentScope)
      // @ts-expect-error A lifetime-only current scope does not create a yielding protocol.
      yield* yieldFrom(currentScope, 'event' as const)
      // @ts-expect-error A lifetime-only current scope does not create a state protocol.
      yield* getState(currentScope)
      // @ts-expect-error A lifetime-only current scope does not create a state protocol.
      yield* modifyState(currentScope, state => [state, undefined] as const)
      return 'done' as const
    }))
  })
})
