import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Fail, fail, returnFail } from './Fail.js'
import { andFinally } from './Finalization.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { scope, withScope } from './Scope.js'
import { GetState, getState, modifyState, type ModifyState, type Stateful, withState, withStateInit } from './State.js'

describe('State', () => {
  const CounterState = scope<Stateful<number>>()('test/State/Counter')
  const OtherState = scope<Stateful<string>>()('test/State/Other')
  const ObjectState = scope<Stateful<{ readonly count: number }>>()('test/State/Object')

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

  it('leaves same-name different state scope tokens unhandled', () => {
    const FirstScope = scope<Stateful<number>>()('test/State/SameName')
    const SecondScope = scope<Stateful<number>>()('test/State/SameName')
    const program = getState(SecondScope).pipe(withState(FirstScope, 1))
    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(GetState.is(next.value), true)
    assert.equal((next.value as GetState<typeof SecondScope>).scope, SecondScope)
  })

  it('allocates state per execution', () => {
    const program = modifyState(CounterState, count => [count + 1, count]).pipe(
      withState(CounterState, 1)
    )

    assert.equal(run(program), 1)
    assert.equal(run(program), 1)
  })

  it('runs state initialization once per execution', () => {
    let initialized = 0
    const initial = fx(function* () {
      initialized += 1
      return { count: initialized }
    })
    const program = getState(ObjectState).pipe(withStateInit(ObjectState, initial))

    assert.deepEqual(run(program), { count: 1 })
    assert.deepEqual(run(program), { count: 2 })
  })

  it('preserves initialization effects', () => {
    const initFailure = new Error('init failed')
    const program = getState(CounterState).pipe(
      withStateInit(CounterState, fail(initFailure)),
      returnFail,
      run
    )

    if (!Fail.is(program)) assert.fail('expected initialization failure')
    assert.equal(program.arg, initFailure)
  })

  it('requires withStateInit when initial state is an Fx', () => {
    const initial = ok(1)

    // @ts-expect-error withState expects a state value, not an Fx that produces one.
    getState(CounterState).pipe(withState(CounterState, initial))

    const program = getState(CounterState).pipe(withStateInit(CounterState, initial), run)

    assert.equal(program, 1)
  })

  it('handles state effects requested during scope cleanup', () => {
    let finalizerState = 0
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* andFinally(CounterState, fx(function* () {
        finalizerState = yield* modifyState(CounterState, count => [count + 1, count])
      }))

      return yield* getState(CounterState)
    }).pipe(withScope(CounterState), withState(CounterState, 1), returnFail, run)

    assert.equal(program, 2)
    assert.equal(finalizerState, 2)
  })

  it('leaves cleanup state effects typed when withState is inside the scope boundary', () => {
    const program = fx(function* () {
      yield* andFinally(CounterState, modifyState(CounterState, count => [count + 1, undefined]))
      return 'done'
    })
    const wrongOrder = program.pipe(withState(CounterState, 1), withScope(CounterState))
    const rightOrder = program.pipe(withScope(CounterState), withState(CounterState, 1))

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
