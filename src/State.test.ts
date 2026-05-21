import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fx, run } from './Fx.js'
import { brand } from './Scope.js'
import { GetState, getState, modifyState, type Stateful, withState } from './State.js'

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
})
