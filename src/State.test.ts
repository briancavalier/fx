import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { returnFail, type Fail } from './Fail.js'
import { andFinally } from './Finalization.js'
import { fx, run, type Fx } from './Fx.js'
import { brand, scope } from './Scope.js'
import { GetState, getState, modifyState, type ModifyState, type Stateful, withState } from './State.js'

describe('State', () => {
  const CounterState = brand<Stateful<number>>()('test/State/Counter')
  const OtherState = brand<Stateful<string>>()('test/State/Other')

  it('gets the initial state', () => {
    const program = getState(CounterState).pipe(withState(CounterState, 1), run)

    assert.equal(program, 1)
  })

  it('modifies state and returns the callback result', () => {
    const program = modifyState(CounterState, count => [count + 1, `count:${count}`]).pipe(
      withState(CounterState, 1),
      run
    )

    assert.equal(program, 'count:1')
  })

  it('repeated modifications see prior updates', () => {
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* modifyState(CounterState, count => [count + 1, undefined])
      return yield* getState(CounterState)
    }).pipe(withState(CounterState, 1), run)

    assert.equal(program, 3)
  })

  it('keeps different state scopes isolated', () => {
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* modifyState(OtherState, value => [`${value}!`, undefined])

      return [yield* getState(CounterState), yield* getState(OtherState)] as const
    }).pipe(
      withState(CounterState, 1),
      withState(OtherState, 'ready'),
      run
    )

    assert.deepEqual(program, [2, 'ready!'])
  })

  it('leaves non-matching state scopes unhandled', () => {
    const program = getState(OtherState).pipe(withState(CounterState, 1))
    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(GetState.is(next.value), true)
    assert.equal((next.value as GetState<typeof OtherState>).scope, OtherState)
  })

  it('allocates state per execution', () => {
    const program = modifyState(CounterState, count => [count + 1, count]).pipe(
      withState(CounterState, 1)
    )

    assert.equal(run(program), 1)
    assert.equal(run(program), 1)
  })

  it('handles state effects requested during scope cleanup', () => {
    let finalizerState = 0
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* andFinally(CounterState, fx(function* () {
        finalizerState = yield* modifyState(CounterState, count => [count + 1, count])
      }))

      return yield* getState(CounterState)
    }).pipe(scope(CounterState), withState(CounterState, 1), returnFail, run)

    assert.equal(program, 2)
    assert.equal(finalizerState, 2)
  })

  it('leaves cleanup state effects typed when withState is inside the scope boundary', () => {
    const program = fx(function* () {
      yield* andFinally(CounterState, modifyState(CounterState, count => [count + 1, undefined]))
      return 'done'
    })
    const wrongOrder = program.pipe(withState(CounterState, 1), scope(CounterState))
    const rightOrder = program.pipe(scope(CounterState), withState(CounterState, 1))

    type WrongEffects = typeof wrongOrder extends Fx<infer E, 'done'> ? E : never
    type RightEffects = typeof rightOrder extends Fx<infer E, 'done'> ? E : never
    const cleanupStateIsVisible: Extract<WrongEffects, ModifyState<typeof CounterState, any>> extends never ? false : true = true
    const cleanupStateIsHandled: Extract<RightEffects, ModifyState<typeof CounterState, any>> extends never ? true : false = true
    const cleanupFailureRemains: RightEffects extends Fail<AggregateError> ? true : false = true

    assert.equal(typeof cleanupStateIsVisible, 'boolean')
    assert.equal(typeof cleanupStateIsHandled, 'boolean')
    assert.equal(typeof cleanupFailureRemains, 'boolean')
  })
})
